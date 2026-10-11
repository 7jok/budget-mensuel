/* Budget mensuel : fonctionnement hors ligne.
   Toujours le réseau d'abord (une mise à jour du site est visible tout de suite),
   la copie gardée sur l'appareil seulement quand le réseau ne répond pas.
   Seuls les fichiers du site sont gardés : jamais l'API, ni les statistiques. */
var CACHE = 'budget-mensuel-v4';
var CORE = [
  './', 'index.html', '404.html', 'manifest.webmanifest',
  'Css/style.css',
  'JavaScript/theme.js', 'JavaScript/config.js', 'JavaScript/i18n.js', 'JavaScript/site.js',
  'JavaScript/countries.js', 'JavaScript/app.js', 'JavaScript/fichiers.js',
  'Fonts/ibm-plex-sans-latin-400-normal.woff2', 'Fonts/ibm-plex-sans-latin-600-normal.woff2', 'Fonts/ibm-plex-mono-latin-500-normal.woff2',
  'Img/favicon.svg', 'Img/icon-192.png', 'favicon.ico'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('index.html');
      return new Response('', { status: 504, statusText: 'Hors ligne' });
    });
  }));
});
