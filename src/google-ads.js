// MODUL: Google Ads (Meta reklam mantiginin Google karsiligi) — REST API v17, axios.
// GUVENLIK/GUARDRAIL: kampanyalar DAIMA PAUSED olusturulur; butce/aktiflestirme Bugra'da.
// UYKU MODU: gerekli env yoksa modul PASIF; endpointler "yapilandirilmadi" doner, uygulama bozulmaz.
// Gereken env (sunucu /secrets veya .env): GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
//   GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID (10 hane, tiresiz),
//   (ops.) GOOGLE_ADS_LOGIN_CUSTOMER_ID (MCC yonetici hesabi id'si).
// NOT: Ilk baglantida canli hesapta bir kez test edilecek (mutate yapilari dogrulanacak).
const axios = require("axios");

const API = "https://googleads.googleapis.com/v17";
const OAUTH = "https://oauth2.googleapis.com/token";
// Ankara/Cankaya hedefi (Meta ile ayni yaklasim): Google "geoTargetConstant" Ankara = 2792 (Turkiye il).
// Yaricapli ozel konum icin proximity kullanilir; il hedefi basit ve saglam.
const ANKARA_GEO = process.env.GOOGLE_ADS_GEO || "geoTargetConstants/1012782"; // Ankara (dogrulanacak)

function cfg() {
  return {
    devToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    customerId: (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/[^0-9]/g, ""),
    loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/[^0-9]/g, "")
  };
}
function yapilandirildi() {
  const c = cfg();
  return !!(c.devToken && c.clientId && c.clientSecret && c.refreshToken && c.customerId);
}

// OAuth refresh -> kisa omurlu access_token (5 dk cache)
let _tok = { value: null, exp: 0 };
async function accessToken() {
  if (_tok.value && Date.now() < _tok.exp) return _tok.value;
  const c = cfg();
  const r = await axios.post(OAUTH, new URLSearchParams({
    client_id: c.clientId, client_secret: c.clientSecret,
    refresh_token: c.refreshToken, grant_type: "refresh_token"
  }), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 });
  _tok.value = r.data.access_token;
  _tok.exp = Date.now() + ((r.data.expires_in || 3600) - 120) * 1000;
  return _tok.value;
}
function headers(token) {
  const c = cfg();
  const h = { "Authorization": "Bearer " + token, "developer-token": c.devToken, "Content-Type": "application/json" };
  if (c.loginCustomerId) h["login-customer-id"] = c.loginCustomerId;
  return h;
}

// OKUMA: GAQL sorgusu (kampanya/performans). Guvenli, sadece okur.
async function search(gaql) {
  const c = cfg(); const token = await accessToken();
  const url = `${API}/customers/${c.customerId}/googleAds:search`;
  const r = await axios.post(url, { query: gaql }, { headers: headers(token), timeout: 20000 });
  return (r.data && r.data.results) || [];
}
async function kampanyalar() {
  return search(`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
    metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
    FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC`);
}

// mutate yardimci
async function mutate(kaynak, operations) {
  const c = cfg(); const token = await accessToken();
  const url = `${API}/customers/${c.customerId}/${kaynak}:mutate`;
  const r = await axios.post(url, { operations }, { headers: headers(token), timeout: 20000 });
  return r.data;
}

// TASLAK butce olustur (gunluk, micros: 1 TL = 1.000.000 micros)
async function butceOlustur(adTL, gunlukTL) {
  const res = await mutate("campaignBudgets", [{
    create: { name: adTL + " butce " + Date.now(), amountMicros: Math.round(gunlukTL * 1e6), deliveryMethod: "STANDARD", explicitlyShared: false }
  }]);
  return res.results && res.results[0] && res.results[0].resourceName;
}

// TASLAK ARAMA (Search) kampanyasi — DAIMA PAUSED, Ankara hedefi, donusum odakli.
async function aramaKampanyasi({ ad, gunlukTL }) {
  const butce = await butceOlustur(ad, gunlukTL || 100);
  const camp = await mutate("campaigns", [{
    create: {
      name: ad, status: "PAUSED", advertisingChannelType: "SEARCH",
      campaignBudget: butce, manualCpc: {},
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: true, targetContentNetwork: false }
    }
  }]);
  const campRes = camp.results && camp.results[0] && camp.results[0].resourceName;
  // Ankara geo hedefi
  if (campRes) await mutate("campaignCriteria", [{ create: { campaign: campRes, location: { geoTargetConstant: ANKARA_GEO } } }]);
  return campRes;
}

// TASLAK Performance Max (yerel/magaza ziyareti) — DAIMA PAUSED. (asset group ayrica eklenir)
async function pmaxKampanyasi({ ad, gunlukTL }) {
  const butce = await butceOlustur(ad, gunlukTL || 100);
  const camp = await mutate("campaigns", [{
    create: {
      name: ad, status: "PAUSED", advertisingChannelType: "PERFORMANCE_MAX",
      campaignBudget: butce, maximizeConversions: {}
    }
  }]);
  const campRes = camp.results && camp.results[0] && camp.results[0].resourceName;
  if (campRes) await mutate("campaignCriteria", [{ create: { campaign: campRes, location: { geoTargetConstant: ANKARA_GEO } } }]);
  return campRes;
}

function register(app, db) {
  // DURUM: baglanti hazir mi?
  app.get("/api/admin/google-ads/status", (req, res) => {
    res.json({ ok: true, yapilandirildi: yapilandirildi(),
      not: yapilandirildi() ? "Google Ads bagli." : "Google Ads env yok — Bugra developer token + OAuth refresh token + customer ID girince aktiflesir." });
  });
  // OKUMA: kampanya listesi (guvenli)
  app.get("/api/admin/google-ads/kampanyalar", async (req, res) => {
    if (!yapilandirildi()) return res.json({ ok: false, error: "Google Ads yapilandirilmadi." });
    try { res.json({ ok: true, kampanyalar: await kampanyalar() }); }
    catch (e) { res.status(500).json({ ok: false, error: (e.response && JSON.stringify(e.response.data).slice(0, 500)) || e.message }); }
  });
  // TASLAK kampanya olustur (PAUSED) — aktiflestirme/butce Bugra'da
  app.post("/api/admin/google-ads/taslak", async (req, res) => {
    if (!yapilandirildi()) return res.json({ ok: false, error: "Google Ads yapilandirilmadi." });
    try {
      const tur = req.body && req.body.tur === "pmax" ? "pmax" : "search";
      const ad = String((req.body && req.body.ad) || "Republique Tunali - " + tur).slice(0, 120);
      const gunlukTL = Math.max(10, Math.min(5000, parseInt(req.body && req.body.gunlukTL) || 100));
      const rn = tur === "pmax" ? await pmaxKampanyasi({ ad, gunlukTL }) : await aramaKampanyasi({ ad, gunlukTL });
      res.json({ ok: true, durum: "PAUSED (taslak) olusturuldu — aktiflestirme Ads panelinde Bugra'da", resourceName: rn });
    } catch (e) { res.status(500).json({ ok: false, error: (e.response && JSON.stringify(e.response.data).slice(0, 600)) || e.message }); }
  });
}

module.exports = { register, yapilandirildi, kampanyalar, aramaKampanyasi, pmaxKampanyasi };
