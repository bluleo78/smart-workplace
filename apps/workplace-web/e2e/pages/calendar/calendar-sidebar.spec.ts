// 캘린더 사이드바 미니 캘린더 + 표시 토글 E2E.
// 백엔드 없이 /calendar/events, /calendars, /me/issues 를 page.route 로 모킹한다.
// (미니 캘린더는 calendar.tsx 래퍼의 기본 locale={ko} 로 캡션이 한글 렌더. nav 버튼 aria-label 도
//  calendar.tsx 의 `labels` prop 으로 한글 지정됨 — #793.)
import type { Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { calendar, calendarEvent } from '../../factories/calendar.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory'

// 기본 캘린더 목록 스텁 — 사이드바 렌더에 필요.
const DEFAULT_CALENDARS = [calendar({ id: 1, name: '기본', color: 'blue', isDefault: true })]

// calendars 를 생략하면 DEFAULT_CALENDARS 로 모킹. 그룹핑 테스트처럼 커스텀 목록이 필요한 경우 배열 전달.
async function stubCalendars(page: Page, calendars = DEFAULT_CALENDARS): Promise<void> {
  await mockApi(page, 'GET', '/api/v1/calendars', calendars)
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

test('미니 캘린더 요일 헤더가 한글로 렌더링된다 (#652 회귀 가드)', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubDueIssue(page)

  await page.goto('/calendar')
  const mini = page.getByTestId('calendar-mini')

  // calendar.tsx 래퍼 기본 locale={ko} 미적용 시 "Su Mo Tu We Th Fr Sa" 로 렌더됨.
  await expect(mini).toContainText('일')
  await expect(mini).toContainText('월')
  await expect(mini).toContainText('화')
  await expect(mini).not.toContainText('Su')
  await expect(mini).not.toContainText('Mo')
})

// #793 — 이전/다음 달 네비게이션 버튼의 accessible name이 영문 기본값이 아니라 한글이어야 한다.
test('미니 캘린더 이전/다음 달 버튼 aria-label이 한글이다 (#793)', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubDueIssue(page)

  await page.goto('/calendar')
  const mini = page.getByTestId('calendar-mini')

  await expect(mini.getByRole('button', { name: '이전 달' })).toBeVisible()
  await expect(mini.getByRole('button', { name: '다음 달' })).toBeVisible()
  // 영문 기본값이 남아있지 않아야 한다.
  await expect(mini.getByRole('button', { name: /previous month/i })).toHaveCount(0)
  await expect(mini.getByRole('button', { name: /next month/i })).toHaveCount(0)
})

test('미니 캘린더가 anchor 와 양방향 동기화된다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubDueIssue(page)

  await page.goto('/calendar')

  const mini = page.getByTestId('calendar-mini')
  await expect(mini).toBeVisible()
  // 초기: 본문 헤더 6월 + 미니 캡션도 한글 2026년 6월(#652: locale={ko} 기본값)
  await expect(page.getByTestId('calendar-title')).toHaveText('2026년 6월')
  await expect(mini).toContainText('2026년 6월')

  // 미니 → 본문: 미니 다음달 화살표 클릭 → 본문 헤더가 7월로 이동
  // (#793 — nav 버튼 aria-label 이 "다음 달"로 한글화됨)
  await mini.getByRole('button', { name: '다음 달' }).click()
  await expect(page.getByTestId('calendar-title')).toHaveText('2026년 7월')
  await expect(mini).toContainText('2026년 7월')

  // 본문 → 미니: 본문 "오늘" 클릭 → 미니 캡션도 2026년 6월 으로 복귀
  await page.getByTestId('calendar-today').click()
  await expect(page.getByTestId('calendar-title')).toHaveText('2026년 6월')
  await expect(mini).toContainText('2026년 6월')
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
  // 기본 캘린더(id=1) 일정 1건 + 내 캘린더가 아닌(초대받은, calendarId=99) 일정 1건.
  // 토글별 표시 규칙(내 캘린더/초대/마감 → 그리드·미니 점)은 calendar.test(isEventVisible·markedDays)가 지키고,
  // 여기선 세 토글이 실제로 그리드에 이어지는지(wiring)만 본다.
  await stubCalendars(page)
  await mockApi(page, 'GET', '/api/v1/calendar/events', [
    calendarEvent({ id: 1, title: '팀 회의', calendarId: 1, startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' }),
    calendarEvent({ id: 2, title: '초대 일정', calendarId: 99, startsAt: '2026-06-11T03:00:00Z', endsAt: '2026-06-11T04:00:00Z' }),
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

  // "초대받은 일정" 끄기 → 초대 일정만 사라짐.
  await expect(page.getByTestId('calendar-event-2')).toBeVisible()
  await page.getByTestId('calendar-layer-invited').click()
  await expect(page.getByTestId('calendar-event-2')).toHaveCount(0)
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
