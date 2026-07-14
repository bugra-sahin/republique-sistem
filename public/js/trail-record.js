// Hafif "olay-izi" (breadcrumb) kaydedici — self-host, 3. taraf YOK, KVKK-temiz.
// Kullanicinin son ~30 saniyedeki EYLEMLERINI (tiklama, kaydirma, alan odagi, panel/kart acma,
// gorunurluk) kompakt bir zaman cizelgesi olarak halka-tampona yazar. HATA olunca (clientlog.js
// 'rai-error' olayini yayinlar) son ~30sn'yi /api/client-replay'e gonderir -> admin "Hatalar"
// sekmesinde "kullanici ne yapmisti" olarak gorunur. YAZILAN DEGERLER (input icerigi) KAYDEDILMEZ.
// NOT: Tam gorsel replay istenirse ileride rrweb (self-host) bu ize eklenebilir; bu surum bagimsiz calisir.
(function () {
  try {
    var MAXAGE = 30000, MAX = 200;
    var buf = [];
    function tbl() {
      try { var p = new URLSearchParams(location.search); var t = p.get('masa') || p.get('table');
        if (!t && location.pathname.indexOf('/menu/') === 0) t = decodeURIComponent(location.pathname.replace('/menu/', '').replace(/\/$/, ''));
        return t && t.trim() ? t.trim() : null; } catch (e) { return null; }
    }
    function push(ev) {
      try {
        ev.t = Date.now();
        buf.push(ev);
        var cut = ev.t - MAXAGE;
        while (buf.length && buf[0].t < cut) buf.shift();
        if (buf.length > MAX) buf.splice(0, buf.length - MAX);
      } catch (e) {}
    }
    function lbl(el) {
      try {
        if (!el) return '?';
        var a = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('id'));
        var txt = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        return (a || txt || (el.tagName || '?')).slice(0, 50);
      } catch (e) { return '?'; }
    }
    push({ type: 'start', url: location.href, w: (screen && screen.width) || 0, h: (screen && screen.height) || 0 });

    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? (e.target.closest('button,a,[role=button],.cat-btn,.product-card,.rai-send,.rai-actbtn,.ai-btn,input,select') || e.target) : e.target;
      push({ type: 'click', tag: (el && el.tagName) || '?', el: lbl(el), x: e.clientX || 0, y: e.clientY || 0 });
    }, true);

    // Alan odagi — SADECE alan kimligi (name/placeholder), yazilan DEGER degil (KVKK)
    document.addEventListener('focusin', function (e) {
      var el = e.target;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        push({ type: 'focus', field: ((el.getAttribute && (el.getAttribute('name') || el.getAttribute('placeholder'))) || el.tagName || '').slice(0, 40) });
      }
    }, true);

    // Kaydirma (throttle)
    var lastScroll = 0;
    window.addEventListener('scroll', function () {
      var n = Date.now(); if (n - lastScroll < 400) return; lastScroll = n;
      push({ type: 'scroll', y: Math.round(window.scrollY || 0) });
    }, { passive: true });

    // Gorunurluk (sekme arka plana/one)
    document.addEventListener('visibilitychange', function () { push({ type: document.hidden ? 'hide' : 'show' }); });
    // Sayfadan ayrilma (reload/kapatma teshisi)
    window.addEventListener('pagehide', function () { push({ type: 'pagehide' }); });

    // Kategori/panel/kart gibi anlamli durumlari da yakala (mutation ile hafif)
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'attributes' && m.target && m.target.classList) {
            var c = m.target.classList;
            if (m.target.classList.contains('rai-panel')) push({ type: 'ai-panel', open: c.contains('open') });
            if (m.target.classList.contains('pd-overlay')) push({ type: 'urun-karti', open: c.contains('open') });
          }
        }
      });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'], subtree: true });
    } catch (e) {}

    function flush(detail) {
      try {
        if (!buf.length) return;
        var payload = {
          eid: (detail && detail.eid) || '', sid: (window.__raiSID || ''), tip: (detail && detail.tip) || 'hata',
          url: location.href, masa: tbl(), ua: navigator.userAgent,
          events: buf.slice(-MAX)
        };
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) navigator.sendBeacon('/api/client-replay', new Blob([body], { type: 'application/json' }));
        else fetch('/api/client-replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      } catch (e) {}
    }
    // clientlog.js hata yayinlayinca son ~30sn izini gonder
    window.addEventListener('rai-error', function (e) { flush(e && e.detail); });
    window.__raiTrailFlush = flush; // manuel tetik (test/istisna)
  } catch (e) {}
})();
