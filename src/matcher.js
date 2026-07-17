const xlsx = require('xlsx');
const db = require('./db');

// §83 KRITIK: PionPOS adisyon saatleri TURKIYE YEREL saatidir (+03).
// AMA konteyner UTC kosuyor -> OLCULDU: `docker exec staging-app-staging-1 date`
//   -> "Thu Jul 16 08:42:54 UTC 2026"
// ESKI KOD `new Date(y, m-1, d, h, min)` kullaniyordu = konteynerin TZ'si = UTC.
// Yani "11:40" -> 11:40 UTC sayiliyordu; oysa gercekte 11:40 Turkiye = 08:40 UTC.
// SONUC: her adisyon taramalardan TAM 3 SAAT ileri gorunuyordu -> GERCEK HAYATTA HIC ESLESME OLMAZDI.
// KANIT: gercek tarayicidan (Turkiye) fbclidli tarama 11:38 -> adisyon 11:40 icin
//   teshis "enYakinFarkDk: -182" dedi (= 3 saat + 2 dk). Tam da bu hata.
// NOT: Onceki "%100 eslesme" testi YANILTICIYDI - o taramalari sunucudaki Playwright uretmisti,
//   yani adisyon saatleriyle AYNI (UTC) cerceveden geliyordu. Gercek misafirde durum farkli.
// Turkiye 2016'dan beri KALICI +03 (yaz saati uygulamasi YOK) -> sabit ofset guvenli.
// ============ §90-C: MASASIZ MI? (Bugra onayiyla eklendi) ============
// 🔴 OLCULDU: app.js masasiz /menu ziyaretinde masa alanina 'Bilinmiyor' YAZIYOR.
// Bu yuzden asagidaki IMPUTE korumasi `if (!masa) continue;` CALISMIYORDU:
//   'Bilinmiyor' truthy -> dukkana GELMEMIS (sadece menuye bakmis) biri
//   IMPUTE_ORTALAMA alip **Purchase olarak Meta'ya gidiyordu** = ciroya yanlis kisi.
// Kodun kendi yorumu zaten "masasiz /menu = gelmemis -> haric" diyordu; NIYET buydu,
// UYGULAMA bozuktu. Bu duzeltme niyeti CALISIR hale getirir.
// NOT: ayni liste capi-sender.js icinde de var (RestoranZiyaret icin).
const MASASIZ_DEGERLER = ['', '--', 'bilinmiyor', 'undefined', 'null'];
function masasizMi(masa) {
  if (masa === null || masa === undefined) return true;
  return MASASIZ_DEGERLER.includes(String(masa).trim().toLowerCase());
}

// ============ §86: fbclid -> fbc YEDEK DONUSUMU (SUNUCU TARAFI) ============
// Asil duzeltme app.js'te (tarayicida, tiklama aninda). BU yedek iki isi yapar:
//   1) VERITABANINDAKI ESKI KAYITLARI KURTARIR (fbclid saklanmis ama fbc bos olan 5 kayit),
//   2) tarayici tarafi herhangi bir sebeple fbc uretemezse hat yine de calisir.
// Meta formati: fb.<altAlanIndeksi>.<olusturmaZamani_ms>.<fbclid>
// Zaman damgasi olarak TARAMA ANI kullanilir (tiklama anina en yakin bildigimiz an).
function fbcUret(scan) {
  if (scan.fbc) return scan.fbc;                 // tarayicidan/cerezden geldiyse ONA dokunma
  if (!scan.fbclid) return undefined;            // reklam tiklamasi yoksa fbc de olmaz
  return 'fb.1.' + new Date(scan.timestamp).getTime() + '.' + scan.fbclid;
}

const POS_SAAT_OFSETI = 3; // PionPOS saatleri UTC+3 (Turkiye)
function parseDate(dateStr) {
  if (!dateStr || dateStr === '--') return null;
  const parts = String(dateStr).split(' ');
  if (parts.length !== 2) return null;
  const [datePart, timePart] = parts;
  const [d, m, y] = datePart.split('.');
  const [h, min] = timePart.split(':');
  if (!d || !m || !y || !h || !min) return null;
  // Yerel (+03) saati UTC'ye cevirerek MUTLAK an uret -> konteynerin TZ'sinden BAGIMSIZ.
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h) - POS_SAAT_OFSETI, Number(min)));
}

