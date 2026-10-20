// 모바일 헤더(WP-125) — 탭 루트 🔔 배지, 메일·캘린더·연락처 사이드바 바텀시트, 메일 본문 열림 시 탭바 숨김.
import { createProject } from '../../factories/project.factory'
import { mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, test, toCalendarMonthView } from '../../fixtures/mobile.fixture'

test('홈 헤더 🔔 배지 → /notifications', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/notifications/unread-count', (r) => r.fulfill({ json: { count: 5 } }))
  await page.goto('/')
  await expect(page.getByTestId('mobile-bell-badge')).toHaveText('5')
  await page.getByTestId('mobile-bell').click()
  await expect(page).toHaveURL(/\/notifications$/)
})

test('캘린더: 사이드바는 인라인에 없고 ☰ 로 바텀시트에서 열린다', async ({ authenticatedPage: page }) => {
  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-new-event')).toBeHidden()
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('calendar-new-event')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('메일: 계정 사이드바는 바텀시트로 연다', async ({ authenticatedPage: page }) => {
  // 계정이 있어야 PageHeader(☰) 가 있는 받은편지함이 렌더된다(계정 없음 안내 화면엔 헤더 없음).
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail')
  await expect(page.getByTestId('mail-sidebar')).toBeHidden()
  await page.getByTestId('mobile-sidebar-trigger').click()
  await expect(page.getByTestId('mobile-sidebar-sheet').getByTestId('mail-sidebar')).toBeVisible()
})

// WP-578: 편지쓰기는 링크가 아닌 버튼이라 시트가 남아 작성 도크를 덮었다 — 시트가 닫히고 도크 입력이 실제로 눌려야 한다.
test('메일: 바텀시트에서 편지쓰기를 누르면 시트가 닫히고 작성 도크를 쓸 수 있다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail')
  await page.getByTestId('mobile-sidebar-trigger').click()
  await page.getByTestId('mobile-sidebar-sheet').getByTestId('mail-compose-new').click()
  await expect(page.getByTestId('mobile-sidebar-sheet')).toBeHidden()
  await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  // 도크가 열리면 받는사람에 스스로 초점이 가야 한다(#802) — 닫히는 시트의 포커스 트랩·초점 복귀가 빼앗지 않아야 한다.
  await expect(page.getByTestId('mail-compose-to')).toBeFocused()
  // 덮는 요소가 있으면 fill 의 hit-test·입력이 막힌다 — 보이기만 하는 게 아니라 조작 가능해야 한다.
  await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
  await expect(page.getByTestId('mail-compose-to')).toHaveValue('rcpt@test.local')
})

// WP-578: 계정 전환 메뉴 항목도 링크가 아니어서 이동 뒤 시트가 남았다.
test('메일: 바텀시트에서 계정을 바꾸면 시트가 닫힌다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [
    mailAccount(),
    mailAccount({ id: 2, emailAddress: 'other@example.com', imapUsername: 'other@example.com', smtpUsername: 'other@example.com' }),
  ])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/2/messages', [])
  await page.goto('/mail')
  await page.getByTestId('mobile-sidebar-trigger').click()
  await page.getByTestId('mobile-sidebar-sheet').getByTestId('mail-account-switcher').click()
  await page.getByTestId('mail-account-2').click()
  await expect(page).toHaveURL(/\/mail\/2/)
  await expect(page.getByTestId('mobile-sidebar-sheet')).toBeHidden()
  // 시트가 닫히면 초점은 시트를 연 ☰ 로 돌아가야 한다 — body 로 빠지면 키보드·스크린리더 사용자가 처음부터 다시 찾아야 한다.
  await expect(page.getByTestId('mobile-sidebar-trigger')).toBeFocused()
  // 메뉴와 시트가 함께 닫혀도 body 의 pointer-events 잠금이 남지 않아 화면을 계속 누를 수 있어야 한다.
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none')
  await page.getByTestId('mobile-sidebar-trigger').click()
  await expect(page.getByTestId('mobile-sidebar-sheet')).toBeVisible()
})

test('캘린더: 모바일 헤더에도 오늘/이전/다음이 보이고 다음 클릭 시 제목이 바뀐다', async ({ authenticatedPage: page }) => {
  await page.goto('/calendar')
  // 모바일 첫 보기(일정 목록)엔 ‹ › 가 없다(WP-136 — 무한 스크롤) — 이동 버튼이 있는 월 보기로 바꿔 확인한다.
  await toCalendarMonthView(page)
  await expect(page.getByTestId('calendar-today')).toBeVisible()
  await expect(page.getByTestId('calendar-prev')).toBeVisible()
  await expect(page.getByTestId('calendar-next')).toBeVisible()
  const title = page.getByTestId('calendar-title')
  const before = await title.textContent()
  await page.getByTestId('calendar-next').click()
  await expect(title).not.toHaveText(before ?? '')
  await expectNoHorizontalOverflow(page)
})

test('프로젝트 하위 페이지(사이클): 뒤로가기(‹)가 모바일 헤더 안에 보인다', async ({ authenticatedPage: page }) => {
  await page.route('**/api/v1/projects/WP', (r) => r.fulfill({ json: createProject() }))
  await page.route('**/api/v1/projects/WP/cycles', (r) => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  await page.route('**/api/v1/projects/WP/cycles/progress', (r) => r.fulfill({ json: [] }))
  await page.goto('/projects/WP/cycles')
  // 병합 헤더(U1-1): 페이지의 "프로젝트로 돌아가기" 아이콘 대신 헤더 선두 ‹ 하나(딥링크 대상도 그 프로젝트).
  await expect(page.getByTestId('page-header').getByTestId('mobile-back')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
