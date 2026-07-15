// Istemci-tarafi hata + DAVRANIS izleme. Telefonda olusan JS hatalari, promise reddleri,
// kaynak yukleme hatalari, UZUN GOREV (donma), ve KULLANICI SURTUNMESI (rage-click, dead-click,
// reload-loop, yavas/basarisiz API) sunucuya gonderilir -> admin "Hatalar" sekmesinde gorunur.
// Boylece sunucu logunda gorunmeyen istemci cokmeleri/sorunlari teshis edilir.
// Bu dosya diger scriptlerden ONCE yuklenmeli ki onlarin hatalarini da yakalasin.
// Hata aninda rrweb-record.js (varsa) 'rai-error' olayini dinleyip son ~30sn replay'i gonderir.
(function () {
  function tbl() {
    try { var p = new URLSearchParams(location.search); var t = p.get('masa') || p.get('table');
      if (!t && location.pathname.indexOf('/menu/') === 0) t = decodeURIComponent(location.pathname.replace('/menu/', '').replace(/\/$/, ''));
      return t && t.trim() ? t.trim() : null; } catch (e) { return null; }
  }
  // Oturum kimligi (replay ile logu eslestirmek icin)
  var SID = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  window.__raiSID = SID; // trail-record.js replay'i ayni oturum kimligiyle eslestirir
  var sent = 0, MAX = 40, _eid = 0;
  function send(payload) {
    if (sent >= MAX) return; sent++;
    var eid = SID + '-' + (++_eid);
    try {
      var body = JSON.stringify(Object.assign({
        url: location.href, masa: tbl(), ua: navigator.userAgent,
        w: (screen && screen.width) || 0, mem: (navigator.deviceMemory || 0), sid: SID, eid: eid
      }, payload));
      if (navigator.sendBeacon) { navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' })); }
      else { fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); }
    } catch (e) {}
    // rrweb-record.js dinliyorsa: bu hata icin son ~30sn kaydini AYNI eid ile gonder
    try {
      var sev = payload && (payload.tip === 'js' || payload.tip === 'promise' || payload.tip === 'donma' || payload.tip === 'reload' || payload.tip === 'rage' || payload.tip === 'netfail');
      if (sev) window.dispatchEvent(new CustomEvent('rai-error', { detail: { eid: eid, tip: payload.tip } }));
    } catch (e) {}
    return eid;
  }
  window.__raiLog = send; // diger scriptler de manuel loglayabilsin

  // ---- 1) JS hatalari + KAYNAK (img/script/link/fetch) yukleme hatalari ----
  window.addEventListener('error', function (e) {
    try {
      if (e && e.target && e.target !== window && (e.target.tagName === 'IMG' || e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK')) {
        send({ tip: 'kaynak', mesaj: ((e.target.src || e.target.href || '') + '').slice(0, 300) + ' yuklenemedi' });
      } else {
        send({ tip: 'js', mesaj: (e.message || '') + '', kaynak: (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0), stack: (e.error && e.error.stack || '').slice(0, 700) });
      }
    } catch (x) {}
  }, true);

  // ---- 2) Yakalanmamis promise reddi ----
  window.addEventListener('unhandledrejection', function (e) {
    try { var r = e && e.reason; send({ tip: 'promise', mesaj: ((r && (r.message || r)) + '').slice(0, 300), stack: (r && r.stack || '').slice(0, 700) }); } catch (x) {}
  });

  // ---- 3) Ana thread'i 3sn+ bloklayan uzun gorev = donma/cokme adayi (Safari watchdog burada oldurur) ----
  try {
    if ('PerformanceObserver' in window) {
      var po = new PerformanceObserver(function (list) {
        var e = list.getEntries().filter(function (x) { return x.duration > 3000; })[0];
        if (e) send({ tip: 'donma', mesaj: 'ana thread ' + Math.round(e.duration) + 'ms bloklandi (donma/cokme riski)' });
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) {}

  // ---- 4) RELOAD-LOOP: kisa surede (20sn) 3+ tekrar yukleme = sayfa surekli yenileniyor ----
  try {
    var KEY = 'rai_loads', WIN = 20000, LIM = 3;
    var arr = [];
    try { arr = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { arr = []; }
    var now = Date.now();
    arr = arr.filter(function (t) { return now - t < WIN; });
    arr.push(now);
    try { sessionStorage.setItem(KEY, JSON.stringify(arr)); } catch (e) {}
    var navType = '';
    try { var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0]; navType = (nav && nav.type) || (performance.navigation && performance.navigation.type === 1 ? 'reload' : ''); } catch (e) {}
    if (arr.length >= LIM) {
      send({ tip: 'reload', mesaj: WIN / 1000 + ' sn icinde ' + arr.length + ' kez yuklendi (' + (navType || 'nav') + ') — surekli yenilenme/cokme dongusu' });
      try { sessionStorage.setItem(KEY, '[]'); } catch (e) {} // ayni dongu icin tek log
    }

    // ---- 4b) TEK SEFERLIK COKME/YENILENME (KOR NOKTA KAPATILDI) ----
    // Onceki hali SADECE 3+ dongude log atiyordu. Safari sekmeyi bellek/GPU baskisiyla oldurup
    // TEK SEFER yeniden yukledigi durumda (Bugra'nin 'sayfa yenilendi'/'atti' sikayeti) HIC KAYIT
    // DUSMUYORDU -> teshis edilemiyordu. Artik her beklenmedik yeniden-yukleme tek basina raporlanir.
    // Sayfada ne kadar kalindigi ipucu verir: cok kisa sure + reload = cokme; uzun sure = muhtemelen kullanici.
    if (navType === 'reload') {
      var onceki = 0, gecen = -1;
      try { onceki = parseInt(sessionStorage.getItem('rai_son_yukleme') || '0', 10) || 0; } catch (e) {}
      if (onceki) gecen = Math.round((now - onceki) / 1000);
      var bellek = '';
      try {
        if (navigator.deviceMemory) bellek = ', cihaz RAM ~' + navigator.deviceMemory + 'GB';
        if (performance.memory) bellek += ', JS bellek ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB';
      } catch (e) {}
      var gizli = '';
      try { gizli = (!('serviceWorker' in navigator) || !window.caches) ? ', GIZLI SEKME olabilir (SW/cache yok)' : ''; } catch (e) {}
      send({
        tip: 'reload',
        mesaj: 'sayfa beklenmedik sekilde YENIDEN YUKLENDI (muhtemel sekme cokmesi). Onceki yuklemeden bu yana: ' +
               (gecen >= 0 ? gecen + ' sn' : 'bilinmiyor') + ', sayfa yuksekligi ' +
               (document.documentElement ? document.documentElement.scrollHeight : '?') + 'px' + bellek + gizli,
        kaynak: location.pathname
      });
    }
    try { sessionStorage.setItem('rai_son_yukleme', String(now)); } catch (e) {}
  } catch (e) {}

  // ---- 5) RAGE-CLICK: ~1sn icinde ayni noktaya 3+ tiklama = ofke/tepkisizlik ----
  try {
    var clicks = [];
    document.addEventListener('click', function (ev) {
      var t = Date.now(), x = ev.clientX || 0, y = ev.clientY || 0;
      clicks = clicks.filter(function (c) { return t - c.t < 1000; });
      clicks.push({ t: t, x: x, y: y });
      var near = clicks.filter(function (c) { return Math.abs(c.x - x) < 45 && Math.abs(c.y - y) < 45; });
      if (near.length >= 3) {
        var el = ev.target && ev.target.closest ? (ev.target.closest('button,a,[role=button],.cat-btn,.product-card') || ev.target) : ev.target;
        var lbl = (el && (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('id')) || (el.textContent || '').trim().slice(0, 40))) || (el && el.tagName) || '?';
        send({ tip: 'rage', mesaj: 'ayni yere ' + near.length + ' hizli tiklama -> ' + lbl });
        clicks = [];
      }
    }, true);
  } catch (e) {}

  // ---- 6) DEAD-CLICK: tiklanabilir gorunen bir ogeye tiklandi ama HICBIR tepki yok (olu buton) ----
  try {
    var mutCount = 0;
    var mo = new MutationObserver(function (m) { mutCount += m.length; });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.closest) return;
      // Yalnizca "tiklanabilir gorunen" ogeler; input/textarea/select yaz alanlarini ATLA
      if (el.closest('input,textarea,select,label')) return;
      var clickable = el.closest('button,a,[role=button],[onclick],.cat-btn,.product-card,.rai-send,.rai-actbtn,.ai-btn');
      if (!clickable) {
        var cur = '';
        try { cur = getComputedStyle(el).cursor; } catch (e) {}
        if (cur !== 'pointer') return; // ne buton ne pointer -> normal bos alan tiklamasi, gormezden gel
      }
      var startMut = mutCount, startUrl = location.href, startY = window.scrollY, startAV = document.activeElement;
      setTimeout(function () {
        try {
          var changed = (mutCount - startMut) > 0 || location.href !== startUrl || Math.abs(window.scrollY - startY) > 4 || document.activeElement !== startAV;
          if (!changed) {
            var lbl = (clickable && ((clickable.getAttribute && clickable.getAttribute('aria-label')) || (clickable.textContent || '').trim().slice(0, 40))) || (el.tagName || '?');
            send({ tip: 'dead', mesaj: 'tiklamaya tepki vermeyen oge (olu tiklama): ' + lbl });
          }
        } catch (e) {}
      }, 700);
    }, true);
  } catch (e) {}

  // ---- 7) YAVAS/BASARISIZ API: /api/* fetch hatasi veya >8sn ----
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        var url = '';
        try { url = (typeof input === 'string') ? input : (input && input.url) || ''; } catch (e) {}
        var isApi = /\/api\//.test(url);
        // Kendi log/replay uclarimizi izleme (sonsuz dongu olmasin)
        var selfLog = /\/api\/client-(log|replay)/.test(url);
        if (!isApi || selfLog) return origFetch.apply(this, arguments);
        var t0 = Date.now();
        return origFetch.apply(this, arguments).then(function (r) {
          var dt = Date.now() - t0;
          if (dt > 8000) send({ tip: 'netfail', mesaj: 'yavas API (' + dt + 'ms): ' + url.slice(0, 160) });
          else if (r && r.status >= 500) send({ tip: 'netfail', mesaj: 'API ' + r.status + ': ' + url.slice(0, 160) });
          return r;
        }).catch(function (err) {
          send({ tip: 'netfail', mesaj: 'API basarisiz: ' + url.slice(0, 160) + ' — ' + ((err && err.message) || err) });
          throw err;
        });
      };
    }
  } catch (e) {}

  // ---- 8) console.error KOPRUSU (sinirli): uygulama kodundaki gizli hatalar ----
  try {
    var origErr = console.error, ce = 0, seen = {};
    console.error = function () {
      try {
        var msg = Array.prototype.map.call(arguments, function (a) {
          try { return (a && a.message) ? a.message : (typeof a === 'string' ? a : JSON.stringify(a)); } catch (e) { return String(a); }
        }).join(' ').slice(0, 300);
        if (msg && ce < 8 && !seen[msg]) { seen[msg] = 1; ce++; send({ tip: 'console', mesaj: msg }); }
      } catch (e) {}
      return origErr.apply(console, arguments);
    };
  } catch (e) {}
})();
