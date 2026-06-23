import { expect, test } from '../fixtures/auth.fixture'

test('홈에 앱 레일이 보이고 상단 GNB는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-rail')).toBeVisible()
  await expect(page.getByTestId('module-sidebar')).toHaveCount(0)
})

test('데스크톱에서 앱 레일은 아이콘 전용이다(워드마크 없음, 홈은 모듈 링크로 접근)', async ({
  authenticatedPage: page,
}) => {
  // 기본 뷰포트(1280)는 lg 브레이크포인트 → 아이콘 레일.
  await page.goto('/')
  // #219 P3 — 레일 최상단 앱마크(→홈)는 워크스페이스 스위처 칩으로 교체됐다.
  // 활성 테넌트가 없는 기본 fixture 에선 스위처가 미렌더(기존 단일테넌트 무영향).
  await expect(page.getByTestId('workspace-switcher')).toHaveCount(0)
  // 옛 앱마크 testid 는 제거됨 — 홈은 모듈 런처의 '홈' 링크(rail-link-/)로 접근한다.
  await expect(page.getByTestId('app-rail').getByTestId('rail-home')).toHaveCount(0)
  await expect(page.getByTestId('rail-link-/')).toBeVisible()
  // 워드마크 "Smart Workplace" 는 레일 어디에도 노출되지 않는다(아이콘 전용 정체성).
  await expect(page.getByTestId('app-rail').getByText('Smart Workplace')).toHaveCount(0)
})

// LNB 표준화(#98) — 레일 라벨 한글화(대화·드라이브) + 소통 묶음 순서.
// #99 — '설정' 모듈을 어드민 전용에서 전체 사용자 노출로 전환, 드라이브 다음(끝)에 배치.
test('앱 레일 — 한글 라벨과 소통 묶음 순서(홈·작업·대화·메일·연락처·캘린더·드라이브·Wiki·설정)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 영문 라벨(Chat/Drive) 제거 — 레일 항목 텍스트가 한글이다.
  await expect(page.getByTestId('rail-link-/chat')).toContainText('대화')
  await expect(page.getByTestId('rail-link-/drive')).toContainText('드라이브')
  // 순서: 홈 · 작업 관리 · 대화 · 메일 · 연락처 · 캘린더 · 드라이브 · Wiki · 설정
  // (소통 앱 인접, 캘린더는 연락처 다음, Wiki 가 드라이브 다음·설정 앞에 활성화됨 — Wiki S1.
  //  설정은 끝에서 일반 사용자에게도 노출. #99, #108)
  const order = await page
    .locator('[data-testid^="rail-link-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(order).toEqual([
    'rail-link-/',
    'rail-link-/projects',
    'rail-link-/chat',
    'rail-link-/mail',
    'rail-link-/contacts',
    'rail-link-/calendar',
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

// #471 — 앱 레일 확장 모드: 기본 축소 → 펼치기 토글 → 접기, 그리고 localStorage 영속.
test('앱 레일 — 기본은 축소(라벨 숨김), 토글로 확장·축소된다 (#471)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 축소 기본: 펼치기 버튼 노출 + 모듈 라벨 텍스트는 시각적으로 숨김(lg:hidden).
  const expandBtn = page.getByTestId('rail-expand')
  await expect(expandBtn).toBeVisible()
  await expect(expandBtn).toHaveAttribute('aria-expanded', 'false')
  const chatLabel = page.getByTestId('rail-link-/chat').getByText('대화')
  await expect(chatLabel).toBeHidden()

  // 펼치기 → 라벨 노출, 펼치기 버튼 사라지고 접기 버튼 노출.
  await expandBtn.click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeVisible()
  await expect(page.getByTestId('rail-expand')).toHaveCount(0)
  const collapseBtn = page.getByTestId('rail-collapse')
  await expect(collapseBtn).toBeVisible()
  await expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')

  // 접기 복귀 → 라벨 재숨김.
  await collapseBtn.click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeHidden()
})

// #471 — 확장 시 하단 알림·유저 라벨이 노출된다.
test('앱 레일 — 확장 시 알림/유저 라벨이 보인다 (#471)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  // 축소 기본: 알림 트리거에 "알림" 텍스트 라벨은 숨김(아이콘만).
  await expect(page.getByTestId('inbox-trigger').getByText('알림')).toBeHidden()
  // 펼치기.
  await page.getByTestId('rail-expand').click()
  await expect(page.getByTestId('inbox-trigger').getByText('알림')).toBeVisible()
  // 유저 메뉴에 사용자명(기본 fixture user) 라벨 노출.
  await expect(page.getByTestId('rail-user-menu').getByText('테스트 사용자')).toBeVisible()
})

test('앱 레일 — 확장 상태가 새로고침 후에도 유지된다(localStorage) (#471)', async ({
  authenticatedPage: page,
}) => {
  await page.goto('/')
  await page.getByTestId('rail-expand').click()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeVisible()
  // localStorage 에 영속.
  expect(await page.evaluate(() => localStorage.getItem('app-rail-expanded'))).toBe('true')
  // 새로고침 후에도 확장 유지(접기 버튼이 보임 = 확장 상태).
  await page.reload()
  await expect(page.getByTestId('rail-collapse')).toBeVisible()
  await expect(page.getByTestId('rail-link-/chat').getByText('대화')).toBeVisible()
})
