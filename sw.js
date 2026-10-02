const CACHE_VERSION = 'v1.1.5';
const CACHE_NAME = `vtsoft-3dm-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './three.min.js',
  './OrbitControls.js',
  './rhino3dm.min.js',
  './rhino3dm.wasm',
  './logo.png',
  './icon-192.png'
];

// 1. ഇൻസ്റ്റാളേഷൻ ഘട്ടം
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // ഓരോ ഫയലും നിർബന്ധമായും കാഷെ ചെയ്യുന്നു
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

// 2. ആക്റ്റിവേഷൻ ഘട്ടം (പഴയ വേർഷനുകൾ ക്ലീൻ ചെയ്യുന്നു)
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

      // (A) ആദ്യം ഡയറക്റ്റ് കാഷെയിൽ നോക്കുന്നു
      let cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;

      // (B) റിലേറ്റീവ് ഫയൽ നെയിം വെച്ച് വീണ്ടും നോക്കുന്നു (ഡെസ്ക്ടോപ്പ് പാത്ത് ഫിക്സ്)
      const url = new URL(event.request.url);
      const filename = './' + url.pathname.split('/').pop();
      cached = await cache.match(filename, { ignoreSearch: true });
      if (cached) return cached;

      // (C) മെയിൻ പേജ് നാവിഗേഷൻ ആണെങ്കിൽ index.html നൽകുന്നു
      if (event.request.mode === 'navigate') {
        const indexPage = await cache.match('./index.html') || await cache.match('./');
        if (indexPage) return indexPage;
      }

      // (D) കാഷെയിൽ ഇല്ലാത്തവ മാത്രം നെറ്റ് വഴി എടുക്കാൻ നോക്കുന്നു
      try {
        const netRes = await fetch(event.request);
        if (netRes && netRes.status === 200 && netRes.type === 'basic') {
          cache.put(event.request, netRes.clone());
        }
        return netRes;
      } catch (err) {
        // നെറ്റും ഇല്ലെങ്കിൽ അവസാന ശ്രമമായി index.html നൽകുന്നു
        if (event.request.mode === 'navigate') {
          return await cache.match('./index.html') || await cache.match('./');
        }
        throw err;
      }
    })()
  );
});
