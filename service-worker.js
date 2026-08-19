const CACHE_NAME = "buzzer-web-timer-v17";

// GitHub Pages 는 모든 파일을 Cache-Control: max-age=600 으로 준다.
// 그래서 파일 이름이 그대로면 배포 후 10 분 동안 브라우저가 옛 파일을 계속 쓴다.
// index.html 만 새것이고 src 모듈이 옛것이면 import 가 깨져 앱이 통째로 죽는다.
// 모든 모듈 URL 에 같은 ?v= 를 달아 배포마다 새 주소가 되게 한다.
// 배포할 때는 이 숫자와 아래 목록, index.html·student.html·각 import 문을 함께 올린다.
const ASSETS = [
  "./",
  "./index.html",
  "./student.html",
  "./styles.css?v=17",
  "./app.js?v=17",
  "./src/format.js?v=17",
  "./src/store.js?v=17",
  "./src/roster.js?v=17",
  "./src/measure.js?v=17",
  "./src/portfolio.js?v=17",
  "./src/settings.js?v=17",
  "./src/sync.js?v=17",
  "./src/student.js?v=17",
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
