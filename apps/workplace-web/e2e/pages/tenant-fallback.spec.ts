// 쓰던 워크스페이스가 정지·삭제됐을 때의 세션 이어 가기(WP-341 후속) E2E.
// 서버 refresh 는 쓰던 테넌트를 더는 쓸 수 없으면 로그아웃 대신 로그인과 같은 규칙으로 다시 고른다:
//  - 남은 소속 1개 → 그 테넌트 토큰, 그 외 → tenant-less 토큰.
// 웹은 401 → refresh 결과 토큰의 tenant 클레임을 보관된 활성 테넌트와 비교해, 바뀌었으면 원래 요청을 재시도하지 않고
// 전체 리로드(이전 테넌트 캐시 정리) → 초기화가 새 토큰 기준으로 선택 카드(tenant-less) 또는 새 테넌트 진입을 한다.
// 전체 리로드(문서 요청)와 리로드 뒤 localStorage·세션 유지를 실제 브라우저에서 봐야 하므로 모두 @platform 이다(WP-971).
// 401 유발: 활성 테넌트가 "죽는" 순간을 흉내 내려고 스위처가 여는 GET /auth/memberships 를 한 번만 401 로 돌려준다.
import type { Page } from '@playwright/test'

import { createMembership, createTokenResponse } from '../factories/auth.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

/** 다른 워크스페이스로 이어 간 뒤 리로드 후 1회 띄우는 안내 토스트 문구. */
const SWITCHED_TOAST = '이전 워크스페이스를 더 이상 사용할 수 없어 다른 워크스페이스로 이동했습니다.'

const ACME = createMembership({ tenantId: 10, tenantName: 'Acme', tenantSlug: 'acme' })
const GLOBEX = createMembership({ tenantId: 20, tenantName: 'Globex', tenantSlug: 'globex' })
const INITECH = createMembership({ tenantId: 30, tenantName: 'Initech', tenantSlug: 'initech' })

/** 서명 없는 테스트용 JWT — 웹은 tenant 클레임만 판독하고 서명은 서버가 검증한다. tenant 를 생략하면 tenant-less. */
function fakeJwt(tenant?: number): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const payload: Record<string, unknown> = { sub: '1', username: 'testuser', type: 'access' }
  if (tenant !== undefined) payload.tenant = tenant
  return `${b64url({ alg: 'HS256' })}.${b64url(payload)}.sig`
}

/**
 * 쓰던 테넌트(Acme)로 진입한 상태를 만들고, kill() 이후 refresh 가 afterToken 을 돌려주게 한다.
 * - 활성 테넌트 Acme 를 첫 로드에만 심는다(리로드 후엔 앱이 기록한 값을 그대로 본다).
 * - refresh: kill 전엔 Acme(10) 토큰, 후엔 afterToken. 호출 횟수가 아니라 상태 변수로 분기(StrictMode 이중 호출·리로드 무관).
 * - memberships: kill 직후 첫 요청만 401(테넌트 죽음 → refresh 유발), 이후엔 remaining 목록.
 */
async function setupDyingTenant(page: Page, afterToken: string, remaining: typeof ACME[]) {
  const state = { dead: false, failNextMemberships: false }
  // 선택 카드는 로그인 페이지에서 렌더된다 — 페이지가 마운트 시 조회하는 가입·SSO 가용성을 스텁해 백엔드 누수를 막는다.
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: false })
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
  await page.addInitScript((t) => {
    if (!window.sessionStorage.getItem('e2e:seeded')) {
      window.sessionStorage.setItem('e2e:seeded', '1')
      window.localStorage.setItem('activeTenant', JSON.stringify(t))
    }
  }, ACME)
  await page.route(
    (url) => url.pathname === '/api/v1/auth/refresh',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createTokenResponse({ accessToken: state.dead ? afterToken : fakeJwt(ACME.tenantId) })),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/auth/memberships',
    (route) => {
      if (state.failNextMemberships) {
        state.failNextMemberships = false
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'unauthorized' }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(remaining) })
    },
  )
  // kill 이후 요청 기록 — 문서(리로드) 요청과 API 요청(경로·Authorization)을 순서대로 남긴다.
  // "원래 요청을 새 토큰으로 재시도하지 않는다"·"리로드 전엔 새 토큰을 설치하지 않는다" 를 단언하는 데 쓴다.
  const log: Array<{ kind: 'doc' } | { kind: 'api'; path: string; auth: string | undefined }> = []
  page.on('request', (req) => {
    if (!state.dead) return
    if (req.resourceType() === 'document') {
      log.push({ kind: 'doc' })
      return
    }
    const path = new URL(req.url()).pathname
    if (path.startsWith('/api/v1/')) log.push({ kind: 'api', path, auth: req.headers()['authorization'] })
  })
  return {
    /** 쓰던 테넌트를 죽인다 — 다음 memberships 요청이 401 → 인터셉터 refresh 가 afterToken 을 받는다. */
    kill() {
      state.dead = true
      state.failNextMemberships = true
    },
    /** kill 이후 첫 리로드(문서 요청)가 일어났는가. */
    reloaded: () => log.some((e) => e.kind === 'doc'),
    /** kill 이후 첫 리로드 전까지 나간 API 요청들. */
    apiBeforeReload: () => {
      const end = log.findIndex((e) => e.kind === 'doc')
      return (end < 0 ? log : log.slice(0, end)).filter((e) => e.kind === 'api')
    },
  }
}

