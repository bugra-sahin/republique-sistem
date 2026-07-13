// MODUL 1: Musteri uyelik + geri bildirim
// - Uyelik: hafif/opsiyonel (isim+telefon, KVKK onayli). Telefon hash'lenir -> CAPI eslesmesi guclenir.
// - Geri bildirim: menude "Gorus Bildir" butonu + (ai-chat sonu) + fis QR. LLM tip siniflandirir.
// - OLUMSUZ -> admin panele dusér, iceride telafi. Review-gating YOK: Google daveti herkese acik.
// Guvenlik: girdi uzunluk siniri, rate-limit (ip+rep), telefon format dogrulama, XSS'e karsi sadece metin saklanir.
const crypto = require("crypto");
const axios = require("axios");

function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

// Telefonu E.164-benzeri normalize et (TR): sadece rakam, bas 0'i at, 90 ekle
function normPhone(p) {
  let d = String(p || "").replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("90")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10) return null;      // TR cep: 5XXXXXXXXX (10 hane)
  return "90" + d;
}

// Basit rate-limit (bellek): ayni anahtar icin penceredeki istek sayisi
const _rl = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const rec = _rl.get(key) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n++;
  _rl.set(key, rec);
  return rec.n > max;
}

// LLM ile tip siniflandirma (olumlu/olumsuz/notr). Anahtar yoksa/hatada anahtar-kelime yedegi.
async function classify(text) {
  const t = String(text || "").slice(0, 1000);
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const resp = await axios.post("https://api.anthropic.com/v1/messages", {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8,
        system: "Sana bir restoran musteri geri bildirimi verilecek. SADECE tek kelime don: olumlu, olumsuz veya notr. Baska hicbir sey yazma.",
        messages: [{ role: "user", content: t }]
      }, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, timeout: 12000 });
      const out = ((resp.data && resp.data.content) || []).map(c => c.text || "").join("").toLowerCase();
      if (out.includes("olumsuz")) return "olumsuz";
      if (out.includes("olumlu")) return "olumlu";
      if (out.includes("notr") || out.includes("nötr")) return "notr";
    } catch (e) { /* yedege dus */ }
  }
  // Yedek: anahtar-kelime
  const s = t.toLowerCase();
  const neg = ["kotu", "kötü", "berbat", "rezalet", "soğuk", "soguk", "gec", "geç", "yavaş", "yavas", "kirli", "pahal", "beğenmedim", "begenmedim", "sikayet", "şikayet", "iyi değil", "iyi degil", "memnun değil", "memnun degil", "kötü"];
  const pos = ["harika", "muhteşem", "muhtesem", "çok iyi", "cok iyi", "güzel", "guzel", "lezzetli", "teşekkür", "tesekkur", "beğendim", "begendim", "memnun", "süper", "super", "10/10", "bayıld", "bayild"];
  if (neg.some(w => s.includes(w))) return "olumsuz";
  if (pos.some(w => s.includes(w))) return "olumlu";
  return "notr";
}

