const axios = require('axios');
const crypto = require('crypto');

// SHA256 Hash fonksiyonu (Meta CAPI zorunlulugu)
function hashData(data) {
  if (!data) return undefined;
  return crypto.createHash('sha256').update(data.trim().toLowerCase()).digest('hex');
}

// ============ §90: MASA URL'si (event_source_url) ============
// Gecis sonrasi format /menu/<masa> olacak (Bugra tarih verecek). TEK YERDEN degissin diye
// env ile secilir: MASA_URL_BICIMI=path -> /menu/b-9 · varsayilan 'query' -> /?masa=b-9
const SITE_HOST = process.env.SITE_HOST || 'test2.republique.tr';
const MASA_URL_BICIMI = process.env.MASA_URL_BICIMI || 'query';
function masaUrl(masa) {
  const base = 'https://' + SITE_HOST;
  if (!masa) return base + '/';
  return MASA_URL_BICIMI === 'path'
    ? base + '/menu/' + encodeURIComponent(String(masa).toLowerCase().trim())
    : base + '/?masa=' + encodeURIComponent(masa);
}

// ============ §90: KIMLIK BLOGU (user_data) ============
// OLCULDU (tests/prod-ip-ua-teshis.sh, prod): 344/344 taramada ip VE user_agent DOLU,
//   ic-ag IP (172./10./127./192.168.) = 0 -> Caddy X-Forwarded-For'u DOGRU iletiyor.
// >>> DIKKAT (Bugra'nin notu): misafirler dukkan WiFi'indaysa IP'ler AYNI cikar. BU NORMALDIR.
//     IP UYDURMA / CESITLENDIRME YAPILMAZ. Meta 'ayni IP' uyarisi verirse Tanilar'dan okunur.
// ============ §90: MASASIZ MI? ============
// 🔴 test2'de OLCULDU: masasiz /menu ziyaretinde app.js masa alanina 'Bilinmiyor' YAZIYOR.
// Yani `if (!masa)` kontrolu YETMEZ - 'Bilinmiyor' truthy'dir ve kontrolden GECER.
// KANIT: 3 tarama (2 masali + 1 masasiz) -> 3 RestoranZiyaret gitti; DB: 'Bilinmiyor','b-9','b-9'.
// Bugra'nin kurali: "masasiz /menu ziyaretinde ASLA gonderme."
const MASASIZ_DEGERLER = ['', '--', 'bilinmiyor', 'undefined', 'null'];
function masasizMi(masa) {
  if (masa === null || masa === undefined) return true;
  return MASASIZ_DEGERLER.includes(String(masa).trim().toLowerCase());
}

function kimlikBlogu(k) {
  const ud = {};
  if (k.fbp) ud.fbp = k.fbp;
  if (k.fbc) ud.fbc = k.fbc;
  // XFF zinciri (a, b, c) gelirse ILK deger gercek misafirdir.
  const ip = k.ip ? String(k.ip).split(',')[0].trim() : null;
  if (ip) ud.client_ip_address = ip;
  if (k.user_agent) ud.client_user_agent = k.user_agent;
  return ud;
}

// ============ §90: TEK GONDERIM NOKTASI ============
// §85 KURALI: dis servise istek atiyorsan CEVABINI OKU. 'Istek gitti' != 'is oldu'.
async function metayaGonder(events, etiket) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) {
    console.error('[CAPI][' + etiket + '] Jeton veya Pixel ID eksik!');
    return 0;
  }
  if (!events || events.length === 0) return 0;
  const url = 'https://graph.facebook.com/v19.0/' + pixelId + '/events';
  const payload = { data: events };
  if (process.env.META_TEST_EVENT_CODE) payload.test_event_code = process.env.META_TEST_EVENT_CODE;
  try {
    const response = await axios.post(url + '?access_token=' + token, payload);
    const c = (response && response.data) || {};
    console.log('[CAPI][' + etiket + '] META CEVABI -> events_received=' + c.events_received +
                ' | gonderilen=' + events.length +
                ' | test_kodu=' + (payload.test_event_code || 'YOK!!') +
                ' | pixel=' + pixelId +
                ' | mesajlar=' + JSON.stringify(c.messages || []) +
                ' | fbtrace=' + c.fbtrace_id);
    if (!c.events_received) {
      console.error('[CAPI][' + etiket + '] >>> DIKKAT: Meta 200 dondu AMA events_received=' +
                    c.events_received + ' -> EVENT ALINMADI.');
      return 0;
    }
    return c.events_received;
  } catch (error) {
    const r = error.response;
    console.error('[CAPI][' + etiket + '] GONDERIM HATASI -> http=' + (r ? r.status : 'YOK') +
                  ' | cevap=' + (r ? JSON.stringify(r.data) : error.message));
    return 0;
  }
}

