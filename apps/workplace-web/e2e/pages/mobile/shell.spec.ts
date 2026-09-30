// 모바일 셸 E2E(WP-123) — 하단 탭바 구성·활성 표시·배지·AI 탭·뷰포트 전환.
import { createUser } from '../../factories/auth.factory'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

test('홈에서 5칸 탭바(홈·채팅 | AI | 메일·더보기)가 보이고 레일·햄버거는 없다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  const bar = page.getByTestId('mobile-tabbar')
  await expect(bar).toBeVisible()
  const ids = await bar.locator('[data-testid^="mobile-tab-"]:not([data-testid^="mobile-tab-badge"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(ids).toEqual(['mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-ai', 'mobile-tab-mail', 'mobile-tab-more'])
  await expect(page.getByTestId('mobile-tab-home')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('app-rail')).toHaveCount(0)
  await expect(page.getByTestId('rail-mobile-toggle')).toHaveCount(0)
  await expect(page.getByTestId('chat-launcher')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('채팅 탭 이동 + 미읽음 배지', async ({ authenticatedPage: page }) => {
  await stubChat(page, { unread: 3 })
  await page.goto('/')
  await expect(page.getByTestId('mobile-tab-badge-chat')).toHaveText('3')
  await page.getByTestId('mobile-tab-chat').click()
  await expect(page).toHaveURL(/\/chat$/)
  await expect(page.getByTestId('mobile-tab-chat')).toHaveAttribute('aria-current', 'page')
})

test('AI 탭은 풀스크린 대화를 열고, 다른 탭을 누르면 닫힌다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  await page.getByTestId('mobile-tab-chat').click()
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat$/)
})

test('뷰포트 전환 — 데스크톱 폭이 되면 레일, 다시 좁히면 탭바(URL 유지)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expect(page).toHaveURL(/\/chat$/)
})

test('데스크톱에서 연 side 패널은 좁히면 풀스크린으로, 다시 넓히면 side 로 복원된다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-current', 'page')
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
})

// authenticatedPage 는 aiAvailable:true 고정 — /api/v1/users/me 를 나중에 등록해 덮어쓴다(page.route 는 LIFO).
test('AI 미사용이면 AI 칸 없이 4칸', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/users/me', (r) =>
    r.fulfill({ json: { ...createUser({ aiAvailable: false }), roles: [] } }))
  await stubChat(page)
  await page.goto('/')
  await expect(page.getByTestId('mobile-tab-ai')).toHaveCount(0)
  await expect(page.getByTestId('mobile-tabbar').locator('[data-testid^="mobile-tab-"]:not([data-testid^="mobile-tab-badge"])')).toHaveCount(4)
})

test('AI 버튼은 다른 탭과 같은 선상 — 탭바 위로 돌출되지 않고, AI 풀스크린 입력창을 가리지 않는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  const bar = (await page.getByTestId('mobile-tabbar').boundingBox())!
  const capsule = (await page.getByTestId('mobile-tab-ai').locator('span').first().boundingBox())!
  // 돌출 금지: 캡슐이 탭바 윗변 안쪽에 있어야 본문 하단(목록 끝 등)을 가리지 않는다.
  expect(capsule.y).toBeGreaterThanOrEqual(bar.y)
  // 같은 선상: AI 칸 라벨과 홈 칸 라벨의 세로 위치가 같다(±1px).
  const labelBottom = (id: string) =>
    page.getByTestId(id).evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el.lastChild as Node)
      return r.getBoundingClientRect().bottom
    })
  expect(Math.abs((await labelBottom('mobile-tab-ai')) - (await labelBottom('mobile-tab-home')))).toBeLessThanOrEqual(1)
  // AI 풀스크린 입력창 하단이 탭바 윗변보다 위.
  await page.getByTestId('mobile-tab-ai').click()
  const input = (await page.getByTestId('ai-fullscreen').getByPlaceholder(/AI 에게 요청/).boundingBox())!
  expect(input.y + input.height).toBeLessThanOrEqual(bar.y + 0.5)
  await expectNoHorizontalOverflow(page)
})
