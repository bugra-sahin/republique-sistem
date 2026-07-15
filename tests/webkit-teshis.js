#!/usr/bin/env node
/* Republique - WEBKIT ai-kart TESHIS. SADECE OLCER, HICBIR SEYI DUZELTMEZ.
   §79-D: "tahmin degil OLCUM".
   SORU: Safari/iPhone-12 de raiShowProduct cagrilinca kart neden ekrana gelmiyor?
   YONTEM: HATA VEREN (iPhone-12) ile GECEN (iPhone-SE) yan yana olculur.
   scrollIntoView / scrollTo / __raiEnsureWindow SARILIR -> her birinin kaydirmaya ve
   sayfa yuksekligine ne yaptigi kaydedilir. Boylece "kaydirma hic olmuyor mu, yoksa",
   "olduktan sonra geri mi aliniyor" sorusu OLCUMLE cevaplanir.
   CALISTIR: cd /opt/republique-staging   sonra   bash tests/run-teshis.sh
*/
const { webkit, devices } = require("playwright");

const BASE = process.env.URL || "https://test2.republique.tr";
const MASA = process.env.MASA || "b-9";
const URUN = process.env.URUN || "Limonata";
const MENU = BASE + "/menu/" + MASA;

const HEDEFLER = [
  { name: "iPhone-12-SAFARI  (HATA VEREN)", dev: devices["iPhone 12"] },
  { name: "iPhone-SE-SAFARI  (GECEN/kontrol)", dev: devices["iPhone SE"] }
];

async function olc(browser, hedef) {
  console.log("");
  console.log("===== " + hedef.name + " =====");
  const ctx = await browser.newContext(Object.assign({}, hedef.dev));
  const page = await ctx.newPage();
  await page.goto(MENU, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);

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
        kartH: r ? Math.round(r.height) : null,
        sayfaH: Math.round(document.documentElement.scrollHeight),
        dom: document.querySelectorAll(".product-card").length,
        bodyPos: getComputedStyle(document.body).position,
        raiLock: document.body.classList.contains("rai-lock"),
        ekranda: r ? (r.top > -50 && r.top < window.innerHeight) : null };
    };

    const zaman = [];
    zaman.push(anlik("0-cagri-oncesi"));
    const donen = window.raiShowProduct(URUN);
    zaman.push(anlik("1-hemen-sonra"));
    await new Promise(r => requestAnimationFrame(r)); zaman.push(anlik("2-rAF1"));
    await new Promise(r => requestAnimationFrame(r)); zaman.push(anlik("3-rAF2"));
    await new Promise(r => requestAnimationFrame(r)); zaman.push(anlik("4-rAF3"));
    await bekle(50);  zaman.push(anlik("5-50ms"));
    await bekle(250); zaman.push(anlik("6-300ms"));
    await bekle(300); zaman.push(anlik("7-600ms"));
    await bekle(600); zaman.push(anlik("8-1200ms"));

    return { donen: donen, innerH: window.innerHeight, innerW: window.innerWidth,
      dpr: window.devicePixelRatio, zaman: zaman, olay: olay };
  }, URUN);

  console.log("raiShowProduct dondu: " + s.donen + "   ekran " + s.innerW + "x" + s.innerH + "  dpr " + s.dpr);
  console.log("");
  console.log("-- ZAMAN CIZGISI (kartTop 0..innerH arasi ise ekranda) --");
  console.log("etiket".padEnd(16) + "scrollY".padStart(8) + "kartTop".padStart(9) + "kartH".padStart(7)
    + "sayfaH".padStart(9) + "dom".padStart(5) + "bodyPos".padStart(9) + "lock".padStart(6) + "ekranda".padStart(9));
  for (const z of s.zaman) {
    console.log(String(z.etiket).padEnd(16) + String(z.scrollY).padStart(8) + String(z.kartTop).padStart(9)
      + String(z.kartH).padStart(7) + String(z.sayfaH).padStart(9) + String(z.dom).padStart(5)
      + String(z.bodyPos).padStart(9) + String(z.raiLock).padStart(6) + String(z.ekranda).padStart(9));
  }
  console.log("");
  console.log("-- KAYDIRMA / LAYOUT OLAYLARI (sirayla) --");
  if (!s.olay.length) console.log("   (HIC CAGRI YOK - kaydirma denenmemis demektir)");
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
    try { await olc(browser, h); } catch (e) { console.log("HATA " + h.name + ": " + e.message); }
  }
  await browser.close();
  console.log("");
  console.log("BITTI. Karsilastir: HATA VEREN vs GECEN cihazda hangi olay farkli?");
})();
