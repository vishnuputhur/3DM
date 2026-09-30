// --- അപ്‌ഡേറ്റുകൾക്കായി ഈ വേർഷൻ നമ്പർ മാറ്റുക ---
const CACHE_VERSION = 'v1.0.1';
const CACHE_NAME = `vtsoft-3dm-${CACHE_VERSION}`;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './three.min.js',
  './OrbitControls.js',
  './rhino3dm.min.js',
  './rhino3dm.wasm'
];

// പുതിയ വേർഷൻ ഫയലുകൾ കാഷെ ചെയ്യുക
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// പഴയ വേർഷൻ കാഷെ ഡിലീറ്റ് ചെയ്ത് പുതിയത് ആക്റ്റീവ് ആക്കുക
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Cleaning old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// ഓഫ്‌ലൈൻ ആക്സസ്
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