/**
 * 테넌트가 바뀐 refresh 뒤 리로드 전까지의 불변식: 401 을 받은 memberships 원 요청은 한 번뿐(재시도 없음)이고,
 * 어떤 API 요청도 새 토큰(afterToken)을 싣지 않는다(새 토큰 미설치).
 */
function expectNoRetryWithNewToken(
  tenant: Awaited<ReturnType<typeof setupDyingTenant>>,
  afterToken: string,
) {
  expect(tenant.reloaded()).toBe(true)
  const before = tenant.apiBeforeReload()
  expect(before.filter((e) => e.kind === 'api' && e.path === '/api/v1/auth/memberships')).toHaveLength(1)
  expect(before.filter((e) => e.kind === 'api' && e.auth === `Bearer ${afterToken}`)).toEqual([])
}

test('다중 소속 사용자의 쓰던 워크스페이스가 사라지고 refresh 가 tenant-less 면 로그인 폼이 아니라 워크스페이스 선택 카드로 간다', { tag: '@platform' }, async ({
  authenticatedPage: page,
}) => {
  const tenant = await setupDyingTenant(page, fakeJwt(), [GLOBEX, INITECH])

  await page.goto('/')
  await expect(page.getByTestId('workspace-switcher')).toBeVisible()

  // 쓰던 Acme 삭제 → 스위처를 여는 순간의 API 가 401 → refresh 는 tenant-less 토큰.
  tenant.kill()
  await page.getByTestId('workspace-switcher').click()

  // 전체 리로드 후 초기화가 tenant-less 를 감지해 남은 워크스페이스 선택 카드를 띄운다(카드는 /login 경로에서 렌더된다).
  await expect(page.getByText('워크스페이스 선택')).toBeVisible()
  await expect(page.getByTestId('workspace-option-20')).toContainText('Globex')
  await expect(page.getByTestId('workspace-option-30')).toContainText('Initech')
  expectNoRetryWithNewToken(tenant, fakeJwt())
  // 왜 선택 화면인지 1회성 안내가 카드에 보인다.
  await expect(page.getByTestId('workspace-select-notice')).toHaveText(
    '이전 워크스페이스를 더 이상 사용할 수 없습니다. 워크스페이스를 선택하세요.',
  )
  // 죽은 워크스페이스는 보이지 않고, 로그아웃(로그인 폼)도 아니다.
  await expect(page.getByTestId('workspace-option-10')).toHaveCount(0)
  await expect(page.locator('#password')).toHaveCount(0)
  // 이전 테넌트의 활성 표시값은 지워지고 세션 플래그는 유지된다(새로고침해도 선택 카드로 돌아온다).
  expect(await page.evaluate(() => window.localStorage.getItem('activeTenant'))).toBeNull()
  expect(await page.evaluate(() => window.localStorage.getItem('hasSession'))).not.toBeNull()
})

