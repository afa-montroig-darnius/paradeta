// Guarda l'app al mòbil perquè s'obri sense connexió.
// Cada cop que es publiqui una versió nova, cal canviar VERSIO.
const VERSIO = 'paradeta-v12';
const FITXERS = ['./', './index.html', './styles.css', './app.js', './nucli.js', './demo.js', './config.js',
  './reserves.html', './reserves.js', './logo.png', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  // «reload»: sempre del servidor, no de la memòria del navegador (si no, hi podria quedar un fitxer de la versió d'abans)
  e.waitUntil(caches.open(VERSIO).then(c => c.addAll(FITXERS.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSIO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const propi = url.origin === self.location.origin;
  const lletres = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!propi && !lletres) return; // les crides a Google (dades) no passen per aquí
  // Primer el que hi ha guardat (s'obre a l'instant i sense connexió) i, de fons, s'actualitza
  e.respondWith(caches.open(VERSIO).then(async c => {
    const desat = await c.match(req, { ignoreSearch: propi });
    const xarxa = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => null);
    if (desat) { e.waitUntil(xarxa); return desat; }
    const r = await xarxa;
    return r || new Response('Sense connexió', { status: 503 });
  }));
});
