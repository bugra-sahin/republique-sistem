// MODUL: Uyelik + OTP (tek kullanimlik kod ile giris)
// Kayit: ad, soyad, dogum gunu (18+ dogrulama), telefon VEYA e-posta, KVKK onayi.
// Giris: hedefe (telefon/e-posta) tek kullanimlik 6 haneli kod gonderilir, dogrulaninca oturum acilir.
// Guvenlik: kod hash'lenir, 5 dk gecerli, 5 deneme siniri, rate-limit (hedef+ip), imzali oturum cerezi.
// Gonderim: pluggable. SMS_API_URL / EMAIL_API_URL env varsa oraya POST atar (axios). Yoksa
//   kod otp_kodlar tablosunda saklanir + log'a yazilir; admin /api/admin/otp-test ile test edebilir
//   (CANLIYA ALMADAN once gercek SMS/e-posta saglayici baglanmali; bkz. devir notu).
const crypto = require("crypto");
const axios = require("axios");

function sha256(s) { return crypto.createHash("sha256").update(String(s)).digest("hex"); }

function normPhone(p) {
  let d = String(p || "").replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("90")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10) return null;
  return "90" + d;
}
function normEmail(e) {
  const s = String(e || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return null;
  if (s.length > 120) return null;
  return s;
}
function maskTarget(t) {
  if (t.includes("@")) { const [a, b] = t.split("@"); return a.slice(0, 2) + "***@" + b; }
  return "*** *** " + t.slice(-4, -2) + " " + t.slice(-2);
}
// 18+ dogrulama: dogum gunu YYYY-MM-DD. En az 18 tam yil dolmus mu?
function yasHesapla(dogumStr) {
  const d = new Date(dogumStr);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let yas = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) yas--;
  return yas;
}

const _rl = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const rec = _rl.get(key) || { n: 0, t: now };
  if (now - rec.t > windowMs) { rec.n = 0; rec.t = now; }
  rec.n++; _rl.set(key, rec);
  return rec.n > max;
}

// Oturum imzalama (personel modulundeki gibi HMAC). Secret /secrets/kiosk_hmac veya env.
function sessionSecret() {
  try { const fs = require("fs"); if (fs.existsSync("/secrets/kiosk_hmac")) return fs.readFileSync("/secrets/kiosk_hmac", "utf8").trim(); } catch (e) {}
  return process.env.SESSION_SECRET || "republique-dev-secret-degistir";
}
function signSession(uyeId) {
  const payload = String(uyeId) + "." + Date.now();
  const sig = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return payload + "." + sig;
}
function verifySession(cookie) {
  if (!cookie) return null;
  const parts = String(cookie).split(".");
  if (parts.length !== 3) return null;
  const [uyeId, ts, sig] = parts;
  const expect = crypto.createHmac("sha256", sessionSecret()).update(uyeId + "." + ts).digest("hex");
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  if (Date.now() - parseInt(ts) > 180 * 24 * 3600 * 1000) return null; // 180 gun
  return parseInt(uyeId);
}

// OTP gonderimi (pluggable). Basarili gonderim -> true. Fallback -> false (kod tabloda/log'da).
async function sendOtp(hedef, kanal, kod) {
  try {
    if (kanal === "sms" && process.env.SMS_API_URL) {
      await axios.post(process.env.SMS_API_URL, {
        to: hedef, message: `Republique Tunali giris kodunuz: ${kod} (5 dk gecerli)`,
        apikey: process.env.SMS_API_KEY || undefined
      }, { timeout: 10000 });
      return true;
    }
    if (kanal === "email" && process.env.EMAIL_API_URL) {
      await axios.post(process.env.EMAIL_API_URL, {
        to: hedef, subject: "Republique Tunalı giriş kodunuz",
        text: `Giriş kodunuz: ${kod} (5 dakika geçerli).`,
        apikey: process.env.EMAIL_API_KEY || undefined
      }, { timeout: 10000 });
      return true;
    }
  } catch (e) { console.error("OTP gonderim hatasi:", e.message); }
  // Fallback: saglayici yok. Kod tabloda; test icin log'a yaz.
  console.log(`[OTP-FALLBACK] ${kanal} ${maskTarget(hedef)} -> ${kod} (saglayici baglanmali)`);
  return false;
}

