/* Republique Tunalı — Service Worker (PWA)
   Strateji: NETWORK-FIRST (her zaman once agdan taze icerik; menu/JS asla bayat kalmasin) +
   cevrimdisi/hata durumunda onbellek yedegi. Boylece "ana ekrana ekle" + app hissi + cevrimdisi
   dayaniklilik saglanir AMA deploy sonrasi eski JS servis edilmez.
   API ('/api/*') ve admin/erp/personel ONBELLEKLENMEZ. */
const CACHE = 'republique-v1';
const SHELL = ['/', '/css/style.css', '/js/clientlog.js', '/js/trail-record.js', '/js/app.js',
  '/js/menu-detail.js', '/js/ai-chat.js', '/js/engagement.js', '/js/feedback.js',
  '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(
    SHELL.map((u) => c.add(u).catch(() => {}))   // biri basarisiz olsa da kurulum devam etsin
  )));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function noCache(url) {
  return /\/api\//.test(url.pathname) || /^\/(admin|erp|personel)(\/|$)/.test(url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // sadece GET
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // 3. taraf (font/pixel) -> tarayiciya birak
  if (noCache(url)) return;                                // API/admin -> her zaman ag, onbellek yok

  // NETWORK-FIRST: once ag, basarisizsa onbellek; navigasyonda son care index.html
  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('/');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
