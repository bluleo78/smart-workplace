// 캘린더 사이드바 미니 캘린더 + 표시 토글 E2E.
// 백엔드 없이 /calendar/events, /calendars, /me/issues 를 page.route 로 모킹한다.
// (Playwright 기본 로케일 en-US → 미니 캘린더 캡션/nav 라벨이 영어로 결정적.)
import type { Page } from '@playwright/test'

import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { calendar, calendarEvent } from '../factories/calendar.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory'

// 기본 캘린더 목록 스텁 — 사이드바 렌더에 필요.
const DEFAULT_CALENDARS = [calendar({ id: 1, name: '기본', color: 'blue', isDefault: true })]

async function stubCalendars(page: Page): Promise<void> {
  await mockApi(page, 'GET', '/api/v1/calendars', DEFAULT_CALENDARS)
}

// 2026-06-11 마감 이슈 1건 + 그 이슈 상세 빈 스텁(이동 시 프록시 누수 방지).
async function stubDueIssue(page: Page): Promise<void> {
  await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({ id: 7, projectKey: 'WP', number: 42, title: '로그인 버그', status: 'IN_PROGRESS', dueDate: '2026-06-11' }),
    ]),
  )
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/42', createIssueDetail())
}

test('미니 캘린더가 anchor 와 양방향 동기화된다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubDueIssue(page)

  await page.goto('/calendar')

  const mini = page.getByTestId('calendar-mini')
  await expect(mini).toBeVisible()
  // 초기: 본문 헤더 6월 + 미니 캡션 June 2026
  await expect(page.getByTestId('calendar-title')).toHaveText('2026년 6월')
  await expect(mini).toContainText('June 2026')

  // 미니 → 본문: 미니 다음달 화살표 클릭 → 본문 헤더가 7월로 이동
  await mini.getByRole('button', { name: /next month/i }).click()
  await expect(page.getByTestId('calendar-title')).toHaveText('2026년 7월')
  await expect(mini).toContainText('July 2026')

  // 본문 → 미니: 본문 "오늘" 클릭 → 미니 캡션도 June 2026 으로 복귀
  await page.getByTestId('calendar-today').click()
  await expect(page.getByTestId('calendar-title')).toHaveText('2026년 6월')
  await expect(mini).toContainText('June 2026')
})

test('미니 캘린더 날짜 클릭 시 선택일(anchor)이 갱신된다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubDueIssue(page)

  await page.goto('/calendar')
  const mini = page.getByTestId('calendar-mini')

  // 6월 20일 클릭 → 해당 일 버튼이 선택 상태로 표시.
  // data-day 는 day.date.toLocaleDateString() (en-US: "6/20/2026") — name 매칭보다 결정적.
  const day20 = mini.locator('button[data-day="6/20/2026"]')
  await day20.click()
  // react-day-picker(shadcn) 단일 선택은 data-selected-single 로 표시.
  await expect(day20).toHaveAttribute('data-selected-single', 'true')

  // anchor 가 본문 뷰로 전파됐는지 검증 — 일 뷰 전환 후 헤더에 "6.20" 포함 확인.
  await page.getByTestId('calendar-view-day-btn').click()
  await expect(page.getByTestId('calendar-view-day')).toContainText('6.20')
})

test('표시 토글로 일정/이슈 레이어를 끄고 켤 수 있다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  // 기본 캘린더(id=1) + 6월 그리드에 보이는 일정 1건(calendarId=1).
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [
    calendarEvent({ id: 1, title: '팀 회의', calendarId: 1, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' }),
  ])
  await stubDueIssue(page)

  await page.goto('/calendar')

  // 초기: 두 레이어 모두 표시.
  await expect(page.getByTestId('calendar-event-1')).toBeVisible()
  await expect(page.getByTestId('calendar-issue-due-7')).toBeVisible()

  // 캘린더별 체크박스 접근성 이름 확인 (회귀 가드).
  await expect(page.getByRole('checkbox', { name: '캘린더 표시: 기본' })).toBeVisible()

  // 이슈 마감일 레이어 끄기 → 이슈 칩만 사라지고 일정은 유지.
  await page.getByTestId('calendar-layer-issue-dues').click()
  await expect(page.getByTestId('calendar-issue-due-7')).toHaveCount(0)
  await expect(page.getByTestId('calendar-event-1')).toBeVisible()

  // 캘린더 1 토글 끄기 → 일정도 사라짐.
  await page.getByTestId('calendar-toggle-1').click()
  await expect(page.getByTestId('calendar-event-1')).toHaveCount(0)
})

