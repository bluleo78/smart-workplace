// e2e/pages/settings/notification-settings.spec.ts
// 설정 > 알림 — 기기 푸시 토글(권한→구독→서버 등록), 종류별 토글, 거부·iOS·비활성 안내, 로그아웃 시 구독 해제.
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { FAKE_ENDPOINT, installPushManagerStub, mockPushApis } from '../../fixtures/push-mock'

test.use({ serviceWorkers: 'allow' })

test.describe('알림 설정', () => {
  test('기기 푸시를 켜면 구독이 서버에 등록된다', { tag: '@smoke' }, async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    const { subscribe } = await mockPushApis(page)

    await page.goto('/settings/notifications')
    const toggle = page.getByTestId('push-device-toggle')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()

    // capture:true 로 받은 요청은 { payload, url, searchParams } — 실제 Playwright Request 가 아니다(api-mock.ts).
    const req = await subscribe.waitForRequest()
    expect(req.payload).toEqual({ endpoint: FAKE_ENDPOINT, keys: { p256dh: 'p256dh-fake', auth: 'auth-fake' } })
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('기기 푸시를 끄면 서버 구독이 삭제된다', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    const { unsubscribe } = await mockPushApis(page)

    await page.goto('/settings/notifications')
    const toggle = page.getByTestId('push-device-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()

    const req = await unsubscribe.waitForRequest()
    expect(req.payload).toEqual({ endpoint: FAKE_ENDPOINT })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  test('종류별 토글은 부분 업데이트로 저장된다', async ({ authenticatedPage: page }) => {
    await installPushManagerStub(page)
    const { nextPrefsPut } = await mockPushApis(page)
    await page.goto('/settings/notifications')

    const put = nextPrefsPut()
    await page.getByTestId('push-pref-CALENDAR').click()

    expect((await put).postDataJSON()).toEqual({ CALENDAR: false })
    await expect(page.getByTestId('push-pref-CALENDAR')).toHaveAttribute('aria-checked', 'false')
  })

  test('권한을 거부하면 안내가 보인다', async ({ authenticatedPage: page }) => {
    // headless Chromium 은 알림 권한 기본값이 이미 'denied' 라 스텁 없이는 클릭 전부터 안내가 보여
    // "클릭 → 거부" 경로를 검증하지 못한다. 'default' 로 스텁해 실제 거부 플로우를 재현한다.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true })
    })
    await installPushManagerStub(page)
    await mockPushApis(page)
    await page.goto('/settings/notifications')

    await expect(page.getByTestId('push-denied-guide')).toHaveCount(0)
    await page.getByTestId('push-device-toggle').click()

    // 권한 미부여 headless Chromium 은 requestPermission() 이 권한 창 없이 즉시 non-granted 로 끝난다(denied 또는 default).
    await expect(page.getByTestId('push-denied-guide')).toBeVisible()
  })

  test('서버가 푸시 비활성이면 푸시 섹션을 숨긴다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page, { enabled: false })
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('push-disabled-notice')).toBeVisible()
    await expect(page.getByTestId('push-device-toggle')).toHaveCount(0)
  })

  test('사이드바에 알림 메뉴가 있다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    await page.goto('/settings/profile')
    await page.getByTestId('settings-sidebar').getByRole('link', { name: '알림' }).click()
    await expect(page).toHaveURL(/\/settings\/notifications$/)
  })

  test('로그아웃 시 구독 해제 후 logout 호출', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    const { unsubscribe } = await mockPushApis(page)
    const order: string[] = []
    await page.route('**/api/v1/auth/logout', async (route) => {
      order.push('logout')
      await route.fulfill({ json: {} })
    })
    page.on('request', (r) => {
      if (r.url().endsWith('/api/v1/push/subscriptions') && r.method() === 'DELETE') order.push('unsubscribe')
    })

    await page.goto('/settings/notifications')
    await page.getByTestId('push-device-toggle').click()
    await expect(page.getByTestId('push-device-toggle')).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: '사용자 메뉴' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await unsubscribe.waitForRequest()
    await expect(page).toHaveURL(/\/login$/)
    expect(order).toEqual(['unsubscribe', 'logout'])
  })

  test('서버 키가 바뀐 기기는 재구독 후 재등록한다', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    // 이전 키(마지막 바이트 다름)로 이미 구독된 브라우저 시뮬레이션
    await page.addInitScript(() => {
      // headless Chromium 은 context.grantPermissions() 후에도 Notification.permission 정적 프로퍼티가
      // 즉시 갱신되지 않고 'denied' 로 캐시돼 있다(requestPermission() 호출로만 갱신) — syncPushOnLogin 은
      // 정적 프로퍼티를 읽으므로, 실사용자가 이미 허용해 둔 상태를 재현하려면 getter 를 직접 스텁해야 한다.
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true })
      const old = new Uint8Array(65)
      old[0] = 4
      old[64] = 1
      let current: unknown = {
        endpoint: 'https://push.example.test/sub/old',
        options: { applicationServerKey: old.buffer },
        toJSON: () => ({ endpoint: 'https://push.example.test/sub/old', keys: { p256dh: 'o', auth: 'o' } }),
        unsubscribe: async () => {
          current = null
          return true
        },
      }
      PushManager.prototype.getSubscription = async function () {
        return current as PushSubscription | null
      }
      PushManager.prototype.subscribe = async function () {
        current = {
          endpoint: 'https://push.example.test/sub/new',
          options: { applicationServerKey: null },
          toJSON: () => ({ endpoint: 'https://push.example.test/sub/new', keys: { p256dh: 'n', auth: 'n' } }),
          unsubscribe: async () => true,
        }
        return current as PushSubscription
      }
    })
    const { subscribe } = await mockPushApis(page)
    await page.goto('/')
    const req = await subscribe.waitForRequest()
    expect((req.payload as { endpoint: string }).endpoint).toBe('https://push.example.test/sub/new')
  })
})

test.describe('알림 설정 — iOS', () => {
  test.use({
    serviceWorkers: 'allow',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })

  test('홈 화면 설치 전이면 설치 안내를 보이고 토글을 막는다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page)
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('push-ios-install-guide')).toBeVisible()
    await expect(page.getByTestId('push-device-toggle')).toBeDisabled()
  })
})

test.describe('인박스 배너', () => {
  test.use({ serviceWorkers: 'allow' })

  test('미구독이면 알림 켜기 배너가 보이고 닫으면 다시 안 보인다', async ({ authenticatedPage: page }) => {
    // headless Chromium 은 알림 권한 기본값이 'denied' 라(grantPermissions 미호출 시) 배너 조건(permission
    // 'default')을 충족 못 한다. 배너 노출 자체를 검증하려는 목적이므로 permission getter 만 'default' 로 스텁.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true })
    })
    await installPushManagerStub(page)
    await mockPushApis(page)
    await mockApi(page, 'GET', '/api/v1/notifications', [])
    await page.goto('/')
    await page.getByTestId('inbox-trigger').click()
    await expect(page.getByTestId('push-prompt-banner')).toBeVisible()
    await page.getByTestId('push-prompt-dismiss').click()
    await expect(page.getByTestId('push-prompt-banner')).toHaveCount(0)
    await page.reload()
    await page.getByTestId('inbox-trigger').click()
    await expect(page.getByTestId('inbox-panel')).toBeVisible()
    await expect(page.getByTestId('push-prompt-banner')).toHaveCount(0)
  })
})
