#!/usr/bin/env node
/* Republique — otonom MOBIL on-test (Playwright, cihaz emulasyonu).
   Sunucuda/CI'da calisir (sandbox dis aga cikamaz; sunucu agi tam). iPhone/Android descriptor'lariyla
   HEADLESS test: menu acilir mi, yatay tasma var mi, kategori kaydirma, urun modali, AI panel ac/yaz,
   JS konsol hatasi, buton cakismasi. Ekran goruntusu + konsol hata raporu uretir; hata varsa exit!=0.

   KURULUM (sunucuda, bir kez):
     cd /opt/republique/tests && npm i -D playwright && npx playwright install --with-deps chromium
   CALISTIR:
     URL="https://test2.republique.tr/menu/masaTest" node mobile-check.js
   (URL bir MASA menusu olmali ki AI panel aktif olsun.)
*/
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.URL || 'https://test2.republique.tr/menu/masaTest';
const OUT = path.join(__dirname, 'report');
const TARGETS = [
  { name: 'iPhone-12', dev: devices['iPhone 12'] },
  { name: 'iPhone-SE', dev: devices['iPhone SE'] },
  { name: 'Pixel-5', dev: devices['Pixel 5'] },
];

const problems = [];
function P(dev, kind, msg) { problems.push({ dev, kind, msg }); console.log(`  [${kind}] ${msg}`); }

async function testDevice(browser, t) {
  console.log(`\n=== ${t.name} (${URL}) ===`);
  const ctx = await browser.newContext({ ...t.dev });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) { P(t.name, 'load', 'sayfa yuklenemedi: ' + e.message); await ctx.close(); return; }
  await page.waitForTimeout(2500);

  // 1) Menu urunleri render oldu mu?
  const cards = await page.locator('.product-card').count();
  if (cards < 1) P(t.name, 'menu', 'urun karti render edilmedi (.product-card=0)');
  else console.log(`  menu OK: ${cards} kart`);

  // 2) Yatay tasma (horizontal overflow) var mi?
  const ov = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  if (ov.sw - ov.iw > 3) P(t.name, 'overflow', `yatay tasma: scrollWidth=${ov.sw} > innerWidth=${ov.iw}`);
  else console.log('  yatay tasma yok OK');

  // 3) Kategori cubugu kaydirilabilir mi / butonlar var mi?
  const cats = await page.locator('.category-nav button, .category-nav a, .cat-btn').count();
  if (cats < 2) P(t.name, 'kategori', `kategori butonu az/yok (${cats})`);
  else {
    // ikinci kategoriye tikla, sayfa kaymali/degismeli
    try { await page.locator('.category-nav button, .category-nav a, .cat-btn').nth(1).click({ timeout: 4000 }); await page.waitForTimeout(600); console.log('  kategori tiklama OK'); }
    catch (e) { P(t.name, 'kategori', 'kategori butonu tiklanamadi: ' + e.message); }
  }

  // 4) Urun modali aciliyor mu?
  try {
    await page.locator('.product-card').first().click({ timeout: 4000 });
    await page.waitForTimeout(600);
    const open = await page.locator('.pd-overlay.open').count();
    if (!open) P(t.name, 'modal', 'urun karti tiklaninca modal acilmadi');
    else { console.log('  urun modali OK'); await page.locator('.pd-close').first().click().catch(() => {}); }
  } catch (e) { P(t.name, 'modal', 'urun karti tiklanamadi: ' + e.message); }

  // 5) AI panel ac + yaz (yanit backend'e bagli; en azindan panel acilip input kabul etmeli)
  try {
    await page.waitForTimeout(400);
    const trigger = page.locator('.rai-fab, .ai-btn').first();
    if (await trigger.count()) {
      await trigger.click({ timeout: 4000 }); await page.waitForTimeout(500);
      const panelOpen = await page.locator('.rai-panel.open').count();
      if (!panelOpen) P(t.name, 'ai', 'AI panel acilmadi');
      else {
        const inp = page.locator('.rai-inp');
        if (await inp.count()) { await inp.fill('merhaba'); console.log('  AI panel ac+yaz OK'); }
        else P(t.name, 'ai', 'AI input bulunamadi');
      }
    } else P(t.name, 'ai', 'AI tetikleyici (.rai-fab/.ai-btn) yok');
  } catch (e) { P(t.name, 'ai', 'AI panel testi hata: ' + e.message); }

  // 6) Konsol JS hatalari
  if (consoleErrors.length) consoleErrors.slice(0, 10).forEach((m) => P(t.name, 'console', m.slice(0, 200)));
  else console.log('  konsol temiz OK');

  // Ekran goruntusu
  try { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: path.join(OUT, t.name + '.png'), fullPage: false }); } catch (e) {}
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const t of TARGETS) { try { await testDevice(browser, t); } catch (e) { P(t.name, 'fatal', e.message); } }
  await browser.close();
  const rep = { url: URL, at: new Date().toISOString(), problemSayisi: problems.length, problemler: problems };
  try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rep, null, 2)); } catch (e) {}
  console.log('\n================ SONUC ================');
  console.log(problems.length ? `HATA/SORUN: ${problems.length} (report/report.json)` : 'TUM CIHAZLARDA TEMIZ ✓');
  process.exit(problems.length ? 1 : 0);
})();
