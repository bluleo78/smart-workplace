import { expect, setupPlatformAuthMocks, test } from '../fixtures/platform-auth.fixture'

test.describe('운영자 콘솔 레이아웃', () => {
  test('하단 프로필 메뉴에서 로그아웃할 수 있다', async ({ page }) => {
    await setupPlatformAuthMocks(page)
    await page.addInitScript(() => window.localStorage.setItem('hasSession', '1'))
    await page.goto('/')
    // 사이드바 하단 프로필 트리거
    await page.getByTestId('admin-user-menu').click()
    // 드롭다운에 테마 전환 + 로그아웃 항목
    await expect(page.getByRole('menuitem', { name: '테마 전환' })).toBeVisible()
    await page.getByRole('menuitem', { name: '로그아웃' }).click()
    await expect(page).toHaveURL(/\/login$/)
  })

  test('좌측 LNB에 운영 메뉴가 보이고 준비중 스텁으로 이동한다', async ({ page }) => {
    await setupPlatformAuthMocks(page)
    await page.addInitScript(() => window.localStorage.setItem('hasSession', '1'))
    await page.goto('/')
    await expect(page.getByTestId('admin-nav-테넌트')).toBeVisible()
    await expect(page.getByTestId('admin-nav-대시보드')).toBeVisible()
    await expect(page.getByTestId('admin-nav-운영자')).toBeVisible()
    await expect(page.getByTestId('admin-nav-감사 로그')).toBeVisible()
    await expect(page.getByTestId('admin-nav-설정')).toBeVisible()
    await page.getByTestId('admin-nav-감사 로그').click()
    await expect(page).toHaveURL(/\/audit$/)
    await expect(page.getByTestId('coming-soon')).toBeVisible()
  })
})
