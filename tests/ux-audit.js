#!/usr/bin/env node
/* Republique - OTOMATIK UX DENETIMI (Playwright cihaz emulasyonu).
   AMAC (Bugra: 'hatalari ben bulmayayim, sistem bulsun'): her dagitimdan sonra otomatik kosar,
   uygulamanin ana ozelliklerini gercek bir telefon gibi dener, rapor uretir. Hata varsa exit!=0.

CALISTIR (sunucuda):
   cd /opt/republique-staging  &&  bash tests/run-audit.sh
   (AI sohbet testini de acmak icin: CHAT=1 -> GERCEK Anthropic cagrisi, 1 mesaj.)

DURUST SINIR: Chromium emulasyonu ~ Safari DEGIL. Gercek iOS bellek baskisi/jetsam ve gercek
klavye burada YOK. Bu suit mantik/duzen/regresyon hatalarini yakalar; surum sonu kisa bir
gercek iPhone turu yine de gerekir (ayda 1-2, her gun degil).

--- SURUM 2 (2026-07-15): ILK TURDAKI IKI YANLIS ALARM DUZELTILDI ---
 (1) [kategori] Eskiden: bastan sona kaydir, SONDA tum bolumlere bak -> "cat-0..3 BOS" derdi.
     Bu YANLIS ALARMDI: app.js pencereli render, 8000px'den UZAK kategorileri KASTEN bosaltir
     (unfillCategory) ve yuksekligi minHeight ile korur. Yani sonda en usttekiler dogal olarak bos.
     Simdi: her bolum TEK TEK goruse getirilir ve O AN dolu mu diye bakilir (IS1'in gercek sorusu).
 (2) [ai-kart] Eskiden: son kategorinin ilk urununu secerdi -> "Ekstra 100 TL" (gercek urun degil,
     servis kalemi) secip "modal acilmadi" derdi. IKI hata vardi: (a) ic dongudeki `break` sadece
     IC dongudan cikiyordu -> aslinda SON BOLUMUN ilk urununu seciyordu; (b) eleme yalnizca
     KATEGORI adina bakiyordu, oysa "Ekstra Istek" bir kategori degil, "Icecek" kategorisinin
     ICINDEKI BIR BOLUM. Simdi: kategori+bolum+urun adlarinda regex eleme + dongu dogru kirilir.
 (3) [tasma] Artik sadece "tasma var" demiyor, TASIRAN OGEYI de bildiriyor (yatay kaydirmasi
     olan konteynerlerin icindekiler haric tutulur - onlarin tasmasi normaldir).

--- SURUM 3 (2026-07-15 gece): DENETIMIN KENDI YANLIS ALARMLARI TEMIZLENDI (§69-E) ---
 (1) [dokunma-hedefi] .cat-btn'de GENISLIK kurali kaldirildi -> sadece YUKSEKLIK. Sebep: yatay
     sekme seridinde "Viski" gibi kisa ad dogal olarak dar (37px); bu hata degil. (E-2)
 (2) [ag-hata] YENI KONTROL: page.on('response') ile 400+ donen ADRESLER kaydedilir. Chrome'un
     adressiz "404 ()" konsol mesaji artik adresiyle raporlanir. (E-3)
 (3) [tasma] position:fixed ogeler (glow-1/2/3 gibi dekoratif isiklar) artik SUCLANMIYOR -
     belge akisinin disindalar, sayfa tasmasi yaratmazlar = yanlis pozitifti. (E-4)
*/
const { chromium, devices } = require('playwright');
const fs = require('fs'); const path = require('path');

const BASE = (process.env.URL || 'https://test2.republique.tr').replace(/\/$/, '');
const MASA = process.env.MASA || 'b-9';
const CHAT = process.env.CHAT === '1';
const OUT = path.join(__dirname, 'report');
const MENU = BASE + '/menu/' + MASA;
const MENU_MASASIZ = BASE + '/menu';

