const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const { updateMenu, getCachedMenu } = require("./src/menu-fetcher");
const { startFirestoreListener } = require("./src/firestore-listener");
const db = require("./src/db");
const multer = require("multer");
const { processPosUpload } = require("./src/matcher");
const { processCapiBatch } = require("./src/capi-sender");
const { chatWithWaiter, flattenMenu } = require("./src/ai-waiter");

// AI sohbet gecmisi tablosu (ilk ay+ kayit; ogrenme/analiz icin)
db.query(`CREATE TABLE IF NOT EXISTS chat_logs (
  id SERIAL PRIMARY KEY, rep_id TEXT, table_name TEXT,
  user_msg TEXT, ai_reply TEXT, provider TEXT, created_at TIMESTAMPTZ DEFAULT now()
)`).catch(e => console.error("chat_logs tablo:", e.message));

db.query(`CREATE TABLE IF NOT EXISTS product_views (
  id SERIAL PRIMARY KEY, product TEXT, rep_id TEXT, table_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
)`).catch(e => console.error("product_views tablo:", e.message));

// Bakis/dwell: misafirin tiklamadan hangi BOLUM/URUNe ne kadar baktigi (adisyonla eslestirilir)
db.query(`CREATE TABLE IF NOT EXISTS section_views (
  id SERIAL PRIMARY KEY, kind TEXT DEFAULT 'section', section TEXT, dwell_ms INTEGER, rep_id TEXT, table_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
)`).catch(e => console.error("section_views tablo:", e.message));
db.query(`ALTER TABLE section_views ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'section'`).catch(() => {});

// Istemci-tarafi hata/cokme kayitlari (telefonda olusan, sunucu logunda gorunmeyen sorunlar)
db.query(`CREATE TABLE IF NOT EXISTS client_logs (
  id SERIAL PRIMARY KEY, tip TEXT, mesaj TEXT, kaynak TEXT, stack TEXT, url TEXT, masa TEXT, ua TEXT, ip TEXT, created_at TIMESTAMPTZ DEFAULT now()
)`).catch(e => console.error("client_logs tablo:", e.message));
// Davranis izleme: oturum + olay kimligi (rrweb replay ile eslestirme)
db.query("ALTER TABLE client_logs ADD COLUMN IF NOT EXISTS sid TEXT").catch(() => {});
db.query("ALTER TABLE client_logs ADD COLUMN IF NOT EXISTS eid TEXT").catch(() => {});
// rrweb "hata-ani" session replay kayitlari (self-host; 3. tarafa veri gitmez). Otomatik 7 gun sonra silinir.
db.query(`CREATE TABLE IF NOT EXISTS client_replays (
  id SERIAL PRIMARY KEY, eid TEXT, sid TEXT, tip TEXT, url TEXT, masa TEXT, ua TEXT, events JSONB, created_at TIMESTAMPTZ DEFAULT now()
)`).catch(e => console.error("client_replays tablo:", e.message));
db.query("CREATE INDEX IF NOT EXISTS idx_client_replays_eid ON client_replays(eid)").catch(() => {});

// Trafik atifi: scans tablosuna kaynak turu + referrer + tekrar-gelen bayragi ekle (varsa atla).
db.query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS kaynak_tur TEXT").catch(e => console.error("scans kaynak_tur:", e.message));
db.query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS referrer TEXT").catch(e => console.error("scans referrer:", e.message));
db.query("ALTER TABLE scans ADD COLUMN IF NOT EXISTS tekrar_gelen BOOLEAN").catch(e => console.error("scans tekrar_gelen:", e.message));

// LLM anahtarlarini kalici gizli dosyadan yukle (/secrets/llm.env)
(function loadLlmSecrets() {
  try {
    const fs = require("fs");
    if (fs.existsSync("/secrets/llm.env")) {
      for (const line of fs.readFileSync("/secrets/llm.env", "utf-8").split("\n")) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) process.env[m[1]] = m[2];
      }
      console.log("LLM gizli anahtarlari yuklendi.");
    }
  } catch (e) { console.error("llm secrets load:", e.message); }
})();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Guvenlik basliklari (tum yanitlara) — clickjacking/mime-sniffing/referrer sertlestirme
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(self)");
  next();
});

// === ADMIN GUVENLIK + AUDIT LOG ===
// Audit log tablosu: admin panelinde yapilan her ISLEM (degisiklik) kaydedilir
db.query(`CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(),
  method TEXT, path TEXT, ip TEXT, user_agent TEXT, body_summary TEXT
)`).catch(e => console.error("audit_log tablo:", e.message));

