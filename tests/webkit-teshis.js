#!/usr/bin/env node
/* Republique - WEBKIT ai-kart TESHIS (3. TUR). SADECE OLCER.
   ONCEKI TURLARIN DERSI: 1. ve 2. turda her cagrinin cevresinde getBoundingClientRect
   okundugu icin test GECIYORDU -> olcum davranisi DEGISTIRIYORDU (Heisenbug).
   Bu yuzden BU TURDA sarmalayici (wrapper) YOK, ARADA rect okumasi YOK.
   Sadece EN SONDA tek bir olcum yapilir -> denetimin gordugu hali birebir taklit eder.

   TEST EDILEN HIPOTEZ (kopuk dugum / detached node):
     raiShowProduct bir "card" degiskeni TUTAR. Pencereli render (__raiEnsureWindow) o kartin
     kategorisini bosaltip YENIDEN olusturursa, tutulan referans DOM DISI (detached) kalir.
     Kopuk dugumde getBoundingClientRect() HEPSI SIFIR doner -> r.top = 0.
     dogrula() icindeki sart:  r.top > -50 && r.top < innerHeight  ->  0 > -50 && 0 < 664  = TRUE
     YANI DONGU "BASARDIM" SANIP CIKAR, gercek kart ekran disinda kalir.
     Bu dogruysa: deneme sayisini artirmak da, ikinci scrollIntoView de HICBIR SEY DEGISTIRMEZ
     (ki gozlem TAM OLARAK BU: iki duzeltme de sonucu degistirmedi).
   KANIT KRITERI: kartHemen.isConnected === false  VEYA  kartHemen !== kartSon

   CALISTIR: cd /opt/republique-staging   sonra   bash tests/run-teshis.sh
*/
const { webkit, devices } = require("playwright");

const BASE = process.env.URL || "https://test2.republique.tr";
const MASA = process.env.MASA || "b-9";
const URUN = process.env.URUN || "Limonata";
const MENU = BASE + "/menu/" + MASA;

const HEDEFLER = [
  { name: "iPhone-12-SAFARI", dev: devices["iPhone 12"] },
  { name: "iPhone-SE-SAFARI", dev: devices["iPhone SE"] }
];
const OZET = [];

async function olc(browser, hedef) {
  console.log("");
  console.log("===== " + hedef.name + " =====");
  const ctx = await browser.newContext(Object.assign({}, hedef.dev));
  const page = await ctx.newPage();
  await page.goto(MENU, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);

  // ux-audit.js adim 4 (kategori) + adim 5 (modal) BIREBIR taklit
  await page.evaluate(async () => {
    const bekle = (ms) => new Promise(r => setTimeout(r, ms));
    const adet = document.querySelectorAll(".category-section").length;
    for (let i = 0; i < adet; i++) {
      const s = document.querySelectorAll(".category-section")[i];
      if (!s) continue;
      s.scrollIntoView({ block: "center" });
      await bekle(500);
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await page.locator(".product-card").first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
  await page.locator(".pd-close").first().click().catch(() => {});
  await page.waitForTimeout(300);

  const s = await page.evaluate(async (URUN) => {
    const bekle = (ms) => new Promise(r => setTimeout(r, ms));
    const kartBul = () => Array.from(document.querySelectorAll(".product-card"))
      .find(c => { const n = c.querySelector(".product-name"); return n && n.textContent.trim() === URUN; });

    window.scrollTo(0, 0);
    await bekle(400);

    const donen = window.raiShowProduct(URUN);
    // raiShowProduct SENKRON kismi bitti; tuttugu "card" ile AYNI dugum bu olmali.
    // DIKKAT: querySelectorAll layout FLUSH ETMEZ (getBoundingClientRect eder) -> yarisi bozmaz.
    const kartHemen = kartBul();

    await bekle(1200);   // denetimin baktigi an

    const kartSon = kartBul();
    const rSon = kartSon ? kartSon.getBoundingClientRect() : null;
    const rHemen = kartHemen ? kartHemen.getBoundingClientRect() : null;

    return {
      donen: donen,
      innerH: window.innerHeight,
      scrollY: Math.round(window.pageYOffset),
      // KANIT ALANLARI
      hemenBagliMi: kartHemen ? kartHemen.isConnected : null,
      ayniElementMi: kartHemen === kartSon,
      hemenTop: rHemen ? Math.round(rHemen.top) : null,
      hemenGenislik: rHemen ? Math.round(rHemen.width) : null,
      sonTop: rSon ? Math.round(rSon.top) : null,
      // denetimin gordugu sonuc
      ekranda: rSon ? (rSon.top > -50 && rSon.top < window.innerHeight) : null,
      // dogrula() KOPUK dugumu olcseydi ne gorurdu?
      dogrulaKanardiMi: rHemen ? (rHemen.top > -50 && rHemen.top < window.innerHeight) : null,
      domKart: document.querySelectorAll(".product-card").length
    };
  }, URUN);

  console.log("  raiShowProduct dondu     : " + s.donen);
  console.log("  ekran yuksekligi         : " + s.innerH + "   scrollY: " + s.scrollY);
  console.log("  DOM kart sayisi          : " + s.domKart);
  console.log("  ---- KOPUK DUGUM KANITI ----");
  console.log("  kartHemen.isConnected    : " + s.hemenBagliMi + "     <-- false ise HIPOTEZ DOGRU");
  console.log("  kartHemen === kartSon    : " + s.ayniElementMi + "     <-- false ise element DEGISMIS");
  console.log("  kartHemen rect.top       : " + s.hemenTop + "  (genislik " + s.hemenGenislik + ")  <-- 0/0 ise KOPUK");
  console.log("  dogrula() bunu gorseydi  : " + (s.dogrulaKanardiMi ? "EKRANDA SANIRDI (yanilirdi)" : "ekranda degil derdi"));
  console.log("  ---- DENETIMIN GORDUGU ----");
  console.log("  kartSon rect.top         : " + s.sonTop);
  console.log("  SONUC                    : " + (s.ekranda ? "GECER" : "*** HATA (kart ekranda degil) ***"));
  OZET.push({ cihaz: hedef.name, gecti: !!s.ekranda, bagli: s.hemenBagliMi, ayni: s.ayniElementMi, sonTop: s.sonTop });
  await ctx.close();
}

(async () => {
  console.log("Hedef: " + MENU + "   Urun: " + URUN);
  const browser = await webkit.launch();
  for (const h of HEDEFLER) {
    try { await olc(browser, h); } catch (e) { console.log("HATA " + h.name + ": " + e.message); }
  }
  await browser.close();
  console.log("");
  console.log("================ OZET ================");
  for (const o of OZET) {
    console.log("  " + String(o.cihaz).padEnd(18) + (o.gecti ? "GECER" : "*** HATA ***").padEnd(14)
      + " isConnected=" + String(o.bagli).padEnd(6) + " ayniElement=" + String(o.ayni).padEnd(6) + " sonTop=" + o.sonTop);
  }
})();
