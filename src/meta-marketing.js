const axios = require('axios');
const db = require('./db');

const META_API_VERSION = 'v19.0';
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

const ACCOUNTS = {
  'Reklam 2 TL': 'act_3919488238351887', // Aktif hesap (müdahale edilebilir)
  'Reklam 1 TL': 'act_748408227534321'   // Eski hesap (salt okunur)
};

const PAGE_ID = process.env.META_PAGE_ID || "210086415512430";
const IG_USER_ID_FALLBACK = process.env.META_IG_USER_ID || "17841445523094763";
const MENU_URL = process.env.MENU_URL || "https://test1.republique.tr/menu?utm_source=meta&utm_medium=paid";
const PIXEL_ID = process.env.META_PIXEL_ID || "858472356496034";
// Ankara ozel konum (Reklam1TL kanitlanmis yapisindan): Kizilay/Tunali merkez, 25km
const ANKARA_GEO = { custom_locations: [{ latitude: 39.905758, longitude: 32.860404, radius: 25, distance_unit: "kilometer" }] };

function getToken() {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN eksik. Admin panel için gerekli.");
  return token;
}

async function getIgUserId() {
  try {
    const r = await axios.get(`${BASE_URL}/${PAGE_ID}`, { params: { access_token: getToken(), fields: 'instagram_business_account' } });
    return (r.data.instagram_business_account && r.data.instagram_business_account.id) || IG_USER_ID_FALLBACK;
  } catch (e) { return IG_USER_ID_FALLBACK; }
}

// Kampanya > Set > Reklam > Insight hiyerarşisi
async function getAccountHierarchy(accountId, timeParams = { date_preset: 'last_30d' }) {
  const token = getToken();
  try {
    const campRes = await axios.get(`${BASE_URL}/${accountId}/campaigns`, { params: { access_token: token, fields: 'id,name,status,objective', limit: 100 } });
    const campaigns = campRes.data.data;
    const adsetRes = await axios.get(`${BASE_URL}/${accountId}/adsets`, { params: { access_token: token, fields: 'id,name,campaign_id,status,daily_budget,targeting', limit: 100 } });
    const adsets = adsetRes.data.data;
    const adsRes = await axios.get(`${BASE_URL}/${accountId}/ads`, { params: { access_token: token, fields: 'id,name,adset_id,campaign_id,status,creative{body,image_url,video_id}', limit: 200 } });
    const ads = adsRes.data.data;
    const insParams = { access_token: token, level: 'ad', fields: 'ad_id,impressions,reach,spend,actions,action_values', limit: 500 };
    if (timeParams.time_range) insParams.time_range = JSON.stringify(timeParams.time_range);
    else insParams.date_preset = timeParams.date_preset || 'last_30d';
    const insightsRes = await axios.get(`${BASE_URL}/${accountId}/insights`, { params: insParams });
    const insights = insightsRes.data.data;
    const hierarchy = campaigns.map(camp => {
      const campAdsets = adsets.filter(s => s.campaign_id === camp.id).map(set => {
        const setAds = ads.filter(a => a.adset_id === set.id).map(ad => {
          const adInsight = insights.find(i => i.ad_id === ad.id) || null;
          return { ...ad, insight: adInsight };
        });
        return { ...set, ads: setAds };
      });
      return { ...camp, adsets: campAdsets };
    });
    return hierarchy;
  } catch (error) {
    console.error(`Meta API Error (getAccountHierarchy - ${accountId}):`, error.response ? JSON.stringify(error.response.data) : error.message);
    throw error;
  }
}

