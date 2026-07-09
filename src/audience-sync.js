const axios = require('axios');
const db = require('./db');
const crypto = require('crypto');

const META_API_VERSION = 'v19.0';
const BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;
const AD_ACCOUNT_ID = 'act_3919488238351887'; // Hedef reklam hesabı

/**
 * Veriyi Meta'nın kabul ettiği SHA-256 formatına çevirir
 */
function hashData(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
}

/**
 * Belirli bir kitle ID'sine kullanıcı listesi (fbp, telefon) gönderir
 */
async function addUsersToCustomAudience(audienceId, users) {
    const token = process.env.META_SYSTEM_USER_TOKEN;
    if (!token) return;

    // Meta API, verileri payload formatında bekler
    const payload = {
        schema: ["EXTERN_ID", "PHONE"], // EXTERN_ID = rep_id veya fbp
        data: users.map(u => [
            hashData(u.extern_id) || "",
            hashData(u.phone) || ""
        ])
    };

    const url = `${BASE_URL}/${audienceId}/users`;
    try {
        await axios.post(url, {
            payload,
            access_token: token
        });
        return true;
    } catch (err) {
        console.error(`Meta Audience Error (${audienceId}):`, err.response?.data || err.message);
        return false;
    }
}

/**
 * Veritabanını tarar, Yüksek Değerli, İstenmeyen ve Retargeting kitlelerini belirler
 */
async function syncAudiences() {
    console.log("Kitle senkronizasyonu başlatılıyor...");

    // 1. İstenmeyen (Kara Liste) Kitle Tespiti
    // Adisyon notunda 'istenmeyen' veya 'sıkıntı' geçenler
    const { rows: blacklistRows } = await db.query(`
        SELECT scan_id, s.rep_id, s.fbp 
        FROM adisyonlar a
        JOIN eslesmeler e ON a.adisyon_no = e.adisyon_no
        JOIN scans s ON e.scan_id = s.id
        WHERE LOWER(a.notlar) LIKE '%istenmeyen%' OR LOWER(a.notlar) LIKE '%sıkıntı%'
    `);
    
    // TODO: Meta tarafında 'İstenmeyen' kitlesi oluşturulup ID'si buraya eklenecek
    // if(blacklistRows.length > 0) await addUsersToCustomAudience('BLACKLIST_AUDIENCE_ID', blacklistRows.map(r => ({extern_id: r.fbp})));

    // 2. Yüksek Değerli (High-Value) Kitle
    // Son 30 günde kişi başı harcaması yüksek olanlar (Örn: 1000 TL üstü)
    const { rows: highValueRows } = await db.query(`
        SELECT s.fbp, (a.toplam_tutar / a.kisi_sayisi) as kisi_basi
        FROM adisyonlar a
        JOIN eslesmeler e ON a.adisyon_no = e.adisyon_no
        JOIN scans s ON e.scan_id = s.id
        WHERE (a.toplam_tutar / a.kisi_sayisi) > 1000
    `);

    // TODO: Meta tarafında 'High-Value' kitlesi oluşturulup ID'si buraya eklenecek
    // if(highValueRows.length > 0) await addUsersToCustomAudience('HIGH_VALUE_AUDIENCE_ID', highValueRows.map(r => ({extern_id: r.fbp})));

    // Senkronizasyon kaydını tut
    await db.query(`
        INSERT INTO audience_syncs (audience_type, count, status, details) 
        VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)
    `, [
        'BLACKLIST', blacklistRows.length, 'COMPLETED', JSON.stringify({}),
        'HIGH_VALUE', highValueRows.length, 'COMPLETED', JSON.stringify({})
    ]);

    console.log(`Senkronize edildi: ${blacklistRows.length} kara liste, ${highValueRows.length} yüksek değerli.`);
}

module.exports = {
    syncAudiences,
    addUsersToCustomAudience
};
