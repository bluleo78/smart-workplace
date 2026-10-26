// 데스크톱 앱 레일 E2E — 브라우저가 있어야 판정되는 것만 남긴다: 실제 기하·계산된 스타일(@layout), 키보드·호버(@input),
// 새로고침 뒤 유지(@platform), 홈 진입 배선(@wiring).
// 항목 순서·링크 이름(aria-label)·펼치기/접기 토글·헤더 구성·안 읽음 배지 수와 이름은
// 화면 컴포넌트 테스트 src/components/layout/appRail.test.tsx 가 지킨다(WP-971).
import { createMembership } from '../factories/auth.factory'
import { createChannel, createDm } from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'
import { expectTheme, tokenColor, withTheme } from '../fixtures/contrast'
import { stubChat } from '../fixtures/mobile.fixture'
import { selectionBarStyle } from '../fixtures/selection'

test('홈에 앱 레일이 보이고 상단 GNB는 없다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('module-sidebar')).toHaveCount(0)
})

test('데스크톱에서 앱 레일은 축소 시 아이콘 전용이다(워드마크 숨김, 홈은 모듈 링크로 접근)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 활성 테넌트 없는 기본 fixture — 워크스페이스 스위처 미렌더.
  await expect(page.getByTestId('workspace-switcher')).toHaveCount(0)
  // 홈은 모듈 런처의 '홈' 링크로 접근(헤더 마크는 토글 전용).
  await expect(page.getByTestId('rail-link-/')).toBeVisible()
  // 축소 상태 — 브랜드 워드마크("Works")는 시각적으로 숨김(lg:hidden).
  await expect(page.getByTestId('app-rail').getByText('Works', { exact: true })).toBeHidden()
})

// WP-815: 「본문 바로가기」 — 첫 Tab 에 보이고, 누르면 레일을 건너뛰어 본문(<main>)으로 포커스가 간다. 평소엔 보이지 않는다.
test('첫 Tab 은 「본문 바로가기」이고 Enter 로 본문으로 건너뛴다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  const skip = page.getByTestId('skip-to-main')
  await expect(skip).not.toBeInViewport()

  await page.keyboard.press('Tab')
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await expect(skip).toHaveText('본문 바로가기')

  await page.keyboard.press('Enter')
  await expect(page.locator('main#main-content')).toBeFocused()
  await expect(page).toHaveURL(/\/$/) // 주소에 #main-content 가 붙지 않는다
})

// 브랜드 케이싱 회귀 가드 — 워드마크 첫 줄은 "Gen:iA" 그대로여야 한다.
// uppercase 계열 클래스가 다시 붙으면 DOM 텍스트는 그대로라 렌더만 "GEN:IA"로 깨지므로,
// 실제 계산된 text-transform 까지 함께 단언한다.
test('앱 레일 — 브랜드 워드마크가 Gen:iA 케이싱을 유지한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const kicker = page.getByTestId('app-rail').getByText('Gen:iA', { exact: true })
  await expect(kicker).toHaveCount(1)
  await expect(kicker).toHaveCSS('text-transform', 'none')
})

// WP-368 — 활성 레일 항목의 막대는 공용 selection-bar 가 그리고, nav-active-indicator 가 CSS 변수(위아래 25% 인셋·다크 그라데이션·glow)만
// 바꾼다. 변수 정리 전과 같은 모양인지 계산된 ::before 스타일로 고정한다.
for (const scheme of ['light', 'dark'] as const) {
  test(`앱 레일 — 활성 항목 막대 모양이 유지된다 (${scheme}, WP-368)`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await withTheme(page, scheme)
    await page.goto('/')
    await expectTheme(page, scheme)
    const active = page.getByTestId('app-rail').locator('a[aria-current="page"]')
    await expect(active).toHaveCount(1)
    await expect(active).toHaveClass(/selection-bar/)
    await expect(active).toHaveClass(/nav-active-indicator/)
    const bar = await selectionBarStyle(active)
    expect(bar.hostPosition).toBe('relative')
    expect(bar.position).toBe('absolute')
    expect(bar.left).toBe('0px')
    expect(bar.width).toBe('3px')
    expect(bar.radius).toBe('0px 3px 3px 0px')
    // 위아래 25% 인셋(selection-bar 기본 22% 가 아니다).
    expect(bar.top).toBeCloseTo(bar.hostHeight * 0.25, 0)
    expect(bar.bottom).toBeCloseTo(bar.hostHeight * 0.25, 0)
    if (scheme === 'dark') {
      expect(bar.backgroundImage).toContain('linear-gradient')
      expect(bar.boxShadow).not.toBe('none')
    } else {
      expect(bar.backgroundImage).toBe('none')
      expect(bar.boxShadow).toBe('none')
      expect(bar.backgroundColor).toBe(await tokenColor(page, '--primary'))
    }
  })
}

// #316 — 하단 알림·유저 아이콘 hover 툴팁 미제공. shadcn Tooltip 을 InboxPanel·AppRailUserMenu
// trigger 에 추가하여 nav 링크와 동일한 패턴으로 맞춤.
test('앱 레일 하단 — 알림 아이콘 hover 시 툴팁 "알림" 표시 (#316)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  const trigger = page.getByTestId('inbox-trigger')
  await trigger.hover()
  // shadcn Tooltip 은 기본 200ms 딜레이 후 role="tooltip" 로 노출.
  await expect(page.getByRole('tooltip', { name: '알림' })).toBeVisible()
})

