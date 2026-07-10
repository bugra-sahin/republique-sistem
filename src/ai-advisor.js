const db = require('./db');
const { requestApprovalForSuggestion } = require('./meta-marketing');

/**
 * AI Advisor: Reklam verilerini analiz edip bütçe artırma / kapatma önerileri üretir.
 * ASLA otomatik kapatma işlemi YAPMAZ. Kullanıcıya "Ortalama Altı" veya "Çok İyi" olarak raporlar.
 */
async function generateAdSuggestions(accountHierarchy) {
    const suggestions = [];

    // Hesabın genel ortalamalarını bulalım
    let totalSpend = 0;
    let totalPurchases = 0;
    let totalImpressions = 0;
    let total3sViews = 0;

    const allAds = [];

    accountHierarchy.forEach(camp => {
        camp.adsets?.forEach(set => {
            set.ads?.forEach(ad => {
                if (ad.insight) {
                    const spend = parseFloat(ad.insight.spend || 0);
                    const impressions = parseInt(ad.insight.impressions || 0, 10);
                    
                    // Dönüşümleri (Purchases) Bul (Hem Meta standart hem CAPI)
                    let purchases = 0;
                    let views3s = 0;

                    if (ad.insight.actions) {
                        const purchaseAction = ad.insight.actions.find(a => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
                        if (purchaseAction) purchases = parseInt(purchaseAction.value, 10);

                        // Hook Rate için 3 saniye izlenme (video_view)
                        const viewAction = ad.insight.actions.find(a => a.action_type === 'video_view');
                        if (viewAction) views3s = parseInt(viewAction.value, 10);
                    }

                    totalSpend += spend;
                    totalPurchases += purchases;
                    totalImpressions += impressions;
                    total3sViews += views3s;

                    const cpa = purchases > 0 ? spend / purchases : null;
                    const hookRate = impressions > 0 ? (views3s / impressions) * 100 : 0;

                    allAds.push({
                        campName: camp.name,
                        setName: set.name,
                        adId: ad.id,
                        adName: ad.name,
                        status: ad.status,
                        spend,
                        purchases,
                        impressions,
                        views3s,
                        cpa,
                        hookRate
                    });
                }
            });
        });
    });

    const avgCPA = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
    const avgHookRate = totalImpressions > 0 ? (total3sViews / totalImpressions) * 100 : 0;

    // Her reklam için karar ver
    allAds.forEach(ad => {
        if (ad.status !== 'ACTIVE') return;

        // Kural 1: Çok iyi performans (CPA düşük veya Hook Rate yüksek) -> Bütçe artırma önerisi
        if (ad.cpa !== null && avgCPA > 0 && ad.cpa < avgCPA * 0.7) {
            suggestions.push({
                type: 'INCREASE_BUDGET',
                adId: ad.adId,
                adName: ad.adName,
                campName: ad.campName,
                setName: ad.setName,
                reason: `CPA (${ad.cpa.toFixed(2)} TL) hesap ortalamasının (${avgCPA.toFixed(2)} TL) çok altında. Bütçe artırılabilir.`
            });
        }

        // Kural 2: Ortalama altı performans (CPA çok yüksek VEYA Harcama yapıp hiç dönüşüm getirmemiş)
        if ((ad.cpa !== null && avgCPA > 0 && ad.cpa > avgCPA * 1.5) || (ad.spend > avgCPA * 2 && ad.purchases === 0 && avgCPA > 0)) {
            suggestions.push({
                type: 'PAUSE_AD',
                adId: ad.adId,
                adName: ad.adName,
                campName: ad.campName,
                setName: ad.setName,
                reason: `Bu reklam ortalama altı performans gösteriyor. Harcama: ${ad.spend.toFixed(2)} TL, Dönüşüm: ${ad.purchases}. Durdurulması önerilir.`
            });
        }
    });

    // Önerileri veritabanına PENDING olarak kaydet (Daha önce kaydedilmemişse)
    for (const sug of suggestions) {
        // Zaten bekleyen bir öneri var mı kontrol et
        const existing = await db.query(
            `SELECT id FROM ad_actions_log WHERE ad_id = $1 AND status = 'PENDING' AND action_type = $2`,
            [sug.adId, sug.type]
        );
        if (existing.rows.length === 0) {
            await requestApprovalForSuggestion(sug.adId, sug.type, sug);
        }
    }

    return {
        avgCPA,
        avgHookRate,
        suggestions
    };
}

module.exports = {
    generateAdSuggestions
};