async function processPosUpload(buffer) {
  // 1. Dosyayı Oku
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet);
  // TESHIS (§82): sheet_to_json 1. SATIRI baslik sayar. PionPOS dosyasinda 1.satir
  // "Adisyon Listesi" oldugu icin sutunlar __EMPTY_N adiyla gelir (E=__EMPTY_3=Masa Adi,
  // H=__EMPTY_6=Acilis, L=__EMPTY_10=Kisi, N=__EMPTY_12=Toplam). DOGRULANDI (xlsx 0.18.5).
  console.log('[eslestirme] dosyadan okunan ham satir:', rows.length);

  // 2. Veritabanından Tüm Taramaları Çek (Son 30 gün)
    // TESHIS (§82): eslesme 0 cikarsa once BU IKI SAYIYA bak.
  const { rows: allScans } = await db.query(`SELECT * FROM scans WHERE timestamp >= NOW() - INTERVAL '30 days' ORDER BY timestamp ASC`);
  
  // Taramaları kullanıcı bazında (rep_id) geçmişleriyle gruplayalım
  const userHistory = {};
  for (const scan of allScans) {
    if (!userHistory[scan.rep_id]) {
      userHistory[scan.rep_id] = { scans: [], hasSeenAd: false, firstSeenAdAt: null };
    }
    const isAd = !!(scan.fbclid || ['meta','facebook','ig','instagram'].includes(scan.utm_source));
    userHistory[scan.rep_id].scans.push({ ...scan, isAd });
    if (isAd && !userHistory[scan.rep_id].hasSeenAd) {
      userHistory[scan.rep_id].hasSeenAd = true;
      userHistory[scan.rep_id].firstSeenAdAt = new Date(scan.timestamp).getTime();
    }
  }

    console.log('[eslestirme] son 30 gunde tarama sayisi:', allScans.length);

  // ===== TESHIS TOPLAYICI (§82) - "neden eslesmedi" sorusunu OLCUMLE cevaplar =====
  const tani = {
    hamSatir: rows.length,
    taramaSayisi: allScans.length,
    gecerliAdisyon: 0,
    masaHicYok: 0,
    zamanTutmadi: 0,
    pencere: '-10dk / +20dk, masa acikken kapanisa kadar (§84)',
    ornekler: []
  };

  const results = {
    totalAdRevenue: 0,
    newCustomerRevenue: 0,
    haloRevenue: 0,
    retargetRevenue: 0,
    imputedRevenue: 0,
    imputedCount: 0,
    avgPerCapita: 0,
    matches: []
  };
  // Yuklenen adisyon dosyasinin kapsadigi zaman araligi (imputasyonu bu gune sabitlemek icin)
  let minOpen = Infinity, maxOpen = -Infinity;

  // 3. Adisyon Satırlarını İşle
  for (const row of rows) {
    const masaName = row['__EMPTY_3'];
    if (!masaName || masaName === '--' || masaName === 'Masa Adı') continue;

    const openTime = parseDate(row['__EMPTY_6']);
    if (!openTime) continue;

    const pax = parseInt(row['__EMPTY_10']) || 1;
    // §90: Adisyon ID = A sutunu. sheet_to_json 1.satiri ('Adisyon Listesi') BASLIK sayar ->
    // A sutununun anahtari 'Adisyon Listesi' olur. GERCEK PionPOS dosyasiyla DOGRULANDI
    // (A='Adisyon ID', deger orn. 'lxl19K4Oa1HtZImQ...'). Bos gelirse masa+acilis ile yedekle.
    const adisyonId = String(row['Adisyon Listesi'] || (String(masaName) + '@' + row['__EMPTY_6'])).trim();
    const totalStr = row['__EMPTY_12'] || '0';
    const totalRaw = totalStr.replace(/[^0-9,]/g, '').replace(',', '.');
    const total = parseFloat(totalRaw) || 0;
    const perCapita = Math.round(total / pax);
    // §84: adisyonun KAPANIS saati. Masa acik kaldigi surece gelen arkadaslarin
    // taramalari da sayilsin diye gerekli. (Kolon J = __EMPTY_8; xlsx 0.18.5 ile DOGRULANDI.)
    const closeTime = parseDate(row['__EMPTY_8']);

    // Eşleşen QR taramalarını bul (Açılış -5dk ile +10dk arası)
    const tOpen = openTime.getTime();
    if (tOpen < minOpen) minOpen = tOpen;
    if (tOpen > maxOpen) maxOpen = tOpen;
    const posMasa = String(masaName).toLowerCase().trim();
    // ONCE sadece MASA'ya gore sup, SONRA zamana gore -> boylece "masa mi tutmadi,
    // zaman mi tutmadi" AYRI AYRI olculebilir (eskiden tek filtrede birlesikti).
    const masaEslesenler = allScans.filter(scan => (scan.masa || '').toLowerCase().trim() === posMasa);
    // ============ §84 PENCERE KURALI (Bugra, 2026-07-16) ============
    // ESKI kod: [acilis-5dk, acilis+10dk] -> hem cok dar, hem masa sirkulasyonunu goz ardi ediyordu.
    // BUGRA'NIN KURALI: "-10 +20 dakika olsun ve bu araliktan itibaren adisyon ACIK KALDIGI SURECE
    //   adisyonda yazan kisi sayisi ve okutanlar tutuyorsa onlar o masadan sayilsin."
    // GEREKCE (Bugra): masalarda sirkulasyon cok; "ilk okutan kazanir" mantiksiz cunku
    //   ARKADASI DA OKUTABILIR (sonradan gelen kisi de o masanin musterisidir).
    // UYGULAMA:
    //   - Gelis penceresi : [acilis - 10dk , acilis + 20dk]
    //   - Masa acik kaldigi surece: pencere KAPANIS saatine kadar UZAR (sonradan gelen arkadas da sayilir)
    //   - Ust sinir       : adisyondaki "Kisi Sayisi" kadar KISI sayilir (asagida, tekillestirmeden sonra)
    const tClose = closeTime ? closeTime.getTime() : null;
    const pencereBas = tOpen - 10 * 60000;
    const pencereSon = Math.max(tOpen + 20 * 60000, tClose || 0);
    const tableScans = masaEslesenler.filter(scan => {
      const scanTime = new Date(scan.timestamp).getTime();
      return scanTime >= pencereBas && scanTime <= pencereSon;
    });

    // ---- TESHIS (§82) ----
    tani.gecerliAdisyon++;
    if (masaEslesenler.length === 0) {
      tani.masaHicYok++;
      if (tani.ornekler.length < 6) tani.ornekler.push({ masa: posMasa, sebep: 'bu masada HIC tarama yok' });
    } else if (tableScans.length === 0) {
      tani.zamanTutmadi++;
      // EN YAKIN taramanin adisyon acilisina farki (DAKIKA). Bu sayi her seyi soyler:
      //   ~ +-180 dk  -> ZAMAN DILIMI hatasi (UTC vs +03)
      //   ~ 10-30 dk  -> pencere cok dar (§5 sartnamesi -10dk/+30dk diyor, kod -5/+10)
      const farklar = masaEslesenler
        .map(s => Math.round((new Date(s.timestamp).getTime() - tOpen) / 60000))
        .sort((a, b) => Math.abs(a) - Math.abs(b));
      if (tani.ornekler.length < 6) tani.ornekler.push({
        masa: posMasa,
        sebep: 'masa VAR ama zaman tutmadi',
        masadakiTarama: masaEslesenler.length,
        enYakinFarkDk: farklar[0],
        yorum: Math.abs(farklar[0]) > 120 ? 'ZAMAN DILIMI SUPHESI' : 'PENCERE DAR OLABILIR'
      });
    }

    // Masadaki benzersiz kişileri bul
    const uniqueUsersAtTable = [];
    const seenIds = new Set();
    for (const s of tableScans) {
      if (!seenIds.has(s.rep_id)) {
        seenIds.add(s.rep_id);
        const isAd = !!(s.fbclid || ['meta','facebook','ig','instagram'].includes(s.utm_source));
        // §90: scanId (event_id icin) + GERCEK misafir ip/user_agent (CAPI user_data icin) tasinir.
        uniqueUsersAtTable.push({ rep_id: s.rep_id, isAdThisScan: isAd, timestamp: new Date(s.timestamp).getTime(), fbp: s.fbp, fbc: fbcUret(s), scanId: s.id, ip: s.ip, user_agent: s.user_agent });
      }
    }

    // ============ §84 KISI SAYISI SINIRI ============
    // ESKIDEN SINIR YOKTU: masada 6 kisi okutup adisyonda "2 kisi" yaziyorsa 6 event gidiyordu
    // ve her birine kisi basi tutar (toplam/2) atfediliyordu -> CIRO 3 KAT SISIYORDU.
    // Bugra: "adisyonda yazan kisi sayisi ve okutanlar tutuyorsa onlar o masadan sayilsin."
    // Kural: zaman sirasina gore ILK 'pax' KISI sayilir (once gelenler = asil parti),
    // fazlasi bir sonraki partinin/gecen birinin taramasi kabul edilip ELENIR.
    uniqueUsersAtTable.sort((a, b) => a.timestamp - b.timestamp);
    const okutanHam = uniqueUsersAtTable.length;
    if (okutanHam > pax) {
      uniqueUsersAtTable.length = pax;   // pax kadarini tut, gerisini at
      tani.kisiSiniriUygulandi = (tani.kisiSiniriUygulandi || 0) + 1;
      if (tani.ornekler.length < 6) tani.ornekler.push({
        masa: posMasa, sebep: 'kisi sayisi siniri uygulandi',
        okutanKisi: okutanHam, adisyondakiKisi: pax, sayilan: pax
      });
    }

    if (uniqueUsersAtTable.length === 0) continue; // Masada QR okutan yok (Sistem dışı organik)

    // Her bir kişi için etiketleme yap
    for (const u of uniqueUsersAtTable) {
      let label = "ORGANİK";
      let type = "ORGANİK";

      const history = userHistory[u.rep_id];

      // Masada BAŞKA (kendisi hariç) reklam kaynaklı biri var mı? (arkadaş etkisi için)
      const otherAdAtTable = uniqueUsersAtTable.some(o =>
        o.rep_id !== u.rep_id && (o.isAdThisScan || userHistory[o.rep_id].hasSeenAd)
      );

      if (u.isAdThisScan) {
        // Bu taramada reklamla gelmiş. Peki geçmişte nasıldı?
        const firstScan = history.scans[0];
        if (!firstScan.isAd && firstScan.timestamp < (u.timestamp - 86400000)) {
          // İlk gelişi organikmiş (en az 1 gün önce), şimdi reklamla geldi
          label = "Retargeting (Sadık Müşteri)";
          type = "RETARGETING";
          results.retargetRevenue += perCapita;
          results.totalAdRevenue += perCapita;
        } else {
          // İlk gelişi direkt reklam veya ilk defa görüyoruz
          label = "İlk Kez Reklamla Gelen (Yeni)";
          type = "YENI_MUSTERI";
          results.newCustomerRevenue += perCapita;
          results.totalAdRevenue += perCapita;
        }
      } else if (history.hasSeenAd) {
        // Bu okutmada organik ama kişinin KENDİSİ geçmişte reklam görmüş -> geri dönüş
        label = "Geçmişte Reklam Gören (Geri Dönüş)";
        type = "RETARGETING";
        results.retargetRevenue += perCapita;
        results.totalAdRevenue += perCapita;
      } else if (otherAdAtTable) {
        // Kendisi hiç reklam görmemiş ama masadaki BAŞKA biri reklam kaynaklı
        label = "Reklam Gören Arkadaşı İle Gelen";
        type = "HALO_EFFECT";
        results.haloRevenue += perCapita;
        results.totalAdRevenue += perCapita;
      }

      results.matches.push({
        rep_id: u.rep_id,
        masa: masaName,
        adisyonId: adisyonId,   // §90
        scanId: u.scanId,       // §90
        pax: pax,               // §90 (ReklamMisafiri kac adet gidecek)
        ip: u.ip,               // §90
        user_agent: u.user_agent, // §90
        time: row['__EMPTY_6'],
        total: total,
        perCapita: perCapita,
        type: type,
        label: label,
        fbp: u.fbp,
        fbc: u.fbc,
        eventTime: Math.floor(tOpen / 1000),
        capiSent: false
      });
    }
  }

  // ================= ORTALAMA IMPUTASYONU (Bugra onayli) =================
  // Reklamdan gelip MASA QR okutan ("Restorana Gelme") ama adisyonu ESLESMEYEN ziyaretcilere,
  // eslesen reklam-ziyaretcilerinin ORTALAMA kisi-basi degerini ata. Boylece kismi eslesmede
  // ROAS gercekci olur. NOT: /menu (masasiz) goruntulemeleri = dukkana GELMEMIS -> HARIC.
  const adAttributedMatches = results.matches.filter(m =>
    m.type === 'YENI_MUSTERI' || m.type === 'RETARGETING' || m.type === 'HALO_EFFECT'
  );
  const avgPerCapita = adAttributedMatches.length > 0
    ? Math.round(adAttributedMatches.reduce((sum, m) => sum + m.perCapita, 0) / adAttributedMatches.length)
    : 0;
  results.avgPerCapita = avgPerCapita;

  const matchedRepIds = new Set(results.matches.map(m => m.rep_id));
  // Dosyanin kapsadigi gun(ler): acilislarin -1saat / +5saat penceresi (servis gunu)
  const lo = (minOpen === Infinity) ? -Infinity : (minOpen - 3600000);
  const hi = (maxOpen === -Infinity) ? Infinity : (maxOpen + 5 * 3600000);

  if (avgPerCapita > 0) {
    const imputedVisits = {}; // rep_id -> ilk uygun ad-masa taramasi (kisi basi tek Purchase)
    for (const scan of allScans) {
      const masa = (scan.masa || '').trim();
      // §90-C: 'Bilinmiyor' DA masasiz sayilir (eskiden bu satir GECIRIYORDU -> yanlis Purchase).
      if (masasizMi(masa)) { tani.masasizElendi = (tani.masasizElendi || 0) + 1; continue; }
      if (matchedRepIds.has(scan.rep_id)) continue; // zaten gercek degerle eslesti
      const hist = userHistory[scan.rep_id];
      if (!hist || !hist.hasSeenAd) continue;    // reklam gecmisi yoksa organik -> haric
      const t = new Date(scan.timestamp).getTime();
      if (t < lo || t > hi) continue;            // yuklenen gunun disindaysa atla
      if (!imputedVisits[scan.rep_id]) imputedVisits[scan.rep_id] = scan;
    }
    for (const rep_id in imputedVisits) {
      const scan = imputedVisits[rep_id];
      results.imputedRevenue += avgPerCapita;
      results.totalAdRevenue += avgPerCapita;
      results.imputedCount++;
      results.matches.push({
        rep_id: rep_id,
        masa: scan.masa,
        scanId: scan.id,          // §90
        ip: scan.ip,              // §90
        user_agent: scan.user_agent, // §90
        time: new Date(scan.timestamp).toISOString(),
        total: avgPerCapita,
        perCapita: avgPerCapita,
        type: 'IMPUTE_ORTALAMA',
        label: 'Reklamdan Geldi, Adisyon Eslesmedi (Ortalama Deger)',
        fbp: scan.fbp,
        fbc: fbcUret(scan),   // §86: burasi da ham scan.fbc kullaniyordu -> fbc kayboluyordu
        eventTime: Math.floor(new Date(scan.timestamp).getTime() / 1000),
        capiSent: false
      });
    }
  }

    results.tani = tani;
  console.log('[eslestirme] TESHIS:', JSON.stringify(tani));
  return results;
}

module.exports = {
  processPosUpload
};
