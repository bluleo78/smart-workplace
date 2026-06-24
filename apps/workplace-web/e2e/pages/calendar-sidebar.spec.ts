// 캘린더 사이드바 미니 캘린더 + 표시 토글 E2E.
// 백엔드 없이 /calendar/events 와 /me/issues 를 page.route 로 모킹한다.
// (Playwright 기본 로케일 en-US → 미니 캘린더 캡션/nav 라벨이 영어로 결정적.)
import type { Page } from '@playwright/test'

import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { calendarEvent } from '../factories/calendar.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory'

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
  // 6월 그리드에 보이는 일정 1건.
  await mockApi(page, 'GET', '/api/v1/calendar/events', [
    calendarEvent({ id: 1, title: '팀 회의', startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' }),
  ])
  await stubDueIssue(page)

  await page.goto('/calendar')

  // 초기: 두 레이어 모두 표시.
  await expect(page.getByTestId('calendar-event-1')).toBeVisible()
  await expect(page.getByTestId('calendar-issue-due-7')).toBeVisible()

  // aria-label 접근성 이름이 올바르게 연결됐는지 검증 (Fix 1 회귀 가드).
  await expect(page.getByRole('checkbox', { name: '내 일정' })).toBeVisible()

  // 이슈 마감일 레이어 끄기 → 이슈 칩만 사라지고 일정은 유지.
  await page.getByTestId('calendar-layer-issue-dues').click()
  await expect(page.getByTestId('calendar-issue-due-7')).toHaveCount(0)
  await expect(page.getByTestId('calendar-event-1')).toBeVisible()

  // 일정 레이어 끄기 → 일정도 사라짐.
  await page.getByTestId('calendar-layer-events').click()
  await expect(page.getByTestId('calendar-event-1')).toHaveCount(0)
})

test('표시 토글 상태가 새로고침 후에도 유지된다(localStorage)', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
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
