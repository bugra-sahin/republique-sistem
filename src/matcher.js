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

  // 2. Veritabanından Tüm Taramaları Çek (Son 30 gün)
  const { rows: allScans } = await db.query(`SELECT * FROM scans WHERE timestamp >= NOW() - INTERVAL '30 days' ORDER BY timestamp ASC`);
  
  // Taramaları kullanıcı bazında (rep_id) geçmişleriyle gruplayalım
  const userHistory = {};
  for (const scan of allScans) {
    if (!userHistory[scan.rep_id]) {
      userHistory[scan.rep_id] = { scans: [], hasSeenAd: false, firstSeenAdAt: null };
    }
    const isAd = !!(scan.fbclid || scan.utm_source === 'facebook' || scan.utm_source === 'ig');
    userHistory[scan.rep_id].scans.push({ ...scan, isAd });
    if (isAd && !userHistory[scan.rep_id].hasSeenAd) {
      userHistory[scan.rep_id].hasSeenAd = true;
      userHistory[scan.rep_id].firstSeenAdAt = new Date(scan.timestamp).getTime();
    }
  }

  const results = {
    totalAdRevenue: 0,
    newCustomerRevenue: 0,
    haloRevenue: 0,
    retargetRevenue: 0,
    matches: []
  };

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
    const tableScans = allScans.filter(scan => {
      const scanMasa = (scan.masa || '').toLowerCase().trim();
      const posMasa = masaName.toLowerCase().trim();
      if (scanMasa !== posMasa) return false;

      const scanTime = new Date(scan.timestamp).getTime();
      return scanTime >= (tOpen - 300000) && scanTime <= (tOpen + 600000);
    });

    // Masadaki benzersiz kişileri bul
    const uniqueUsersAtTable = [];
    const seenIds = new Set();
    for (const s of tableScans) {
      if (!seenIds.has(s.rep_id)) {
        seenIds.add(s.rep_id);
        const isAd = !!(s.fbclid || s.utm_source === 'facebook' || s.utm_source === 'ig');
        uniqueUsersAtTable.push({ rep_id: s.rep_id, isAdThisScan: isAd, timestamp: new Date(s.timestamp).getTime(), fbp: s.fbp, fbc: s.fbc });
      }
    }

    if (uniqueUsersAtTable.length === 0) continue; // Masada QR okutan yok (Sistem dışı organik)

    // Masada herhangi bir reklam kaynağı var mı? (Arkadaş etkisi için)
    let anyAdAtTable = false;
    for (const u of uniqueUsersAtTable) {
      if (u.isAdThisScan || userHistory[u.rep_id].hasSeenAd) {
        anyAdAtTable = true;
        break;
      }
    }

    // Her bir kişi için etiketleme yap
    for (const u of uniqueUsersAtTable) {
      let label = "ORGANİK";
      let type = "ORGANİK";
      
      const history = userHistory[u.rep_id];

      if (u.isAdThisScan) {
        // Bu taramada reklamla gelmiş. Peki geçmişte nasıldı?
        // Eğer history'deki ilk reklam gösterimi bugünden ESKİYSE veya ilk gelişleri zaten organikse:
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
      } else if (anyAdAtTable) {
        // Kendisi organik ama masada reklam gören biri var
        label = "Reklam Gören Arkadaşı İle Gelen";
        type = "HALO_EFFECT";
        results.haloRevenue += perCapita;
        results.totalAdRevenue += perCapita;
      } else if (history.hasSeenAd) {
        // Bu okutmada organik ama GECMISTE reklam görmüş!
        label = "Geçmişte Reklam Gören (Geri Dönüş)";
        type = "RETARGETING";
        results.retargetRevenue += perCapita;
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
        capiSent: false
      });
    }
  }

  return results;
}

module.exports = {
  processPosUpload
};
