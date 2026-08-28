const CACHE_NAME = "buzzer-web-timer-v21";

// GitHub Pages 는 모든 파일을 Cache-Control: max-age=600 으로 준다.
// 그래서 파일 이름이 그대로면 배포 후 10 분 동안 브라우저가 옛 파일을 계속 쓴다.
// index.html 만 새것이고 src 모듈이 옛것이면 import 가 깨져 앱이 통째로 죽는다.
// 모든 모듈 URL 에 같은 ?v= 를 달아 배포마다 새 주소가 되게 한다.
// 배포할 때는 이 숫자와 아래 목록, index.html·student.html·각 import 문을 함께 올린다.
const ASSETS = [
  "./",
  "./index.html",
  "./student.html",
  "./me.html",
  "./styles.css?v=21",
  "./app.js?v=21",
  "./src/format.js?v=21",
  "./src/timer.js?v=21",
  "./src/me.js?v=21",
  "./src/store.js?v=21",
  "./src/roster.js?v=21",
  "./src/measure.js?v=21",
  "./src/portfolio.js?v=21",
  "./src/settings.js?v=21",
  "./src/sync.js?v=21",
  "./src/student.js?v=21",
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

  // 네트워크 우선: 항상 최신 버전을 받아오고, 오프라인일 때만 캐시 사용.
  //
  // cache: "no-cache" 가 없으면 network-first 라는 말이 무색해진다.
  // GitHub Pages 가 max-age=600 을 주기 때문에 그냥 fetch 하면 브라우저
  // HTTP 캐시가 10 분 동안 옛 index.html 을 그대로 돌려준다. 홈 화면에
  // 설치한 앱이 배포 후에도 한참 옛 화면을 띄우는 이유가 이것이다.
  // no-cache 는 캐시를 버리는 게 아니라 서버에 물어보게 하는 것이라
  // 안 바뀌었으면 304 로 끝나 비용도 거의 없다.
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
