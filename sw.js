const CACHE_VERSION = 'v1.0.7';
const CACHE_NAME = `vtsoft-3dm-${CACHE_VERSION}`;

// കാഷെ ചെയ്യേണ്ട ഫയലുകൾ
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './three.min.js',
  './OrbitControls.js',
  './rhino3dm.min.js',
  './rhino3dm.wasm',
  './logo.png',
  './splash_logo.png',
  './icon-192.png',
  './icon-512.png'
];

// 1. ഫെയിൽ-സേഫ് ഇൻസ്റ്റാൾ (ഒറ്റ ഫയലും ബ്രേക്ക് ഉണ്ടാക്കില്ല)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // addAll ഒഴിവാക്കി, ഓരോ ഫയലും സുരക്ഷിതമായി ക്യാഷ് ചെയ്യുന്നു
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`File skipped or not found: ${url}`, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. പഴയ കാഷെ ഡിലീറ്റ് ചെയ്യുക
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

// 3. പക്കാ ഓഫ്‌ലൈൻ Fetch (Desktop + Mobile Compatible)
self.addEventListener('fetch', (event) => {
  // http / https അല്ലാത്ത റിക്വസ്റ്റുകൾ ഒഴിവാക്കുക (chrome-extension മുതലായവ)
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // കാഷെയിൽ ഇല്ലെങ്കിൽ മാത്രം നെറ്റിൽ നിന്ന് എടുക്കുക
      return fetch(event.request).then((networkResponse) => {
        // ലഭിച്ച പുതിയ ഫയൽ കൂടി ഭാവിയിലേക്ക് കാഷെ ചെയ്യുന്നു
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return networkResponse;
      }).catch(async () => {
        // ഡെസ്ക്ടോപ്പ് PWA ഓഫ്‌ലൈൻ ഓപ്പൺ ചെയ്യുമ്പോൾ ഹോം പേജ് നൽകുക
        if (event.request.mode === 'navigate') {
          const indexPage = await caches.match('./index.html') || await caches.match('./');
          if (indexPage) return indexPage;
        }
      });
    })
  );
});
