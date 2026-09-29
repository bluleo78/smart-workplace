// src/sw.ts
// 서비스워커 진입점. 운영 빌드에서만 앱 셸 precache + SPA 네비게이션 fallback 을 등록한다(개발 모드는 fetch 핸들러 없음 →
// E2E mock 이 SW 에 가로채이지 않음). /api 는 절대 캐시하지 않는다. 새 버전은 사용자가 토스트에서 새로고침할 때만 활성화(SKIP_WAITING).
// push·notificationclick 은 개발/운영 공통으로 등록 — 판단 로직은 순수 함수(./sw/logic)로 분리해 vitest 로 검증한다.
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import {
  buildNotification,
  isAppRouteUrl,
  parsePushPayload,
  requiresVisibleNotification,
  safeTarget,
  shouldSuppress,
} from './sw/logic'

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

// 알림 탭 — 앱 라우트 창이 있으면 postMessage 로 그 창 라우터를 이동시키고, 없으면 같은 origin 의 다른 창(예: /login)을
// /push-open 으로 navigate 시키며, 그마저 없으면 /push-open 으로 새 창을 연다(테넌트 전환 포함, openFromNotification 참고).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(event.notification.data))
})

async function openFromNotification(data: unknown) {
  const d = (data ?? {}) as { url?: unknown; tenantId?: unknown }
  const url = safeTarget(d.url)
  const tenantId = typeof d.tenantId === 'number' ? d.tenantId : null
  const origin = self.location.origin
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const qs = new URLSearchParams({ to: url })
  if (tenantId != null) qs.set('t', String(tenantId))
  const target = `/push-open?${qs.toString()}`

  // 1순위: 앱 라우트(로그인/공유링크/알림 진입점이 아닌 일반 화면)를 보고 있는 창 — 그 창의 라우터가 이미 살아 있으므로
  // postMessage 로 바로 이동시킬 수 있다. postMessage 를 먼저 보내고 focus 는 실패해도(창이 그새 닫히는 등) 무시한다 —
  // 메시지는 이미 전달됐으므로 이동 자체는 성공한다.
  const appWindow = windows.find((c) => isAppRouteUrl(c.url, origin))
  if (appWindow) {
    appWindow.postMessage({ type: 'push-navigate', url, tenantId })
    try {
      await appWindow.focus()
    } catch {
      // 포커스만 실패 — 이동은 이미 postMessage 로 전달됐다.
    }
    return
  }

  // 2순위: 앱 라우트는 아니지만 같은 origin 창(/login, /push-open 등)이 열려 있으면 그 창을 /push-open 으로 이동시켜
  // 재사용한다 — 새 창을 또 띄우지 않는다(예: 로그아웃 후 /login 탭만 남은 상태).
  const sameOriginWindow = windows.find((c) => {
    try {
      return new URL(c.url).origin === origin
    } catch {
      return false
    }
  })
  if (sameOriginWindow) {
    try {
      const navigated = await sameOriginWindow.navigate(target)
      await (navigated ?? sameOriginWindow).focus()
    } catch {
      // navigate/focus 실패해도 알림 클릭 처리 자체를 막지 않는다.
    }
    return
  }

  // 3순위: 열린 창이 전혀 없으면 새 창.
  await self.clients.openWindow(target)
}