// ============ PURCHASE (DEGISMEDI) ============
// §90 KURALI (Bugra): 'Mevcut Purchase akisina DOKUNMA - kisi basi deger modeli AYNEN kalir.'
// Bu oturumda SADECE su eklendi: user_data'ya GERCEK IP + user-agent ve event_source_url.
// event_id formulu, deger (perCapita), action_source, filtre: HEPSI AYNEN.
async function sendCapiEvent(match) {
  const eventTime = match.eventTime ? match.eventTime : Math.floor(new Date().getTime() / 1000);
  const eventId = crypto.createHash('sha256').update(match.rep_id + '_' + eventTime + '_purchase').digest('hex');
  const event = {
    event_name: 'Purchase',
    event_time: eventTime,
    event_id: eventId,
    action_source: 'physical_store',
    event_source_url: masaUrl(match.masa),
    user_data: kimlikBlogu(match),
    custom_data: {
      value: match.perCapita,
      currency: 'TRY',
      content_name: 'Adisyon Eslesmesi - ' + match.label,
      content_category: match.type
    }
  };
  const alinan = await metayaGonder([event], 'Purchase');
  if (alinan) {
    console.log('CAPI Basarili: ' + match.rep_id + ' - ' + match.perCapita + ' TL');
    return true;
  }
  return false;
}

// ============ §90-YENI-1: RestoranZiyaret ============
// Bugra: 'masa parametreli HER taramada gonderilir (masasiz /menu ziyaretinde ASLA gonderme).
//         Degersiz. event_id = taramaID.'
// action_source='website': bu bir SAYFA goruntulemesidir (event_source_url anlamli olsun diye)
//   ve eski URL-kuralli 'Restorana gelme' ozel donusumunun yerini alir -> o da website idi.
//   >>> Test Events'te 'INTERNET SITESI' kanalinda gorunur (Purchase 'Cevrimdisi'nda). BEKLENEN.
async function ziyaretEventiGonder(scan) {
  // masasiz -> ASLA gonderme (Bugra'nin kurali). 'Bilinmiyor' DA masasiz sayilir (yukari bak).
  if (!scan || masasizMi(scan.masa)) return false;
  const eventTime = scan.timestamp ? Math.floor(new Date(scan.timestamp).getTime() / 1000)
                                   : Math.floor(Date.now() / 1000);
  const event = {
    event_name: 'RestoranZiyaret',
    event_time: eventTime,
    event_id: String(scan.id),                 // Bugra: event_id = taramaID
    action_source: 'website',
    event_source_url: masaUrl(scan.masa),
    user_data: kimlikBlogu(scan)
    // custom_data YOK -> DEGERSIZ event (Bugra'nin karari)
  };
  const alinan = await metayaGonder([event], 'RestoranZiyaret');
  return alinan > 0;
}

// ============ §90-YENI-2: ReklamMisafiri ============
// Bugra: 'eslestirmede REKLAM BAGLANTILI cikan HER ADISYON icin, adisyondaki Kisi Sayisi kadar
//         gonderilir. Degersiz. event_id = adisyonID + sira.'
// REKLAM BAGLANTILI = adisyondaki eslesen kisilerden en az biri YENI_MUSTERI / RETARGETING /
//   HALO_EFFECT. (HALO zaten 'masada BASKA reklam kaynakli biri var' demektir -> adisyon reklamlidir.)
// KIMLIK: i. event icin i. eslesen kisinin kimligi kullanilir; eslesen kisi sayisi pax'tan azsa
//   kalan eventler REKLAMLI kisinin kimligiyle gider (elimizdeki en dogru kimlik odur).
function reklamMisafiriEventleri(adisyonlar) {
  const events = [];
  for (const a of adisyonlar) {
    const reklamli = a.kisiler.some(m => m.type === 'YENI_MUSTERI' || m.type === 'RETARGETING' || m.type === 'HALO_EFFECT');
    if (!reklamli) continue;
    const pax = a.pax || a.kisiler.length;
    const reklamKisi = a.kisiler.find(m => m.type === 'YENI_MUSTERI' || m.type === 'RETARGETING') || a.kisiler[0];
    for (let i = 1; i <= pax; i++) {
      const kimlik = a.kisiler[i - 1] || reklamKisi;
      events.push({
        event_name: 'ReklamMisafiri',
        event_time: a.eventTime,
        event_id: a.adisyonId + '-' + i,          // Bugra: adisyonID + sira
        action_source: 'physical_store',
        event_source_url: masaUrl(a.masa),
        user_data: kimlikBlogu(kimlik)
        // DEGERSIZ (Bugra'nin karari)
      });
    }
  }
  return events;
}

