// 모바일 헤더(WP-125) — 탭 루트 🔔 배지, 메일·캘린더·연락처 사이드바 바텀시트, 메일 본문 열림 시 탭바 숨김.
import { createProject } from '../../factories/project.factory'
import { mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

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

test('캘린더: 모바일 헤더에도 오늘/이전/다음이 보이고 다음 클릭 시 제목이 바뀐다', async ({ authenticatedPage: page }) => {
  await page.goto('/calendar')
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
