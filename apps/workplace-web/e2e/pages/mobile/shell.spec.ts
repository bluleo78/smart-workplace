// 모바일 셸 E2E(WP-123) — 하단 탭바 구성·활성 표시·배지·AI 탭·뷰포트 전환.
import { createUser } from '../../factories/auth.factory'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { resizeAndSettle } from '../../fixtures/wait'

// iPhone 13(390pt)은 넓은 폰 — 사용자 5칸 + AI + 앱 = 7칸(WP-877).
test('홈에서 7칸 탭바(홈·채팅·메일 | AI | 캘린더·드라이브·앱)가 보이고 레일·햄버거는 없다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  const bar = page.getByTestId('mobile-tabbar')
  await expect(bar).toBeVisible()
  const ids = await bar.locator('[data-testid^="mobile-tab-"]:not([data-testid^="mobile-tab-badge"]):not([data-testid="mobile-tab-ai-capsule"])')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(ids).toEqual([
    'mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-mail', 'mobile-tab-ai', 'mobile-tab-calendar', 'mobile-tab-drive', 'mobile-tab-apps',
  ])
  // 칸이 늘어도 누르기 최소 크기(44pt)를 지킨다.
  const boxes = await bar.locator(':scope > button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
  expect(boxes).toHaveLength(7)
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
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

test('AI 탭은 AI 시트를 열고, 다른 탭을 누르면 닫힌다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  // WP-191: AI 는 탭이 아닌 시트 — 열림은 aria-expanded, 보던 탭 강조는 유지.
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('ai-side-panel')).toHaveCount(0)
  await page.getByTestId('mobile-tab-chat').click()
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat$/)
})

test('뷰포트 전환 — 데스크톱 폭이 되면 레일, 다시 좁히면 탭바(URL 유지)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  // 1024 경계를 넘는 리사이즈 — 셸 교체가 끝난 뒤에 단언한다(WP-225).
  await resizeAndSettle(page, { width: 1280, height: 800 })
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await resizeAndSettle(page, { width: 390, height: 844 })
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expect(page).toHaveURL(/\/chat$/)
})

test('데스크톱에서 연 side 패널은 좁히면 AI 시트로, 다시 넓히면 side 로 복원된다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  // 1024 경계를 넘는 리사이즈 — 셸 교체가 끝난 뒤에 단언한다(WP-225).
  await resizeAndSettle(page, { width: 390, height: 844 })
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-expanded', 'true')
  await resizeAndSettle(page, { width: 1280, height: 800 })
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
})

// authenticatedPage 는 aiAvailable:true 고정 — /api/v1/users/me 를 나중에 등록해 덮어쓴다(page.route 는 LIFO).
test('AI 미사용이면 AI 칸 없이 6칸', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/users/me', (r) =>
    r.fulfill({ json: { ...createUser({ aiAvailable: false }), roles: [] } }))
  await stubChat(page)
  await page.goto('/')
  await expect(page.getByTestId('mobile-tab-ai')).toHaveCount(0)
  await expect(page.getByTestId('mobile-tabbar').locator('[data-testid^="mobile-tab-"]:not([data-testid^="mobile-tab-badge"]):not([data-testid="mobile-tab-ai-capsule"])')).toHaveCount(6)
})

// WP-880: AI 칸이 없는 탭바인데도 편집 화면이 「가운데 AI 와 끝의 앱은 고정」이라고 안내했다.
test('탭바 순서 편집 안내는 AI 칸 유무에 맞춘다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps/tabs')
  await expect(page.getByTestId('tab-edit-intro')).toHaveText('가운데 AI 와 끝의 앱은 고정입니다. 나머지 5칸을 고르세요.')

  await page.route((u) => u.pathname === '/api/v1/users/me', (r) =>
    r.fulfill({ json: { ...createUser({ aiAvailable: false }), roles: [] } }))
  await page.reload()
  await expect(page.getByTestId('tab-edit-intro')).toHaveText('끝의 앱은 고정입니다. 나머지 5칸을 고르세요.')
})