// ============ §90-YENI-3: TumSatislar ============
// Bugra: 'eslestirmede bulunan TUM adisyonlar icin (ORGANIK dahil) gonderilir.
//         Deger = kisi basi pay (mevcut Purchase kuraliyla AYNI hesap). event_id = adisyonID + taramaID.'
// NOT: IMPUTE_ORTALAMA kayitlarinin ADISYONU YOK (eslesmemis ziyaretci) -> TumSatislar'a GIRMEZ.
function tumSatislarEventleri(matches) {
  return matches
    .filter(m => m.adisyonId && m.type !== 'IMPUTE_ORTALAMA')
    .map(m => ({
      event_name: 'TumSatislar',
      event_time: m.eventTime,
      event_id: m.adisyonId + '-' + m.scanId,    // Bugra: adisyonID + taramaID
      action_source: 'physical_store',
      event_source_url: masaUrl(m.masa),
      user_data: kimlikBlogu(m),
      custom_data: {
        value: m.perCapita,                       // Purchase ile AYNI hesap
        currency: 'TRY',
        content_name: 'Tum Satislar - ' + m.label,
        content_category: m.type
      }
    }));
}

// Adisyon bazinda gruplama (ReklamMisafiri icin)
function adisyonlaraGrupla(matches) {
  const harita = {};
  for (const m of matches) {
    if (!m.adisyonId || m.type === 'IMPUTE_ORTALAMA') continue;
    if (!harita[m.adisyonId]) {
      harita[m.adisyonId] = { adisyonId: m.adisyonId, masa: m.masa, pax: m.pax, eventTime: m.eventTime, kisiler: [] };
    }
    harita[m.adisyonId].kisiler.push(m);
  }
  return Object.values(harita);
}

async function processCapiBatch(matches) {
  // ---- 1) PURCHASE: FILTRE DEGISMEDI (Bugra: mevcut akisa dokunma) ----
  // Meta'ya gonderilecekler: dogrudan reklam temasli (YENI/RETARGETING) + ortalama-imputasyonlu
  // ad-ziyaretciler. HALO (arkadas etkisi) panelde gorunur ama Purchase olarak GONDERILMEZ (tiklama yok).
  const eligibleMatches = matches.filter(m => m.type === 'YENI_MUSTERI' || m.type === 'RETARGETING' || m.type === 'IMPUTE_ORTALAMA');

  let successCount = 0;
  for (const match of eligibleMatches) {
    const success = await sendCapiEvent(match);
    if (success) {
      match.capiSent = true;
      successCount++;
    }
  }

  // ---- 2) §90 YENI EVENTLER (Purchase'i ETKILEMEZ) ----
  const adisyonlar = adisyonlaraGrupla(matches);
  const rmEvents = reklamMisafiriEventleri(adisyonlar);
  const tsEvents = tumSatislarEventleri(matches);

  const rmAlinan = await metayaGonder(rmEvents, 'ReklamMisafiri');
  const tsAlinan = await metayaGonder(tsEvents, 'TumSatislar');

  console.log('[CAPI][OZET] Purchase=' + successCount + '/' + eligibleMatches.length +
              ' | ReklamMisafiri=' + rmAlinan + '/' + rmEvents.length +
              ' | TumSatislar=' + tsAlinan + '/' + tsEvents.length +
              ' | adisyon=' + adisyonlar.length);

  // Panel (§90-3) bu sayilari gosterecek
  return {
    purchase: successCount,
    purchaseDenendi: eligibleMatches.length,
    reklamMisafiri: rmAlinan,
    reklamMisafiriDenendi: rmEvents.length,
    tumSatislar: tsAlinan,
    tumSatislarDenendi: tsEvents.length,
    adisyonSayisi: adisyonlar.length
  };
}

module.exports = {
  processCapiBatch,
  ziyaretEventiGonder
};
