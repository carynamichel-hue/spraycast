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
var CACHE = 'spraycast-nuxt-20260827124917';
var SHELL = ['./', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  /* ⚑ sweep EVERY spraycast cache, not just spraycast-nuxt-*: the pre-Nuxt
     standalone that lived at this URL until 2026-08-25 used 'spraycast-v1',
     and the Cache API is ORIGIN-wide — with a prefix that missed it, that
     cache survived on every migrated phone, and a bare caches.match() finds
     the OLDEST cache first, so the offline path served the retired app
     forever (the exact bug PlantPicks hit live on 08-26). The other apps on
     this origin (blightcast-*, plantpicks-*) are NOT ours to delete. */
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('spraycast') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   /* weather + map tiles go straight to the network */
  /* ⚑ ALWAYS match inside OUR cache — never bare caches.match(). The Cache
     API is origin-wide and bare match searches every cache OLDEST-first, so
     the standalone's leftover cache (or a sibling app's) would win over the
     stamped one and the per-deploy sweep would be defeated. */
  var inOurs = function (key) { return caches.open(CACHE).then(function (c) { return c.match(key); }); };
  var isNav = req.mode === 'navigate';
  if (isNav) {
    /* the shell key './' must only ever hold the app ROOT: caching any ok
       navigation there meant reading the /guide/ page overwrote the shell,
       and the next offline open of the app hydrated guide markup against the
       wrong route's payload. Other navigations cache under their own URL, so
       the guide also opens offline directly once visited. */
    var isRoot = url.pathname === new URL('./', self.location).pathname
      || url.pathname === new URL('./index.html', self.location).pathname;
    /* network first, but not forever: on lie-fi (connected to a hotspot that
       carries nothing) a bare fetch hangs and the app appears frozen, so the
       cached shell wins after 4 seconds. With NO cached shell the timer must
       stay silent — it used to reject, which settled the race and handed a
       first-ever visitor on a slow network a browser error page while the
       real HTML was still on its way. */
    e.respondWith(
      Promise.race([
        fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(isRoot ? './' : req, copy); });
          }
          return res;
        }),
        new Promise(function (resolve) {
          setTimeout(function () {
            inOurs(isRoot ? './' : req).then(function (c) {
              if (c) return resolve(c);
              if (!isRoot) inOurs('./').then(function (shell) { if (shell) resolve(shell); });
            });
          }, 4000);
        }),
      ]).catch(function () {
        /* the last resort must be a RESPONSE. On a first-ever open over lie-fi
           there is no cached shell yet, so this resolved to undefined and
           respondWith threw — instead of letting the browser show its own
           offline page. */
        return inOurs(isRoot ? './' : req).then(function (c) {
          return c || inOurs('./').then(function (shell) { return shell || Response.error(); });
        });
      })
    );
    return;
  }
  e.respondWith(
    inOurs(req).then(function (cached) {
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
