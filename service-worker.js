const CACHE_NAME = "buzzer-web-timer-v15";
const ASSETS = [
  "./",
  "./index.html",
  "./student.html",
  "./styles.css?v=15",
  "./app.js?v=6",
  "./src/format.js",
  "./src/store.js",
  "./src/roster.js",
  "./src/measure.js",
  "./src/portfolio.js",
  "./src/settings.js",
  "./src/sync.js",
  "./src/student.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  // 앱 파일만 캐시한다. 외부 응답까지 캐시하면 오래된 데이터를 계속 돌려주게 된다.
  if (new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  // 네트워크 우선: 항상 최신 버전을 받아오고, 오프라인일 때만 캐시 사용
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
