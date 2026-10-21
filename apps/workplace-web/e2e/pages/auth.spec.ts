import { expect, test } from '../fixtures/auth.fixture'
import { createLoginResponse, createUser } from '../factories/auth.factory'
import { createProject } from '../factories/project.factory'
import { createPageResponse, mockApi } from '../fixtures/api-mock'

// 로그인 페이지 자체 진입 (인증 불필요)
test('로그인 페이지가 보인다', { tag: '@smoke' }, async ({ page }) => {
  // #495 — 로그인 페이지가 마운트 시 가입 가용성을 조회하므로 기본 스텁(가용)으로 백엔드 누수 방지.
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
  // WP-48 — 로그인 페이지가 마운트 시 SSO 가용성(/auth/sso/status)도 조회한다. 미스텁 시 로컬 백엔드로 누수돼 401 → refresh 실패 → /login 강제 이동으로 테스트가 깨진다.
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
  await page.goto('/login')
  await expect(page.getByText('Gen:iA Works')).toBeVisible()
  await expect(page.getByRole('button', { name: /로그인/ })).toBeVisible()
})

// 인증된 상태로 진입 시 홈이 보인다 (HomePage)
test('인증 상태에서 홈에 진입한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  // 셸 전환 — 좌측 앱 레일(LNB)이 보이면 인증 셸 진입 성공.
  await expect(page.getByTestId('app-rail')).toBeVisible()
  // 홈은 사이드바 대신 상단 헤더가 모듈 타이틀("홈")을 타 모듈과 동일하게 보여준다(#505).
  await expect(page.getByTestId('canvas-header').getByText('홈')).toBeVisible()
})

// 헤더 사용자 메뉴에서 로그아웃 — 서버 호출 + 로그인 페이지 이동
test('헤더 메뉴에서 로그아웃하면 로그인 페이지로 이동한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const logoutCapture = await mockApi(page, 'POST', '/api/v1/auth/logout', {}, { capture: true })

  await page.goto('/')
  // 셸 전환 — 사용자 메뉴는 앱 레일 하단으로 이동(AppRailUserMenu).
  await expect(page.getByTestId('app-rail')).toBeVisible()

  await page.getByRole('button', { name: '사용자 메뉴' }).click()
  await page.getByRole('menuitem', { name: '로그아웃' }).click()

  // 서버 logout 호출 + /login 이동
  await logoutCapture.waitForRequest()
  await expect(page).toHaveURL(/\/login$/)
})

// WP-699 — 저장하지 않은 이슈 본문 초안은 로그아웃하면 지워져 같은 기기의 다음 사용자에게 남지 않는다(다른 저장값은 둔다).
test('로그아웃하면 이슈 본문 초안이 지워진다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'POST', '/api/v1/auth/logout', {})
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem('issue-body-draft:1:-:WP:1', '저장 안 한 글')
    localStorage.setItem('issue-body-draft:WP:2', '예전 키 초안')
  })

  await page.getByRole('button', { name: '사용자 메뉴' }).click()
  await page.getByRole('menuitem', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/login$/)

  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('issue-body-draft:'))))
    .toEqual([])
})

// ADMIN 권한이면 사용자 관리 페이지 진입 가능
test('관리자 권한으로 사용자 관리 페이지에 진입한다', { tag: '@smoke' }, async ({ adminPage: page }) => {
  // 페이지가 호출하는 사용자 목록 API 를 빈 배열로 모킹
  await page.route('**/api/v1/users**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.goto('/settings/users')
  // 페이지 자체가 렌더 (NotFound 가 아님) 만 확인 — 실제 표 내용은 폴리싱 후
  await expect(page).toHaveURL(/\/settings\/users/)
})

// WP-700 — 로그아웃 뒤 같은 탭(새로고침 없음)에서 다른 사람이 로그인하면, 앞 사용자가 본 화면 데이터(멤버가 아닌 프로젝트 등)가
// 캐시 유지 시간 동안 그대로 그려졌다. 로그아웃·로그인 때 화면 데이터 캐시를 비워 뒤 사용자는 자기 데이터만 본다.
test('로그아웃 후 다른 사람이 로그인하면 앞 사용자의 프로젝트 목록이 보이지 않는다', async ({ authenticatedPage: page }) => {
  let who: 'admin' | 'bob' = 'admin'
  const hr = createProject({ id: 11, key: 'HR', name: '관리자전용 인사평가' })
  const bobs = createProject({ id: 12, key: 'BOB', name: '밥의 개인 작업', type: 'PERSONAL' })
  await page.route(
    (url) => url.pathname === '/api/v1/projects',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: createPageResponse(who === 'admin' ? [hr] : [bobs]) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/users/me',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            json: {
              ...createUser(who === 'admin' ? { id: 1, name: '관리자' } : { id: 2, username: 'bob', name: '밥' }),
              roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }],
            },
          })
        : route.fallback(),
  )
  await mockApi(page, 'POST', '/api/v1/auth/logout', {})
  await mockApi(page, 'POST', '/api/v1/auth/login', createLoginResponse())
  await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
  await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })

  await page.goto('/projects')
  await expect(page.getByText('관리자전용 인사평가').first()).toBeVisible()

  await page.getByRole('button', { name: '사용자 메뉴' }).click()
  await page.getByRole('menuitem', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/login$/)

  who = 'bob'
  await page.getByLabel('아이디').fill('bob')
  await page.locator('#password').fill('Password123')
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page.getByTestId('app-rail')).toBeVisible()
  // 새로고침 없이(SPA) 작업 관리로 — 캐시가 남아 있으면 앞 사용자의 목록이 그려진다.
  await page.getByTestId('app-rail').locator('a[href="/projects"]').click()
  await expect(page.getByText('밥의 개인 작업').first()).toBeVisible()
  await expect(page.getByText('관리자전용 인사평가')).toHaveCount(0)
})

