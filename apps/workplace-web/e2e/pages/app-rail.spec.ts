import { expect, test } from '../fixtures/auth.fixture'

test('홈에 앱 레일이 보이고 상단 GNB는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('module-sidebar')).toHaveCount(0)
})

test('데스크톱에서 앱 레일은 축소 시 아이콘 전용이다(워드마크 숨김, 홈은 모듈 링크로 접근)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 활성 테넌트 없는 기본 fixture — 워크스페이스 스위처 미렌더.
  await expect(page.getByTestId('workspace-switcher')).toHaveCount(0)
  // 홈은 모듈 런처의 '홈' 링크로 접근(헤더 마크는 토글 전용).
  await expect(page.getByTestId('rail-link-/')).toBeVisible()
  // 축소 상태 — 브랜드 워드마크("Workplace")는 시각적으로 숨김(lg:hidden).
  await expect(page.getByTestId('app-rail').getByText('Workplace')).toBeHidden()
})

// LNB 표준화(#98) — 레일 라벨 한글화(대화·드라이브) + 소통 묶음 순서.
// #99 — '설정' 모듈을 어드민 전용에서 전체 사용자 노출로 전환, 드라이브 다음(끝)에 배치.
// #477 — 소통 우선 순서: 소통 묶음(대화·메일·연락처) 앞에 인접 배치, 작업관리는 그 다음.
test('앱 레일 — 한글 라벨과 소통 우선 순서(홈·대화·메일·연락처·캘린더·작업관리·드라이브·노트·설정)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 영문 라벨(Chat/Drive) 제거 — 레일 항목 텍스트가 한글이다.
  await expect(page.getByTestId('rail-link-/chat')).toContainText('대화')
  await expect(page.getByTestId('rail-link-/drive')).toContainText('드라이브')
  // 순서: 홈 · 대화 · 메일 · 연락처 · 캘린더 · 작업 관리 · 드라이브 · 노트 · 설정
  // (소통 앱 인접 우선, 작업관리는 그 다음, 파일/노트는 끝. #477)
  const order = await page
    .locator('[data-testid^="rail-link-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(order).toEqual([
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

// #316 — 하단 알림·유저 아이콘 hover 툴팁 미제공. shadcn Tooltip 을 InboxPanel·AppRailUserMenu
// trigger 에 추가하여 nav 링크와 동일한 패턴으로 맞춤.
test('앱 레일 하단 — 알림 아이콘 hover 시 툴팁 "알림" 표시 (#316)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  const trigger = page.getByTestId('inbox-trigger')
  await trigger.hover()
  // shadcn Tooltip 은 기본 200ms 딜레이 후 role="tooltip" 로 노출.
  await expect(page.getByRole('tooltip', { name: '알림' })).toBeVisible()
})

test('앱 레일 하단 — 유저 아이콘 hover 시 툴팁 "내 계정" 표시 (#316)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  const trigger = page.getByTestId('rail-user-menu')
  await trigger.hover()
  await expect(page.getByRole('tooltip', { name: '내 계정' })).toBeVisible()
})

// #120 — 데스크톱(lg) 레일에서 라벨 span 이 lg:hidden 이라 모듈 링크 8개의 accessible name 이
// 비어 있던 a11y 결함(WCAG 4.1.2). RailLink<Link> 에 aria-label 부여로 모든 뷰포트에서 이름 보장.
// 요소 존재가 아니라 "역할 link + 접근 가능한 이름"을 함께 검증한다.
test('앱 레일 — 데스크톱 모듈 링크 9개가 접근 가능한 이름(역할 link + 이름)을 갖는다 (#120)', async ({
  authenticatedPage: page,
}) => {
  // 기본 뷰포트(1280)는 lg → 라벨 span 이 숨겨지는, 버그가 발생하던 바로 그 조건.
  await page.goto('/')
  // 레일의 <nav> 로 스코프 — 헤더의 홈 마크(aria-label="홈")와 이름 충돌을 피한다.
  const nav = page.getByTestId('app-rail').locator('nav')
  // MODULES 라벨(순서 무관, 이름 존재만 검증). 노트(구 Wiki) 활성 모듈 포함.
  const labels = ['홈', '작업 관리', '대화', '메일', '연락처', '캘린더', '드라이브', '노트', '설정']
  for (const name of labels) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible()
  }
  // 레일 nav 안의 link 역할 요소는 정확히 9개(모듈 링크) — 이름 없는 link 가 없음을 보장.
  await expect(nav.getByRole('link')).toHaveCount(9)
})

// #471 — 브랜드 마크 = 확장 토글. 축소: 마크 클릭→펼치기 / 확장: « 접기.
test('앱 레일 — 마크 클릭으로 펼치고 « 로 접는다 (#471)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 축소 기본: 마크 토글 버튼 노출(aria-expanded=false), 모듈 라벨·워드마크 숨김.
  const markToggle = page.getByTestId('rail-toggle')
  await expect(markToggle).toBeVisible()
  await expect(markToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(markToggle).toHaveAttribute('aria-label', '사이드바 펼치기')
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeHidden()

  // 펼치기 → 라벨 + 워드마크("Workplace") 노출, 접기 버튼(«)으로 전환.
  await markToggle.click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeVisible()
  await expect(page.getByTestId('app-rail').getByText('Workplace')).toBeVisible()
  await expect(page.getByTestId('rail-toggle')).toHaveCount(0)
  const collapse = page.getByTestId('rail-collapse')
  await expect(collapse).toBeVisible()
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')

  // 접기 복귀.
  await collapse.click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeHidden()
})

test('앱 레일 — 확장 상태가 새로고침 후에도 유지된다(localStorage) (#471)', async ({
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

// #471 — 워크스페이스 스위처는 하단 푸터(알림 위)로 이동했다. 활성 테넌트 없으면 미렌더이므로
// 위치 회귀는 "헤더에 없음"으로 검증(헤더 = 첫 border-b 블록).
test('앱 레일 — 헤더엔 브랜드 토글만, 워크스페이스 스위처는 헤더에 없다 (#471)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 헤더(상단 h-14)에는 rail-toggle 만. workspace-switcher 는 fixture 에서 미렌더(테넌트 없음)지만,
  // 렌더되더라도 헤더가 아닌 푸터여야 한다 — 구조 회귀 가드로 헤더 내 스위처 부재를 단정.
  const header = page.getByTestId('app-rail').locator('div.border-b').first()
  await expect(header.getByTestId('workspace-switcher')).toHaveCount(0)
  await expect(header.getByTestId('rail-toggle')).toBeVisible()
})
