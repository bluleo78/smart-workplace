// src/sw.ts
// 서비스워커 진입점. 운영 빌드에서만 앱 셸 precache + SPA 네비게이션 fallback 을 등록한다(개발 모드는 fetch 핸들러 없음 →
// E2E mock 이 SW 에 가로채이지 않음). /api 는 절대 캐시하지 않는다. 새 버전은 사용자가 토스트에서 새로고침할 때만 활성화(SKIP_WAITING).
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> }

if (import.meta.env.PROD) {
  precacheAndRoute(self.__WB_MANIFEST)
  cleanupOutdatedCaches()
  // 네비게이션(주소창 이동·새로고침)은 precache 된 index.html 로 — 단 API·공유 링크 경로는 제외.
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//, /^\/s\//] }))
}

// 업데이트 토스트 "새로고침" → workbox-window 가 보내는 메시지로 대기 중인 SW 를 즉시 활성화.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
