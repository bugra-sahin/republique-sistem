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
    // ============ §85: META'NIN CEVABI ARTIK OKUNUYOR ============
    // ESKI KOD: `response` degiskenini ALIP HIC OKUMUYORDU -> istek gidince "CAPI Basarili"
    // yaziyorduk. AMA Meta HTTP 200 donup event'i SESSIZCE dusurebilir (events_received: 0)
    // veya "messages" icinde uyari donebilir. Yani elimizdeki "Basarili" logu KANIT DEGILDI.
    // Bu, projedeki 3. "sessiz basarisizlik" (bkz. §74-C buton, §82-B buton, §84-C ciro sismesi).
    const c = (response && response.data) || {};
    console.log('[CAPI] META CEVABI -> events_received=' + c.events_received +
                ' | test_kodu=' + (payload.test_event_code || 'YOK!!') +
                ' | pixel=' + pixelId +
                ' | mesajlar=' + JSON.stringify(c.messages || []) +
                ' | fbtrace=' + c.fbtrace_id);
    console.log('[CAPI] GONDERILEN KIMLIK -> fbp=' + (match.fbp ? 'VAR' : 'YOK') +
                ' fbc=' + (match.fbc ? 'VAR' : 'YOK') +
                ' | action_source=physical_store | deger=' + match.perCapita + ' TRY');
    if (!c.events_received) {
      console.error('[CAPI] >>> DIKKAT: Meta 200 dondu AMA events_received=' + c.events_received +
                    ' -> EVENT ALINMADI. "Basarili" YAZILMAYACAK.');
      return false;
    }
    console.log(`CAPI Başarılı: ${match.rep_id} - ${match.perCapita} TL`);
    return true;
  } catch (error) {
    // §85: hatanin TAMAMINI bas (eskiden sadece data'yi basiyordu, HTTP kodu gorunmuyordu)
    const r = error.response;
    console.error('[CAPI] GONDERIM HATASI -> http=' + (r ? r.status : 'YOK') +
                  ' | cevap=' + (r ? JSON.stringify(r.data) : error.message));
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