test('AI 버튼은 다른 탭과 같은 선상 — 탭바 위로 돌출되지 않고, AI 시트 입력창을 가리지 않는다', async ({ authenticatedPage: page }) => {
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
  // AI 시트 입력창 하단이 탭바 윗변보다 위.
  await page.getByTestId('mobile-tab-ai').click()
  const input = (await page.getByTestId('ai-sheet').getByPlaceholder(/AI 에게 요청/).boundingBox())!
  expect(input.y + input.height).toBeLessThanOrEqual(bar.y + 0.5)
  await expectNoHorizontalOverflow(page)
})

// WP-877 — 좁은 폰(SE 등 390pt 미만)은 예전처럼 5칸: 저장한 5개 중 앞 3개만 쓰고 AI 는 가운데.
test.describe('좁은 폰(375pt)', () => {
  test.use({ viewport: { width: 375, height: 667 } })

  test('탭바는 5칸(홈·채팅 | AI | 메일·앱)이고, 넓어지면 7칸이 된다', async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await page.goto('/')
    const ids = () => page.getByTestId('mobile-tabbar')
      .locator('[data-testid^="mobile-tab-"]:not([data-testid^="mobile-tab-badge"]):not([data-testid="mobile-tab-ai-capsule"])')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    await expect(page.getByTestId('mobile-tab-apps')).toBeVisible()
    expect(await ids()).toEqual(['mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-ai', 'mobile-tab-mail', 'mobile-tab-apps'])
    await expectNoHorizontalOverflow(page)
    // 같은 기기를 가로로 돌리는 등 폭이 넓어지면 바로 7칸.
    await page.setViewportSize({ width: 402, height: 874 })
    await expect(page.getByTestId('mobile-tab-drive')).toBeVisible()
    expect(await ids()).toEqual([
      'mobile-tab-home', 'mobile-tab-chat', 'mobile-tab-mail', 'mobile-tab-ai', 'mobile-tab-calendar', 'mobile-tab-drive', 'mobile-tab-apps',
    ])
  })

  test('탭 편집은 보이는 3칸만 고르고, 안 보이는 뒤 2칸은 그대로 남는다', async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await page.goto('/apps/tabs')
    await expect(page.getByText('나머지 3칸을 고르세요')).toBeVisible()
    await expect(page.getByTestId('tab-edit-slot-2')).toBeVisible()
    await expect(page.getByTestId('tab-edit-slot-3')).toHaveCount(0)
    await page.getByTestId('tab-edit-remove-2').click() // mail
    await page.getByTestId('tab-edit-add-tasks').click()
    await page.getByTestId('tab-edit-save').click()
    await expect(page).toHaveURL(/\/apps$/)
    await expect(page.getByTestId('mobile-tab-tasks')).toBeVisible()
    await expect(page.getByTestId('mobile-tab-mail')).toHaveCount(0)
    // 넓어지면 저장한 뒤 2칸(캘린더·드라이브)이 그대로 보인다.
    await page.setViewportSize({ width: 402, height: 874 })
    await expect(page.getByTestId('mobile-tab-calendar')).toBeVisible()
    await expect(page.getByTestId('mobile-tab-drive')).toBeVisible()
    await expect(page.getByTestId('mobile-tab-mail')).toHaveCount(0)
  })

  test('편집 중 화면을 돌려 칸 수가 바뀌면 그 칸 수로 다시 고를 수 있다', async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await page.goto('/apps/tabs')
    await expect(page.getByText('나머지 3칸을 고르세요')).toBeVisible()
    await page.setViewportSize({ width: 402, height: 874 })
    await expect(page.getByText('나머지 5칸을 고르세요')).toBeVisible()
    await expect(page.getByTestId('tab-edit-slot-4')).toBeVisible()
    await expect(page.getByTestId('tab-edit-full-hint')).toBeVisible()
    await page.getByTestId('tab-edit-remove-4').click() // drive
    await page.getByTestId('tab-edit-add-wiki').click()
    await page.getByTestId('tab-edit-save').click()
    await expect(page).toHaveURL(/\/apps$/)
    await expect(page.getByTestId('mobile-tab-wiki')).toBeVisible()
  })
})
