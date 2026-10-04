// e2e/pages/pwa/pwa-shell.spec.ts
// PWA 셸 — manifest 노출과 서비스워커 등록 확인(E2E=1 dev 서버에서 dev SW 활성).
import { expect, test } from '../../fixtures/auth.fixture'

test.use({ serviceWorkers: 'allow' })

test.describe('PWA 셸', () => {
  test('manifest 가 연결되고 앱 정보가 올바르다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.goto('/')
    const manifestLink = page.locator('link[rel="manifest"]')
    // 링크 주입을 기다린 뒤 값을 읽는다 (WP-225)
    await expect(manifestLink).toHaveAttribute('href', /.+/)
    const href = (await manifestLink.getAttribute('href'))!
    const res = await page.request.get(href)
    expect(res.ok()).toBeTruthy()
    const manifest = await res.json()
    expect(manifest.name).toBe('Gen:iA Works')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBeTruthy()
  })

  test('서비스워커가 등록되어 활성화된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.goto('/')
    const active = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return !!reg.active
    })
    expect(active).toBe(true)
  })

  test('iOS 홈 화면 메타가 있다', async ({ authenticatedPage: page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon-180x180.png')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#4338ca')
  })
})