function register(app, db) {
  // Tablolar
  // Tablo ve unique index SIRALI olusturulmali (index tablodan sonra) — aksi halde ON CONFLICT calismaz
  db.query(`CREATE TABLE IF NOT EXISTS uyeler (
    id SERIAL PRIMARY KEY, isim TEXT, telefon TEXT, telefon_hash TEXT,
    rep_id TEXT, masa TEXT, kvkk_onay BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  )`)
    .then(() => db.query(`CREATE UNIQUE INDEX IF NOT EXISTS uyeler_tel_uk ON uyeler(telefon)`))
    .catch(e => console.error("uyeler tablo/index:", e.message));

  db.query(`CREATE TABLE IF NOT EXISTS geri_bildirimler (
    id SERIAL PRIMARY KEY, rep_id TEXT, masa TEXT, kaynak TEXT,
    metin TEXT, tip TEXT DEFAULT 'notr', durum TEXT DEFAULT 'yeni',
    ilgilenen TEXT, admin_not TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  )`).catch(e => console.error("geri_bildirimler tablo:", e.message));

  // === UYELIK (opsiyonel) ===
  app.post("/api/member", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (rateLimited("mem:" + ip, 5, 60000)) return res.status(429).json({ ok: false, error: "Cok fazla deneme, biraz bekleyin." });
      const { isim, telefon, kvkk, masa } = req.body || {};
      const repId = (req.cookies && req.cookies.rep_id) || null;
      if (!kvkk) return res.status(400).json({ ok: false, error: "KVKK onayi gerekli." });
      const tel = normPhone(telefon);
      if (!tel) return res.status(400).json({ ok: false, error: "Gecerli bir telefon giriniz (5XX XXX XX XX)." });
      const ad = String(isim || "").slice(0, 80).trim() || null;
      await db.query(
        `INSERT INTO uyeler (isim, telefon, telefon_hash, rep_id, masa, kvkk_onay)
         VALUES ($1,$2,$3,$4,$5,true)
         ON CONFLICT (telefon) DO UPDATE SET isim=COALESCE(EXCLUDED.isim, uyeler.isim), rep_id=COALESCE(EXCLUDED.rep_id, uyeler.rep_id)`,
        [ad, tel, sha256(tel), repId, masa || null]
      );
      res.json({ ok: true, mesaj: "Tesekkurler! Kaydiniz alindi." });
    } catch (e) { console.error("/api/member:", e.message); res.status(500).json({ ok: false, error: "Kayit alinamadi." }); }
  });

  // === GERI BILDIRIM ===
  app.post("/api/feedback", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (rateLimited("fb:" + ip, 8, 60000)) return res.status(429).json({ ok: false, error: "Cok fazla gonderim, biraz bekleyin." });
      const { metin, masa, kaynak } = req.body || {};
      const repId = (req.cookies && req.cookies.rep_id) || null;
      const text = String(metin || "").slice(0, 2000).trim();
      if (text.length < 2) return res.status(400).json({ ok: false, error: "Lutfen goruslerinizi yazin." });
      const tip = await classify(text);
      const { rows } = await db.query(
        `INSERT INTO geri_bildirimler (rep_id, masa, kaynak, metin, tip, durum)
         VALUES ($1,$2,$3,$4,$5,'yeni') RETURNING id`,
        [repId, masa || null, String(kaynak || "menu").slice(0, 30), text, tip]
      );
      // TEKRAR GELEN mi? (bu rep_id 6 saatten onceki bir ziyaret yapmis -> daha once gelmis)
      // Google yorum daveti YALNIZCA tekrar gelene ve OLUMSUZ olmayana gosterilir (Bugra karari).
      let tekrarGelen = false;
      try {
        if (repId) { const rr = await db.query("SELECT 1 FROM scans WHERE rep_id=$1 AND timestamp < now() - interval '6 hours' LIMIT 1", [repId]); tekrarGelen = rr.rows.length > 0; }
      } catch (e) {}
      const googleDavet = tekrarGelen && tip !== "olumsuz";
      res.json({
        ok: true, id: rows[0].id, tip, tekrarGelen, googleDavet,
        mesaj: tip === "olumsuz"
          ? "Bu deneyim icin cok uzgunuz. Ekibimiz en kisa surede sizinle ilgilenecek — dilerseniz masanizdan bir personelimizi cagirabilirsiniz."
          : (googleDavet
              ? "Tekrar aramizda oldugunuz icin tesekkurler! Bizi Google'da degerlendirmek isterseniz cok memnun oluruz."
              : "Gorusunuz icin cok tesekkurler, not ettik!")
      });
    } catch (e) { console.error("/api/feedback:", e.message); res.status(500).json({ ok: false, error: "Gonderilemedi." }); }
  });

  // === ADMIN: geri bildirim listesi ===
  app.get("/api/admin/feedback", async (req, res) => {
    try {
      const days = Math.min(365, parseInt(req.query.days) || 30);
      const tip = ["olumlu", "olumsuz", "notr"].includes(req.query.tip) ? req.query.tip : null;
      const durum = ["yeni", "ilgilenildi", "cozuldu"].includes(req.query.durum) ? req.query.durum : null;
      const params = [String(days)];
      let sql = "SELECT id, rep_id, masa, kaynak, metin, tip, durum, ilgilenen, admin_not, created_at, updated_at FROM geri_bildirimler WHERE created_at >= now() - ($1||' days')::interval";
      if (tip) { params.push(tip); sql += " AND tip=$" + params.length; }
      if (durum) { params.push(durum); sql += " AND durum=$" + params.length; }
      sql += " ORDER BY (durum='yeni') DESC, (tip='olumsuz') DESC, created_at DESC LIMIT 500";
      const { rows } = await db.query(sql, params);
      const say = await db.query("SELECT tip, durum, COUNT(*)::int c FROM geri_bildirimler GROUP BY tip, durum");
      res.json({ ok: true, kayitlar: rows, ozet: say.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // === ADMIN: geri bildirim durum guncelle ===
  app.post("/api/admin/feedback/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (!id) return res.status(400).json({ ok: false, error: "id gecersiz" });
      const durum = ["yeni", "ilgilenildi", "cozuldu"].includes(req.body.durum) ? req.body.durum : null;
      const ilgilenen = String(req.body.ilgilenen || "").slice(0, 80) || null;
      const not = String(req.body.admin_not || "").slice(0, 1000) || null;
      await db.query(
        "UPDATE geri_bildirimler SET durum=COALESCE($2,durum), ilgilenen=COALESCE($3,ilgilenen), admin_not=COALESCE($4,admin_not), updated_at=now() WHERE id=$1",
        [id, durum, ilgilenen, not]
      );
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // === ADMIN: uye listesi/ozeti ===
  app.get("/api/admin/members", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, isim, telefon, rep_id, masa, created_at FROM uyeler ORDER BY created_at DESC LIMIT 1000");
      res.json({ ok: true, sayi: rows.length, kayitlar: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { register, classify, normPhone };
