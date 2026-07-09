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

  const url = `https://graph.facebook.com/v19.0/${pixelId}/events`;
  const eventTime = Math.floor(new Date().getTime() / 1000);

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        action_source: "physical_store",
        user_data: {
          fbp: match.fbp,
          fbc: match.fbc
        },
        custom_data: {
          value: match.perCapita,
          currency: "TRY",
          content_name: `Adisyon Eşleşmesi - ${match.label}`,
          content_category: match.type
        }
      }
    ]
  };

  // Test modu: .env icinde META_TEST_EVENT_CODE varsa eventler Meta "Test Events"e duser
  // (gercek optimizasyonu kirletmez). Canliya alirken .env'den kaldirilir/bosaltilir.
  if (process.env.META_TEST_EVENT_CODE) {
    payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  }

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
  // Sadece YENI_MUSTERI ve RETARGETING etiketli (dogrudan reklam temasli) olanlari CAPI'ye yolla
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