// Instagram gönderilerini (post/reels) çek
async function getInstagramMedia(pageId) {
  const token = getToken();
  try {
    const pageRes = await axios.get(`${BASE_URL}/${pageId}`, { params: { access_token: token, fields: 'instagram_business_account' } });
    const igAccountId = pageRes.data.instagram_business_account && pageRes.data.instagram_business_account.id;
    if (!igAccountId) return { error: "Bu sayfaya bağlı Instagram İşletme Hesabı bulunamadı." };
    const mediaRes = await axios.get(`${BASE_URL}/${igAccountId}/media`, { params: { access_token: token, fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp', limit: 20 } });
    return mediaRes.data.data;
  } catch (error) {
    console.error(`Meta API Error (getInstagramMedia):`, error.response ? JSON.stringify(error.response.data) : error.message);
    return { error: (error.response && error.response.data && error.response.data.error && error.response.data.error.message) || error.message };
  }
}

/**
 * Mevcut IG gönderisinden GERÇEK bir PAUSED taslak reklam oluşturur.
 * Adımlar: adcreative (source_instagram_media_id) -> campaign -> adset -> ad. Hepsi PAUSED.
 * ASLA aktifleştirmez; bütçe girse bile status=PAUSED kalır (onay Buğra'da).
 */
async function createDraftAdFromIG(mediaId, options = {}) {
  const token = getToken();
  const accountId = ACCOUNTS['Reklam 2 TL'];
  const budgetTL = parseInt(options.budget) > 0 ? parseInt(options.budget) : 100;
  const dailyBudget = budgetTL * 100; // kuruş (TRY minor unit)
  const igUserId = await getIgUserId();
  const created = {};
  try {
    // 1) Kreatif: mevcut IG gönderisinden
    const creativeRes = await axios.post(`${BASE_URL}/${accountId}/adcreatives`, {
      name: `IG Taslak Kreatif (${mediaId})`,
      object_id: PAGE_ID,
      instagram_user_id: igUserId,
      source_instagram_media_id: mediaId,
      call_to_action: JSON.stringify({ type: 'VIEW_MENU', value: { link: MENU_URL } }),
      access_token: token
    });
    created.creative_id = creativeRes.data.id;

    // 2) Kampanya (PAUSED)
    const campRes = await axios.post(`${BASE_URL}/${accountId}/campaigns`, {
      name: `[TASLAK] IG Reklam - ${mediaId}`,
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: [],
      access_token: token
    });
    created.campaign_id = campRes.data.id;

    // 3) Reklam Seti (PAUSED, manuel kitle, 18+, TR)
    const adsetRes = await axios.post(`${BASE_URL}/${accountId}/adsets`, {
      name: `[TASLAK] Set - ${mediaId}`,
      campaign_id: created.campaign_id,
      daily_budget: dailyBudget,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      promoted_object: JSON.stringify({ pixel_id: PIXEL_ID, custom_event_type: 'PURCHASE' }),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting: JSON.stringify({ geo_locations: ANKARA_GEO, age_min: 18 }),
      status: 'PAUSED',
      access_token: token
    });
    created.adset_id = adsetRes.data.id;

    // 4) Reklam (PAUSED)
    const adRes = await axios.post(`${BASE_URL}/${accountId}/ads`, {
      name: `[TASLAK] Reklam - ${mediaId}`,
      adset_id: created.adset_id,
      creative: JSON.stringify({ creative_id: created.creative_id }),
      status: 'PAUSED',
      access_token: token
    });
    created.ad_id = adRes.data.id;

    return {
      success: true,
      message: `IG gönderisinden DURAKLATILMIŞ (PAUSED) taslak reklam oluşturuldu. Kampanya ID: ${created.campaign_id}. Meta'da 'Taslak' olarak durur; sen onaylamadan yayına GİRMEZ.`,
      ...created
    };
  } catch (error) {
    const errData = error.response ? error.response.data : { message: error.message };
    console.error("createDraftAdFromIG hata:", JSON.stringify(errData));
    return { success: false, error: (errData.error && errData.error.message) || errData.message || 'Bilinmeyen hata', created };
  }
}

// AI önerisini onay için PENDING kaydeder
async function requestApprovalForSuggestion(adId, suggestionType, details) {
  try {
    await db.query(
      `INSERT INTO ad_actions_log (action_type, ad_id, status, details) VALUES ($1, $2, $3, $4)`,
      [suggestionType, adId, 'PENDING', JSON.stringify(details)]
    );
    return true;
  } catch (error) {
    console.error(`DB Error (requestApprovalForSuggestion):`, error);
    throw error;
  }
}

module.exports = {
  ACCOUNTS,
  getAccountHierarchy,
  getInstagramMedia,
  createDraftAdFromIG,
  requestApprovalForSuggestion
};
