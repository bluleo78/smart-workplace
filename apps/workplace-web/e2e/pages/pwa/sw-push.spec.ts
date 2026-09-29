// e2e/pages/pwa/sw-push.spec.ts
// 서비스워커 push 핸들러 — CDP 로 실제 push 이벤트를 주입해 알림 표시/억제를 확인한다(Chromium 전용).
import type { CDPSession, Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'

test.use({ serviceWorkers: 'allow' })

async function deliverPush(page: Page, data: object) {
  const cdp: CDPSession = await page.context().newCDPSession(page)
  const origin = new URL(page.url()).origin
  const regId = await new Promise<string>((resolve) => {
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
      const r = e.registrations.find((x) => x.scopeURL.startsWith(origin) && !x.isDeleted)
      if (r) resolve(r.registrationId)
    })
    void cdp.send('ServiceWorker.enable')
  })
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId: regId, data: JSON.stringify(data) })
}

const payload = { v: 1, tenantId: 1, category: 'DM', title: '박OO', body: '안녕', url: '/chat/dms/42', tag: 'ch-42' }

// 헤드리스 Chromium 은 context.grantPermissions(['notifications']) 를 줘도 Notification.permission 이
// 'denied' 로 고정되어(플랫폼 알림 미지원) showNotification 이 예외를 던진다 — 실제 알림 표시는 검증 불가.
// 브리프의 대체 지침대로 fixme 처리하고, 실기기 스모크(Task 6)로 대체한다. 억제 경로(다음 테스트)는
// 알림 표시와 무관하게 유효하므로 그대로 유지한다.
test.fixme('다른 화면을 보고 있으면 알림을 표시한다', async ({ authenticatedPage: page, context }) => {
  await context.grantPermissions(['notifications'])
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await deliverPush(page, payload)
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready
        return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag }))
      }),
    )
    .toEqual([{ title: '박OO', body: '안녕', tag: 'ch-42' }])
})

test('같은 화면을 보고 있으면 알림 대신 창에 메시지를 보낸다', async ({ authenticatedPage: page, context }) => {
  await context.grantPermissions(['notifications'])
  await page.goto('/chat/dms/42')
  await page.evaluate(() => {
    ;(window as unknown as { __pushReceived: unknown[] }).__pushReceived = []
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'push-received') (window as unknown as { __pushReceived: unknown[] }).__pushReceived.push(e.data)
    })
    return navigator.serviceWorker.ready
  })
  await deliverPush(page, payload)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __pushReceived: unknown[] }).__pushReceived.length))
    .toBe(1)
  const count = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length)
  expect(count).toBe(0)
})