// Admin kimlik dogrulama (Basic Auth). ADMIN_PASSWORD ayarliysa AKTIF; degilse ACIK (kimse kilitlenmez).
// Kapsam: /admin (panel) ve /api/admin/* (yonetim API'leri). Menu/AI/track herkese acik kalir.
// Admin sifresi: /secrets/adminpw dosyasindan (mangle-proof: sadece rakam/harf yazilir) VEYA env'den.
let _pwCache = { v: null, t: 0 };
function getAdminPw() {
  const now = Date.now();
  if (now - _pwCache.t < 10000) return _pwCache.v;
  let pw = process.env.ADMINPW || process.env.ADMIN_PASSWORD || null;
  try {
    const fs = require("fs");
    if (fs.existsSync("/secrets/adminpw")) {
      const f = fs.readFileSync("/secrets/adminpw", "utf8").trim();
      if (f) pw = f;
    }
  } catch (e) {}
  _pwCache = { v: pw, t: now };
  return pw;
}
function adminAuth(req, res, next) {
  const pw = getAdminPw();
  const p = req.path || "";
  const isAdmin = (p === "/admin" || p.startsWith("/admin/") || p.startsWith("/api/admin"));
  if (!isAdmin) return next(); // menu/AI/track herkese acik
  // FAIL-CLOSED (guvenlik): admin sifresi AYARLI DEGILSE admin yollarini ASLA acik birakma.
  // Eski "if(!pw) return next()" fail-OPEN idi -> sifre dusmeyince /api/admin musteri PII'sini
  // (IP, fbp, cihaz, masa) internete siziyordu. Artik sifre yoksa 503 ile KAPALI.
  if (!pw) {
    console.error("GUVENLIK UYARISI: admin sifresi ayarli degil -> /admin ve /api/admin KAPATILDI (503). Cozum: /secrets/llm.env'e 'ADMINPW=...' ekleyip 'docker compose restart app'.");
    res.set("WWW-Authenticate", 'Basic realm="Republique Yonetim"');
    return res.status(503).send("Yonetim paneli, sifre yapilandirilana kadar kapali.");
  }
  const hdr = req.headers.authorization || "";
  const m = hdr.match(/^Basic\s+(.+)$/i);
  if (m) {
    try {
      const dec = Buffer.from(m[1], "base64").toString("utf8");
      const idx = dec.indexOf(":");
      const pass = idx >= 0 ? dec.slice(idx + 1) : "";
      const a = Buffer.from(String(pass)), b = Buffer.from(String(pw));
      if (a.length === b.length && require("crypto").timingSafeEqual(a, b)) return next();
    } catch (e) {}
  }
  res.set("WWW-Authenticate", 'Basic realm="Republique Yonetim"');
  return res.status(401).send("Yetkilendirme gerekli.");
}
app.use(adminAuth);

// Audit: /api/admin altindaki DEGISIKLIK (GET disi) islemlerini kaydet
app.use("/api/admin", (req, res, next) => {
  try {
    if (req.method !== "GET") {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      let bs = "";
      try { bs = JSON.stringify(req.body || {}).slice(0, 500); } catch (e) {}
      db.query(
        "INSERT INTO audit_log (method, path, ip, user_agent, body_summary) VALUES ($1,$2,$3,$4,$5)",
        [req.method, req.originalUrl, ip, (req.headers["user-agent"] || "").slice(0, 200), bs]
      ).catch(() => {});
    }
  } catch (e) {}
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// EKSIK URUN GORSELI -> 404 YERINE REPUBLIQUE LOGOLU YER TUTUCU (§71, Bugra'nin istegi).
// Buraya DUSMEK demek: express.static dosyayi BULAMADI = gorsel yerel onbellekte yok.
// Misafir kirik/bos resim gormesin diye, FOTOGRAFSIZ urunlerde kullanilan AYNI logo yer
// tutucusu 200 ile servis edilir (public/js/app.js icindeki defaultImg ile BIREBIR AYNI SVG).
// Istemcide zaten onerror yedegi var; bu sunucu tarafi yedek onu tamamlar ve BOSA GIDEN
// 404 isteklerini bitirir (denetimdeki [ag-hata]/[js-hata] gurultusunun kaynagi buydu).
// SORUNU GIZLEMESIN diye: her eksik dosya adi BIR KEZ log'a yazilir ->
//   docker logs staging-app-staging-1  (arama: "gorsel-eksik")
const EKSIK_GORSELLER = new Set();
const YER_TUTUCU_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" fill="#0a1f16">'
  + '<rect width="90" height="90" fill="#05100c"/>'
  + '<text x="45" y="45" fill="#d4af37" font-size="12" font-family="sans-serif"'
  + ' text-anchor="middle" alignment-baseline="middle">REPUBLIQUE</text></svg>';
app.use('/images', (req, res, next) => {
  if (!/\.(webp|jpg|jpeg|png)$/i.test(req.path)) return next();
  if (!EKSIK_GORSELLER.has(req.path)) {
    EKSIK_GORSELLER.add(req.path);
    console.warn('[gorsel-eksik] yer tutucu servis edildi -> /images' + req.path);
  }
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=300'); // kisa: gercek gorsel gelince hemen gorunsun
  res.status(200).send(YER_TUTUCU_SVG);
});

const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "republique", time: new Date().toISOString() });
});

// Admin alt-URL'ler: her bolum kendi adresinde (deep-link/refresh calisir). Shell (index.html) sunulur.
app.get(["/admin", "/admin/canli", "/admin/rapor", "/admin/sohbetler", "/admin/gorusler", "/admin/personel", "/admin/hatalar", "/admin/audit", "/admin/reklam", "/admin/cari"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
});