test('쓰던 워크스페이스가 사라지고 refresh 가 남은 한 워크스페이스 토큰을 주면 그 워크스페이스로 이어 간다', { tag: '@platform' }, async ({
  authenticatedPage: page,
}) => {
  const tenant = await setupDyingTenant(page, fakeJwt(GLOBEX.tenantId), [GLOBEX])

  await page.goto('/')
  await expect(page.getByTestId('workspace-switcher')).toBeVisible()

  tenant.kill()
  await page.getByTestId('workspace-switcher').click()

  // 리로드 후 활성 테넌트가 Globex 로 바뀌고 앱 셸에 그대로 진입한다(선택 카드·로그인 폼 없음).
  // 리로드 중엔 실행 컨텍스트가 사라져 evaluate 가 던진다 — 그동안은 "아직" 으로 보고 다시 폴링한다.
  await expect
    .poll(async () =>
      page
        .evaluate(() => JSON.parse(window.localStorage.getItem('activeTenant') ?? 'null')?.tenantId)
        .catch(() => undefined),
    )
    .toBe(GLOBEX.tenantId)
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByText('워크스페이스 선택')).toHaveCount(0)
  await expect(page.locator('#password')).toHaveCount(0)
  expectNoRetryWithNewToken(tenant, fakeJwt(GLOBEX.tenantId))
  // 조용히 바뀌지 않도록 리로드 후 한 번 안내 토스트를 띄운다.
  await expect(page.getByText(SWITCHED_TOAST)).toBeVisible()
})

test('다중 탭: 다른 탭이 이미 보관값을 새 워크스페이스로 바꿔 놨어도 이 탭은 메모리 토큰 기준으로 바뀜을 알아채 리로드한다', { tag: '@platform' }, async ({
  authenticatedPage: page,
}) => {
  const tenant = await setupDyingTenant(page, fakeJwt(GLOBEX.tenantId), [GLOBEX])

  await page.goto('/')
  await expect(page.getByTestId('workspace-switcher')).toBeVisible()

  // 다른 탭이 먼저 refresh → 리로드해 공유 localStorage 활성 테넌트를 Globex 로 기록한 상태. 이 탭의 메모리 토큰은 아직 Acme(10).
  tenant.kill()
  await page.evaluate((m) => window.localStorage.setItem('activeTenant', JSON.stringify(m)), GLOBEX)
  await page.getByTestId('workspace-switcher').click()

  // 보관값(Globex) = 새 토큰(Globex) 이어도 이 탭은 Acme 화면이었으므로 재시도 없이 리로드해 Globex 로 새로 진입한다.
  await expect.poll(() => tenant.reloaded()).toBe(true)
  await expect(page.getByTestId('app-rail')).toBeVisible()
  expectNoRetryWithNewToken(tenant, fakeJwt(GLOBEX.tenantId))
  await expect(page.getByText(SWITCHED_TOAST)).toBeVisible()
})

test('남은 워크스페이스가 없으면 refresh 쿠키를 폐기(logout)하고 로그인 폼에 무소속 안내를 띄운다', { tag: '@platform' }, async ({
  authenticatedPage: page,
}) => {
  const tenant = await setupDyingTenant(page, fakeJwt(), [])
  const logout = await mockApi(page, 'POST', '/api/v1/auth/logout', {}, { capture: true })

  await page.goto('/')
  await expect(page.getByTestId('workspace-switcher')).toBeVisible()

  tenant.kill()
  await page.getByTestId('workspace-switcher').click()

  // 리로드 후 tenant-less + 0개 → 서버 logout 으로 쿠키 폐기 → 로그인 폼 + 안내.
  await logout.waitForRequest()
  await expect(page.locator('#password')).toBeVisible()
  await expect(page.getByText('접속 가능한 워크스페이스가 없습니다. 관리자에게 문의하세요.')).toBeVisible()
  await expect(page.getByText('워크스페이스 선택')).toHaveCount(0)
  expect(await page.evaluate(() => window.localStorage.getItem('hasSession'))).toBeNull()
})

test('새 토큰의 워크스페이스가 선택 가능 목록에 없으면 활성 표시 없이 진입하지 않고 선택 카드로 보낸다', { tag: '@platform' }, async ({
  authenticatedPage: page,
}) => {
  // 토큰은 40 을 가리키지만 목록에는 없다(경합 등) — tenant-scoped 토큰으로 이름 없는 진입 대신 선택으로.
  const tenant = await setupDyingTenant(page, fakeJwt(40), [GLOBEX, INITECH])

  await page.goto('/')
  await expect(page.getByTestId('workspace-switcher')).toBeVisible()

  tenant.kill()
  await page.getByTestId('workspace-switcher').click()

  await expect(page.getByText('워크스페이스 선택')).toBeVisible()
  await expect(page.getByTestId('workspace-option-20')).toBeVisible()
  await expect(page.getByTestId('workspace-option-30')).toBeVisible()
  await expect(page.getByTestId('app-rail')).toHaveCount(0)
})
