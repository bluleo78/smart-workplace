// 「새 소식」(WP-439) — 모바일: 계정 시트의 새 소식 줄·아바타 안 읽음 점·릴리스 노트 창.
// 노트 픽스처·실행 버전(0.9.0)은 데스크톱 spec(e2e/pages/whats-new.spec.ts)과 같다.
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('아바타 점 → 계정 시트의 새 소식(v0.9.0) → 창 → 닫으면 점이 사라진다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await expect(page.getByTestId('apps-account-avatar-dot')).toBeVisible()
  await page.getByTestId('apps-account').click()
  const row = page.getByTestId('apps-whats-new')
  await expect(row).toContainText('새 소식')
  await expect(row).toContainText('v0.9.0')
  await expect(row.getByTestId('whats-new-dot')).toBeVisible()
  // 프로필 다음 줄.
  const sheet = page.getByTestId('apps-account-sheet')
  const testIds = await sheet
    .locator('[data-testid="apps-profile"], [data-testid="apps-whats-new"], [data-testid="apps-account-theme"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(testIds).toEqual(['apps-profile', 'apps-whats-new', 'apps-account-theme'])
  await row.click()
  const dialog = page.getByTestId('whats-new-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('한글 문서를 바로 미리볼 수 있습니다')
  await expect(dialog).toContainText('버전 v0.9.0 (a5d66d0)')
  await expectNoHorizontalOverflow(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('apps-account-avatar-dot')).toHaveCount(0)
  // 창을 연 계정 시트 줄은 이미 사라졌으므로, 닫으면 포커스는 시트를 연 아바타 버튼으로 돌아온다(body 로 빠지지 않는다).
  await expect(page.getByTestId('apps-account')).toBeFocused()
})
