#!/usr/bin/env node
/* Republique - OTOMATIK UX DENETIMI (Playwright cihaz emulasyonu).
   AMAC (Bugra: 'hatalari ben bulmayayim, sistem bulsun'): her dagitimdan sonra otomatik kosar,
   uygulamanin ana ozelliklerini gercek bir telefon gibi dener, rapor uretir. Hata varsa exit!=0.

   KURULUM (sunucuda bir kez):
     cd /opt/republique-staging/tests
     npm i -D playwright
     npx playwright install --with-deps chromium
   CALISTIR:
     URL=https://test2.republique.tr MASA=b-9 node ux-audit.js
     (AI sohbet testini de acmak icin: CHAT=1  -> GERCEK Anthropic cagrisi yapar, 1 mesaj.)

   DURUST SINIR: Chromium emulasyonu ~ Safari DEGIL. Gercek iOS bellek baskisi/jetsam ve gercek
   klavye burada YOK. Bu suit mantik/duzen/regresyon hatalarini yakalar; surum sonu kisa bir
   gercek iPhone turu yine de gerekir (ayda 1-2, her gun degil).
*/
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = (process.env.URL || 'https://test2.republique.tr').replace(/\/$/, '');
const MASA = process.env.MASA || 'b-9';
const CHAT = process.env.CHAT === '1';
const OUT = path.join(__dirname, 'report');
const MENU = BASE + '/menu/' + MASA;
const MENU_MASASIZ = BASE + '/menu';

const sorunlar = [];
const gecen = [];
function BAD(cihaz, konu, mesaj) { sorunlar.push({ cihaz, konu, mesaj }); console.log('  [HATA][' + konu + '] ' + mesaj); }
function OK(konu, mesaj) { gecen.push(konu); console.log('  [ok] ' + konu + (mesaj ? ' - ' + mesaj : '')); }

