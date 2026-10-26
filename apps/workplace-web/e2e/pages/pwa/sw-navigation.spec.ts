// e2e/pages/pwa/sw-navigation.spec.ts
// 서비스워커 네비게이션 가로채기(WP-867) — 앱 화면은 precache 앱 셸로, 노트 공유 링크는 서버에서 최신 앱으로 여는지.
// 네비게이션 라우트는 운영 빌드에서만 등록되므로(sw.ts) preview 서버(E2E_SERVER=preview)에서만 돈다.
import { expect, test } from '../../fixtures/auth.fixture'
import { openSwControlled } from '../../fixtures/push-mock'

test.use({ serviceWorkers: 'allow' })

test.describe('서비스워커 네비게이션', { tag: '@platform' }, () => {
  test.skip(process.env.E2E_SERVER !== 'preview', '네비게이션 라우트는 운영 빌드(preview)에서만 등록된다')

  test('노트 공유 링크는 SW 앱 셸이 아니라 서버에서 받는다', async ({ authenticatedPage: page }) => {
    // 여기선 문서 응답 출처만 본다 — 열린 노트·공유 화면의 API 는 실제 백엔드로 새지 않게 없음(404)으로 끊는다.
    await page.route('**/api/v1/wiki/**', (route) => route.fulfill({ status: 404, json: { status: 404, message: '없음' } }))
    await openSwControlled(page, '/')

    // 대조군 — 일반 앱 화면은 SW 가 precache 앱 셸로 응답한다.
    const appNav = await page.goto('/wiki/spaces/3/pages/12')
    expect(appNav?.fromServiceWorker()).toBe(true)

    for (const path of ['/wiki/share/wsh_token', '/wiki/share/wsh_token/pages/12']) {
      const shareNav = await page.goto(path)
      expect(shareNav?.fromServiceWorker(), path).toBe(false)
      expect(shareNav?.ok(), path).toBe(true)
    }
  })
})
