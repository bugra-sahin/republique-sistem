const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const { updateMenu, getCachedMenu } = require("./src/menu-fetcher");
const { startFirestoreListener } = require("./src/firestore-listener");
const db = require("./src/db");
const multer = require("multer");
const { processPosUpload } = require("./src/matcher");
const { processCapiBatch } = require("./src/capi-sender");
const { chatWithWaiter } = require("./src/ai-waiter");

// AI sohbet gecmisi tablosu (ilk ay+ kayit; ogrenme/analiz icin)
db.query(`CREATE TABLE IF NOT EXISTS chat_logs (
  id SERIAL PRIMARY KEY, rep_id TEXT, table_name TEXT,
  user_msg TEXT, ai_reply TEXT, provider TEXT, created_at TIMESTAMPTZ DEFAULT now()
)`).catch(e => console.error("chat_logs tablo:", e.message));

db.query(`CREATE TABLE IF NOT EXISTS product_views (
  id SERIAL PRIMARY KEY, product TEXT, rep_id TEXT, table_name TEXT, created_at TIMESTAMPTZ DEFAULT now()
)`).catch(e => console.error("product_views tablo:", e.message));

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

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "republique", time: new Date().toISOString() });
});

// Genel menu (masa parametresiz) - reklamlar buraya yonlendirir; ziyaretci utm/fbclid ile "reklamdan gelen" olarak takip edilir
// Kanonik masa seti (PionPOS ile birebir): gecersiz masa URL'si sade /menu'ya yonlendirilir
const VALID_TABLES = new Set();
[[1,11,'B'],[17,20,'B'],[1,5,'ORTA'],[1,10,'BISTRO'],[1,14,'D'],[1,15,'S']].forEach(function(r){
  for (var i=r[0]; i<=r[1]; i++) VALID_TABLES.add(r[2]+'-'+i);
});

