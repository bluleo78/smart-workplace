// src/sw.ts
// 서비스워커 진입점. 운영 빌드에서만 앱 셸 precache + SPA 네비게이션 fallback 을 등록한다(개발 모드는 fetch 핸들러 없음 →
// E2E mock 이 SW 에 가로채이지 않음). /api 는 절대 캐시하지 않는다. 새 버전은 사용자가 토스트에서 새로고침할 때만 활성화(SKIP_WAITING).
// push·notificationclick 은 개발/운영 공통으로 등록 — 판단 로직은 순수 함수(./sw/logic)로 분리해 vitest 로 검증한다.
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import { buildNotification, parsePushPayload, requiresVisibleNotification, safeTarget, shouldSuppress } from './sw/logic'

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

// 푸시 수신 — 사용자가 이미 그 화면을 보고 있으면(비 Safari) 알림 대신 창에 알리고, 아니면 알림을 표시한다.
self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event.data?.text() ?? null))
})

async function handlePush(raw: string | null) {
  const payload = parsePushPayload(raw)
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const views = windows.map((c) => ({ url: c.url, visible: c.visibilityState === 'visible' }))
  if (shouldSuppress(payload, views, self.location.origin, requiresVisibleNotification(self.navigator.userAgent))) {
    windows
      .filter((c) => c.visibilityState === 'visible')
      .forEach((c) => c.postMessage({ type: 'push-received', payload }))
    return
  }
  const { title, options } = buildNotification(payload)
  await self.registration.showNotification(title, options)
}

// 알림 탭 — 열린 창이 있으면 포커스 후 앱 라우터로 이동시키고, 없으면 /push-open 으로 새 창(테넌트 전환 포함).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(event.notification.data))
})

async function openFromNotification(data: unknown) {
  const d = (data ?? {}) as { url?: unknown; tenantId?: unknown }
  const url = safeTarget(d.url)
  const tenantId = typeof d.tenantId === 'number' ? d.tenantId : null
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows.find((c) => new URL(c.url).origin === self.location.origin)
  if (existing) {
    await existing.focus()
    existing.postMessage({ type: 'push-navigate', url, tenantId })
    return
  }
  const qs = new URLSearchParams({ to: url })
  if (tenantId != null) qs.set('t', String(tenantId))
  await self.clients.openWindow(`/push-open?${qs.toString()}`)
}