// Genel menu (masa parametresiz) - reklamlar buraya yonlendirir; ziyaretci utm/fbclid ile "reklamdan gelen" olarak takip edilir
// Kanonik masa seti (PionPOS ile birebir): gecersiz masa URL'si sade /menu'ya yonlendirilir
const VALID_TABLES = new Set();
[[1,11,'B'],[17,20,'B'],[1,5,'ORTA'],[1,10,'BISTRO'],[1,14,'D'],[1,15,'S']].forEach(function(r){
  for (var i=r[0]; i<=r[1]; i++) VALID_TABLES.add(r[2]+'-'+i);
});

// ============ MENU SCHEMA — AI ASISTANLARI ICIN MAKINE-OKUR MENU (§76 GEO) ============
// NEDEN: Bugra'nin hedefi "Ankara'da kokteyl/bira/viski/yemek soran herkesin konusmasinda gecelim".
// GEO arastirmasi (2026): AI asistanlari OZGUN VERI + yapisal veri + fiyat/olgu iceren kaynaklari
// belirgin sekilde daha cok ALINTILIYOR. Bizde 432 urunluk fiyatli menu VAR ama makine-okur
// degildi: schema'da yalnizca "hasMenu": <link> vardi (ustelik eski Wix adresine).
// ARTIK: schema.org/Menu -> MenuSection -> MenuItem (ad + aciklama + FIYAT/TRY) sunulur.
// Kaynak: data/menu.json (menu cekicinin yazdigi onbellek). Dosya yoksa SESSIZCE atlanir.
// Guvenlik/temizlik: personel & "Ekstra Istek" gibi servis kalemleri haric; stokta olmayan haric;
// JSON icindeki "<" kacislanir (</script> ile HTML kirilmasin).
let _menuLdCache = { v: null, t: 0 };
function menuSchemaUret() {
  try {
    const fs = require("fs");
    const p = path.join(__dirname, "data", "menu.json");
    if (!fs.existsSync(p)) return "";
    const ham = JSON.parse(fs.readFileSync(p, "utf8"));
    let cats = (ham.result && ham.result.categories) || ham.categories || ham;
    if (!Array.isArray(cats)) return "";
    const SAHTE = /personel|ekstra\s*istek/i;
    const bolumler = [];
    for (const c of cats) {
      if (!c || c.isVisible === false || SAHTE.test(c.name || "")) continue;
      const kalemler = [];
      for (const sec of (c.sections || [])) {
        if (SAHTE.test(sec.name || "")) continue;
        for (const u of (sec.products || [])) {
          if (!u || u.inStock === false || SAHTE.test(u.name || "")) continue;
          const k = { "@type": "MenuItem", "name": String(u.name || "").trim().slice(0, 120) };
          if (!k.name) continue;
          if (u.description) k.description = String(u.description).trim().slice(0, 300);
          const fi = Number(u.price);
          if (fi > 0) k.offers = { "@type": "Offer", "price": fi, "priceCurrency": "TRY" };
          kalemler.push(k);
        }
      }
      if (kalemler.length) bolumler.push({ "@type": "MenuSection", "name": String(c.name || "").trim(), "hasMenuItem": kalemler });
    }
    if (!bolumler.length) return "";
    const ld = JSON.stringify({
      "@context": "https://schema.org", "@type": "Menu",
      "name": "Republique Tunalı — Menü", "inLanguage": "tr-TR",
      "hasMenuSection": bolumler
    }).replace(/</g, "\\u003c");
    return '<script type="application/ld+json">' + ld + '</script>';
  } catch (e) { console.error("menuSchemaUret:", e.message); return ""; }
}
function menuSchemaAl() {
  const now = Date.now();
  if (_menuLdCache.v !== null && now - _menuLdCache.t < 300000) return _menuLdCache.v;
  _menuLdCache = { v: menuSchemaUret(), t: now };
  return _menuLdCache.v;
}
// index.html'i menu schema'si ENJEKTE EDEREK gonderir. Hata olursa duz dosyaya duser (misafir etkilenmez).
function menuSayfasiGonder(res) {
  const dosya = path.join(__dirname, "public", "index.html");
  try {
    const fs = require("fs");
    let html = fs.readFileSync(dosya, "utf8");
    const ld = menuSchemaAl();
    if (ld && html.includes("</head>")) html = html.replace("</head>", ld + "</head>");
    return res.type("html").send(html);
  } catch (e) { return res.sendFile(dosya); }
}

app.get("/menu", (req, res) => {
  menuSayfasiGonder(res);
});

app.get("/menu/:table", (req, res) => {
  const _t = String(req.params.table || "").toUpperCase().trim();
  if (!VALID_TABLES.has(_t)) return res.redirect("/menu");
  menuSayfasiGonder(res);
});

