// 서비스워커 precache 대상 glob 을 빌드 환경(E2E 여부)에 따라 고른다.
//
// 왜: 운영 빌드는 정적 파일 수백 개(측정 당시 508개)를 precache 한다. Playwright 는 테스트마다 새 브라우저
// 컨텍스트를 만들고, 컨텍스트마다 SW install 이 그 목록을 전부 다시 받는다 — 걸리는 시간이 목록 크기 × 동시 컨텍스트
// 수에 비례해, 전체 E2E 부하에서 serviceWorker.ready 30초를 넘겨 PWA spec 이 깨졌다(WP-1802).
// E2E=1 빌드는 SW 가 설치·활성화·갱신 흐름만 검증하면 되므로 앱 셸(index.html)만 고른다
// (vite-plugin-pwa 가 manifest·아이콘을 덧붙여 실제 precache 는 몇 개 더 된다).
//
// CI 환경변수는 보지 않는다(vite.config.ts 의 IS_E2E 와 다름): 운영 이미지 빌드도 CI=true 로 돌기 때문에,
// CI 로 분기하면 운영 precache 가 줄어든다. 오직 명시적인 E2E=1 일 때만 줄인다.
export function precacheGlobPatterns(env) {
  // 매번 새 배열 리터럴을 돌려줘 호출자가 바꿔도 다음 결과에 번지지 않는다.
  return env.E2E === '1' ? ['index.html'] : ['**/*.{js,css,html,svg,png,woff2}']
}