test('미니 캘린더가 일정/마감 있는 날에 점을 표시한다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  // 6/11 에 일정 1건(calendarId=1). 미니 그리드(6월) 범위로 조회됨.
  await mockApi(page, 'GET', '/api/v1/calendar/events', [
    calendarEvent({ id: 1, title: '팀 회의', calendarId: 1, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' }),
  ])
  await stubDueIssue(page) // 6/11 마감 이슈(id 7) — calendar-sidebar.spec.ts 상단 헬퍼

  await page.goto('/calendar')
  const mini = page.getByTestId('calendar-mini')

  // react-day-picker v10 modifiersClassNames 는 Day(<td> gridcell)에 적용됨 — data-day=ISO(2026-06-11).
  // 6/11 셀에는 점(day-has-items), 6/15 셀에는 없음.
  await expect(mini.locator('[data-day="2026-06-11"]')).toHaveClass(/day-has-items/)
  await expect(mini.locator('[data-day="2026-06-15"]')).not.toHaveClass(/day-has-items/)
})

test('표시 토글을 끄면 미니 캘린더 점도 사라진다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  // 6/11 에 일정만(이슈 마감 없음, calendarId=1) → 캘린더 1 끄면 점 사라져야 함.
  await mockApi(page, 'GET', '/api/v1/calendar/events', [
    calendarEvent({ id: 1, title: '팀 회의', calendarId: 1, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' }),
  ])
  await mockApi(page, 'GET', '/api/v1/me/issues', createIssueSearchResponse([]))

  await page.goto('/calendar')
  const mini = page.getByTestId('calendar-mini')
  // react-day-picker v10: modifiersClassNames 는 Day(<td> gridcell, data-day=ISO) 에 적용.
  const cell = mini.locator('[data-day="2026-06-11"]')

  await expect(cell).toHaveClass(/day-has-items/)
  // 캘린더 1 토글 끄기 → 점 사라짐.
  await page.getByTestId('calendar-toggle-1').click()
  await expect(cell).not.toHaveClass(/day-has-items/)
})

test('이슈 마감일 토글을 끄면 마감 점도 사라진다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  // 6/11 에 마감 이슈만(일정 없음) → "내 이슈 마감일" 끄면 점 사라져야 함(issueDues 분기 검증).
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubDueIssue(page) // 6/11 마감 이슈(id 7)

  await page.goto('/calendar')
  const mini = page.getByTestId('calendar-mini')
  const cell = mini.locator('[data-day="2026-06-11"]')

  await expect(cell).toHaveClass(/day-has-items/)
  // "내 이슈 마감일" 토글 끄기 → 점 사라짐.
  await page.getByTestId('calendar-layer-issue-dues').click()
  await expect(cell).not.toHaveClass(/day-has-items/)
})

test('표시 토글 상태가 새로고침 후에도 유지된다(localStorage)', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubDueIssue(page)

  await page.goto('/calendar')
  await expect(page.getByTestId('calendar-issue-due-7')).toBeVisible()

  // 이슈 레이어 끄기.
  const issueToggle = page.getByTestId('calendar-layer-issue-dues')
  await issueToggle.click()
  await expect(page.getByTestId('calendar-issue-due-7')).toHaveCount(0)

  // 새로고침 → 체크 해제 상태 + 칩 부재 유지.
  await page.reload()
  await expect(page.getByTestId('calendar-layer-issue-dues')).not.toBeChecked()
  await expect(page.getByTestId('calendar-issue-due-7')).toHaveCount(0)
})