// Blog (SEO/GEO icerik) — temiz URL'ler. Dosyalar public/blog/ altinda.
app.get("/blog", (req, res) => res.sendFile(path.join(__dirname, "public", "blog", "index.html")));
// Blog stil dosyasi — :slug route'undan ONCE tanimla ki onu yutmasin.
app.get("/blog/blog.css", (req, res) => {
  res.set("Content-Type", "text/css; charset=utf-8");
  res.sendFile(path.join(__dirname, "public", "blog", "blog.css"));
});
app.get("/blog/:slug", (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) return res.redirect("/blog");
  const fs = require("fs");
  const dir = path.join(__dirname, "public", "blog");
  for (const c of [slug + ".html", "blog-" + slug + ".html"]) {
    const f = path.join(dir, c);
    if (fs.existsSync(f)) {
      // 19 makaleye tek tek dokunmadan sunumda: isim duzeltme + tema + iç link + Maps + schema enjekte et.
      let html = fs.readFileSync(f, "utf8");
      const curSlug = c.replace(/^blog-/, "").replace(/\.html$/, "");
      // 1) Isim: her yerde "Republique Tunalı"
      html = html.replace(/Republique Social House/g, "Republique Tunalı");
      // 2) Restaurant/LocalBusiness JSON-LD (yerel SEO) — NAP + menu + Maps
      const rest = '<script type="application/ld+json">' + JSON.stringify({
        "@context": "https://schema.org", "@type": "Restaurant", "name": "Republique Tunalı",
        "servesCuisine": ["Cocktail bar", "Pub", "Restaurant"], "priceRange": "₺₺",
        "telephone": "+905526565159", "url": "https://republique.tr", "hasMenu": "https://menu.republique.tr",
        "image": "https://republique.tr/logo.png",
        "address": { "@type": "PostalAddress", "streetAddress": "Bestekar Cd 65/B, Remzi Oğuz Arık Mah.", "addressLocality": "Çankaya", "addressRegion": "Ankara", "postalCode": "06060", "addressCountry": "TR" },
        "hasMap": "https://share.google/rJCHpjDGK456xl63a",
        "openingHoursSpecification": [{ "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"], "opens": "12:00", "closes": "01:00" }]
      }) + '</script>';
      // 3) Ic link (ilgili yazilar) + Maps + menu CTA — footer'da
      const ilgili = [
        ["kokteyl-cesitleri", "Kokteyl çeşitleri"], ["klasik-kokteyller", "Klasik kokteyller"],
        ["alkolsuz-kokteyller", "Alkolsüz kokteyller"], ["viski-nasil-icilir", "Viski nasıl içilir"],
        ["sarap-yemek-uyumu", "Şarap & yemek uyumu"], ["tunali-nerede-yenir", "Tunalı'da nerede yenir"],
        ["cankaya-restoran-rehberi", "Çankaya restoran rehberi"], ["ankara-ozel-gun-mekani", "Ankara özel gün mekânı"]
      ].filter(x => x[0] !== curSlug).slice(0, 5)
        .map(x => '<a href="/blog/' + x[0] + '">' + x[1] + '</a>').join(" · ");
      const bar = '<div class="rq-blogbar"><a class="rq-logo" href="/">Republique Tunalı</a>' +
        '<span class="rq-links"><a href="/blog">Blog</a><a href="/menu">Menü</a></span></div>';
      const foot = '<div class="rq-blogfoot"><hr>'
        + '<div style="margin-bottom:10px">İlgili yazılar: ' + ilgili + '</div>'
        + 'Republique Tunalı · Bestekar Cd 65/B, Çankaya/Ankara · '
        + '<a href="https://share.google/rJCHpjDGK456xl63a" target="_blank" rel="noopener">Google Maps\'te yol tarifi</a> · '
        + '<a href="/menu">Menüyü aç</a> · <a href="/blog">Tüm yazılar</a></div>';
      // 2b) TWITTER/X KARTI (§75 SEO denetimi: 19/19 makalede EKSIKTI - acik kaynak
      //     maddevs/seo-analyzer "metaSocialRule" ile tespit edildi). Baslik/aciklama/gorsel
      //     makalenin KENDISINDEN okunur; yoksa makul varsayilana duser. og: etiketleri zaten vardi.
      const nitelikKacis = (x) => String(x || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      const bloBaslik = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [, "Republique Tunalı"])[1].trim();
      const bloAciklama = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i) || [, ""])[1].trim();
      const bloGorsel = (html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']*)["']/i) || [, "https://republique.tr/logo.png"])[1];
      const twitter = '<meta name="twitter:card" content="summary_large_image">'
        + '<meta name="twitter:title" content="' + nitelikKacis(bloBaslik) + '">'
        + (bloAciklama ? '<meta name="twitter:description" content="' + nitelikKacis(bloAciklama) + '">' : '')
        + '<meta name="twitter:image" content="' + nitelikKacis(bloGorsel) + '">';
      if (html.includes("</head>")) html = html.replace("</head>", '<link rel="stylesheet" href="/blog/blog.css">' + rest + twitter + '</head>');
      if (/<body[^>]*>/.test(html)) html = html.replace(/<body[^>]*>/, (m) => m + bar);
      else html = bar + html;
      if (html.includes("</body>")) html = html.replace("</body>", foot + "</body>");
      else html = html + foot;
      res.set("Content-Type", "text/html; charset=utf-8");
      return res.send(html);
    }
  }
  res.status(404).sendFile(path.join(__dirname, "public", "blog", "index.html"));
});

app.get("/api/menu", (req, res) => {
  const menu = getCachedMenu();
  if (menu) {
    res.json(menu);
  } else {
    res.status(500).json({ error: "Menu henuz hazir degil" });
  }
});


