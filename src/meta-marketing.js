const axios = require('axios');
const db = require('./db');

const META_API_VERSION = 'v19.0';
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

// İşletmenin ve hesapların sabitleri
const ACCOUNTS = {
    'Reklam 2 TL': 'act_3919488238351887', // Aktif hesap (Müdahale edilebilir)
    'Reklam 1 TL': 'act_748408227534321'   // Eski hesap (Sadece Okunabilir)
};

/**
 * Yardımcı: Ortam değişkeninden token'i alır
 */
function getToken() {
    const token = process.env.META_SYSTEM_USER_TOKEN;
    if (!token) {
        throw new Error("META_SYSTEM_USER_TOKEN eksik. Admin panel için gerekli.");
    }
    return token;
}

/**
 * Belirli bir reklam hesabının Kampanyalarını ve Insights (Performans) verilerini çeker
 */
async function getAccountInsights(accountId, datePreset = 'last_30d') {
    try {
        const url = `${BASE_URL}/${accountId}/campaigns`;
        const params = {
            access_token: getToken(),
            fields: 'id,name,status,objective,insights.date_preset(' + datePreset + '){spend,actions,action_values,cpa,roas}',
            limit: 50
        };

        const response = await axios.get(url, { params });
        return response.data.data;
    } catch (error) {
        console.error(`Meta API Error (getAccountInsights - ${accountId}):`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Belirli bir reklamı DURAKLATIR (Pause). Yalnızca yeni hesap için çalıştırılır.
 */
async function pauseAd(adId, reason) {
    try {
        // AI Kararını Logla
        await db.query(
            `INSERT INTO ad_actions_log (action_type, ad_id, status, details) VALUES ($1, $2, $3, $4)`,
            ['PAUSE_AD', adId, 'EXECUTED', JSON.stringify({ reason })]
        );

        const url = `${BASE_URL}/${adId}`;
        const data = {
            status: 'PAUSED',
            access_token: getToken()
        };

        const response = await axios.post(url, data);
        return response.data;
    } catch (error) {
        console.error(`Meta API Error (pauseAd - ${adId}):`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Ortalamanın altındaki bir reklam için kullanıcıdan ONAY ister (Veritabanına PENDING kaydeder).
 */
async function requestApprovalToPauseAd(adId, adName, details) {
    try {
        await db.query(
            `INSERT INTO ad_actions_log (action_type, ad_id, ad_name, status, details) VALUES ($1, $2, $3, $4, $5)`,
            ['REQUEST_PAUSE', adId, adName, 'PENDING', JSON.stringify(details)]
        );
        return true;
    } catch (error) {
        console.error(`DB Error (requestApprovalToPauseAd):`, error);
        throw error;
    }
}

/**
 * Eski hesaptaki veriyi öğrenme amacıyla analiz eder (Read-Only)
 */
async function analyzeOldAccount() {
    return await getAccountInsights(ACCOUNTS['Reklam 1 TL'], 'maximum');
}

module.exports = {
    ACCOUNTS,
    getAccountInsights,
    pauseAd,
    requestApprovalToPauseAd,
    analyzeOldAccount
};
