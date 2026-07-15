const xlsx = require('xlsx');
const db = require('./db');

function parseDate(dateStr) {
  if (!dateStr || dateStr === '--') return null;
  const parts = dateStr.split(' ');
  if (parts.length !== 2) return null;
  const [datePart, timePart] = parts;
  const [d, m, y] = datePart.split('.');
  const [h, min] = timePart.split(':');
  return new Date(y, m - 1, d, h, min);
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
    pencere: '-30dk / +10dk (§5)',
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
    const totalStr = row['__EMPTY_12'] || '0';
    const totalRaw = totalStr.replace(/[^0-9,]/g, '').replace(',', '.');
    const total = parseFloat(totalRaw) || 0;
    const perCapita = Math.round(total / pax);

    // Eşleşen QR taramalarını bul (Açılış -5dk ile +10dk arası)
    const tOpen = openTime.getTime();
    if (tOpen < minOpen) minOpen = tOpen;
    if (tOpen > maxOpen) maxOpen = tOpen;
    const posMasa = String(masaName).toLowerCase().trim();
    // ONCE sadece MASA'ya gore sup, SONRA zamana gore -> boylece "masa mi tutmadi,
    // zaman mi tutmadi" AYRI AYRI olculebilir (eskiden tek filtrede birlesikti).
    const masaEslesenler = allScans.filter(scan => (scan.masa || '').toLowerCase().trim() === posMasa);
    const tableScans = masaEslesenler.filter(scan => {
      const scanTime = new Date(scan.timestamp).getTime();
      // §82 PENCERE DUZELTMESI (OLCUMLE bulundu):
      //   ESKI: (tOpen - 300000) = taramadan sadece 5 DAKIKA once -> GERCEK HAYATTA COGU
      //   ESLESME KACIYORDU. Cunku §5'te yazan gercek akis: "Once QR taranir, SONRA adisyon
      //   acilir (tipik: tarama 12:50 -> adisyon 12:55)". Yani tarama, adisyon acilisindan
      //   DAKIKALARCA ONCE olur; 5 dakika cok dar.
      //   KANIT (test2, gercek tarama verisi): adisyon 22:40 icin en yakin tarama -16 dk ->
      //   ESKI kod bunu REDDEDIYORDU. Tam da yakalamamiz gereken senaryo buydu.
      //   §5 SARTNAMESI: "adisyon acilisi, taramadan sonra <=30 dk VEYA taramadan once <=10 dk"
      //   -> tarama araligi = [acilis - 30dk , acilis + 10dk]
      return scanTime >= (tOpen - 1800000) && scanTime <= (tOpen + 600000);
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
        uniqueUsersAtTable.push({ rep_id: s.rep_id, isAdThisScan: isAd, timestamp: new Date(s.timestamp).getTime(), fbp: s.fbp, fbc: s.fbc });
      }
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
      if (!masa) continue;                       // masasiz /menu = gelmemis -> haric
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
        time: new Date(scan.timestamp).toISOString(),
        total: avgPerCapita,
        perCapita: avgPerCapita,
        type: 'IMPUTE_ORTALAMA',
        label: 'Reklamdan Geldi, Adisyon Eslesmedi (Ortalama Deger)',
        fbp: scan.fbp,
        fbc: scan.fbc,
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
