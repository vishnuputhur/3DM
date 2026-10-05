const CACHE_VERSION = 'v2.0.0';
const CACHE_NAME = `csl-3d-viewer-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',      // <-- പുതിയതായി ചേർത്തത്
  './app.js',         // <-- പുതിയതായി ചേർത്തത്
  './manifest.json',
  './three.min.js',
  './OrbitControls.js',
  './rhino3dm.min.js',
  './rhino3dm.wasm',
  './logo.png',
  './icon-192.png'
];

// ബാക്കി install, activate, fetch ഇവയെല്ലാം നിങ്ങൾ തന്ന കോഡ് പോലെ തന്നെ തുടരാം
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        ASSETS_TO_CACHE.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res.ok) await cache.put(url, res);
          } catch (e) {
            console.warn(`Asset caching failed for: ${url}`, e);
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      let cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;

      const url = new URL(event.request.url);
      const filename = './' + url.pathname.split('/').pop();
      cached = await cache.match(filename, { ignoreSearch: true });
      if (cached) return cached;

      if (event.request.mode === 'navigate') {
        const indexPage = await cache.match('./index.html') || await cache.match('./');
        if (indexPage) return indexPage;
      }

      try {
        const netRes = await fetch(event.request);
        if (netRes && netRes.status === 200 && netRes.type === 'basic') {
          cache.put(event.request, netRes.clone());
        }
        return netRes;
      } catch (err) {
        if (event.request.mode === 'navigate') {
          return await cache.match('./index.html') || await cache.match('./');
        }
        throw err;
      }
    })()
  );
});