function register(app, db) {
  // Mevcut uyeler tablosuna yeni alanlar (varsa atla)
  db.query("ALTER TABLE uyeler ADD COLUMN IF NOT EXISTS soyad TEXT").catch(e => console.error("uyeler soyad:", e.message));
  db.query("ALTER TABLE uyeler ADD COLUMN IF NOT EXISTS dogum_gunu DATE").catch(e => console.error("uyeler dogum_gunu:", e.message));
  db.query("ALTER TABLE uyeler ADD COLUMN IF NOT EXISTS email TEXT").catch(e => console.error("uyeler email:", e.message));
  db.query("ALTER TABLE uyeler ADD COLUMN IF NOT EXISTS email_hash TEXT").catch(e => console.error("uyeler email_hash:", e.message));
  db.query("ALTER TABLE uyeler ADD COLUMN IF NOT EXISTS dogrulandi BOOLEAN DEFAULT false").catch(e => console.error("uyeler dogrulandi:", e.message));
  db.query("ALTER TABLE uyeler ADD COLUMN IF NOT EXISTS son_giris TIMESTAMPTZ").catch(e => console.error("uyeler son_giris:", e.message));
  db.query(`CREATE TABLE IF NOT EXISTS otp_kodlar (
    id SERIAL PRIMARY KEY, hedef TEXT, kanal TEXT, kod_hash TEXT,
    expires_at TIMESTAMPTZ, deneme INT DEFAULT 0, kullanildi BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
  )`).catch(e => console.error("otp_kodlar tablo:", e.message));

  // Hedef (telefon/email) icin OTP uret+kaydet+gonder
  async function otpUret(hedef, kanal) {
    const kod = String(Math.floor(100000 + Math.random() * 900000)); // 6 hane
    const expires = new Date(Date.now() + 5 * 60 * 1000);
    await db.query("UPDATE otp_kodlar SET kullanildi=true WHERE hedef=$1 AND kullanildi=false", [hedef]); // eskiyi iptal et
    await db.query("INSERT INTO otp_kodlar (hedef, kanal, kod_hash, expires_at) VALUES ($1,$2,$3,$4)",
      [hedef, kanal, sha256(kod), expires]);
    const gonderildi = await sendOtp(hedef, kanal, kod);
    return gonderildi;
  }

  // === KAYIT ===
  app.post("/api/uye/kayit", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (rateLimited("uk:" + ip, 8, 60000)) return res.status(429).json({ ok: false, error: "Çok fazla deneme, biraz bekleyin." });
      const { ad, soyad, dogum_gunu, telefon, email, kvkk } = req.body || {};
      if (!kvkk) return res.status(400).json({ ok: false, error: "Devam etmek için KVKK aydınlatma metnini onaylamalısınız." });
      const adT = String(ad || "").slice(0, 60).trim();
      const soyadT = String(soyad || "").slice(0, 60).trim();
      if (adT.length < 2 || soyadT.length < 2) return res.status(400).json({ ok: false, error: "Ad ve soyad giriniz." });
      const yas = yasHesapla(dogum_gunu);
      if (yas === null) return res.status(400).json({ ok: false, error: "Geçerli bir doğum tarihi giriniz." });
      if (yas < 18) return res.status(403).json({ ok: false, error: "Üyelik yalnızca 18 yaş ve üzeri içindir." });
      if (yas > 120) return res.status(400).json({ ok: false, error: "Geçerli bir doğum tarihi giriniz." });
      const tel = telefon ? normPhone(telefon) : null;
      const mail = email ? normEmail(email) : null;
      if (!tel && !mail) return res.status(400).json({ ok: false, error: "Telefon veya e-posta giriniz." });
      const kanal = tel ? "sms" : "email";
      const hedef = tel || mail;
      const repId = (req.cookies && req.cookies.rep_id) || null;
      // Uyeyi olustur/guncelle (dogrulanmadan once dogrulandi=false)
      if (tel) {
        await db.query(
          `INSERT INTO uyeler (isim, soyad, dogum_gunu, telefon, telefon_hash, email, email_hash, rep_id, kvkk_onay, dogrulandi)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,false)
           ON CONFLICT (telefon) DO UPDATE SET isim=EXCLUDED.isim, soyad=EXCLUDED.soyad, dogum_gunu=EXCLUDED.dogum_gunu,
             email=COALESCE(EXCLUDED.email,uyeler.email), email_hash=COALESCE(EXCLUDED.email_hash,uyeler.email_hash), rep_id=COALESCE(EXCLUDED.rep_id,uyeler.rep_id)`,
          [adT, soyadT, dogum_gunu, tel, sha256(tel), mail, mail ? sha256(mail) : null, repId]
        );
      } else {
        // sadece email: telefon UNIQUE index NULL'a izin verir; email icinde ayri kontrol
        const varMi = await db.query("SELECT id FROM uyeler WHERE email=$1 LIMIT 1", [mail]);
        if (varMi.rows.length) {
          await db.query("UPDATE uyeler SET isim=$1, soyad=$2, dogum_gunu=$3, rep_id=COALESCE($4,rep_id) WHERE email=$5",
            [adT, soyadT, dogum_gunu, repId, mail]);
        } else {
          await db.query(
            `INSERT INTO uyeler (isim, soyad, dogum_gunu, email, email_hash, rep_id, kvkk_onay, dogrulandi)
             VALUES ($1,$2,$3,$4,$5,$6,true,false)`,
            [adT, soyadT, dogum_gunu, mail, sha256(mail), repId]
          );
        }
      }
      if (rateLimited("otp:" + hedef, 4, 10 * 60000)) return res.status(429).json({ ok: false, error: "Bu hedefe çok fazla kod istendi, 10 dk sonra tekrar deneyin." });
      const gonderildi = await otpUret(hedef, kanal);
      res.json({ ok: true, kanal, hedefMaskeli: maskTarget(hedef), gonderildi,
        mesaj: `Doğrulama kodu ${kanal === "sms" ? "telefonunuza" : "e-postanıza"} gönderildi (${maskTarget(hedef)}).` });
    } catch (e) { console.error("/api/uye/kayit:", e.message); res.status(500).json({ ok: false, error: "Kayıt alınamadı." }); }
  });

  // === GIRIS (mevcut uyeye kod gonder) ===
  app.post("/api/uye/giris", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (rateLimited("ug:" + ip, 8, 60000)) return res.status(429).json({ ok: false, error: "Çok fazla deneme, biraz bekleyin." });
      const { telefon, email } = req.body || {};
      const tel = telefon ? normPhone(telefon) : null;
      const mail = email ? normEmail(email) : null;
      if (!tel && !mail) return res.status(400).json({ ok: false, error: "Telefon veya e-posta giriniz." });
      const hedef = tel || mail;
      const kanal = tel ? "sms" : "email";
      const q = tel ? await db.query("SELECT id FROM uyeler WHERE telefon=$1 LIMIT 1", [tel])
                    : await db.query("SELECT id FROM uyeler WHERE email=$1 LIMIT 1", [mail]);
      // Bilgi sizdirmamak icin: uye yoksa da "kod gonderildi" de, ama gercekte gonderme.
      if (q.rows.length) {
        if (rateLimited("otp:" + hedef, 4, 10 * 60000)) return res.status(429).json({ ok: false, error: "Bu hedefe çok fazla kod istendi, 10 dk sonra tekrar deneyin." });
        await otpUret(hedef, kanal);
      }
      res.json({ ok: true, kanal, hedefMaskeli: maskTarget(hedef),
        mesaj: `Eğer bu ${kanal === "sms" ? "numara" : "e-posta"} kayıtlıysa doğrulama kodu gönderildi.` });
    } catch (e) { console.error("/api/uye/giris:", e.message); res.status(500).json({ ok: false, error: "İşlem başarısız." }); }
  });

  // === DOGRULA (kod ile oturum ac) ===
  app.post("/api/uye/dogrula", async (req, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (rateLimited("ud:" + ip, 15, 60000)) return res.status(429).json({ ok: false, error: "Çok fazla deneme, biraz bekleyin." });
      const { telefon, email, kod } = req.body || {};
      const tel = telefon ? normPhone(telefon) : null;
      const mail = email ? normEmail(email) : null;
      const hedef = tel || mail;
      const kodT = String(kod || "").replace(/[^0-9]/g, "");
      if (!hedef || kodT.length !== 6) return res.status(400).json({ ok: false, error: "Geçerli hedef ve 6 haneli kod giriniz." });
      const { rows } = await db.query(
        "SELECT id, kod_hash, expires_at, deneme, kullanildi FROM otp_kodlar WHERE hedef=$1 ORDER BY created_at DESC LIMIT 1", [hedef]);
      if (!rows.length) return res.status(400).json({ ok: false, error: "Kod bulunamadı, yeni kod isteyin." });
      const rec = rows[0];
      if (rec.kullanildi) return res.status(400).json({ ok: false, error: "Bu kod kullanılmış, yeni kod isteyin." });
      if (new Date(rec.expires_at).getTime() < Date.now()) return res.status(400).json({ ok: false, error: "Kodun süresi doldu, yeni kod isteyin." });
      if (rec.deneme >= 5) { await db.query("UPDATE otp_kodlar SET kullanildi=true WHERE id=$1", [rec.id]); return res.status(429).json({ ok: false, error: "Çok fazla hatalı deneme, yeni kod isteyin." }); }
      const dogru = rec.kod_hash.length === sha256(kodT).length && crypto.timingSafeEqual(Buffer.from(rec.kod_hash), Buffer.from(sha256(kodT)));
      if (!dogru) { await db.query("UPDATE otp_kodlar SET deneme=deneme+1 WHERE id=$1", [rec.id]); return res.status(400).json({ ok: false, error: "Kod hatalı." }); }
      await db.query("UPDATE otp_kodlar SET kullanildi=true WHERE id=$1", [rec.id]);
      const u = tel ? await db.query("SELECT id, isim, soyad FROM uyeler WHERE telefon=$1 LIMIT 1", [tel])
                    : await db.query("SELECT id, isim, soyad FROM uyeler WHERE email=$1 LIMIT 1", [mail]);
      if (!u.rows.length) return res.status(400).json({ ok: false, error: "Üye kaydı bulunamadı." });
      const uye = u.rows[0];
      await db.query("UPDATE uyeler SET dogrulandi=true, son_giris=now() WHERE id=$1", [uye.id]);
      res.cookie("uye_session", signSession(uye.id), { httpOnly: true, sameSite: "Lax", maxAge: 180 * 24 * 3600 * 1000, secure: true });
      res.json({ ok: true, uye: { ad: uye.isim, soyad: uye.soyad }, mesaj: `Hoş geldiniz ${uye.isim}!` });
    } catch (e) { console.error("/api/uye/dogrula:", e.message); res.status(500).json({ ok: false, error: "Doğrulama başarısız." }); }
  });

  // === BEN (oturum durumu) ===
  app.get("/api/uye/ben", async (req, res) => {
    try {
      const uyeId = verifySession(req.cookies && req.cookies.uye_session);
      if (!uyeId) return res.json({ ok: true, girisli: false });
      const { rows } = await db.query("SELECT isim, soyad, dogum_gunu FROM uyeler WHERE id=$1 LIMIT 1", [uyeId]);
      if (!rows.length) return res.json({ ok: true, girisli: false });
      // Dogum gunu bugun mu? (yil-bagimsiz gun/ay)
      let dogumGunuBugun = false;
      if (rows[0].dogum_gunu) { const d = new Date(rows[0].dogum_gunu); const n = new Date(); dogumGunuBugun = d.getDate() === n.getDate() && d.getMonth() === n.getMonth(); }
      res.json({ ok: true, girisli: true, ad: rows[0].isim, soyad: rows[0].soyad, dogumGunuBugun });
    } catch (e) { res.json({ ok: true, girisli: false }); }
  });

  // === CIKIS ===
  app.post("/api/uye/cikis", (req, res) => { res.clearCookie("uye_session"); res.json({ ok: true }); });

  // === ADMIN: uye listesi (genisletilmis) ===
  app.get("/api/admin/uyeler", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT id, isim, soyad, telefon, email, dogum_gunu, dogrulandi, son_giris, created_at FROM uyeler ORDER BY created_at DESC LIMIT 2000");
      const dogrulanan = rows.filter(r => r.dogrulandi).length;
      res.json({ ok: true, sayi: rows.length, dogrulanan, kayitlar: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // === ADMIN: bekleyen test kodlari (SADECE saglayici baglanana kadar test icin) ===
  app.get("/api/admin/otp-test", async (req, res) => {
    try {
      const { rows } = await db.query("SELECT hedef, kanal, expires_at, kullanildi FROM otp_kodlar ORDER BY created_at DESC LIMIT 20");
      res.json({ ok: true, not: "Gercek gonderim icin SMS_API_URL/EMAIL_API_URL baglayin. Kodlar burada gorunmez (hash).", kayitlar: rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}

module.exports = { register, verifySession, yasHesapla, normPhone, normEmail };
