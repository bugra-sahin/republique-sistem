const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const { updateMenu, getCachedMenu } = require("./src/menu-fetcher");
const { startFirestoreListener } = require("./src/firestore-listener");
const db = require("./src/db");
const multer = require("multer");
const { processPosUpload } = require("./src/matcher");
const { processCapiBatch } = require("./src/capi-sender");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Multer in-memory ayarı (Excel/CSV yüklemeleri için)
const upload = multer({ storage: multer.memoryStorage() });

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "republique", time: new Date().toISOString() });
});

// Yeni QR kod yapısı (örneğin: /menu/b-4)
app.get("/menu/:table", (req, res) => {
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

// 1. Canlı Akış Çekimi
app.get("/api/admin/reports", async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM scans ORDER BY timestamp DESC LIMIT 100`);
    res.json(rows);
  } catch (err) {
    console.error('Reports error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. Adisyon Yükleme ve Eşleştirme (Faz 2)
app.post("/api/admin/upload-pos", upload.single('pos_file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Dosya yüklenmedi" });
    }
    
    // Yüklenen Excel'i zeka modülüne yolla
    const reportData = await processPosUpload(req.file.buffer);
    
    // Eşleşenleri anında Meta CAPI'ye fırlat
    await processCapiBatch(reportData.matches);

    res.json({ success: true, report: reportData });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Republique app listening on " + PORT);
  
  await db.initDb();
  await updateMenu();
  
  startFirestoreListener(() => {
    updateMenu().catch(err => console.error("Menu guncelleme hatasi:", err));
  });
});
