// Istemci-tarafi hata/cokme loglamasi. Telefonda olusan JS hatalari, promise reddleri,
// kaynak yukleme hatalari ve UZUN GOREV (donma/cokme belirtisi) sunucuya gonderilir ->
// admin panelinde "Hatalar" sekmesinde gorunur. Boylece sunucu logunda gorunmeyen
// istemci cokmeleri (ornek: iOS Safari "sayfada bircok kez sorun olustu") teshis edilebilir.
// Bu dosya diger scriptlerden ONCE yuklenmeli ki onlarin hatalarini da yakalasin.
(function () {
  function tbl() {
    try { var p = new URLSearchParams(location.search); var t = p.get('masa') || p.get('table');
      if (!t && location.pathname.indexOf('/menu/') === 0) t = decodeURIComponent(location.pathname.replace('/menu/', '').replace(/\/$/, ''));
      return t && t.trim() ? t.trim() : null; } catch (e) { return null; }
  }
  var sent = 0, MAX = 25;
  function send(payload) {
    if (sent >= MAX) return; sent++;
    try {
      var body = JSON.stringify(Object.assign({ url: location.href, masa: tbl(), ua: navigator.userAgent, w: (screen && screen.width) || 0, mem: (navigator.deviceMemory || 0) }, payload));
      if (navigator.sendBeacon) { navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' })); }
      else { fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); }
    } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    try {
      if (e && e.target && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
        send({ tip: 'kaynak', mesaj: ((e.target.src || e.target.href || '') + '').slice(0, 300) + ' yuklenemedi' });
      } else {
        send({ tip: 'js', mesaj: (e.message || '') + '', kaynak: (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0), stack: (e.error && e.error.stack || '').slice(0, 700) });
      }
    } catch (x) {}
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    try { var r = e && e.reason; send({ tip: 'promise', mesaj: ((r && (r.message || r)) + '').slice(0, 300), stack: (r && r.stack || '').slice(0, 700) }); } catch (x) {}
  });
  // Ana thread'i 3sn+ bloklayan uzun gorev = donma/cokme adayi (Safari watchdog burada oldurur)
  try {
    if ('PerformanceObserver' in window) {
      var po = new PerformanceObserver(function (list) {
        var e = list.getEntries().filter(function (x) { return x.duration > 3000; })[0];
        if (e) send({ tip: 'donma', mesaj: 'ana thread ' + Math.round(e.duration) + 'ms bloklandi (donma/cokme riski)' });
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) {}
})();
