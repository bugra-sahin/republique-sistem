#!/usr/bin/env node
/* Republique - WEBKIT ai-kart TESHIS. SADECE OLCER, HICBIR SEYI DUZELTMEZ.
   §79-D: "tahmin degil OLCUM".

   1. TUR BULGUSU (kanit): raiShowProduct icindeki git() SIRASI TERS ->
      scrollIntoView kartI ekrana getiriyor (kartTop 262), HEMEN ARDINDAN __raiEnsureWindow
      cagriliyor, o da sayfa yuksekligini 56404 -> 58620 buyutup kartI 2478 e FIRLATIYOR.
      Yani once kaydirip SONRA layout degistiriliyor. Dogrulama dongusu bunu 2. denemede
      genelde kurtariyor -> TEMIZ sayfada test GECIYOR. Demek ki hata YARIS (race) ve
      sayfanin O ANKI doldurma durumuna bagli.

   2. TUR SORUSU: denetimde ai-kart testinden ONCE kategori taramasi (her bolum scrollIntoView)
      ve modal testi kosuyor -> sayfa BAMBASKA bir doldurma durumunda. Hata orada cikiyor olmali.
      Bu yuzden her cihaz IKI senaryoda olculur:
        TEMIZ        = sayfa yeni acilmis (1. turdaki gibi)
        DENETIM-GIBI = ux-audit.js adim 4 (kategori taramasi) + adim 5 (modal) BIREBIR taklit edilir
      Ikisi arasindaki fark HATANIN TETIKLEYICISIDIR.

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
const SENARYOLAR = ["TEMIZ", "DENETIM-GIBI"];
const OZET = [];   // konsol geriye kaydirilamiyor -> en sonda toplu tablo basilir

async function olc(browser, hedef, senaryo) {
  console.log("");
  console.log("===== " + hedef.name + "   [" + senaryo + "] =====");
  const ctx = await browser.newContext(Object.assign({}, hedef.dev));
  const page = await ctx.newPage();
  await page.goto(MENU, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);

  if (senaryo === "DENETIM-GIBI") {
    // ux-audit.js adim 4 (kategori) BIREBIR: her bolumu goruse getir, 500ms bekle, sonra basa don
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
    // ux-audit.js adim 5 (modal) BIREBIR
    await page.locator(".product-card").first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.locator(".pd-close").first().click().catch(() => {});
    await page.waitForTimeout(300);
  }

  const s = await page.evaluate(async (URUN) => {
    const bekle = (ms) => new Promise(r => setTimeout(r, ms));
    const kartBul = () => Array.from(document.querySelectorAll(".product-card"))
      .find(c => { const n = c.querySelector(".product-name"); return n && n.textContent.trim() === URUN; });

    window.scrollTo(0, 0);
    await bekle(400);

    const olay = [];

    if (typeof window.__raiEnsureWindow === "function") {
      const ger = window.__raiEnsureWindow;
      window.__raiEnsureWindow = function () {
        const k1 = kartBul();
        const yOnce = Math.round(window.pageYOffset);
        const hOnce = Math.round(document.documentElement.scrollHeight);
        const rOnce = k1 ? Math.round(k1.getBoundingClientRect().top) : null;
        const cikti = ger.apply(this, arguments);
        const k2 = kartBul();
        olay.push({ tip: "ensureWindow", yOnce: yOnce, ySonra: Math.round(window.pageYOffset),
          hOnce: hOnce, hSonra: Math.round(document.documentElement.scrollHeight),
          kOnce: rOnce, kSonra: k2 ? Math.round(k2.getBoundingClientRect().top) : null });
        return cikti;
      };
    }

    const gerSIV = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      const yOnce = Math.round(window.pageYOffset);
      const rOnce = Math.round(this.getBoundingClientRect().top);
      const cikti = gerSIV.apply(this, arguments);
      olay.push({ tip: "scrollIntoView", yOnce: yOnce, ySonra: Math.round(window.pageYOffset),
        hOnce: null, hSonra: null, kOnce: rOnce, kSonra: Math.round(this.getBoundingClientRect().top) });
      return cikti;
    };

    const gerST = window.scrollTo.bind(window);
    window.scrollTo = function () {
      const yOnce = Math.round(window.pageYOffset);
      gerST.apply(null, arguments);
      olay.push({ tip: "scrollTo", yOnce: yOnce, ySonra: Math.round(window.pageYOffset),
        hOnce: null, hSonra: null, kOnce: null, kSonra: null });
    };

    const anlik = (etiket) => {
      const k = kartBul();
      const r = k ? k.getBoundingClientRect() : null;
      return { etiket: etiket,
        scrollY: Math.round(window.pageYOffset),
        kartTop: r ? Math.round(r.top) : null,
        sayfaH: Math.round(document.documentElement.scrollHeight),
        dom: document.querySelectorAll(".product-card").length,
        ekranda: r ? (r.top > -50 && r.top < window.innerHeight) : null };
    };

    const zaman = [];
    zaman.push(anlik("0-cagri-oncesi"));
    const donen = window.raiShowProduct(URUN);
    zaman.push(anlik("1-hemen-sonra"));
    await new Promise(r => requestAnimationFrame(r)); zaman.push(anlik("2-rAF1"));
    await new Promise(r => requestAnimationFrame(r)); zaman.push(anlik("3-rAF2"));
    await new Promise(r => requestAnimationFrame(r)); zaman.push(anlik("4-rAF3"));
    await new Promise(r => requestAnimationFrame(r)); zaman.push(anlik("5-rAF4"));
    await bekle(50);  zaman.push(anlik("6-50ms"));
    await bekle(250); zaman.push(anlik("7-300ms"));
    await bekle(900); zaman.push(anlik("8-1200ms  <- DENETIM BURAYA BAKAR"));

    return { donen: donen, innerH: window.innerHeight, innerW: window.innerWidth,
      zaman: zaman, olay: olay };
  }, URUN);

  const son = s.zaman[s.zaman.length - 1];
  OZET.push({ cihaz: hedef.name, senaryo: senaryo, gecti: !!son.ekranda, kartTop: son.kartTop });
  console.log("raiShowProduct dondu: " + s.donen + "   ekran " + s.innerW + "x" + s.innerH);
  console.log(">>> DENETIM SONUCU OLURDU: " + (son.ekranda ? "GECER" : "*** HATA (kart ekranda degil) ***"));
  console.log("");
  console.log("etiket".padEnd(30) + "scrollY".padStart(8) + "kartTop".padStart(9) + "sayfaH".padStart(9) + "dom".padStart(5) + "ekranda".padStart(9));
  for (const z of s.zaman) {
    console.log(String(z.etiket).padEnd(30) + String(z.scrollY).padStart(8) + String(z.kartTop).padStart(9)
      + String(z.sayfaH).padStart(9) + String(z.dom).padStart(5) + String(z.ekranda).padStart(9));
  }
  console.log("");
  console.log("-- KAYDIRMA / LAYOUT OLAYLARI (sirayla) --");
  if (!s.olay.length) console.log("   (HIC CAGRI YOK)");
  for (const o of s.olay) {
    let satir = "   " + String(o.tip).padEnd(15) + " scrollY " + String(o.yOnce).padStart(6) + " -> " + String(o.ySonra).padStart(6);
    if (o.kOnce !== null) satir += "  |  kartTop " + String(o.kOnce).padStart(7) + " -> " + String(o.kSonra).padStart(7);
    if (o.hOnce !== null) satir += "  |  sayfaH " + String(o.hOnce).padStart(7) + " -> " + String(o.hSonra).padStart(7);
    console.log(satir);
  }
  await ctx.close();
}

(async () => {
  console.log("Hedef: " + MENU + "   Urun: " + URUN);
  const browser = await webkit.launch();
  for (const h of HEDEFLER) {
    for (const sen of SENARYOLAR) {
      try { await olc(browser, h, sen); } catch (e) { console.log("HATA " + h.name + "/" + sen + ": " + e.message); }
    }
  }
  await browser.close();
  console.log("");
  console.log("================ OZET (denetimin bakacagi an: 1200ms) ================");
  for (const o of OZET) {
    console.log("  " + String(o.cihaz).padEnd(18) + String(o.senaryo).padEnd(15)
      + (o.gecti ? "GECER" : "*** HATA ***").padEnd(14) + " kartTop=" + o.kartTop);
  }
  console.log("");
  console.log("KARSILASTIR: TEMIZ GECIP DENETIM-GIBI HATA VERIYORSA -> tetikleyici sayfanin doldurma durumu.");
})();
