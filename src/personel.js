// MODUL 5: Personel mesai (kiosk QR)
// Guvenlik ozeti:
//  - Kiosk QR: sunucu-imzali (HMAC), 10 sn'lik zaman dilimi + ±1 dilim tolerans -> ekran goruntusu ~20sn'de gecersiz.
//  - Kiosk cihaz kilidi: yalnizca Bugra'nin onayladigi tarayici token uretebilir/isteyebilir.
//  - Personel: sifre ilk giriste kendi belirler (scrypt hash), TEK cihaz (yeni onay eskiyi duserir).
//  - Personel yalnizca QR okutup kendi kayitlarini gorur; avans/izin/maas/duzeltme yalnizca admin.
//  - Tum panel islemleri audit_log'a duser (server.js middleware /api/admin altini logluyor).
const crypto = require("crypto");
const fs = require("fs");

// --- Gizli anahtar (kalici): /secrets/kiosk_hmac; yoksa uret+yaz; olmazsa env/turetilmis ---
let _SECRET = null;
function SECRET() {
  if (_SECRET) return _SECRET;
  try {
    if (fs.existsSync("/secrets/kiosk_hmac")) {
      const v = fs.readFileSync("/secrets/kiosk_hmac", "utf8").trim();
      if (v) { _SECRET = v; return _SECRET; }
    }
    const gen = crypto.randomBytes(32).toString("hex");
    try { fs.writeFileSync("/secrets/kiosk_hmac", gen, { mode: 0o600 }); } catch (e) {}
    _SECRET = gen; return _SECRET;
  } catch (e) {
    _SECRET = process.env.KIOSK_HMAC_SECRET || (process.env.ADMINPW || "republique") + "-kiosk-fallback";
    return _SECRET;
  }
}
function hmac(data) { return crypto.createHmac("sha256", SECRET()).update(String(data)).digest("hex"); }

// --- Sifre hash (scrypt) ---
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return { salt, hash: h };
}
function verifyPw(pw, salt, hash) {
  try {
    const h = crypto.scryptSync(String(pw), salt, 32).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
  } catch (e) { return false; }
}

// --- Kiosk token (zaman dilimli HMAC) ---
function makeKioskToken() {
  const slot = Math.floor(Date.now() / 10000);
  const sig = hmac("k:" + slot).slice(0, 16);
  return slot + "." + sig;
}
function verifyKioskToken(tok) {
  const m = String(tok || "").match(/^(\d+)\.([a-f0-9]{16})$/);
  if (!m) return false;
  const slot = parseInt(m[1]);
  const now = Math.floor(Date.now() / 10000);
  if (Math.abs(now - slot) > 1) return false;         // ±1 dilim (~20sn)
  const expected = hmac("k:" + slot).slice(0, 16);
  if (m[2].length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected)) ? slot : false;
}

// --- Tek-kullanimlik (replay) korumasi: (personel,slot,action) bellek seti ---
const _used = new Map();
function markUsed(k) { _used.set(k, Date.now()); }
function isUsed(k) { return _used.has(k); }
setInterval(() => { const t = Date.now(); for (const [k, v] of _used) if (t - v > 60000) _used.delete(k); }, 30000);

// --- Oturum cookie'si (personel) ---
function makeSession(personelId, deviceId) {
  const exp = Date.now() + 12 * 3600 * 1000; // 12 saat
  const sig = hmac("s:" + personelId + ":" + deviceId + ":" + exp).slice(0, 32);
  return personelId + "." + deviceId + "." + exp + "." + sig;
}
function parseSession(c) {
  const m = String(c || "").match(/^(\d+)\.(\d+)\.(\d+)\.([a-f0-9]{32})$/);
  if (!m) return null;
  const [_, pid, did, exp, sig] = m;
  if (parseInt(exp) < Date.now()) return null;
  const expected = hmac("s:" + pid + ":" + did + ":" + exp).slice(0, 32);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { personelId: parseInt(pid), deviceId: parseInt(did) };
}

