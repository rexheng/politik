const CACHE_NAME = "politik-shell-v30";

const SHELL_ASSETS = [
  "/",
  "/app.css",
  "/app.js",
  "/format.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/map",
  "/map.css",
  "/map.js",
  "/saying",
  "/saying.css",
  "/saying.js",
  "/sources",
  "/sources.css",
  "/sources.js",
  "/tabs.css",
  "/jev",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // An update finds the cache of an older version; a first install finds none. Decided before the old ones go.
      const isUpdate = keys.some((key) => key.startsWith("politik-shell-") && key !== CACHE_NAME);
      await Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
      if (!isUpdate) {
        return;
      }
      // Open chat and map pages are reloaded onto the new shell, but never waited for: the browser holds a reload of a
      // page this worker controls until activation finishes, so waiting here would hang the activation and the page.
      // A page whose address carries a question (?q=) is left alone: reloading it would ask the question again.
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) {
        const url = new URL(client.url);
        if (!["/", "/map"].includes(url.pathname) || url.searchParams.has("q")) {
          continue;
        }
        try {
          client.navigate(client.url).catch(() => {});
        } catch (error) {}
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return;
  }

  const url = new URL(request.url);
  if (url.pathname === "/api/voice/listen" || url.pathname === "/api/map-token") {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isMapAsset(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isShellAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

function isMapAsset(pathname) {
  return pathname === "/map" || pathname === "/map.js" || pathname === "/map.css";
}

function isShellAsset(pathname) {
  return SHELL_ASSETS.includes(pathname);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}
