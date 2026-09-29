// e2e/fixtures/push-mock.ts
// 푸시 E2E 공용 — headless Chromium 은 실제 푸시 서비스(FCM) 연결 없이 subscribe 가 실패하므로 PushManager 를 스텁하고
// /push/* API 를 mock 한다. 스텁은 페이지 로드마다 초기화(구독 없음 상태에서 시작).
import type { Page } from '@playwright/test'

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
