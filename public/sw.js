/* Mailflow service worker.
 *
 * What it is for: making Mailflow installable as an app, opening it
 * quickly, and showing a plain "you're offline" page instead of the
 * browser's error when there is no connection.
 *
 * What it deliberately does NOT do:
 *   - Cache any page. Mailflow pages carry client names and addresses,
 *     and a laptop's cache outlives a signed-out session. Pages always
 *     come from the network; offline gets /offline.html, nothing else.
 *   - Touch anything client-facing. Tracking, unsubscribe, forms,
 *     surveys and landing pages (/e/, /f/, /s/, /p/ and /api/) go
 *     straight to the network, untouched, so a stale copy can never
 *     stand between a client and their unsubscribe.
 *   - Touch writes. Only GET requests are ever handled.
 *
 * Static build files are content-hashed and never change, so they are
 * cached first. Bump CACHE_VERSION when this file changes.
 */

const CACHE_VERSION = "v2";
const CACHE_PREFIX = "mailflow-";
const STATIC_CACHE = `${CACHE_PREFIX}static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  /* Drop every older cache, including LoanFlow's ("loanflow-*"), which
     an earlier copy of this file created and which held whole pages. */
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Pages inside Mailflow: always the network; the offline page only
     when there is no network at all. */
  if (req.mode === "navigate") {
    if (!url.pathname.startsWith("/marketing")) return;
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || Response.error()),
      ),
    );
    return;
  }

  /* Hashed build files and the app's own icons: cache first. */
  const isStatic =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/");
  if (!isStatic) return;

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
