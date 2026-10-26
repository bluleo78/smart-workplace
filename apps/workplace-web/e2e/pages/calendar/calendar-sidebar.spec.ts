// 캘린더 사이드바 표시 토글 — 새로고침 뒤 유지(localStorage)만 브라우저로 본다(@platform, WP-966).
// 미니 달력(한국어·이동 버튼 이름·본문과 양방향 이동·날짜 선택·점)과 표시 토글 → 그리드 연결은
// src/pages/calendar/calendarPage.test.tsx(renderScreen)가 지킨다.
import type { Page } from '@playwright/test'

import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { calendar } from '../../factories/calendar.factory'
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

test('표시 토글 상태가 새로고침 후에도 유지된다(localStorage)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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