async function denetle(browser, hedef) {
  console.log('\n===== ' + hedef.name + ' =====');
  const ctx = await browser.newContext({ ...hedef.dev });
  const page = await ctx.newPage();
  const jsHata = [];
  page.on('console', m => { if (m.type() === 'error') jsHata.push(m.text()); });
  page.on('pageerror', e => jsHata.push('pageerror: ' + e.message));

  // 1) MENU ACILIYOR MU
  try { await page.goto(MENU, { waitUntil: 'networkidle', timeout: 45000 }); }
  catch (e) { BAD(hedef.name, 'yukleme', MENU + ' acilmadi: ' + e.message); await ctx.close(); return; }
  await page.waitForTimeout(2500);
  const kart0 = await page.locator('.product-card').count();
  if (kart0 < 1) BAD(hedef.name, 'menu', 'hic urun karti yok'); else OK('menu', kart0 + ' kart');

  // 2) BELLEK/COKME RISKI: acilista DOM kart sayisi makul mu (415 kart = iPhone cokmesi idi)
  if (kart0 > 250) BAD(hedef.name, 'bellek', 'acilista ' + kart0 + ' kart DOM,da (>250) - iPhone cokme riski');
  else OK('bellek', 'acilista ' + kart0 + ' kart (pencereli render calisiyor)');

  // 3) YATAY TASMA
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (ov.sw - ov.iw > 3) BAD(hedef.name, 'tasma', 'yatay tasma sw=' + ov.sw + ' iw=' + ov.iw); else OK('tasma');

  // 4) KAYDIRINCA TUM KATEGORILER DOLUYOR MU (IS1 regresyonu: 2/3 menu gorunmuyordu)
  const kat = await page.locator('.cat-btn').count();
  if (kat < 2) BAD(hedef.name, 'kategori', 'kategori butonu yok/az: ' + kat);
  else {
    await page.evaluate(async () => {
      const adim = 600; const bekle = ms => new Promise(r => setTimeout(r, ms));
      for (let y = 0; y < document.body.scrollHeight; y += adim) { window.scrollTo(0, y); await bekle(60); }
    });
    await page.waitForTimeout(1200);
    const bos = await page.evaluate(() => [...document.querySelectorAll('.category-section')]
      .map((s, i) => ({ i, kart: s.querySelectorAll('.product-card').length, h: s.offsetHeight }))
      .filter(x => x.kart === 0 && x.h > 100).map(x => 'cat-' + x.i));
    if (bos.length) BAD(hedef.name, 'kategori', 'kaydirmaya ragmen BOS kalan bolum: ' + bos.join(','));
    else OK('kategori', kat + ' kategori, kaydirinca hepsi doldu');
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(500);
  }

  // 5) URUN MODALI
  try {
    await page.locator('.product-card').first().click({ timeout: 5000 });
    await page.waitForTimeout(700);
    if (!(await page.locator('.pd-overlay.open').count())) BAD(hedef.name, 'modal', 'karta dokununca modal acilmadi');
    else { OK('modal'); await page.locator('.pd-close').first().click().catch(() => {}); await page.waitForTimeout(300); }
  } catch (e) { BAD(hedef.name, 'modal', 'kart tiklanamadi: ' + e.message); }

  // 6) AI: raiShowProduct uzak kategorideki urunu ACIYOR + kart EKRANDA (Bugra,nin cokme senaryosu)
  const show = await page.evaluate(async () => {
    const bekle = ms => new Promise(r => setTimeout(r, ms));
    const r = await fetch('/api/menu'); const d = await r.json();
    let cats = (d.result && d.result.categories) || d;
    cats = cats.filter(c => c.isVisible !== false && c.name !== 'Personel' && c.name !== 'Ekstra İstek');
    const son = cats[cats.length - 1]; let ad = null;
    for (const s of (son.sections || [])) for (const p of (s.products || [])) { if (p.inStock !== false) { ad = p.name; break; } }
    if (!ad || typeof window.raiShowProduct !== 'function') return { hata: 'raiShowProduct yok veya urun yok' };
    window.scrollTo(0, 0); await bekle(300);
    const sonuc = window.raiShowProduct(ad);
    await bekle(1200);
    const kart = [...document.querySelectorAll('.product-card')].find(c => c.querySelector('.product-name')?.textContent.trim() === ad);
    const rect = kart ? kart.getBoundingClientRect() : null;
    return { urun: ad, sonuc, modal: !!document.querySelector('.pd-overlay.open'),
      baslik: document.querySelector('.pd-name')?.textContent,
      kartDOMda: !!kart, ekranda: rect ? (rect.top > -50 && rect.top < window.innerHeight) : false,
      domKart: document.querySelectorAll('.product-card').length };
  });
  if (show.hata) BAD(hedef.name, 'ai-kart', show.hata);
  else {
    if (!show.modal) BAD(hedef.name, 'ai-kart', show.urun + ': modal acilmadi');
    else if (show.baslik !== show.urun) BAD(hedef.name, 'ai-kart', 'yanlis urun modali: ' + show.baslik + ' != ' + show.urun);
    else if (!show.kartDOMda) BAD(hedef.name, 'ai-kart', show.urun + ': kart DOM,dan silindi (pin calismiyor)');
    else if (!show.ekranda) BAD(hedef.name, 'ai-kart', show.urun + ': kart ekranda degil (kaydirma hatali)');
    else OK('ai-kart', show.urun + ' -> modal+konum dogru, DOM ' + show.domKart + ' kart');
  }
  await page.evaluate(() => document.querySelector('.pd-overlay')?.classList.remove('open'));

  // 7) SOHBET KALICILIGI (yenileme sonrasi durmali)
  await page.evaluate(m => sessionStorage.setItem('raiHist:' + m, JSON.stringify([
    { role: 'user', content: 'denetim testi', _sent: true },
    { role: 'assistant', content: 'denetim yaniti', _sent: true }])), MASA);
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2000);
  await page.locator('.rai-fab').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  const mesajlar = await page.locator('.rai-msg').allTextContents();
  if (!mesajlar.includes('denetim testi')) BAD(hedef.name, 'sohbet-kalicilik', 'yenileme sonrasi sohbet KAYBOLDU');
  else OK('sohbet-kalicilik', mesajlar.length + ' mesaj geri geldi');

  // 8) KLAVYE/visualViewport: input,a odaklaninca son mesaj gorunur kalmali
  try {
    const inp = page.locator('.rai-inp');
    if (await inp.count()) { await inp.click({ timeout: 4000 }); await page.waitForTimeout(600);
      const gorunur = await page.evaluate(() => { const b = document.getElementById('raiBody'); if (!b) return null;
        return b.scrollHeight - b.scrollTop - b.clientHeight < 60; });
      if (gorunur === false) BAD(hedef.name, 'klavye', 'input odaklaninca son mesaj gorunmuyor');
      else OK('klavye');
    }
  } catch (e) { BAD(hedef.name, 'klavye', e.message); }

  // 9) DOKUNMA HEDEFI >= 40px
  const kucuk = await page.evaluate(() => [...document.querySelectorAll('button, .cat-btn, .rai-send, .rai-close, .pd-close')]
    .filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 40 || r.width < 40); })
    .map(b => (b.className || b.tagName) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)).slice(0, 6));
  if (kucuk.length) BAD(hedef.name, 'dokunma-hedefi', 'kucuk hedefler: ' + kucuk.join(' | '));
  else OK('dokunma-hedefi');

  // 10) COKUSME/BINISME: sol-alt uyelik ile sag-alt AI balonu ust uste binmemeli
  const binisme = await page.evaluate(() => {
    const a = document.querySelector('.rai-fab'); const b = document.querySelector('.uyelik-btn, .membership-btn, [class*=uye]');
    if (!a || !b) return null; const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
    const kesisim = !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom);
    return kesisim ? (Math.round(r1.left) + ',' + Math.round(r1.top) + ' <-> ' + Math.round(r2.left) + ',' + Math.round(r2.top)) : false;
  });
  if (binisme) BAD(hedef.name, 'binisme', 'AI balonu ile uyelik butonu ust uste: ' + binisme);
  else OK('binisme');

  // 11) MASASIZ MENUDE AI BUTONU GORUNMEMELI (kota korumasi, IS2)
  const p2 = await ctx.newPage();
  try {
    await p2.goto(MENU_MASASIZ, { waitUntil: 'networkidle', timeout: 30000 }); await p2.waitForTimeout(1500);
    const gorunen = await p2.evaluate(() => { const f = document.querySelector('.rai-fab'); const b = document.querySelector('.ai-btn');
      const gor = el => el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null; return { fab: gor(f), aiBtn: gor(b) }; });
    if (gorunen.fab || gorunen.aiBtn) BAD(hedef.name, 'masa-kapisi', 'masasiz /menu,de AI butonu GORUNUYOR: ' + JSON.stringify(gorunen));
    else OK('masa-kapisi', 'masasiz menude AI butonu yok');
  } catch (e) { BAD(hedef.name, 'masa-kapisi', e.message); }
  await p2.close();

  // 12) AI SOHBET UCTAN UCA (opsiyonel: gercek LLM cagrisi)
  if (CHAT) {
    const c = await page.evaluate(async (masa) => {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'bir kokteyl onerir misin', table: masa, history: [] }) });
      return await r.json();
    }, MASA);
    if (!c || c.ok === false) BAD(hedef.name, 'ai-sohbet', 'api/chat basarisiz: ' + JSON.stringify(c).slice(0, 150));
    else if (c.show && c.goto) BAD(hedef.name, 'ai-sohbet', 'HEM kart HEM bolum etiketi dondu (guardrail calismadi)');
    else OK('ai-sohbet', 'reply=' + String(c.reply || '(bos)').slice(0, 40) + ' show=' + c.show + ' goto=' + c.goto);
  }

  // 13) JS HATALARI
  if (jsHata.length) jsHata.slice(0, 8).forEach(m => BAD(hedef.name, 'js-hata', m.slice(0, 180)));
  else OK('js-hata', 'konsol temiz');

  try { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, hedef.name + '.png') }); } catch (e) {}
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const hedefler = [
    { name: 'iPhone-12', dev: devices['iPhone 12'] },
    { name: 'iPhone-SE', dev: devices['iPhone SE'] },
    { name: 'Pixel-5', dev: devices['Pixel 5'] },
  ];
  for (const h of hedefler) { try { await denetle(browser, h); } catch (e) { BAD(h.name, 'olumcul', e.message); } }
  await browser.close();
  const rapor = { adres: MENU, zaman: new Date().toISOString(), gecen: gecen.length, sorunSayisi: sorunlar.length, sorunlar };
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'ux-audit.json'), JSON.stringify(rapor, null, 2)); } catch (e) {}
  console.log('\n================ DENETIM SONUCU ================');
  console.log('Gecen kontrol: ' + gecen.length + ' | Sorun: ' + sorunlar.length);
  if (sorunlar.length) { sorunlar.forEach(s => console.log(' - [' + s.cihaz + '][' + s.konu + '] ' + s.mesaj)); }
  else console.log('TUM CIHAZLARDA TEMIZ');
  console.log('Rapor: tests/report/ux-audit.json');
  process.exit(sorunlar.length ? 1 : 0);
})();
