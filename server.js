const express = require("express");
const path = require("path");
const { updateMenu, getCachedMenu } = require("./src/menu-fetcher");
const { startFirestoreListener } = require("./src/firestore-listener");

const app = express();
const PORT = process.env.PORT || 3000;

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

app.get("/", (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="tr"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Republique</title>
  <style>body{font-family:system-ui,sans-serif;text-align:center;margin-top:60px;color:#222}</style>
  </head><body>
  <h1>Republique sistemi calisiyor</h1>
  <p>Faz 1 - altyapi ayakta. Menu ve tarama modulleri buraya gelecek.</p>
  <p><a href="/api/menu">Canli menuyu goruntule</a></p>
  <p style="color:#888">v0.1.0</p>
  </body></html>`);
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log("Republique app listening on " + PORT);
  
  await updateMenu();
  
  startFirestoreListener(() => {
    updateMenu().catch(err => console.error("Menu guncelleme hatasi:", err));
  });
});