test('앱 레일 하단 — 유저 아이콘 hover 시 툴팁 "내 계정" 표시 (#316)', { tag: '@input' }, async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  const trigger = page.getByTestId('rail-user-menu')
  await trigger.hover()
  await expect(page.getByRole('tooltip', { name: '내 계정' })).toBeVisible()
})

test('앱 레일 하단 — 내 아바타는 다른 사람 아바타와 같은 사람 색 토큰 + 이니셜이다 (WP-318)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 기본 로그인 사용자 id=1 → presenceColorIndex 2. 예전 bg-primary/10 아이콘 원 대신 --presence-2 바탕 + --presence-foreground 이니셜.
  const avatar = page.getByTestId('rail-user-avatar')
  await expect(avatar).toHaveClass(/bg-presence/)
  await expect(avatar).toHaveText('테')
  await expect(avatar).toHaveCSS('background-color', await tokenColor(page, '--presence-2'))
})

// #120 — 데스크톱(lg) 레일에서 라벨 span 이 lg:hidden 이라 모듈 링크 9개의 accessible name 이
// 비어 있던 a11y 결함(WCAG 4.1.2). CSS 로 숨은 글자가 이름에서 빠지는지는 실제 브라우저의 접근성 트리에서만 판정된다(@layout).
test('앱 레일 — 데스크톱 모듈 링크 9개가 접근 가능한 이름(역할 link + 이름)을 갖는다 (#120)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  // 기본 뷰포트(1280)는 lg → 라벨 span 이 숨겨지는, 버그가 발생하던 바로 그 조건.
  await page.goto('/')
  // 레일의 <nav> 로 스코프 — 헤더의 홈 마크(aria-label="홈")와 이름 충돌을 피한다.
  const nav = page.getByTestId('app-rail').locator('nav')
  const labels = ['홈', '작업 관리', '대화', '메일', '연락처', '캘린더', '드라이브', '노트', '설정']
  for (const name of labels) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
  }
  // 레일 nav 안의 link 역할 요소는 정확히 9개(모듈 링크) — 이름 없는 link 가 없음을 보장.
  await expect(nav.getByRole('link')).toHaveCount(9)
})

test('앱 레일 — 확장 상태가 새로고침 후에도 유지된다(localStorage) (#471)', { tag: '@platform' }, async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  await page.getByTestId('rail-toggle').click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('app-rail-expanded'))).toBe('true')
  await page.reload()
  await expect(page.getByTestId('rail-collapse')).toBeVisible()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeVisible()
})

// WP-198 — 확장 레일(152px)에서 조직명이 80px 1줄 말줄임으로 대부분 잘리던 결함.
// 확장 시 음절 단위 최대 2줄로 감싸 노출하고, 넘치면 2줄 끝 말줄임 + hover 툴팁으로 전체 이름.
test('앱 레일 — 확장 시 긴 조직명은 최대 2줄로 감싸고 가로로 넘치지 않으며 툴팁으로 전체 이름을 보인다 (WP-198)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  const longName = '(주)아이에이클라우드 코리아 기술연구소'
  await page.addInitScript((t) => {
    window.localStorage.setItem('activeTenant', JSON.stringify(t))
    window.localStorage.setItem('app-rail-expanded', 'true')
  }, createMembership({ tenantName: longName }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const chip = page.getByTestId('workspace-switcher')
  const name = chip.getByText(longName, { exact: true })
  await expect(name).toBeVisible()
  // 펼침 전환(200ms)이 끝난 뒤 측정 — 줄 수는 높이/줄높이로 계산한다.
  await expect
    .poll(() =>
      name.evaluate((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight)
        return Math.round(el.getBoundingClientRect().height / lh)
      }),
    )
    .toBe(2)
  // 칩·레일 모두 가로 넘침 없음.
  expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(
    await page.getByTestId('app-rail').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)

  // 확장 상태에서도 hover 시 전체 이름 툴팁.
  await chip.hover()
  await expect(page.getByRole('tooltip', { name: longName })).toBeVisible()
})

// WP-796 — 배지 수·접근 가능한 이름·0 이면 숨김은 appRail.test.tsx 가 본다. 여기서는 펼친 레일(152px)에서
// 라벨이 실제로 보이고 배지가 아이콘 위에 남으며 레일 밖으로 넘치지 않는지(기하)만 본다.
test('앱 레일 — 펼치면 라벨이 보이고 대화 배지는 아이콘 위에 남아 레일 밖으로 넘치지 않는다', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await stubChat(page, { channels: [createChannel({ id: 1, unreadCount: 2 })], dms: [createDm({ id: 2, unreadCount: 3 })] })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const chatBadge = page.getByTestId('rail-badge-/chat')
  await expect(chatBadge).toHaveText('5')
  // 축소 상태에선 라벨이 시각적으로 숨는다(max-w-0·opacity-0).
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeHidden()

  await page.getByTestId('rail-toggle').click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeVisible()
  await expect(chatBadge).toBeVisible()
  expect(
    await page.getByTestId('app-rail').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)

  // 로고로 접으면 라벨이 다시 숨는다.
  await page.getByTestId('rail-collapse').click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeHidden()
})
