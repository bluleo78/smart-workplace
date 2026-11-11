// 휴대폰 도움말 시트(WP-1505) — 탭 첫 화면 헤더 「?」로 여는 전체 화면 시트의 브라우저 판정.
// 열림·닫힘 상태 분기, 한 번에 하나 규칙, 「✦ AI에게 묻기」로 AI 시트로 넘긴 뒤의 뒤로 가기는
// MobileHelpSheet.test.tsx(jsdom 세션 히스토리)가 지킨다. 여기엔 jsdom 이 잴 수 없는 것만 둔다(@layout):
// 시트가 보이는 뷰포트를 다 덮고(탭바·헤더 위) 가로로 넘치지 않는지, 그리고 실제 브라우저에서 뒤로 가기가 시트만 걷어 주소·화면이 그대로인지.
import { expect, expectNoHorizontalOverflow, expectOnTop, test } from '../../fixtures/mobile.fixture'
import { mockHelpBundle } from '../../fixtures/help-bundle-mock'
import { measureBox } from '../../fixtures/wait'

test('「?」로 연 도움말 시트는 화면을 다 덮고 넘치지 않으며, 뒤로 가기로 닫힌다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockHelpBundle(page)
  await page.goto('/')
  await page.getByTestId('mobile-help-button').tap()
  const sheet = page.getByTestId('help-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('help-panel-body')).toBeVisible()

  const viewport = page.viewportSize()!
  await expect(async () => {
    const box = await measureBox(sheet, 'help-sheet')
    expect(box.x).toBe(0)
    expect(box.y).toBe(0)
    expect(Math.round(box.width)).toBe(viewport.width)
    expect(Math.round(box.height)).toBe(viewport.height)
  }).toPass()
  // 탭바 자리에서도 맨 위는 시트다 — 탭바가 시트를 뚫고 보이지 않는다.
  await expectOnTop(page, page.getByTestId('mobile-tabbar'), '[data-testid="help-sheet"]')
  await expectNoHorizontalOverflow(page)

  await page.goBack()
  await expect(sheet).toBeHidden()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('mobile-help-button')).toBeVisible()
})
