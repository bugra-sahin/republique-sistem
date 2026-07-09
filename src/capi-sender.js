const axios = require('axios');
const crypto = require('crypto');

// SHA256 Hash fonksiyonu (Meta CAPI zorunluluğu)
function hashData(data) {
  if (!data) return undefined;
  return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
}

async function sendCapiEvent(match) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;

  if (!pixelId || !token) {
    console.error("CAPI Jetonu veya Pixel ID eksik! Lütfen .env dosyasını kontrol edin.");
    return false;
  }

  // Meta CAPI Endpoint
  const url = `https://graph.facebook.com/v19.0/${pixelId}/events`;

  // UNIX Timestamp (Saniye cinsinden)
  const eventTime = Math.floor(new Date().getTime() / 1000); 

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        action_source: "physical_store", // Fiziksel restoran satışı
        user_data: {
          fbp: match.fbp, // Meta Tarayıcı Çerezi
          fbc: match.fbc  // Meta Tıklama Çerezi (Varsa)
          // Not: Ad/Soyad/E-posta varsa burada hash'lenerek gönderilir (client_ip ve user_agent da eklenebilir)
        },
        custom_data: {
          value: match.perCapita, // Kişi başı harcama
          currency: "TRY",
          content_name: `Adisyon Eşleşmesi - ${match.label}`,
          content_category: match.type
        }
      }
    ],
    // test_event_code: "TEST98132" // Test için açılabilir
  };

  try {
    const response = await axios.post(`${url}?access_token=${token}`, payload);
    console.log(`CAPI Başarılı: ${match.rep_id} - ${match.perCapita} TL`);
    return true;
  } catch (error) {
    console.error("CAPI Gönderim Hatası:", error.response ? error.response.data : error.message);
    return false;
  }
}

async function processCapiBatch(matches) {
  // Sadece YENI_MUSTERI ve RETARGETING etiketli (doğrudan reklam temaslı) olanları CAPI'ye yolla
  const eligibleMatches = matches.filter(m => m.type === 'YENI_MUSTERI' || m.type === 'RETARGETING');
  
  let successCount = 0;
  for (const match of eligibleMatches) {
    const success = await sendCapiEvent(match);
    if (success) {
      match.capiSent = true;
      successCount++;
    }
  }
  
  return successCount;
}

module.exports = {
  processCapiBatch
};
