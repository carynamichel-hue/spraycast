/* SprayCast service worker — the standalone pages-kit's SW adapted for the
   Nuxt build: makes the hosted app installable and lets it OPEN with no
   signal (last-cached app shell + whatever data is in the browser; the
   forecast refreshes when connectivity returns).
   Differences from the single-file version: the shell pre-list holds only
   './' (Nuxt's asset names are content-hashed and unknowable here — the
   fetch handler caches them as they're first served), and navigations fall
   back to the cached app root so a deep link still opens offline.

   NAVIGATIONS ARE NETWORK-FIRST, and that is not a preference — it is what
   makes a per-deploy cache stamp safe. BlightCast learned this live on
   2026-08-23: with a cache-first shell, a deploy replaced the content-hashed
   assets, the new worker swept the old cache, and the stale shell that still
   loaded went looking for lazy route chunks that no longer existed anywhere
   — header tabs silently did nothing. Hashed assets stay cache-first (they
   are immutable); only the shell must always match the server.
   CACHE is stamped per-deploy by scripts/deploy_pages.mjs so old caches
   sweep; the source keeps the -v1 placeholder. */
var CACHE = 'spraycast-nuxt-202608251856';
var SHELL = ['./', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('spraycast-nuxt-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   /* weather + map tiles go straight to the network */
  var isNav = req.mode === 'navigate';
  if (isNav) {
    /* network first, but not forever: on lie-fi (connected to a hotspot that
       carries nothing) a bare fetch hangs and the app appears frozen, so the
       cached shell wins after 4 seconds. BlightCast deferred this one; it is
       here from the start. */
    e.respondWith(
      Promise.race([
        fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put('./', copy); });
          }
          return res;
        }),
        new Promise(function (resolve, reject) {
          setTimeout(function () { caches.match('./').then(function (c) { c ? resolve(c) : reject(new Error('timeout')); }); }, 4000);
        }),
      ]).catch(function () {
        /* the last resort must be a RESPONSE. On a first-ever open over lie-fi
           there is no cached shell yet, so this resolved to undefined and
           respondWith threw — instead of letting the browser show its own
           offline page. */
        return caches.match('./').then(function (c) { return c || Response.error(); });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(function (cached) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || fresh;
    })
  );
});
