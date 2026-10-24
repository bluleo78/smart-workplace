// e2e/pages/settings/notification-settings.spec.ts
// 설정 > 알림 — 기기 푸시 토글(권한→구독→서버 등록), 앱별 「사람이 / AI가」 알림 매트릭스(WP-913), 거부·iOS·비활성 안내, 로그아웃 시 구독 해제.
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import {
  FAKE_ENDPOINT,
  installPushManagerStub,
  mockPushApis,
  stubNotificationPermission,
  waitForServiceWorkerReady,
} from '../../fixtures/push-mock'
import { mockNotificationSettings } from '../../fixtures/notification-settings-mock'
import { trackRequests } from '../../fixtures/requests'

test.use({ serviceWorkers: 'allow' })

test.describe('알림 설정', () => {
  test('기기 푸시를 켜면 구독이 서버에 등록된다', { tag: '@smoke' }, async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    const { subscribe } = await mockPushApis(page)
    await mockNotificationSettings(page)

    await page.goto('/settings/notifications')
    await waitForServiceWorkerReady(page)
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
    await mockNotificationSettings(page)

    await page.goto('/settings/notifications')
    await waitForServiceWorkerReady(page)
    const toggle = page.getByTestId('push-device-toggle')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await toggle.click()

    const req = await unsubscribe.waitForRequest()
    expect(req.payload).toEqual({ endpoint: FAKE_ENDPOINT })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  // WP-913: 앱별 카드 × 「사람이 / AI가」 두 열 — 칸 하나를 바꾸면 그 칸만 PUT 한다.
  test('칸을 바꾸면 그 칸만 저장되고 새로고침 뒤에도 유지된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await installPushManagerStub(page)
    await mockPushApis(page)
    const { nextSettingsPut } = await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    // 기본값 — AI 가 나를 할당·사람이 바꾼 상태 변경은 꺼짐, AI 작업 알림에는 「사람이」 칸이 없다.
    await expect(page.getByTestId('notif-cell-ISSUE_ASSIGNED-AGENT')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('notif-cell-ISSUE_STATUS_CHANGED-HUMAN')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('notif-cell-ISSUE_AI_NEEDS_INPUT-HUMAN')).toHaveCount(0)

    const put = nextSettingsPut()
    await page.getByTestId('notif-cell-ISSUE_COMMENTED-AGENT').click()
    expect((await put).postDataJSON()).toEqual({ cells: [{ item: 'ISSUE_COMMENTED', actor: 'AGENT', enabled: true }] })
    await expect(page.getByTestId('notif-cell-ISSUE_COMMENTED-AGENT')).toHaveAttribute('aria-checked', 'true')

    await page.reload()
    await expect(page.getByTestId('notif-cell-ISSUE_COMMENTED-AGENT')).toHaveAttribute('aria-checked', 'true')
  })

  // 채팅은 알림 목록에 쌓이지 않고 푸시로만 알려(꺼도 메시지·안 읽음 표시는 그대로) 화면 위 공통 안내와 달라, 채팅 카드에만 안내를 둔다.
  test('채팅 카드에만 푸시로만 알린다는 안내가 있다', async ({ authenticatedPage: page }) => {
    await installPushManagerStub(page)
    await mockPushApis(page)
    await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    await expect(page.getByTestId('notif-app-CHAT').getByTestId('notif-app-note-CHAT')).toHaveText(
      '채팅은 알림 목록에 쌓이지 않고 푸시로만 알려요. 꺼도 메시지와 안 읽음 표시는 채팅에 그대로 있어요.',
    )
    await expect(page.getByTestId('notif-app-ISSUE').getByTestId(/^notif-app-note-/)).toHaveCount(0)
  })

  test('앱 전체를 끄면 그 앱 칸이 꺼진 채 잠기고 다시 켜면 돌아온다', async ({ authenticatedPage: page }) => {
    await installPushManagerStub(page)
    await mockPushApis(page)
    const { nextSettingsPut } = await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    const appToggle = page.getByTestId('notif-app-toggle-ISSUE')
    const assigned = page.getByTestId('notif-cell-ISSUE_ASSIGNED-HUMAN')
    await expect(assigned).toHaveAttribute('aria-checked', 'true')

    let put = nextSettingsPut()
    await appToggle.click()
    expect((await put).postDataJSON()).toEqual({ apps: { ISSUE: false } })
    await expect(assigned).toHaveAttribute('aria-checked', 'false')
    await expect(assigned).toBeDisabled()
    // 다른 앱 칸은 그대로다.
    await expect(page.getByTestId('notif-cell-CHAT_DM-HUMAN')).toHaveAttribute('aria-checked', 'true')

    put = nextSettingsPut()
    await appToggle.click()
    expect((await put).postDataJSON()).toEqual({ apps: { ISSUE: true } })
    // 칸 값은 서버에 보존돼 있어 앱을 다시 켜면 원래 값으로 돌아온다.
    await expect(assigned).toHaveAttribute('aria-checked', 'true')
    await expect(assigned).toBeEnabled()
  })

  // WP-847: 잠금은 disabled 가 아니라 aria-disabled + 바꾸기 무시 — disabled 로 꺼지면 키보드 초점이 body 로 사라졌다.
  test('저장 중에는 모든 스위치가 잠기고, 키보드로 바꾼 스위치에 초점이 남는다', async ({ authenticatedPage: page }) => {
    await installPushManagerStub(page)
    await mockPushApis(page)
    await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    // PUT 을 붙잡아 뒀다가 나중에 풀어준다 — 한 뮤테이션을 모든 스위치가 공유하므로, 응답이 오기 전에 다른 칸을 또 누르면
    // 부분 업데이트가 겹쳐 먼저 보낸 요청 결과가 나중 응답에 덮어써질 수 있다. 풀린 뒤에는 상태 있는 mock 이 응답한다.
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/v1/notification-settings', async (route) => {
      if (route.request().method() !== 'PUT') return route.fallback()
      await gate
      await route.fallback()
    })
    const puts = trackRequests(page, 'PUT', '/api/v1/notification-settings')

    const invited = page.getByTestId('notif-cell-CALENDAR_INVITED-HUMAN')
    await expect(invited).toHaveAttribute('aria-checked', 'true')
    await invited.focus()
    await page.keyboard.press('Space')
    await puts.waitFor()
    const matrix = page.getByTestId('notif-settings-matrix')
    const switches = matrix.getByRole('switch')
    const n = await switches.count()
    expect(n).toBeGreaterThan(20)
    for (let i = 0; i < n; i++) await expect(switches.nth(i)).toHaveAttribute('aria-disabled', 'true')
    await expect(invited).toBeFocused()

    // 잠긴 동안 다시 누르거나 다른 칸을 눌러도 요청을 더 보내지 않고 값도 그대로다.
    await page.keyboard.press('Space')
    // aria-disabled 요소는 Playwright 가 click 을 기다리므로, 초점을 옮기지 않는 클릭 이벤트로 누름을 흉내 낸다.
    const dm = page.getByTestId('notif-cell-CHAT_DM-HUMAN')
    await dm.dispatchEvent('click')
    await expect(dm).toHaveAttribute('aria-checked', 'true')

    release()
    await expect(dm).not.toHaveAttribute('aria-disabled', 'true')
    await expect(invited).toHaveAttribute('aria-checked', 'false')
    await expect(invited).toBeFocused()
    expect(puts.count()).toBe(1)
  })

  test('권한을 거부하면 안내가 보인다', async ({ authenticatedPage: page }) => {
    // headless Chromium 은 알림 권한 기본값이 이미 'denied' 라 스텁 없이는 클릭 전부터 안내가 보여
    // "클릭 → 거부" 경로를 검증하지 못한다. 'default' 로 스텁해 실제 거부 플로우를 재현한다.
    await stubNotificationPermission(page, 'default')
    await installPushManagerStub(page)
    await mockPushApis(page)
    await mockNotificationSettings(page)
    await page.goto('/settings/notifications')

    await expect(page.getByTestId('push-denied-guide')).toHaveCount(0)
    await page.getByTestId('push-device-toggle').click()

    // 권한 미부여 headless Chromium 은 requestPermission() 이 권한 창 없이 즉시 non-granted 로 끝난다(denied 또는 default).
    await expect(page.getByTestId('push-denied-guide')).toBeVisible()
  })

  // WP-913: 알림 종류 설정은 푸시가 아니라 알림 자체를 끄고 켜므로, 서버 푸시가 꺼져 있어도 보이고 저장된다.
  test('서버가 푸시 비활성이어도 알림 매트릭스는 보이고 저장된다', async ({ authenticatedPage: page }) => {
    await mockPushApis(page, { enabled: false })
    await mockNotificationSettings(page)
    const puts = trackRequests(page, 'PUT', '/api/v1/notification-settings')
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('push-disabled-notice')).toBeVisible()
    await expect(page.getByTestId('push-device-toggle')).toHaveCount(0)
    await expect(page.getByTestId('notif-settings-matrix')).toBeVisible()

    const dm = page.getByTestId('notif-cell-CHAT_DM-AGENT')
    await dm.click()
    await puts.waitFor()
    await expect(dm).toHaveAttribute('aria-checked', 'false')
    expect(puts.count()).toBe(1)
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
    await mockPushApis(page)
    await mockNotificationSettings(page)
    // 구독 해제(DELETE)와 logout 의 발사 순서를 한 tracker 로 함께 기록한다.
    const calls = trackRequests(page, 'ANY', (url, req) =>
      url.pathname === '/api/v1/auth/logout' || (url.pathname === '/api/v1/push/subscriptions' && req.method() === 'DELETE'))
    await page.route('**/api/v1/auth/logout', async (route) => {
      await route.fulfill({ json: {} })
    })

    await page.goto('/settings/notifications')
    await waitForServiceWorkerReady(page)
    await page.getByTestId('push-device-toggle').click()
    await expect(page.getByTestId('push-device-toggle')).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: '사용자 메뉴' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await calls.waitFor(2)
    await expect(page).toHaveURL(/\/login$/)
    const order = calls.urls().map((u) => (u.pathname === '/api/v1/auth/logout' ? 'logout' : 'unsubscribe'))
    expect(order).toEqual(['unsubscribe', 'logout'])
  })

  // 타임아웃 경계(2999ms 대기·3000ms 진행·reject 전파)는 src/lib/withTimeout.test.ts 가 본다. 여기선 멈춘 구독 해제가
  // 로그아웃을 막지 않는다는 배선만 — 실제 3초 대신 page.clock 으로 경과시킨다(WP-410).
  test('구독 해제 요청이 멈춰도 3초 후 로그아웃이 진행된다', async ({ authenticatedPage: page, context }) => {
    await page.clock.install()
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    await mockPushApis(page)
    await mockNotificationSettings(page)
    // DELETE 응답을 영원히 미룬다(네트워크 hang 재현) — clearPushOnLogout 이 멈춰도 AuthContext.logout 의
    // 3초 타임아웃(item 5)으로 로그아웃 자체는 진행되는지 확인.
    await page.route('**/api/v1/push/subscriptions', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      await new Promise(() => {})
    })
    await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ json: {} }))

    await page.goto('/settings/notifications')
    await waitForServiceWorkerReady(page)
    await page.getByTestId('push-device-toggle').click()
    await expect(page.getByTestId('push-device-toggle')).toHaveAttribute('aria-checked', 'true')

    await page.getByRole('button', { name: '사용자 메뉴' }).click()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    // 타임아웃 타이머 등록 시점이 클릭 직후보다 늦을 수 있어 한 번에 넘기지 않고 1초씩 전진하며 확인한다.
    await expect
      .poll(
        async () => {
          await page.clock.fastForward(1000)
          return new URL(page.url()).pathname
        },
        { intervals: [100] },
      )
      .toBe('/login')
  })

  test('서버 키가 바뀐 기기는 재구독 후 재등록한다', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    // 이전 키(마지막 바이트 다름)로 이미 구독된 브라우저 시뮬레이션
    // 실사용자가 이미 허용해 둔 상태 재현(syncPushOnLogin 은 정적 프로퍼티를 읽는다 — 스텁 이유는 push-mock 참고).
    await stubNotificationPermission(page, 'granted')
    await page.addInitScript(() => {
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
    await waitForServiceWorkerReady(page)
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
    await mockNotificationSettings(page)
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
    await stubNotificationPermission(page, 'default')
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
