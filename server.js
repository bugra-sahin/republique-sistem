const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const { updateMenu, getCachedMenu } = require("./src/menu-fetcher");
const { startFirestoreListener } = require("./src/firestore-listener");
const db = require("./src/db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "republique", time: new Date().toISOString() });
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

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Republique app listening on " + PORT);
  
  await db.initDb();
  await updateMenu();
  
  startFirestoreListener(() => {
    updateMenu().catch(err => console.error("Menu guncelleme hatasi:", err));
  });
});
