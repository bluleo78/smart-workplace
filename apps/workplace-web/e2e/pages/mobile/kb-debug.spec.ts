// [임시 진단용 — WP-154] 키보드 디버그 오버레이 — ?kbdebug=1 로 켜면 저장소에 기억돼 파라미터 없이도 보이고, ?kbdebug=0 으로 끈다.
import { expect, test } from '../../fixtures/mobile.fixture'

test('?kbdebug=1 로 켜면 뷰포트 값이 보이고, 새로고침 후에도 유지되며 ?kbdebug=0 으로 꺼진다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expect(page.getByTestId('kb-debug-overlay')).toHaveCount(0)

  await page.goto('/?kbdebug=1')
  const overlay = page.getByTestId('kb-debug-overlay')
  await expect(overlay).toContainText('innerH')
  await expect(overlay).toContainText('vvH')
  await expect(overlay).toContainText('kb=false')

  // 파라미터 없이 다시 열어도 저장소 플래그로 유지된다.
  await page.goto('/')
  await expect(overlay).toBeVisible()

  await page.goto('/?kbdebug=0')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expect(overlay).toHaveCount(0)
})

test('편집 요소에 포커스하면 그 동안의 뷰포트 값을 기록해, 포커스가 빠진 뒤에도 상자에 남긴다', async ({ authenticatedPage: page }) => {
  await page.goto('/?kbdebug=1')
  const overlay = page.getByTestId('kb-debug-overlay')
  await expect(overlay).toBeVisible()
  await expect(overlay).not.toContainText('마지막 입력 포커스 기록')
  // 임의 입력칸으로 포커스 → 해제 — 기록 구간의 시작(focusin)·끝(focusout)이 남아야 한다.
  await page.evaluate(() => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
  })
  await expect(overlay).toContainText('focusin')
  await expect(overlay).toContainText('t300')
  await page.evaluate(() => (document.activeElement as HTMLElement).blur())
  await expect(overlay).toContainText('focusout')
  await expect(overlay).toContainText('마지막 입력 포커스 기록')
})
