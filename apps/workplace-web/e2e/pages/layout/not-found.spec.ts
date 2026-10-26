// e2e/pages/layout/not-found.spec.ts
// 없는 주소의 404 화면(WP-872) — SW 관리 밖(서버의 최신 앱)이면 바로 404, SW 관리를 받으면 서버 버전을 확인한 뒤 404.
// 새 SW 적용으로 같은 주소를 다시 여는 경로는 E2E 에서 새 배포를 만들 수 없어 outdatedApp.test.ts 와 라이브 검증으로 확인한다.
import { expect, test } from '../../fixtures/auth.fixture'
import { openSwControlled } from '../../fixtures/push-mock'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

test('없는 주소는 새 버전 확인 없이 404 를 보이고 홈으로 갈 수 있다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  const versionChecks = trackRequests(page, 'GET', '/version.json')

  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  await expect(page.getByText('페이지를 찾을 수 없습니다')).toBeVisible()
  await expectStays(page, versionChecks.count, 0)
  // WP-924: 앱 셸 안에서 그린다 — 레일(다른 메뉴)·main 구역이 함께 있고 탭 제목도 없는 화면임을 알린다.
  await expect(page.getByRole('main').getByRole('heading', { name: '404' })).toBeVisible()
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page).toHaveTitle(/^페이지를 찾을 수 없음 · /)

  await page.getByRole('button', { name: '홈으로 가기' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test.describe('SW 관리를 받는 앱', { tag: '@platform' }, () => {
  test.use({ serviceWorkers: 'allow' })
  test.skip(process.env.E2E_SERVER !== 'preview', '네비게이션을 앱 셸로 여는 SW 는 운영 빌드(preview)에서만 동작한다')

  test('서버 버전이 다르면 새 버전을 확인하고, 적용할 새 SW 가 없으면 404 를 보인다', async ({ authenticatedPage: page }) => {
    // 서버에 다른 버전이 배포된 것처럼 — 실제 sw.js 는 그대로라 대기 중인 새 SW 는 생기지 않는다.
    await page.route('**/version.json', (route) => route.fulfill({ json: { version: '9.9.9-e2e', commit: 'e2e' } }))
    const versionChecks = trackRequests(page, 'GET', '/version.json')
    await openSwControlled(page, '/')

    // 표식을 남기고 앱 안 이동으로 없는 주소에 들어간다 — 새로고침되면 표식이 사라진다.
    type Marked = { __beforeNotFound?: boolean }
    await page.evaluate(() => {
      ;(window as Marked).__beforeNotFound = true
      history.pushState({}, '', '/no-such-page')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByText('페이지를 찾을 수 없습니다')).toBeVisible()
    expect(versionChecks.count()).toBe(1)
    expect(await page.evaluate(() => (window as Marked).__beforeNotFound)).toBe(true)
  })
})
