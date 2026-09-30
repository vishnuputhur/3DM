const CACHE_VERSION = 'v1.0.7';
const CACHE_NAME = `vtsoft-3dm-${CACHE_VERSION}`;

// നിർബന്ധമായും കാഷെ ചെയ്യേണ്ട പ്രധാന ഫയലുകൾ
const ESSENTIAL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './three.min.js',
  './OrbitControls.js',
  './rhino3dm.min.js',
  './rhino3dm.wasm'
];

// ഉണ്ടെങ്കിൽ മാത്രം കാഷെ ചെയ്യേണ്ട ഇമേജ് ഫയലുകൾ (ഇതിൽ ഒന്ന് മിസ്സായാലും ആപ്പ് തടസ്സപ്പെടില്ല)
const OPTIONAL_FILES = [
  './logo.png',
  './splash_logo.png',
  './icon-192.png',
  './icon-512.png'
];

// Fail-safe Install Step
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 1. മെയിൻ ഫയലുകൾ ഉറപ്പായും കാഷെ ചെയ്യുന്നു
      await cache.addAll(ESSENTIAL_FILES);
      
      // 2. ഇമേജുകൾ ഓരോന്നായി സുരക്ഷിതമായി കാഷെ ചെയ്യുന്നു
      for (const file of OPTIONAL_FILES) {
        try {
          await cache.add(file);
        } catch (e) {
          console.warn(`Optional asset skipped: ${file}`);
        }
      }
    })
  );
  self.skipWaiting();
});

// പഴയ കാഷെ ക്ലീൻ ചെയ്യുക
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
    })
  );
  self.clients.claim();
});

// 100% ഓഫ്‌ലൈൻ ആക്സസ് തരുന്ന Fetch തന്ത്രം (Cache First, Network Fallback)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // ഓഫ്‌ലൈനിൽ മെയിൻ പേജിലേക്ക് തിരിച്ചുവിടുന്നു
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
