const CACHE_VERSION = 'v2.1.5'; // വേർഷൻ അപ്ഡേറ്റ് ചെയ്തു
const CACHE_NAME = `csl-3d-viewer-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
   './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './three.min.js',
  './OrbitControls.js',
  './rhino3dm.min.js',
  './rhino3dm.wasm',
  './occt-import-js.js',
  './occt-import-js.wasm',
  './dxf-parser.js',
  './icon-192.png',
  './logo.png'
];

// 1. ഇൻസ്റ്റാളേഷൻ ഘട്ടം (പുതിയ ഫയലുകൾ നിർബന്ധമായും ഡൗൺലോഡ് ചെയ്യുന്നു)
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

// 2. ആക്റ്റിവേഷൻ ഘട്ടം (പഴയ ഫയലുകൾ ക്ലീൻ ചെയ്ത് പുതിയത് നടപ്പിലാക്കുന്നു)
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

// 3. പക്കാ ഓഫ്‌ലൈൻ Fetch സ്ട്രാറ്റജി (Cache-First)
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // (A) ആദ്യം കാഷെയിൽ നോക്കുന്നു
      let cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;

      // (B) റിലേറ്റീവ് ഫയൽ പാത്ത് ഫിക്സ്
      const url = new URL(event.request.url);
      const filename = './' + url.pathname.split('/').pop();
      cached = await cache.match(filename, { ignoreSearch: true });
      if (cached) return cached;

      // (C) മെയിൻ പേജ് നാവിഗേഷൻ ആണെങ്കിൽ index.html നൽകുന്നു
      if (event.request.mode === 'navigate') {
        const indexPage = await cache.match('./index.html') || await cache.match('./');
        if (indexPage) return indexPage;
      }

      // (D) നെറ്റ് വഴി ഫെച്ച് ചെയ്യുന്നു
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