function ipOf(req) { return (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(); }

function register(app, db) {
  // ===== TABLOLAR =====
  const T = [
    `CREATE TABLE IF NOT EXISTS personeller (
      id SERIAL PRIMARY KEY, ad TEXT NOT NULL, telefon TEXT, aktif BOOLEAN DEFAULT true,
      sifre_hash TEXT, sifre_salt TEXT, ilk_giris BOOLEAN DEFAULT true,
      yillik_izin_gun INTEGER DEFAULT 14, created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS personel_cihazlari (
      id SERIAL PRIMARY KEY, personel_id INTEGER, cihaz_key TEXT, user_agent TEXT,
      onayli BOOLEAN DEFAULT false, aktif BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS kiosk_cihazlari (
      id SERIAL PRIMARY KEY, cihaz_key TEXT UNIQUE, ad TEXT, onayli BOOLEAN DEFAULT false,
      aktif BOOLEAN DEFAULT true, user_agent TEXT, created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS mesai_olaylari (
      id SERIAL PRIMARY KEY, personel_id INTEGER, tip TEXT, ts TIMESTAMPTZ DEFAULT now(),
      kiosk_slot BIGINT, created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS avanslar (
      id SERIAL PRIMARY KEY, personel_id INTEGER, tutar NUMERIC(10,2), tarih DATE DEFAULT CURRENT_DATE,
      not_metni TEXT, giren TEXT, created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS izinler (
      id SERIAL PRIMARY KEY, personel_id INTEGER, baslangic DATE, bitis DATE, gun NUMERIC(5,1),
      tip TEXT DEFAULT 'yillik', not_metni TEXT, giren TEXT, created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS maas_odemeleri (
      id SERIAL PRIMARY KEY, personel_id INTEGER, tutar NUMERIC(10,2), donem TEXT, tarih DATE DEFAULT CURRENT_DATE,
      not_metni TEXT, giren TEXT, created_at TIMESTAMPTZ DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS duzeltmeler (
      id SERIAL PRIMARY KEY, personel_id INTEGER, tip TEXT, dakika INTEGER, gerekce TEXT,
      giren TEXT, ts TIMESTAMPTZ DEFAULT now()
    )`
  ];
  T.forEach(q => db.query(q).catch(e => console.error("personel tablo:", e.message)));

  // ===== DURUM MAKINESI =====
  // olaylar (kronolojik) -> mevcut durum
  function stateFromEvents(evs) {
    if (!evs.length) return "disarida";
    const last = evs[evs.length - 1].tip;
    if (last === "cikis") return "disarida";
    if (last === "giris" || last === "mola_bitir") return "mesai";
    if (last === "mola_basla") return "mola";
    return "disarida";
  }
  function optionsFor(state) {
    if (state === "disarida") return ["giris"];
    if (state === "mesai") return ["mola_basla", "cikis"];
    if (state === "mola") return ["mola_bitir"];
    return [];
  }
  const TR = { giris: "Mesai Başlat", mola_basla: "Molaya Çık", mola_bitir: "Moladan Dön", cikis: "Mesai Bitir" };

  // Bugunku olaylar (Istanbul gunu; UTC+3)
  async function todayEvents(personelId) {
    const { rows } = await db.query(
      "SELECT tip, ts FROM mesai_olaylari WHERE personel_id=$1 AND ts >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul') ORDER BY ts ASC",
      [personelId]
    );
    return rows;
  }
  // Calisma dakikasi (mola dusulmus) — bir gunun olaylarindan
  function workedMinutes(evs) {
    let total = 0, inStart = null, onBreakFrom = null, breakMs = 0;
    for (const e of evs) {
      const t = new Date(e.ts).getTime();
      if (e.tip === "giris") { inStart = t; breakMs = 0; }
      else if (e.tip === "mola_basla") { onBreakFrom = t; }
      else if (e.tip === "mola_bitir") { if (onBreakFrom) { breakMs += t - onBreakFrom; onBreakFrom = null; } }
      else if (e.tip === "cikis") { if (inStart) { total += (t - inStart - breakMs); inStart = null; } }
    }
    return Math.max(0, Math.round(total / 60000));
  }

  // ===== PERSONEL AUTH MIDDLEWARE =====
  async function personelAuth(req, res, next) {
    const s = parseSession(req.cookies && req.cookies.psess);
    if (!s) return res.status(401).json({ ok: false, error: "Giris gerekli", login: true });
    try {
      const { rows } = await db.query(
        "SELECT d.id did, d.onayli, d.aktif, p.id pid, p.ad, p.aktif paktif FROM personel_cihazlari d JOIN personeller p ON p.id=d.personel_id WHERE d.id=$1 AND d.personel_id=$2",
        [s.deviceId, s.personelId]
      );
      const r = rows[0];
      if (!r || !r.onayli || !r.aktif || !r.paktif) return res.status(401).json({ ok: false, error: "Cihaz/oturum gecersiz", login: true });
      req.personel = { id: r.pid, ad: r.ad, deviceId: r.did };
      next();
    } catch (e) { res.status(500).json({ ok: false, error: "sunucu" }); }
  }

  // ===== SAYFA ROUTE'LARI =====
  const pdir = require("path").join(__dirname, "..", "public", "personel");
  app.get("/personel", (req, res) => res.sendFile(require("path").join(pdir, "index.html")));
  app.get("/personel/qr", (req, res) => res.sendFile(require("path").join(pdir, "kiosk.html")));

  // ===== KIOSK API =====
  // Kiosk kayit talebi (cihaz onayi icin)
  app.post("/api/kiosk/register", async (req, res) => {
    try {
      const key = String((req.body && req.body.key) || "").slice(0, 80);
      if (!/^[a-z0-9]{16,80}$/i.test(key)) return res.status(400).json({ ok: false, error: "gecersiz anahtar" });
      const ua = (req.headers["user-agent"] || "").slice(0, 200);
      await db.query(
        `INSERT INTO kiosk_cihazlari (cihaz_key, ad, user_agent, onayli) VALUES ($1,$2,$3,false)
         ON CONFLICT (cihaz_key) DO NOTHING`,
        [key, "Kiosk " + key.slice(0, 6), ua]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  // Kiosk durum (onaylandi mi?)
  app.get("/api/kiosk/status", async (req, res) => {
    try {
      const key = String(req.query.key || "");
      const { rows } = await db.query("SELECT onayli, aktif FROM kiosk_cihazlari WHERE cihaz_key=$1", [key]);
      const r = rows[0];
      res.json({ ok: true, onayli: !!(r && r.onayli && r.aktif) });
    } catch (e) { res.status(500).json({ ok: false }); }
  });
  // Kiosk token (yalnizca onayli kiosk) — 10sn'de bir cagirilir
  app.get("/api/kiosk/token", async (req, res) => {
    try {
      const key = String(req.query.key || "");
      const { rows } = await db.query("SELECT onayli, aktif FROM kiosk_cihazlari WHERE cihaz_key=$1", [key]);
      const r = rows[0];
      if (!r || !r.onayli || !r.aktif) return res.status(403).json({ ok: false, error: "cihaz onayli degil" });
      res.json({ ok: true, token: makeKioskToken(), ttl: 10 });
    } catch (e) { res.status(500).json({ ok: false }); }
  });

  // ===== PERSONEL AUTH API =====
  // Giris / ilk kayit. body: {ad, sifre, deviceKey}
  app.post("/api/personel/login", async (req, res) => {
    try {
      const ad = String((req.body && req.body.ad) || "").trim().slice(0, 80);
      const sifre = String((req.body && req.body.sifre) || "");
      const deviceKey = String((req.body && req.body.deviceKey) || "").slice(0, 80);
      if (!ad || sifre.length < 4 || !/^[a-z0-9]{16,80}$/i.test(deviceKey))
        return res.status(400).json({ ok: false, error: "Ad, en az 4 haneli sifre ve cihaz gerekli." });
      const { rows } = await db.query("SELECT * FROM personeller WHERE lower(ad)=lower($1) AND aktif=true", [ad]);
      const p = rows[0];
      if (!p) return res.status(404).json({ ok: false, error: "Personel bulunamadi. Yoneticinize kaydettirin." });

      // Ilk giris -> sifre belirle
      if (p.ilk_giris || !p.sifre_hash) {
        const { salt, hash } = hashPw(sifre);
        await db.query("UPDATE personeller SET sifre_hash=$2, sifre_salt=$3, ilk_giris=false WHERE id=$1", [p.id, hash, salt]);
      } else if (!verifyPw(sifre, p.sifre_salt, p.sifre_hash)) {
        return res.status(401).json({ ok: false, error: "Sifre hatali." });
      }

      // Cihaz: bu personelin bu cihazi var mi?
      let dev = (await db.query("SELECT * FROM personel_cihazlari WHERE personel_id=$1 AND cihaz_key=$2", [p.id, deviceKey])).rows[0];
      if (!dev) {
        const ins = await db.query(
          "INSERT INTO personel_cihazlari (personel_id, cihaz_key, user_agent, onayli, aktif) VALUES ($1,$2,$3,false,true) RETURNING *",
          [p.id, deviceKey, (req.headers["user-agent"] || "").slice(0, 200)]
        );
        dev = ins.rows[0];
      }
      if (!dev.onayli) return res.json({ ok: true, bekliyor: true, mesaj: "Cihaziniz yonetici onayi bekliyor." });

      const psess = makeSession(p.id, dev.id);
      res.cookie("psess", psess, { httpOnly: true, sameSite: "lax", maxAge: 12 * 3600 * 1000 });
      res.json({ ok: true, ad: p.ad });
    } catch (e) { console.error("personel/login:", e.message); res.status(500).json({ ok: false, error: "sunucu" }); }
  });

  app.post("/api/personel/logout", (req, res) => { res.clearCookie("psess"); res.json({ ok: true }); });

  // Durum + bu ay ozet (salt-okunur)
  app.get("/api/personel/me", personelAuth, async (req, res) => {
    try {
      const pid = req.personel.id;
      const evs = await todayEvents(pid);
      const state = stateFromEvents(evs);
      const worked = workedMinutes(evs);
      const p = (await db.query("SELECT yillik_izin_gun FROM personeller WHERE id=$1", [pid])).rows[0] || {};
      // bu ay toplam calisma (gunluk hesaplanip toplanir)
      const monthEvs = (await db.query(
        "SELECT tip, ts FROM mesai_olaylari WHERE personel_id=$1 AND ts >= date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul') ORDER BY ts ASC", [pid])).rows;
      // gunlere ayir
      const byDay = {};
      for (const e of monthEvs) { const k = new Date(e.ts).toISOString().slice(0, 10); (byDay[k] = byDay[k] || []).push(e); }
      let ayDk = 0; for (const k in byDay) ayDk += workedMinutes(byDay[k]);
      const izinKullanilan = (await db.query("SELECT COALESCE(SUM(gun),0) s FROM izinler WHERE personel_id=$1 AND date_part('year',baslangic)=date_part('year',now())", [pid])).rows[0].s;
      const avanslar = (await db.query("SELECT tutar, tarih, not_metni FROM avanslar WHERE personel_id=$1 ORDER BY tarih DESC LIMIT 24", [pid])).rows;
      res.json({
        ok: true, ad: req.personel.ad, durum: state, options: optionsFor(state), tr: TR,
        bugunDk: worked, ayDk, yillikIzin: p.yillik_izin_gun, izinKullanilan: Number(izinKullanilan) || 0, avanslar
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Punch: token dogrula. action yoksa secenek don; varsa isle.
  app.post("/api/personel/punch", personelAuth, async (req, res) => {
    try {
      const pid = req.personel.id;
      const slot = verifyKioskToken(req.body && req.body.token);
      if (slot === false) return res.status(400).json({ ok: false, error: "QR gecersiz ya da suresi doldu. Kiosk ekranindaki guncel QR'i okutun." });
      const evs = await todayEvents(pid);
      const state = stateFromEvents(evs);
      const opts = optionsFor(state);
      const action = req.body && req.body.action;
      if (!action) return res.json({ ok: true, durum: state, options: opts, tr: TR });
      if (!opts.includes(action)) return res.status(409).json({ ok: false, error: "Bu islem su an gecerli degil.", durum: state, options: opts });
      const usedKey = pid + ":" + slot + ":" + action;
      if (isUsed(usedKey)) return res.status(409).json({ ok: false, error: "Bu QR zaten kullanildi, yeni QR okutun." });
      markUsed(usedKey);
      await db.query("INSERT INTO mesai_olaylari (personel_id, tip, kiosk_slot) VALUES ($1,$2,$3)", [pid, action, slot]);
      const evs2 = await todayEvents(pid);
      res.json({ ok: true, islendi: action, durum: stateFromEvents(evs2), tr: TR, bugunDk: workedMinutes(evs2) });
    } catch (e) { console.error("punch:", e.message); res.status(500).json({ ok: false, error: "sunucu" }); }
  });

  // ===== ADMIN API (/api/admin/personel/*) — server.js adminAuth korur + audit'ler =====
  app.get("/api/admin/personel/list", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, ad, telefon, aktif, ilk_giris, yillik_izin_gun, created_at FROM personeller ORDER BY aktif DESC, ad ASC");
      // her personel icin bugunku durum
      for (const p of rows) { const evs = await todayEvents(p.id); p.durum = stateFromEvents(evs); p.bugunDk = workedMinutes(evs); }
      res.json({ ok: true, kayitlar: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post("/api/admin/personel/add", async (req, res) => {
    try {
      const ad = String((req.body && req.body.ad) || "").trim().slice(0, 80);
      const tel = String((req.body && req.body.telefon) || "").slice(0, 20) || null;
      if (!ad) return res.status(400).json({ ok: false, error: "ad gerekli" });
      const { rows } = await db.query("INSERT INTO personeller (ad, telefon) VALUES ($1,$2) RETURNING id", [ad, tel]);
      res.json({ ok: true, id: rows[0].id });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post("/api/admin/personel/remove", async (req, res) => {
    try { await db.query("UPDATE personeller SET aktif=false WHERE id=$1", [parseInt(req.body.id)]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Sifre sifirla (yeniden kayit talebi) — ilk_giris'e cevir
  app.post("/api/admin/personel/reset-password", async (req, res) => {
    try { await db.query("UPDATE personeller SET ilk_giris=true, sifre_hash=NULL, sifre_salt=NULL WHERE id=$1", [parseInt(req.body.id)]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Bekleyen cihaz/kiosk talepleri
  app.get("/api/admin/personel/requests", async (req, res) => {
    try {
      const pdev = (await db.query(
        "SELECT d.id, d.personel_id, p.ad, d.user_agent, d.created_at FROM personel_cihazlari d JOIN personeller p ON p.id=d.personel_id WHERE d.onayli=false AND d.aktif=true ORDER BY d.created_at DESC")).rows;
      const kiosk = (await db.query("SELECT id, cihaz_key, ad, user_agent, created_at FROM kiosk_cihazlari WHERE onayli=false AND aktif=true ORDER BY created_at DESC")).rows;
      res.json({ ok: true, personel: pdev, kiosk });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Cihaz onayla: {tip:'personel'|'kiosk', id}
  app.post("/api/admin/personel/approve", async (req, res) => {
    try {
      const tip = req.body.tip, id = parseInt(req.body.id);
      if (tip === "personel") {
        const d = (await db.query("SELECT personel_id FROM personel_cihazlari WHERE id=$1", [id])).rows[0];
        if (!d) return res.status(404).json({ ok: false });
        // yeni onay eskiyi duserir (tek cihaz)
        await db.query("UPDATE personel_cihazlari SET aktif=false WHERE personel_id=$1 AND id<>$2", [d.personel_id, id]);
        await db.query("UPDATE personel_cihazlari SET onayli=true, aktif=true WHERE id=$1", [id]);
      } else if (tip === "kiosk") {
        await db.query("UPDATE kiosk_cihazlari SET onayli=true, aktif=true WHERE id=$1", [id]);
      } else return res.status(400).json({ ok: false, error: "tip" });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post("/api/admin/personel/revoke", async (req, res) => {
    try {
      const tip = req.body.tip, id = parseInt(req.body.id);
      if (tip === "personel") await db.query("UPDATE personel_cihazlari SET aktif=false, onayli=false WHERE id=$1", [id]);
      else if (tip === "kiosk") await db.query("UPDATE kiosk_cihazlari SET aktif=false WHERE id=$1", [id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Canli durum panosu
  app.get("/api/admin/personel/live", async (req, res) => {
    try {
      const ps = (await db.query("SELECT id, ad FROM personeller WHERE aktif=true ORDER BY ad")).rows;
      for (const p of ps) {
        const evs = await todayEvents(p.id);
        p.durum = stateFromEvents(evs);
        p.bugunDk = workedMinutes(evs);
        p.sonOlay = evs.length ? evs[evs.length - 1].ts : null;
      }
      res.json({ ok: true, kayitlar: ps });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Gunluk zaman cizelgesi
  app.get("/api/admin/personel/timeline", async (req, res) => {
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : null;
      const params = []; let sql = "SELECT m.id, m.personel_id, p.ad, m.tip, m.ts FROM mesai_olaylari m JOIN personeller p ON p.id=m.personel_id";
      if (date) { params.push(date); sql += " WHERE m.ts::date = $1"; }
      else sql += " WHERE m.ts >= now() - interval '1 day'";
      sql += " ORDER BY m.ts DESC LIMIT 500";
      const { rows } = await db.query(sql, params);
      res.json({ ok: true, kayitlar: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Duzeltme/kesinti (gerekceli, audit'li)
  app.post("/api/admin/personel/duzeltme", async (req, res) => {
    try {
      const pid = parseInt(req.body.personel_id), dk = parseInt(req.body.dakika) || 0;
      const tip = ["kesinti", "ekleme", "ihlal"].includes(req.body.tip) ? req.body.tip : "kesinti";
      const gerekce = String(req.body.gerekce || "").slice(0, 500);
      if (!pid || !gerekce) return res.status(400).json({ ok: false, error: "personel, dakika ve gerekce gerekli" });
      await db.query("INSERT INTO duzeltmeler (personel_id, tip, dakika, gerekce, giren) VALUES ($1,$2,$3,$4,$5)",
        [pid, tip, dk, gerekce, "admin"]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  // Avans / izin / maas
  app.post("/api/admin/personel/avans", async (req, res) => {
    try { await db.query("INSERT INTO avanslar (personel_id, tutar, not_metni, giren) VALUES ($1,$2,$3,'admin')",
      [parseInt(req.body.personel_id), parseFloat(req.body.tutar) || 0, String(req.body.not || "").slice(0, 300)]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post("/api/admin/personel/izin", async (req, res) => {
    try { await db.query("INSERT INTO izinler (personel_id, baslangic, bitis, gun, tip, giren) VALUES ($1,$2,$3,$4,$5,'admin')",
      [parseInt(req.body.personel_id), req.body.baslangic, req.body.bitis, parseFloat(req.body.gun) || 0, String(req.body.tip || "yillik").slice(0, 30)]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
  app.post("/api/admin/personel/maas", async (req, res) => {
    try { await db.query("INSERT INTO maas_odemeleri (personel_id, tutar, donem, giren) VALUES ($1,$2,$3,'admin')",
      [parseInt(req.body.personel_id), parseFloat(req.body.tutar) || 0, String(req.body.donem || "").slice(0, 20)]); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Personel detay (admin)
  app.get("/api/admin/personel/detay", async (req, res) => {
    try {
      const pid = parseInt(req.query.id);
      const p = (await db.query("SELECT id, ad, telefon, aktif, yillik_izin_gun FROM personeller WHERE id=$1", [pid])).rows[0];
      if (!p) return res.status(404).json({ ok: false });
      const avanslar = (await db.query("SELECT tutar, tarih, not_metni FROM avanslar WHERE personel_id=$1 ORDER BY tarih DESC LIMIT 50", [pid])).rows;
      const izinler = (await db.query("SELECT baslangic, bitis, gun, tip FROM izinler WHERE personel_id=$1 ORDER BY baslangic DESC LIMIT 50", [pid])).rows;
      const maaslar = (await db.query("SELECT tutar, donem, tarih FROM maas_odemeleri WHERE personel_id=$1 ORDER BY tarih DESC LIMIT 50", [pid])).rows;
      const duzeltmeler = (await db.query("SELECT tip, dakika, gerekce, giren, ts FROM duzeltmeler WHERE personel_id=$1 ORDER BY ts DESC LIMIT 50", [pid])).rows;
      res.json({ ok: true, personel: p, avanslar, izinler, maaslar, duzeltmeler });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Bordro (aylik) — CSV (Excel acar)
  app.get("/api/admin/personel/bordro.csv", async (req, res) => {
    try {
      const ay = /^\d{4}-\d{2}$/.test(req.query.ay || "") ? req.query.ay : new Date().toISOString().slice(0, 7);
      const ps = (await db.query("SELECT id, ad FROM personeller WHERE aktif=true ORDER BY ad")).rows;
      const lines = ["Personel;Calisma Saati;Duzeltme(dk);Avans TL;Maas TL;Donem"];
      for (const p of ps) {
        const evs = (await db.query(
          "SELECT tip, ts FROM mesai_olaylari WHERE personel_id=$1 AND to_char(ts AT TIME ZONE 'Europe/Istanbul','YYYY-MM')=$2 ORDER BY ts ASC", [p.id, ay])).rows;
        const byDay = {}; for (const e of evs) { const k = new Date(e.ts).toISOString().slice(0, 10); (byDay[k] = byDay[k] || []).push(e); }
        let dk = 0; for (const k in byDay) dk += workedMinutes(byDay[k]);
        const duz = (await db.query("SELECT COALESCE(SUM(CASE WHEN tip='ekleme' THEN dakika ELSE -dakika END),0) s FROM duzeltmeler WHERE personel_id=$1 AND to_char(ts,'YYYY-MM')=$2", [p.id, ay])).rows[0].s;
        const avans = (await db.query("SELECT COALESCE(SUM(tutar),0) s FROM avanslar WHERE personel_id=$1 AND to_char(tarih,'YYYY-MM')=$2", [p.id, ay])).rows[0].s;
        const maas = (await db.query("SELECT COALESCE(SUM(tutar),0) s FROM maas_odemeleri WHERE personel_id=$1 AND donem=$2", [p.id, ay])).rows[0].s;
        const saat = ((dk + Number(duz)) / 60).toFixed(1);
        lines.push([p.ad, saat, duz, avans, maas, ay].join(";"));
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="bordro-' + ay + '.csv"');
      res.send("﻿" + lines.join("\n"));
    } catch (e) { res.status(500).send("hata: " + e.message); }
  });

  // Ihlal raporu: (a) acik mola > 90dk, (b) cikis okutmadan gun bitmis (dun ve oncesi acik mesai)
  app.get("/api/admin/personel/ihlal", async (req, res) => {
    try {
      const ps = (await db.query("SELECT id, ad FROM personeller WHERE aktif=true")).rows;
      const ihlaller = [];
      for (const p of ps) {
        const evs = (await db.query(
          "SELECT tip, ts FROM mesai_olaylari WHERE personel_id=$1 AND ts >= now() - interval '14 days' ORDER BY ts ASC", [p.id])).rows;
        const byDay = {}; for (const e of evs) { const k = new Date(e.ts).toISOString().slice(0, 10); (byDay[k] = byDay[k] || []).push(e); }
        const bugun = new Date().toISOString().slice(0, 10);
        for (const k in byDay) {
          const st = stateFromEvents(byDay[k]);
          if (k < bugun && st !== "disarida") ihlaller.push({ personel: p.ad, tarih: k, tur: "Çıkış okutulmamış (gün açık kalmış)" });
          if (k === bugun && st === "mola") {
            const last = byDay[k][byDay[k].length - 1];
            if (Date.now() - new Date(last.ts).getTime() > 90 * 60000) ihlaller.push({ personel: p.ad, tarih: k, tur: "Uzun mola (90dk+, dönüş okutulmamış)" });
          }
        }
      }
      res.json({ ok: true, kayitlar: ihlaller });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { register };
