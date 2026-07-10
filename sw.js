const CACHE = 'nova-comercial-v5';
const ASSETS = [
  '/paineldocomercial/',
  '/paineldocomercial/index.html',
  '/paineldocomercial/manifest.json'
];

// arquivos grandes de dados nunca devem ser cacheados pelo SW
const NO_CACHE = ['usuarios_data.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const url = e.request.url;
  if(NO_CACHE.some(f => url.includes(f))) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