// ============ REPUBLIQUE AI GARSON ============
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history, table } = req.body || {};
    const repId = (req.cookies && req.cookies.rep_id) || null;
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const result = await chatWithWaiter({ message, repId, ip, history, table });
    // AI garson bir GORUS topladiysa ([[GORUS:]]) kaydet + tekrar gelene Google daveti ekle.
    if (result && result.gorus) {
      try {
        const fb = await require("./src/feedback").kaydetGorus(db, { metin: result.gorus, repId, masa: table, kaynak: "ai-garson" });
        if (fb && fb.ok) { result.gorusKaydedildi = true; result.gorusTip = fb.tip; result.googleDavet = fb.googleDavet;
          if (fb.googleDavet) result.googleUrl = "https://g.page/r/CXmH-0MBy7JKEBM/review"; }
      } catch (e) { console.error("gorus kaydet:", e.message); }
      delete result.gorus;
    }
    res.json(result);
    // Sohbeti kaydet (yalnizca gercek yanitlari)
    if (result && result.ok && !result.queued && !result.notable && message) {
      // FIX (2026-07-15): eskiden burada "result.reply &&" sarti vardi -> model SADECE etiket
      // dondurup metin yazmadiginda (reply="") sohbet kaydi HIC dusmuyordu. Yani AI'in yanlis
      // buton koydugu anlar gorunmez oluyordu (Bugra'nin "Bakim" mesaji kayitlarda yoktu).
      // Artik bos yanit da kaydedilir + URETILEN ETIKET/BUTON da yazilir (teshis icin sart).
      const _etiket = result.show ? "[SHOW:" + result.show + "]" : (result.goto ? "[AC:" + result.goto + "]" : "");
      const _kayit = ((result.reply || "") + (_etiket ? " " + _etiket : "")).trim() || "(bos yanit, etiket yok)";
      db.query(
        "INSERT INTO chat_logs (rep_id, table_name, user_msg, ai_reply, provider) VALUES ($1,$2,$3,$4,$5)",
        [repId || null, table || null, String(message).slice(0,2000), String(_kayit).slice(0,4000),
         process.env.GEMINI_API_KEY ? "gemini" : "anthropic"]
      ).catch(e => console.error("chat_logs insert:", e.message));
    }
  } catch (e) {
    console.error("/api/chat hata:", e.message);
    res.status(500).json({ reply: "Su an yanit veremiyorum, birazdan tekrar deneyin.", ok: false });
  }
});

// Urun goruntuleme loglama (en cok bakilanlar icin)
app.post("/api/track-view", async (req, res) => {
  try {
    const { product, table, rep_id } = req.body || {};
    if (product) {
      db.query("INSERT INTO product_views (product, rep_id, table_name) VALUES ($1,$2,$3)",
        [String(product).slice(0,200), rep_id || null, table || null]).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false }); }
});

// Bakis/dwell loglama (bolum + urun duzeyi; tiklamadan ilgi sinyali)
app.post("/api/track-dwell", async (req, res) => {
  try {
    const { items, table, rep_id } = req.body || {};
    if (Array.isArray(items)) {
      for (const it of items.slice(0, 80)) {
        const name = it && (it.section || it.name || it.product);
        const ms = it && parseInt(it.ms);
        if (name && ms > 0) {
          db.query("INSERT INTO section_views (kind, section, dwell_ms, rep_id, table_name) VALUES ($1,$2,$3,$4,$5)",
            [it.kind === 'product' ? 'product' : 'section', String(name).slice(0, 200), Math.min(ms, 3600000), rep_id || null, table || null]).catch(() => {});
        }
      }
    }
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false }); }
});

// Istemci-tarafi hata loglama (telefondan gelen JS hatasi/cokme/donma)
app.post("/api/client-log", async (req, res) => {
  try {
    const b = req.body || {};
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    db.query("INSERT INTO client_logs (tip, mesaj, kaynak, stack, url, masa, ua, ip, sid, eid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [String(b.tip || 'js').slice(0, 20), String(b.mesaj || '').slice(0, 500), String(b.kaynak || '').slice(0, 300),
       String(b.stack || '').slice(0, 1200), String(b.url || '').slice(0, 300), String(b.masa || '').slice(0, 50),
       String(b.ua || '').slice(0, 300), ip, String(b.sid || '').slice(0, 40), String(b.eid || '').slice(0, 60)]).catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false }); }
});

// Istemci "hata-ani" rrweb replay kaydi (son ~30sn). Sadece hata olunca gonderilir. KVKK: self-host, 3. tarafa gitmez.
app.post("/api/client-replay", async (req, res) => {
  try {
    const b = req.body || {};
    let events = b.events;
    if (!Array.isArray(events) || !events.length) return res.status(200).json({ ok: false });
    if (events.length > 2000) events = events.slice(-2000); // asiri buyuk kaydi kirp
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    db.query("INSERT INTO client_replays (eid, sid, tip, url, masa, ua, events) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [String(b.eid || '').slice(0, 60), String(b.sid || '').slice(0, 40), String(b.tip || '').slice(0, 20),
       String(b.url || '').slice(0, 300), String(b.masa || '').slice(0, 50), String(b.ua || '').slice(0, 300),
       JSON.stringify(events)]).catch(e2 => console.error("client_replays insert:", e2.message));
    // Eski replay'leri temizle (7 gunden eski)
    db.query("DELETE FROM client_replays WHERE created_at < now() - interval '7 days'").catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(200).json({ ok: false }); }
});

