// 공용 DialogContent 닫힘 시 포커스 복원 회귀 테스트 (#708).
// Radix 기본 동작은 다이얼로그를 연 요소(트리거)로 포커스를 정확히 되돌리지 못하는
// 케이스가 있어, 열릴 때의 activeElement 를 캡처했다가 닫힐 때 복원하도록 공용
// DialogContent 에 내장했다. Tab 으로 트리거에 포커스 → Enter 로 열기 → Esc 로 닫기 →
// activeElement 가 트리거로 복원되는지 단언한다.

import { expect, test } from '../fixtures/auth.fixture'
import { mockApi, createPageResponse } from '../fixtures/api-mock'
import { createProject } from '../factories/project.factory'
import type { CalendarEvent } from '../../src/types/calendar'

test('캘린더 새 일정 다이얼로그 — Esc로 닫으면 포커스가 트리거로 복원된다 (#708)', async ({
  authenticatedPage: page,
}) => {
  await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))

  const store: CalendarEvent[] = []
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/calendar/events'),
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(store),
        })
      }
      return route.fallback()
    },
  )

  await page.goto('/calendar')

  const trigger = page.getByTestId('calendar-new-event')
  // Tab 으로 트리거에 포커스를 맞춘다 (실제 키보드 사용자 시나리오).
  await trigger.focus()
  await expect(trigger).toBeFocused()

  // Enter 로 열기 — 다이얼로그가 열리면 Radix 가 바깥 콘텐츠를 aria-hidden 처리하며
  // 포커스를 다이얼로그 내부로 이동시킨다.
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()

  // Esc 로 닫기
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()

  // activeElement 가 트리거 버튼으로 복원되어야 한다.
  await expect(trigger).toBeFocused()

  // 재오픈 — 캡처 ref 가 이전 close 값으로 stale 하게 남지 않고 매번 새로 캡처되는지 확인.
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('calendar-event-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('calendar-event-dialog')).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('프로젝트 새 프로젝트 다이얼로그 — Esc로 닫으면 포커스가 트리거로 복원된다 (#708)', async ({
  authenticatedPage: page,
}) => {
  await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]))
  await page.goto('/projects')

  const trigger = page.getByRole('button', { name: '+ 새 프로젝트' })
  await trigger.focus()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '새 프로젝트' })).not.toBeVisible()

  await expect(trigger).toBeFocused()
})