// Gercek bir menu urunu OLMAYAN kalemler (servis/ekstra/personel). Hem kategori, hem bolum,
// hem urun adinda aranir. Bunlarin karti olmayabilir -> teste sokma.
const SAHTE_KALEM = /ekstra|personel|servis|kuver|bahsis|garson|paket\s*servis/i;

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
  // SURUM 3 (§69-E-3): Chrome konsolu "404 ()" derken ADRESI YAZMIYOR -> hangi dosyanin eksik
  // oldugunu ogrenemiyorduk. Cozum: yanitlari dogrudan dinle, 400+ donen HER adresi kaydet.
  const agHata = [];
  page.on('response', r => { if (r.status() >= 400) agHata.push(r.status() + ' ' + r.url()); });
  page.on('requestfailed', r => { const f = r.failure(); agHata.push('BASARISIZ(' + (f ? f.errorText : '?') + ') ' + r.url()); });

  // 1) MENU ACILIYOR MU
  try { await page.goto(MENU, { waitUntil: 'networkidle', timeout: 45000 }); }
  catch (e) { BAD(hedef.name, 'yukleme', MENU + ' acilmadi: ' + e.message); await ctx.close(); return; }
  await page.waitForTimeout(2500);
  const kart0 = await page.locator('.product-card').count();
  if (kart0 < 1) BAD(hedef.name, 'menu', 'hic urun karti yok'); else OK('menu', kart0 + ' kart');

  // 2) BELLEK/COKME RISKI: acilista DOM kart sayisi makul mu (415 kart = iPhone cokmesi idi)
  if (kart0 > 250) BAD(hedef.name, 'bellek', 'acilista ' + kart0 + ' kart DOM,da (>250) - iPhone cokme riski');
  else OK('bellek', 'acilista ' + kart0 + ' kart (pencereli render calisiyor)');

  // 3) YATAY TASMA (+ TASIRAN OGEYI BILDIR)
  const ov = await page.evaluate(() => {
    const iw = document.documentElement.clientWidth;
    // Yatay kaydirmasi olan bir konteynerin ICINDE olan oge tasma sayilmaz (orn. kategori seridi).
    const kaydirilabilirIcinde = el => {
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    const ad = el => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += '#' + el.id;
      if (el.className && typeof el.className === 'string' && el.className.trim())
        s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
      return s;
    };
    const suclu = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= iw + 1 && r.left >= -1) continue;
      if (kaydirilabilirIcinde(el)) continue;
      // §69-E-4: position:fixed ogeler (glow-1/2/3 gibi dekoratif isiklar) belge akisinin DISINDA
      // durur -> sayfa tasmasi YARATMAZ. Bunlari suclamak YANLIS POZITIF ve yanlis yonlendirir.
      if (getComputedStyle(el).position === 'fixed') continue;
      suclu.push({ oge: ad(el), sol: Math.round(r.left), sag: Math.round(r.right), gen: Math.round(r.width) });
    }
    suclu.sort((a, b) => b.sag - a.sag);
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, suclu: suclu.slice(0, 8) };
  });
  if (ov.sw - ov.iw > 3) {
    const detay = ov.suclu.length
      ? ' | TASIRAN: ' + ov.suclu.map(s => s.oge + ' (sol=' + s.sol + ' sag=' + s.sag + ' gen=' + s.gen + ')').join(' ; ')
      : ' | tasiran oge bulunamadi (govde/margin kaynakli olabilir)';
    BAD(hedef.name, 'tasma', 'yatay tasma sw=' + ov.sw + ' iw=' + ov.iw + detay);
  } else OK('tasma');

  // 4) HER KATEGORI, GORUSE GELDIGINDE DOLUYOR MU (IS1 regresyonu: 2/3 menu gorunmuyordu)
  //    NOT: Pencereli render UZAK kategorileri KASTEN bosaltir -> "sonda hepsine bakmak" YANLIS ALARM
  //    uretir. Dogru soru: "misafir oraya kaydirdiginda dolu mu?"
  const kat = await page.locator('.cat-btn').count();
  if (kat < 2) BAD(hedef.name, 'kategori', 'kategori butonu yok/az: ' + kat);
  else {
    const bos = await page.evaluate(async () => {
      const bekle = ms => new Promise(r => setTimeout(r, ms));
      const sonuc = [];
      const adet = document.querySelectorAll('.category-section').length;
      for (let i = 0; i < adet; i++) {
        const s = document.querySelectorAll('.category-section')[i];
        if (!s) continue;
        s.scrollIntoView({ block: 'center' });
        await bekle(500);                       // scroll olayi + rAF + fillCategory tamamlansin
        const g = document.querySelectorAll('.category-section')[i];
        if (!g) continue;
        const kart = g.querySelectorAll('.product-card').length;
        if (kart === 0 && g.offsetHeight > 100) sonuc.push('cat-' + i);
      }
      window.scrollTo(0, 0);
      return sonuc;
    });
    if (bos.length) BAD(hedef.name, 'kategori', 'goruse gelmesine RAGMEN bos kalan bolum: ' + bos.join(','));
    else OK('kategori', kat + ' kategori, her biri goruse gelince doldu');
    await page.waitForTimeout(500);
  }

  // 5) URUN MODALI
  try {
    await page.locator('.product-card').first().click({ timeout: 5000 });
    await page.waitForTimeout(700);
    if (!(await page.locator('.pd-overlay.open').count())) BAD(hedef.name, 'modal', 'karta dokununca modal acilmadi');
    else { OK('modal'); await page.locator('.pd-close').first().click().catch(() => {}); await page.waitForTimeout(300); }
  } catch (e) { BAD(hedef.name, 'modal', 'kart tiklanamadi: ' + e.message); }

  // 6) AI: raiShowProduct uzak kategorideki GERCEK urunu ACIYOR + kart EKRANDA (Bugra,nin cokme senaryosu)
  const show = await page.evaluate(async (SAHTE_STR) => {
    const SAHTE = new RegExp(SAHTE_STR, 'i');
    const bekle = ms => new Promise(r => setTimeout(r, ms));
    const r = await fetch('/api/menu'); const d = await r.json();
    let cats = (d.result && d.result.categories) || d;
    cats = cats.filter(c => c.isVisible !== false && !SAHTE.test(c.name || ''));
    if (!cats.length) return { hata: 'kategori bulunamadi' };
    const son = cats[cats.length - 1];
    // Son kategorinin ILK gercek urunu (servis/ekstra bolumleri elenir; dongu DOGRU kirilir).
    let ad = null;
    dis: for (const s of (son.sections || [])) {
      if (SAHTE.test(s.name || '')) continue;
      for (const p of (s.products || [])) {
        if (p.inStock === false) continue;
        if (SAHTE.test(p.name || '')) continue;
        ad = p.name; break dis;
      }
    }
    if (!ad) return { hata: son.name + ' kategorisinde test edilebilir gercek urun yok' };
    if (typeof window.raiShowProduct !== 'function') return { hata: 'raiShowProduct fonksiyonu yok' };
    window.scrollTo(0, 0); await bekle(300);
    const sonuc = window.raiShowProduct(ad);
    await bekle(1200);
    const kart = [...document.querySelectorAll('.product-card')]
      .find(c => c.querySelector('.product-name') && c.querySelector('.product-name').textContent.trim() === ad);
    const rect = kart ? kart.getBoundingClientRect() : null;
    return {
      kategori: son.name, urun: ad, sonuc, modal: !!document.querySelector('.pd-overlay.open'),
      baslik: document.querySelector('.pd-name') ? document.querySelector('.pd-name').textContent : null,
      kartDOMda: !!kart, ekranda: rect ? (rect.top > -50 && rect.top < window.innerHeight) : false,
      domKart: document.querySelectorAll('.product-card').length
    };
  }, SAHTE_KALEM.source);
  if (show.hata) BAD(hedef.name, 'ai-kart', show.hata);
  else {
    if (!show.modal) BAD(hedef.name, 'ai-kart', show.urun + ': modal acilmadi');
    else if (show.baslik !== show.urun) BAD(hedef.name, 'ai-kart', 'yanlis urun modali: ' + show.baslik + ' != ' + show.urun);
    else if (!show.kartDOMda) BAD(hedef.name, 'ai-kart', show.urun + ': kart DOM,dan silindi (pin calismiyor)');
    else if (!show.ekranda) BAD(hedef.name, 'ai-kart', show.urun + ': kart ekranda degil (kaydirma hatali)');
    else OK('ai-kart', show.kategori + '/' + show.urun + ' -> modal+konum dogru, DOM ' + show.domKart + ' kart');
  }
  await page.evaluate(() => { const o = document.querySelector('.pd-overlay'); if (o) o.classList.remove('open'); });

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
    if (await inp.count()) {
      await inp.click({ timeout: 4000 }); await page.waitForTimeout(600);
      const gorunur = await page.evaluate(() => {
        const b = document.getElementById('raiBody'); if (!b) return null;
        return b.scrollHeight - b.scrollTop - b.clientHeight < 60;
      });
      if (gorunur === false) BAD(hedef.name, 'klavye', 'input odaklaninca son mesaj gorunmuyor');
      else OK('klavye');
    }
  } catch (e) { BAD(hedef.name, 'klavye', e.message); }

  // 9) DOKUNMA HEDEFI >= 40px (Apple 44px onerir; 40 esigi ile uyariyoruz)
  const kucuk = await page.evaluate(() => [...document.querySelectorAll('button, .cat-btn, .rai-send, .rai-close, .pd-close')]
    .filter(b => {
      // §69-E-2: YATAY sekme seridindeki .cat-btn icin GENISLIK kurali ANLAMSIZ. "Viski" gibi kisa
      // bir kategori adi dogal olarak dar olur (37px) ve bu bir hata DEGILDIR. Sadece YUKSEKLIGE bak.
      const r = b.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return false;
      if (b.classList.contains('cat-btn')) return r.height < 40;
      return r.height < 40 || r.width < 40;
    })
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
    const gorunen = await p2.evaluate(() => {
      const f = document.querySelector('.rai-fab'); const b = document.querySelector('.ai-btn');
      const gor = el => el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
      return { fab: gor(f), aiBtn: gor(b) };
    });
    if (gorunen.fab || gorunen.aiBtn) BAD(hedef.name, 'masa-kapisi', 'masasiz /menu,de AI butonu GORUNUYOR: ' + JSON.stringify(gorunen));
    else OK('masa-kapisi', 'masasiz menude AI butonu yok');
  } catch (e) { BAD(hedef.name, 'masa-kapisi', e.message); }
  await p2.close();

  // 12) AI SOHBET UCTAN UCA (opsiyonel: gercek LLM cagrisi)
  if (CHAT) {
    const c = await page.evaluate(async (masa) => {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'bir kokteyl onerir misin', table: masa, history: [] })
      });
      return await r.json();
    }, MASA);
    if (!c || c.ok === false) BAD(hedef.name, 'ai-sohbet', 'api/chat basarisiz: ' + JSON.stringify(c).slice(0, 150));
    else if (c.show && c.goto) BAD(hedef.name, 'ai-sohbet', 'HEM kart HEM bolum etiketi dondu (guardrail calismadi)');
    else OK('ai-sohbet', 'reply=' + String(c.reply || '(bos)').slice(0, 40) + ' show=' + c.show + ' goto=' + c.goto);
  }

  // 13) JS HATALARI
  if (jsHata.length) jsHata.slice(0, 8).forEach(m => BAD(hedef.name, 'js-hata', m.slice(0, 180)));
  else OK('js-hata', 'konsol temiz');

  // 14) AG HATALARI - 400+ donen ADRESLER (§69-E-3). Konsoldaki adressiz "404 ()" mesajlarinin
  //     karsiligi burada ADRESIYLE gorunur. Ayni adres tekrar ediyorsa tek satirda sayilir.
  if (agHata.length) {
    const sayac = {};
    agHata.forEach(a => { sayac[a] = (sayac[a] || 0) + 1; });
    Object.entries(sayac).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .forEach(([adres, adet]) => BAD(hedef.name, 'ag-hata', adres + (adet > 1 ? ' (x' + adet + ')' : '')));
  } else OK('ag-hata', 'tum istekler 2xx/3xx');

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
  if (sorunlar.length) { sorunlar.forEach(s => console.log('  - [' + s.cihaz + '][' + s.konu + '] ' + s.mesaj)); }
  else console.log('TUM CIHAZLARDA TEMIZ');
  console.log('Rapor: tests/report/ux-audit.json');
  process.exit(sorunlar.length ? 1 : 0);
})();
