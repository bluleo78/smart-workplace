// 캘린더 이슈 마감일 오버레이 E2E (#109) — 내게 할당된 이슈의 마감일을
// 캘린더에 읽기전용 칩으로 표시하고, 클릭 시 해당 이슈로 이동하는지 검증.
// 백엔드 없이 /calendar/events 와 /me/issues 를 page.route 로 모킹한다.
import type { Page } from '@playwright/test'

import { mockApi, type MockApiCapture } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { calendarEvent } from '../factories/calendar.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory'

// 고정 시각(2026-06-10) 기준 월/주 뷰에 보이도록 6월 마감 이슈 1건을 반환.
// /me/issues 요청을 캡처해 윈도잉 파라미터(assignee/dueFrom/dueTo) 검증에 사용.
async function stubAssignedDueIssue(page: Page): Promise<MockApiCapture> {
  const meIssues = await mockApi(
    page,
    'GET',
    '/api/v1/me/issues',
    createIssueSearchResponse([
      createIssue({
        id: 7,
        projectKey: 'WP',
        number: 42,
        title: '로그인 버그',
        status: 'IN_PROGRESS',
        dueDate: '2026-06-12',
      }),
    ]),
    { capture: true },
  )
  // 이동 대상 이슈 상세 — 라우트 진입 시 프록시 누수 방지용 빈 스텁.
  await mockApi(page, 'GET', '/api/v1/projects/WP/issues/42', createIssueDetail())
  return meIssues
}

test(
  '내 이슈 마감일이 해당 날짜 칸에만 칩으로 표시되고 클릭 시 이슈로 이동',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

    // 일정은 없고 마감 이슈만 — 칩이 일정과 독립적으로 렌더링됨을 보장.
    await mockApi(page, 'GET', '/api/v1/calendar/events', [])
    const meIssues = await stubAssignedDueIssue(page)

    await page.goto('/calendar')

    // 입력→처리: /me/issues 요청이 윈도잉 파라미터를 실제로 전송했는지 검증.
    // (이 검증이 없으면 가시 범위 무시·파라미터 누락 회귀가 false-green 으로 통과)
    const req = await meIssues.waitForRequest()
    expect(req.searchParams.get('assignee')).toBe('me')
    const dueFrom = req.searchParams.get('dueFrom') ?? ''
    const dueTo = req.searchParams.get('dueTo') ?? ''
    expect(dueFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dueTo).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // 그리드 경계를 하드코딩하지 않으면서 윈도우가 마감일을 포함함을 검증.
    expect(dueFrom <= '2026-06-12' && '2026-06-12' <= dueTo).toBe(true)

    // 출력: 마감일(2026-06-12) 칸 안에 이슈 칩이 표시 (셀 스코프로 날짜 정확성 검증)
    const cell = page.getByTestId('calendar-cell-2026-06-12')
    const chip = cell.getByTestId('calendar-issue-due-7')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('로그인 버그')

    // 날짜 매칭 회귀(모든 칸에 렌더) 방지 — 그리드 전체에 칩은 정확히 1개.
    await expect(page.getByTestId('calendar-issue-due-7')).toHaveCount(1)

    // 칩은 일정 칩(calendar-event-*)이 아니다 — 읽기전용 오버레이로 구분.
    await expect(page.getByTestId('calendar-event-7')).toHaveCount(0)

    // 클릭 → 해당 이슈 상세로 이동 (입력→처리→출력: 네비게이션 검증)
    await chip.click()
    await expect(page).toHaveURL(/\/projects\/WP\/issues\/42$/)
  },
)

test('주 뷰 종일 줄에 마감 이슈 칩이 표시', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  // 2026-06-10(수) 이 속한 주(06-07~06-13)에 마감일(06-12)이 포함됨.
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await stubAssignedDueIssue(page)

  await page.goto('/calendar')
  await page.getByTestId('calendar-view-week-btn').click()

  // 주 뷰(TimeGrid 종일 줄)는 월 뷰와 별개 렌더 경로 — 별도 커버.
  await expect(page.getByTestId('calendar-view-week')).toBeVisible()
  const chip = page.getByTestId('calendar-issue-due-7')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText('로그인 버그')
})

test('마감 이슈가 목록(어젠다) 뷰에서 마감 행으로 표시', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  // 일정 1건 + 마감 이슈 1건 — 어젠다에 함께 정렬되어 노출.
  await mockApi(page, 'GET', '/api/v1/calendar/events', [
    calendarEvent({ id: 1, title: '팀 회의', startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' }),
  ])
  await stubAssignedDueIssue(page)

  await page.goto('/calendar')
  await page.getByTestId('calendar-view-agenda-btn').click()

  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
  // 일정과 마감 이슈가 모두 행으로 나열된다.
  await expect(page.getByTestId('calendar-event-1')).toBeVisible()
  const dueRow = page.getByTestId('calendar-issue-due-7')
  await expect(dueRow).toBeVisible()
  await expect(dueRow).toContainText('마감')
  await expect(dueRow).toContainText('WP-42')
})
