const CACHE_NAME = "politik-shell-v18";

const SHELL_ASSETS = [
  "/",
  "/app.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/map",
  "/map.css",
  "/map.js",
  "/saying",
  "/saying.css",
  "/saying.js",
  "/onboard",
  "/onboard.css",
  "/onboard.js",
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
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
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
  if (url.pathname === "/api/voice/listen") {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isShellAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

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
