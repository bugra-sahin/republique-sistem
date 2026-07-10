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
  const eventTime = match.eventTime ? match.eventTime : Math.floor(new Date().getTime() / 1000);
  // Dedup icin event_id (ayni event tekrar yuklenirse Meta mukerrer saymaz)
  const eventId = crypto.createHash('sha256').update(`${match.rep_id}_${eventTime}_purchase`).digest('hex');

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTime,
        event_id: eventId,
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
  // Meta'ya gonderilecekler: dogrudan reklam temasli (YENI/RETARGETING) + ortalama-imputasyonlu
  // ad-ziyaretciler. HALO (arkadas etkisi) panelde gorunur ama Meta'ya gonderilmez (tiklama yok).
  const eligibleMatches = matches.filter(m => m.type === 'YENI_MUSTERI' || m.type === 'RETARGETING' || m.type === 'IMPUTE_ORTALAMA');

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
