// WP-36/WP-61 — 서버 측(AI Chat 등) 캘린더 일정 변경이 열린 화면에 새로고침 없이 반영되는지 E2E.
// /api/v1/events 를 게이트 모킹해 resource.changed 프레임을 첫 렌더 *뒤에* 흘려보내고, 재조회로 화면이 바뀌는지 본다.
import type { Page } from '@playwright/test'
import type { CalendarEvent } from '../../../src/types/calendar'
import { calendarEvent } from '../../factories/calendar.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockGatedEvents, resourceChangedFrame } from '../../fixtures/gatedEvents'

test.describe('캘린더 일정 변경 실시간 반영 (WP-61)', () => {
  // 브라우저가 쓰기 요청을 보내면 안 되는 시나리오 — GET 외에는 404 로 드러낸다. store 는 테스트가 직접 바꾼다.
  async function stubEvents(page: Page, getStore: () => CalendarEvent[]) {
    await page.route(
      (url) => url.pathname.startsWith('/api/v1/calendar/events'),
      (route) => {
        if (route.request().method() !== 'GET') return route.fulfill({ status: 404 })
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(getStore()),
        })
      },
    )
  }

  test('일정 생성 — 새 일정이 화면에 나타난다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    let store = [calendarEvent({ id: 1, title: '주간 회의' })]
    await stubEvents(page, () => store)
    const events = await mockGatedEvents(page)

    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-event-1')).toContainText('주간 회의')
    await expect(page.getByText('AI 가 잡은 미팅')).toHaveCount(0)

    store = [...store, calendarEvent({ id: 77, title: 'AI 가 잡은 미팅', startsAt: '2026-06-11T01:00:00Z', endsAt: '2026-06-11T02:00:00Z' })]
    const data = { resource: 'calendar-event', op: 'created', scopeType: 'USER', scopeId: 1, ids: [77], actorId: 99 }
    events.deliver(resourceChangedFrame(data))

    await expect(page.getByTestId('calendar-event-77')).toContainText('AI 가 잡은 미팅')
  })

  test('일정 삭제 — 일정이 화면에서 사라진다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
    let store = [calendarEvent({ id: 1, title: '주간 회의' }), calendarEvent({ id: 2, title: '삭제될 회의' })]
    await stubEvents(page, () => store)
    const events = await mockGatedEvents(page)

    await page.goto('/calendar')
    await expect(page.getByTestId('calendar-event-1')).toContainText('주간 회의')
    await expect(page.getByTestId('calendar-event-2')).toContainText('삭제될 회의')

    store = store.filter((e) => e.id !== 2)
    const data = { resource: 'calendar-event', op: 'deleted', scopeType: 'USER', scopeId: 1, ids: [2], actorId: 99 }
    events.deliver(resourceChangedFrame(data))

    await expect(page.getByTestId('calendar-event-2')).toHaveCount(0)
    await expect(page.getByTestId('calendar-event-1')).toBeVisible()
  })
})
