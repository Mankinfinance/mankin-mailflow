/* LoanFlow service worker.
 *
 * Strategy:
 *   - Static assets (CSS, JS, images, fonts): cache-first with stale-
 *     while-revalidate. Keeps the shell loading instantly even on a
 *     flaky connection.
 *   - Navigations (HTML page loads): network-first with cache fallback.
 *     Brokers + customers expect fresh data on every visit, so we only
 *     fall back to cache when the network is unreachable.
 *   - Everything else (POST server actions, /api/*): passthrough. Never
 *     cache writes.
 *
 * The cache key includes a version string so a deploy bumps the cache
 * and old assets get evicted on activate. Update CACHE_VERSION when
 * changing this file.
 */

const CACHE_VERSION = "loanflow-v1";
const CACHE_PREFIX = "loanflow-";
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const PAGE_CACHE = `${CACHE_PREFIX}pages-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/dashboard",
  "/dashboard/today",
  "/manifest.webmanifest",
  "/brand/mankin-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  /* Evict caches from older versions on activate so the SW doesn't
     accumulate stale entries across deploys. */
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  /* Only handle same-origin requests. Cross-origin (Microsoft Graph,
     SharePoint, SMS Broadcast, Anthropic) goes straight to the
     network. */
  if (url.origin !== self.location.origin) return;

  /* Never touch writes or API calls - server actions and auth flow
     must hit the network every time. */
  if (req.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/data/")) return;
  if (url.pathname.startsWith("/_next/static/chunks/pages-api")) return;

  /* HTML navigations: network-first with cache fallback. Stale shell
     when offline is better than a Chrome dino. */
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(PAGE_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/dashboard"))),
    );
    return;
  }

  /* Static assets: cache-first with background refresh. */
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