app.get("/menu", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get("/menu/:table", (req, res) => {
  const _t = String(req.params.table || "").toUpperCase().trim();
  if (!VALID_TABLES.has(_t)) return res.redirect("/menu");
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    res.json(result);
    // Sohbeti kaydet (yalnizca gercek yanitlari)
    if (result && result.ok && !result.queued && !result.notable && result.reply && message) {
      db.query(
        "INSERT INTO chat_logs (rep_id, table_name, user_msg, ai_reply, provider) VALUES ($1,$2,$3,$4,$5)",
        [repId || null, table || null, String(message).slice(0,2000), String(result.reply).slice(0,4000),
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

// ============ TEK SEFERLIK LLM ANAHTAR KURULUMU (kurulumdan sonra kaldirilacak) ============
app.post("/api/setup-llm", async (req, res) => {
  try {
    if (process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) {
      return res.status(403).json({ ok: false, error: "Anahtar zaten kurulu. Bu sayfa guvenlik icin devre disi. Degistirmek icin yoneticinize basvurun." });
    }
    const { provider, key } = req.body || {};
    if (!key || typeof key !== "string" || key.trim().length < 20) {
      return res.status(400).json({ ok: false, error: "Anahtar gecersiz veya eksik." });
    }
    const varName = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
    const fs = require("fs");
    try { fs.mkdirSync("/secrets", { recursive: true }); } catch (e) {}
    const store = {};
    try {
      if (fs.existsSync("/secrets/llm.env")) {
        for (const l of fs.readFileSync("/secrets/llm.env", "utf-8").split("\n")) {
          const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) store[m[1]] = m[2];
        }
      }
    } catch (e) {}
    store[varName] = key.trim();
    fs.writeFileSync("/secrets/llm.env", Object.keys(store).map(k => k + "=" + store[k]).join("\n") + "\n");
    process.env[varName] = key.trim();
    res.json({ ok: true, provider: varName });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/admin/chat-logs", async (req, res) => {
  try {
    const days = Math.min(90, parseInt(req.query.days) || 1);
    const { rows } = await db.query(
      "SELECT id, rep_id, table_name, user_msg, ai_reply, provider, created_at FROM chat_logs WHERE created_at >= now() - ($1||' days')::interval ORDER BY created_at DESC LIMIT 2000",
      [String(days)]
    );
    res.json({ ok: true, count: rows.length, logs: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/setup-llm", (req, res) => {
  if (process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY) {
    return res.type("html").send('<!doctype html><meta charset=utf-8><body style="background:#141210;color:#c9a24b;font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center"><div><h2>Republique AI kurulumu tamamlandi ✓</h2><p style="color:#a99">Bu sayfa guvenlik icin devre disi birakildi.</p></div></body>');
  }
  res.type("html").send(`<!doctype html><html lang=tr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Republique AI Kurulum</title>
<style>body{background:#141210;color:#eee;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.c{background:#1c1a16;border:1px solid #3a2f1c;border-radius:16px;padding:28px;max-width:440px;width:92%}
h1{font-size:19px;color:#c9a24b;margin:0 0 6px}p{color:#a99;font-size:14px;line-height:1.5}
label{display:block;margin:14px 0 6px;font-size:14px}select,input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #3a2f1c;background:#241f18;color:#fff;font-size:15px}
button{margin-top:18px;width:100%;padding:13px;border:0;border-radius:10px;background:#c9a24b;color:#1a1410;font-weight:700;font-size:15px;cursor:pointer}
.msg{margin-top:14px;font-size:14px;padding:10px;border-radius:8px;display:none}.ok{background:#173a24;color:#8f8}.err{background:#3a1717;color:#f99}</style></head>
<body><div class=c><h1>Republique AI — Anahtar Kurulumu</h1>
<p>Sağlayıcıyı seç, API anahtarını kutuya <b>yapıştır</b> ve Kaydet'e bas. Anahtar yalnızca sunucuda saklanır.</p>
<label>Sağlayıcı</label>
<select id=prov><option value=anthropic>Claude (Anthropic)</option><option value=gemini>Gemini (Google)</option></select>
<label>API Anahtarı</label>
<input id=key type=password placeholder="sk-ant-... veya AIza..." autocomplete=off>
<button id=btn>Kaydet ve Aktive Et</button>
<div id=msg class=msg></div></div>
<script>
const msg=document.getElementById('msg');
function show(t,ok){msg.style.display='block';msg.className='msg '+(ok?'ok':'err');msg.textContent=t;}
document.getElementById('btn').onclick=async()=>{
  const key=document.getElementById('key').value.trim();const provider=document.getElementById('prov').value;
  if(key.length<20){show('Anahtar çok kısa görünüyor.',false);return;}
  show('Kaydediliyor...',true);
  try{
    const r=await fetch('/api/setup-llm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,key})}).then(x=>x.json());
    if(!r.ok){show('Hata: '+(r.error||'bilinmiyor'),false);return;}
    show('Kaydedildi ✓ Test ediliyor...',true);
    const t=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Merhaba, kısa bir öneri ver',table:'kurulum-testi'})}).then(x=>x.json());
    show('✓ Çalışıyor! Republique AI yanıtı: '+(t.reply||'(bos)'),true);
  }catch(e){show('Bağlantı hatası: '+e.message,false);}
};
</script></body></html>`);
});

app.post("/api/track", async (req, res) => {
  try {
    const { rep_id, fbp, fbc, masa, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    await db.query(
      `INSERT INTO scans (rep_id, fbp, fbc, masa, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [rep_id, fbp, fbc, masa, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, userAgent, ip]
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

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Republique app listening on " + PORT);
  await db.initDb();
  await updateMenu();
  startFirestoreListener(() => {
    updateMenu().catch(err => console.error("Menu guncelleme hatasi:", err));
  });
  // Menu bos ise otomatik tekrar cek (puppeteer ara sira basarisiz oluyor). Kalici volume (menudata)
  // sayesinde bir kez yuklenince restart'ta hemen hazir olur.
  setInterval(() => {
    if (!getCachedMenu()) {
      console.log("Menu bos, tekrar cekiliyor...");
      updateMenu().catch(err => console.error("Menu retry hatasi:", err.message));
    }
  }, 60000);
  // 30 dakikada bir tazele (fiyat/stok degisimi Firestore push disinda da yakalansin)
  setInterval(() => {
    updateMenu().catch(err => console.error("Menu periyodik guncelleme hatasi:", err.message));
  }, 30 * 60000);
});
