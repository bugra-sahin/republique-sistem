// fbc SAFARI/WebKit TESTI - §88
// NEDEN: Bugra'nin iPhone Safari taramalarinda fbclid DB'ye ULASMADI (2 deneme).
//   Masaustu Chrome'da AYNI kod fbc uretti. Soru: Safari/WebKit fbclid'i kiriyor mu?
// Bu test GERCEK CANLI siteyi (test1) GERCEK WebKit motorunda acar ve OLCER.
// DURUSTLUK NOTU: Playwright WebKit != gercek iOS Safari. Bu test motoru olcer, cihazi DEGIL.
const { webkit, devices } = require('playwright');

const URL_HEDEF = process.env.HEDEF || 'https://test1.republique.tr';
const FBCLID = 'IwWEBKITTEST' + Date.now();

(async () => {
  const hedefler = ['iPhone 12', 'iPhone SE', 'iPhone 14 Pro Max'];
  let sorun = 0, gecen = 0;
  for (const ad of hedefler) {
    const browser = await webkit.launch();
    const ctx = await browser.newContext({ ...devices[ad] });
    const page = await ctx.newPage();
    const istekler = [];
    page.on('request', r => { if (r.url().includes('/api/track')) istekler.push(r.postData() || ''); });
    const url = URL_HEDEF + '/?masa=WEBKIT-TEST&fbclid=' + FBCLID;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    const cerezler = await ctx.cookies();
    const fbcCerez = cerezler.find(c => c.name === '_fbc');
    const govde = istekler[0] || '';
    let g = {};
    try { g = JSON.parse(govde); } catch (e) {}
    const cerezOk = !!fbcCerez && fbcCerez.value.startsWith('fb.1.') && fbcCerez.value.endsWith(FBCLID);
    const istekAtildi = istekler.length > 0;
    const fbclidGitti = g.fbclid === FBCLID;
    const fbcGitti = typeof g.fbc === 'string' && g.fbc.startsWith('fb.1.');
    const masaGitti = g.masa === 'WEBKIT-TEST';
    const hepsi = cerezOk && istekAtildi && fbclidGitti && fbcGitti && masaGitti;
    if (hepsi) gecen++; else sorun++;
    console.log('===== ' + ad + ' (WebKit) =====');
    console.log('  [' + (istekAtildi ? 'ok' : 'SORUN') + '] /api/track istegi atildi mi');
    console.log('  [' + (masaGitti ? 'ok' : 'SORUN') + '] masa sunucuya gitti mi');
    console.log('  [' + (fbclidGitti ? 'ok' : 'SORUN') + '] fbclid sunucuya gitti mi');
    console.log('  [' + (cerezOk ? 'ok' : 'SORUN') + '] _fbc cerezi dogru formatta yazildi mi');
    console.log('  [' + (fbcGitti ? 'ok' : 'SORUN') + '] fbc sunucuya gitti mi (KIRIK HALKA)');
    await browser.close();
  }
  console.log('');
  console.log('========== SONUC ==========');
  console.log('Gecen cihaz: ' + gecen + ' | Sorunlu cihaz: ' + sorun);
  console.log(sorun === 0 ? 'SAFARI/WebKit fbc ZINCIRI SAGLAM' : 'SAFARI/WebKit ta SORUN VAR');
  process.exit(sorun === 0 ? 0 : 1);
})();
