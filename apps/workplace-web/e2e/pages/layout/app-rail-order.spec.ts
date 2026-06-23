import { expect, test } from '../../fixtures/auth.fixture'

test('앱 레일 순서: 홈→대화→메일→연락처→캘린더→작업관리→드라이브→노트→설정', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  // 레일이 DOM 에 마운트될 때까지 대기
  await expect(page.getByTestId('rail-link-/')).toBeAttached()
  const links = page.locator('[data-testid="app-rail"] [data-testid^="rail-link-"]')
  const hrefs = await links.evaluateAll(els => els.map(e => e.getAttribute('data-testid')))
  expect(hrefs).toEqual([
    'rail-link-/',
    'rail-link-/chat',
    'rail-link-/mail',
    'rail-link-/contacts',
    'rail-link-/calendar',
    'rail-link-/projects',
    'rail-link-/drive',
    'rail-link-/wiki',
    'rail-link-/settings/profile',
  ])
})
