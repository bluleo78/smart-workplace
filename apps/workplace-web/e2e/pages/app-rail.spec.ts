import { expect, test } from '../fixtures/auth.fixture'

test('홈에 앱 레일이 보이고 상단 GNB는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('module-sidebar')).toHaveCount(0)
})

test('데스크톱에서 앱 레일은 아이콘 전용이다(앱 마크 표시·워드마크 숨김)', async ({
  authenticatedPage: page,
}) => {
  // 기본 뷰포트(1280)는 lg 브레이크포인트 → 아이콘 레일.
  await page.goto('/')
  // 앱 마크(→홈)는 항상 보인다.
  await expect(page.getByTestId('rail-home')).toBeVisible()
  // 워드마크 "Smart Workplace" 는 lg 에서 숨김(아이콘 전용 정체성).
  await expect(page.getByTestId('app-rail').getByText('Smart Workplace')).toBeHidden()
})

// LNB 표준화(#98) — 레일 라벨 한글화(대화·드라이브) + 소통 묶음 순서.
test('앱 레일 — 한글 라벨과 소통 묶음 순서(홈·작업·대화·메일·연락처·드라이브)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 영문 라벨(Chat/Drive) 제거 — 레일 항목 텍스트가 한글이다.
  await expect(page.getByTestId('rail-link-/chat')).toContainText('대화')
  await expect(page.getByTestId('rail-link-/drive')).toContainText('드라이브')
  // 순서: 홈 · 작업 관리 · 대화 · 메일 · 연락처 · 드라이브 (소통 앱 인접, 드라이브는 끝)
  const order = await page
    .locator('[data-testid^="rail-link-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(order).toEqual([
    'rail-link-/',
    'rail-link-/projects',
    'rail-link-/chat',
    'rail-link-/mail',
    'rail-link-/contacts',
    'rail-link-/drive',
  ])
})
