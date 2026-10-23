// e2e/fixtures/push-mock.ts
// 푸시 E2E 공용 — headless Chromium 은 실제 푸시 서비스(FCM) 연결 없이 subscribe 가 실패하므로 PushManager 를 스텁하고
// /push/* API 를 mock 한다. 스텁은 페이지 로드마다 초기화(구독 없음 상태에서 시작).
import { expect, type Page } from '@playwright/test'

import { mockApi } from './api-mock'

/** 65바이트(0x04 + 0*64) base64url — 서버 VAPID 공개키 대용. */
export const VAPID_KEY = 'B' + 'A'.repeat(86)
export const FAKE_ENDPOINT = 'https://push.example.test/sub/1'

export async function installPushManagerStub(page: Page) {
  await page.addInitScript(
    ({ endpoint }) => {
      let current: unknown = null
      const make = (key: BufferSource | null) => ({
        endpoint,
        options: { applicationServerKey: key },
        toJSON: () => ({ endpoint, keys: { p256dh: 'p256dh-fake', auth: 'auth-fake' } }),
        unsubscribe: async () => {
          current = null
          return true
        },
      })
      PushManager.prototype.getSubscription = async function () {
        return current as PushSubscription | null
      }
      PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
        current = make((opts?.applicationServerKey as BufferSource) ?? null)
        return current as PushSubscription
      }
    },
    { endpoint: FAKE_ENDPOINT },
  )
}

/**
 * Notification.permission 정적 프로퍼티를 고정한다. headless Chromium 은 context.grantPermissions() 후에도 이 값이
 * 즉시 갱신되지 않고(requestPermission() 호출로만 갱신) 캐시돼 있어, 앱이 정적 프로퍼티를 읽는 경로(배너 노출·syncPushOnLogin)의
 * 권한 상태를 재현하려면 getter 를 직접 스텁해야 한다. 페이지 로드마다 적용되도록 init script 로 등록한다.
 */
export async function stubNotificationPermission(page: Page, value: NotificationPermission) {
  await page.addInitScript((v) => {
    Object.defineProperty(Notification, 'permission', { get: () => v, configurable: true })
  }, value)
}

/**
 * 서비스워커가 활성화될 때까지 기다린다. 구독은 navigator.serviceWorker.ready 를 기다리는데, preview 빌드의 실제 SW 는
 * 설치 때 자산 전체를 미리 받아 두므로(precache) 부하가 걸리면 10초를 넘긴다 — 그동안 토글은 busy 로 잠기고 구독 요청도 나가지 않는다.
 * 토글을 누르기 전에 준비를 끝내 두어 클릭 뒤 단언이 SW 설치 시간에 좌우되지 않게 한다.
 */
export async function waitForServiceWorkerReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
}

/** SW 의 관리를 받는 상태로 연다 — 첫 방문은 관리 밖이라 한 번 새로고침해야 관리받는다(sw.ts 는 clients.claim 을 하지 않음). */
export async function openSwControlled(page: Page, path: string) {
  await page.goto(path)
  await waitForServiceWorkerReady(page)
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
}

export async function mockPushApis(page: Page, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true
  await mockApi(page, 'GET', '/api/v1/push/config', { enabled, vapidPublicKey: enabled ? VAPID_KEY : null })
  // 설정은 GET/PUT 을 한 핸들러가 상태로 처리(PUT 결과가 이후 GET 에 반영).
  let prefsState = { DM: true, MENTION: true, ISSUE: true, CALENDAR: true }
  await page.route('**/api/v1/push/preferences', async (route) => {
    if (route.request().method() === 'PUT') {
      prefsState = { ...prefsState, ...route.request().postDataJSON() }
    }
    await route.fulfill({ json: prefsState })
  })
  const subscribe = await mockApi(page, 'POST', '/api/v1/push/subscriptions', {}, { status: 204, capture: true })
  const unsubscribe = await mockApi(page, 'DELETE', '/api/v1/push/subscriptions', {}, { status: 204, capture: true })
  /** 다음 설정 PUT 요청 대기 — 클릭 전에 호출해 Promise 를 잡아 둔다. */
  const nextPrefsPut = () =>
    page.waitForRequest((r) => r.url().endsWith('/api/v1/push/preferences') && r.method() === 'PUT')
  return { subscribe, unsubscribe, nextPrefsPut }
}