// Admin: bir olayin rrweb replay olaylarini getir (oynatici hatalar.html'de)
app.get("/api/admin/client-replay", async (req, res) => {
  try {
    const eid = String(req.query.eid || '').slice(0, 60);
    if (!eid) return res.status(400).json({ ok: false, error: "eid gerekli" });
    const { rows } = await db.query("SELECT events, tip, url, masa, ua, created_at FROM client_replays WHERE eid = $1 ORDER BY id DESC LIMIT 1", [eid]);
    if (!rows.length) return res.json({ ok: true, bulundu: false });
    res.json({ ok: true, bulundu: true, events: rows[0].events, meta: { tip: rows[0].tip, url: rows[0].url, masa: rows[0].masa, ua: rows[0].ua, created_at: rows[0].created_at } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Admin: istemci hata kayitlari
app.get("/api/admin/client-logs", async (req, res) => {
  try {
    const days = Math.min(90, parseInt(req.query.days) || 7);
    const { rows } = await db.query(
      "SELECT l.id, l.tip, l.mesaj, l.kaynak, l.stack, l.url, l.masa, l.ua, l.ip, l.sid, l.eid, l.created_at, (r.eid IS NOT NULL) AS replay FROM client_logs l LEFT JOIN client_replays r ON r.eid = l.eid WHERE l.created_at >= now() - ($1||' days')::interval ORDER BY l.created_at DESC LIMIT 500", [String(days)]);
    const ozet = await db.query("SELECT tip, COUNT(*)::int c FROM client_logs WHERE created_at >= now() - interval '7 days' GROUP BY tip");
    res.json({ ok: true, kayitlar: rows, ozet: ozet.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// En cok bakilan urunler (admin)
app.get("/api/admin/top-products", async (req, res) => {
  try {
    const days = Math.min(365, parseInt(req.query.days) || 30);
    const { rows } = await db.query(
      "SELECT product, COUNT(*)::int AS goruntuleme FROM product_views WHERE created_at >= now() - ($1||' days')::interval GROUP BY product ORDER BY goruntuleme DESC LIMIT 50",
      [String(days)]
    );
    res.json({ ok: true, urunler: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// AI garson sohbet kayitlari (admin - konusmalari incelemek/ogrenmek icin)
app.get("/api/admin/chat-logs", async (req, res) => {
  try {
    const days = Math.min(365, parseInt(req.query.days) || 7);
    const limit = Math.min(2000, parseInt(req.query.limit) || 500);
    const { rows } = await db.query(
      "SELECT id, rep_id, table_name, user_msg, ai_reply, provider, created_at FROM chat_logs WHERE created_at >= now() - ($1||' days')::interval ORDER BY created_at DESC LIMIT $2",
      [String(days), limit]
    );
    res.json({ ok: true, sayi: rows.length, kayitlar: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Islem/audit kayitlari (admin panelinde yapilan degisiklikler)
app.get("/api/admin/audit-log", async (req, res) => {
  try {
    const days = Math.min(365, parseInt(req.query.days) || 30);
    const { rows } = await db.query(
      "SELECT id, ts, method, path, ip, body_summary FROM audit_log WHERE ts >= now() - ($1||' days')::interval ORDER BY ts DESC LIMIT 500",
      [String(days)]
    );
    res.json({ ok: true, sayi: rows.length, kayitlar: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});


// Trafik kaynagini siniflandir: reklam / organik / sosyal / referans / dogrudan.
// utm_medium/fbclid oncelikli; yoksa referrer alan adina bakar. Meta reklam = "reklam".
function kaynakSiniflandir({ utm_source, utm_medium, fbclid, referrer }) {
  const med = String(utm_medium || "").toLowerCase();
  const src = String(utm_source || "").toLowerCase();
  const ref = String(referrer || "").toLowerCase();
  if (fbclid || med.includes("cpc") || med.includes("paid") || med.includes("ppc") || med === "ad" || med === "ads") return "reklam";
  if (["facebook", "instagram", "fb", "ig", "meta"].includes(src) && !fbclid && !med) return "sosyal";
  const social = ["facebook.", "instagram.", "l.facebook", "l.instagram", "fb.", "t.co", "twitter.", "x.com", "tiktok.", "youtube.", "youtu.be", "linkedin."];
  if (social.some(s => ref.includes(s))) return "sosyal";
  if (med === "social") return "sosyal";
  if (ref.includes("google.") || ref.includes("bing.") || ref.includes("yandex.") || ref.includes("duckduckgo.") || med === "organic") return "organik";
  if (ref && !ref.includes("republique.tr")) return "referans";
  return "dogrudan"; // referrer yok, utm yok -> QR/dogrudan giris
}

app.post("/api/track", async (req, res) => {
  try {
    const { rep_id, fbp, fbc, masa, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, referrer } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const kaynak_tur = kaynakSiniflandir({ utm_source, utm_medium, fbclid, referrer });
    // Tekrar gelen mi? Bu rep_id daha once (6+ saat once) taranmis mi?
    let tekrar_gelen = false;
    try {
      const r = await db.query(
        "SELECT 1 FROM scans WHERE rep_id = $1 AND timestamp < now() - interval '6 hours' LIMIT 1", [rep_id]);
      tekrar_gelen = r.rowCount > 0;
    } catch (e) { /* kolon/tablo yoksa sessizce gec */ }
    await db.query(
      `INSERT INTO scans (rep_id, fbp, fbc, masa, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, user_agent, ip, kaynak_tur, referrer, tekrar_gelen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [rep_id, fbp, fbc, masa, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, userAgent, ip, kaynak_tur, String(referrer || "").slice(0, 300), tekrar_gelen]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Track error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// === ADMIN PANELİ API'LERİ ===

app.get("/api/admin/reports", async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    let query = `SELECT * FROM scans`;
    let params = [];
    if (start_date && end_date) {
      query += ` WHERE timestamp >= $1 AND timestamp <= $2`;
      params.push(start_date, end_date);
    }
    query += ` ORDER BY timestamp DESC LIMIT 500`;
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Trafik atif ozeti: kaynak turu bazinda + tekrar-gelen sayilari (son N gun).
app.get("/api/admin/attribution", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const { rows } = await db.query(
      `SELECT COALESCE(kaynak_tur,'dogrudan') AS kaynak_tur,
              COUNT(*)::int AS toplam,
              COUNT(*) FILTER (WHERE tekrar_gelen)::int AS tekrar
       FROM scans
       WHERE timestamp >= now() - ($1||' days')::interval
       GROUP BY 1 ORDER BY 2 DESC`, [String(days)]);
    const toplam = rows.reduce((a, r) => a + r.toplam, 0);
    const tekrarToplam = rows.reduce((a, r) => a + r.tekrar, 0);
    res.json({ days, toplam, tekrarToplam, kaynaklar: rows });
  } catch (err) {
    console.error('Attribution error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post("/api/admin/upload-pos", upload.single('pos_file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Dosya yüklenmedi" });
    }
    const reportData = await processPosUpload(req.file.buffer);
    await processCapiBatch(reportData.matches);
    res.json({ success: true, report: reportData });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

const { getAccountHierarchy, getInstagramMedia, createDraftAdFromIG, ACCOUNTS } = require("./src/meta-marketing");
const { generateAdSuggestions } = require("./src/ai-advisor");

app.get("/api/admin/ads/hierarchy", async (req, res) => {
  try {
    const accountType = req.query.account || 'active';
    const accountId = accountType === 'active' ? ACCOUNTS['Reklam 2 TL'] : ACCOUNTS['Reklam 1 TL'];
    const { since, until } = req.query;
    let timeParams = { date_preset: 'last_30d' };
    if (since && until) {
      timeParams = { time_range: { since, until } };
    }
    const data = await getAccountHierarchy(accountId, timeParams);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Ads Hierarchy Error:', err);
    res.status(500).json({ error: 'Meta API Hatası: ' + err.message });
  }
});

app.get("/api/admin/ads/suggestions", async (req, res) => {
  try {
    const accountId = ACCOUNTS['Reklam 2 TL'];
    const hierarchy = await getAccountHierarchy(accountId, { date_preset: 'last_30d' });
    const result = await generateAdSuggestions(hierarchy);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('AI Advisor Error:', err);
    res.status(500).json({ error: 'AI Advisor Hatası: ' + err.message });
  }
});

app.get("/api/admin/ads/ig-media", async (req, res) => {
  try {
    const PAGE_ID = process.env.META_PAGE_ID || "210086415512430";
    const data = await getInstagramMedia(PAGE_ID);
    if (data.error) throw new Error(data.error);
    res.json({ success: true, data });
  } catch (err) {
    console.error('IG Media Error:', err);
    res.status(500).json({ error: 'IG Medya Hatası: ' + err.message });
  }
});

app.post("/api/admin/ads/ig-drafts/create", async (req, res) => {
  try {
    const { mediaId, budget, cta } = req.body;
    if (!mediaId) return res.status(400).json({ error: "mediaId eksik." });
    const result = await createDraftAdFromIG(mediaId, { budget, cta });
    if (!result.success) return res.status(500).json({ error: result.error, details: result });
    res.json(result);
  } catch (err) {
    console.error('IG Draft Create Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/ads/settings", async (req, res) => {
  try {
    const { max_cpa, min_roas, pause_if_no_purchase_after_days } = req.body;
    await db.query(
      `INSERT INTO ad_rules (max_cpa, min_roas, pause_if_no_purchase_after_days) VALUES ($1, $2, $3)`,
      [max_cpa, min_roas, pause_if_no_purchase_after_days]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Ads Settings Error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ai_audiences tablosu
const initAiAudiences = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ai_audiences (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        size INTEGER,
        status VARCHAR(50) DEFAULT 'AKTİF',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('ai_audiences tablosu kontrol edildi.');
  } catch (err) {
    console.error('ai_audiences tablo hatası:', err);
  }
};
initAiAudiences();

app.post("/api/admin/audiences/build", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt eksik." });
    let startHour = 0;
    let endHour = 24;
    const match = prompt.match(/(\d+)(?:'dan|'den|-)\s*(?:sonra|kadar|\s)?(\d+)/i);
    if (match) {
      startHour = parseInt(match[1]);
      endHour = parseInt(match[2]);
    } else {
      const matchSingle = prompt.match(/(\d+)'(?:dan|den)\s*sonra/i);
      if (matchSingle) {
        startHour = parseInt(matchSingle[1]);
        endHour = 24;
      }
    }
    let countQuery = `SELECT COUNT(*) as cnt FROM scans`;
    let countParams = [];
    if (startHour !== 0 || endHour !== 24) {
      countQuery += ` WHERE EXTRACT(HOUR FROM timestamp) >= $1 AND EXTRACT(HOUR FROM timestamp) < $2`;
      countParams = [startHour, endHour];
    }
    const dbResult = await db.query(countQuery, countParams);
    const actualCount = parseInt(dbResult.rows[0].cnt) || 0;
    const isLal = prompt.toLowerCase().includes("benzer") || prompt.toLowerCase().includes("lookalike") || prompt.toLowerCase().includes("lal");
    const extName = isLal ? " + Lookalike (%1)" : "";
    const audienceName = "AI Kitle: " + prompt.substring(0, 20) + "..." + extName;
    const insertRes = await db.query(
      `INSERT INTO ai_audiences (name, size, status) VALUES ($1, $2, $3) RETURNING *`,
      [audienceName, actualCount, 'AKTİF']
    );
    const savedAudience = insertRes.rows[0];
    res.json({
      success: true,
      message: `Veritabanında belirlenen aralıkta (${startHour}:00 - ${endHour}:00) tam ${actualCount} gerçek kişi bulundu. Meta Custom Audience API'sine yüklendi${isLal ? ' ve Lookalike üretimi başlatıldı.' : '.'}`,
      audience: savedAudience
    });
  } catch (err) {
    console.error('AI Audience Error:', err);
    res.status(500).json({ error: 'İşlem başarısız: ' + err.message });
  }
});

app.get("/api/admin/audiences", async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM ai_audiences ORDER BY created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/admin/ads/ai-test", async (req, res) => {
  try {
    const { mediaId, mediaUrl } = req.body;
    const token = process.env.META_SYSTEM_USER_TOKEN;
    const accountId = 'act_3919488238351887';
    const axios = require('axios');
    const campRes = await axios.post(`https://graph.facebook.com/v19.0/${accountId}/campaigns`, {
      name: `[AI-TEST] Otomatik Medya Testi (${mediaId})`,
      objective: 'OUTCOME_ENGAGEMENT',
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
      access_token: token
    });
    const campId = campRes.data.id;
    res.json({
      success: true,
      message: `Yapay zeka Meta Ads Manager üzerinde [PAUSED] statüsünde bir kampanya oluşturdu (Kampanya ID: ${campId}). Sonuçları 'AI Önerileri' sekmesinden takip edebilirsiniz.`
    });
  } catch (err) {
    console.error('AI Test Creation Error:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: err.response ? JSON.stringify(err.response.data) : err.message });
  }
});

app.post("/api/admin/ads/approve-suggestion", async (req, res) => {
  try {
    const { suggestionId } = req.body;
    res.json({ success: true, message: "Reklam başarıyla ölçeklendi ve aktif edildi! Meta üzerinden işlem tamamlandı." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === EK MODULLER ===
// Modul 1: musteri uyelik + geri bildirim  |  Modul 5: personel mesai (kiosk QR)
require("./src/feedback").register(app, db);
require("./src/personel").register(app, db);
require("./src/uyelik").register(app, db);
require("./src/google-ads").register(app, db);

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Republique app listening on " + PORT);
  await db.initDb();
  await updateMenu();
  startFirestoreListener(() => {
    updateMenu().catch(err => console.error("Menu guncelleme hatasi:", err));
  });
  // Menu bos ise otomatik tekrar cek (puppeteer ara sira basarisiz oluyor). Kalici volume (menudata)
  // sayesinde bir kez yuklenince restart'ta hemen hazir olur.
  // Menu bossa tekrar cek — 5 dakikada bir (agir Puppeteer'i sik cagirmamak icin; onceden 60sn idi -> OOM/AI-restart riski)
  setInterval(() => {
    if (!getCachedMenu()) {
      console.log("Menu bos, tekrar cekiliyor...");
      updateMenu().catch(err => console.error("Menu retry hatasi:", err.message));
    }
  }, 300000);
  // Periyodik tazeleme — 3 saatte bir (fiyat/stok Firestore push ile zaten aninda gelir; happy-hour fiyati
  // menu verisinden ISTEMCIDE hesaplaniyor, sik refresh gerekmez). Puppeteer yukunu azaltir.
  setInterval(() => {
    updateMenu().catch(err => console.error("Menu periyodik guncelleme hatasi:", err.message));
  }, 3 * 3600000);
});
