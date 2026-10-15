// #460: 홈 챗 도크 캘린더 위젯 렌더 — show_calendar / show_event 지시를 받아
// 일정 목록(CalendarWidget) 및 단일 일정 상세(EventWidget)를 렌더하는지 검증한다.
// 전략: compose done SSE 에 widgets:[{type:'calendar',...}] 를 포함시키고
//   위젯이 자체 훅으로 호출하는 /calendar/events 를 모킹하여 백엔드 없이 검증한다.

import { calendarEvent } from '../factories/calendar.factory';
import { expect, test } from '../fixtures/auth.fixture';
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock';
import { trackRequests } from '../fixtures/requests';

test.describe('#460 홈 챗 도크 캘린더 위젯 렌더', () => {
  test(
    '캘린더 위젯이 일정 목록을 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 1) compose 는 텍스트 없이 calendar 위젯만 지시 — AI 가 실제로 주는 date-only params 로 위젯이 params 를 넘기는지도 본다.
      await mockHomeChatGeneration(page, {
        frames: [
          { event: 'done', data: { sessionId: 's-cal-1', widgets: [{ type: 'calendar', params: { from: '2026-06-22', to: '2026-06-22' } }] } },
        ],
      });
      // 2) 위젯이 오늘 범위로 호출하는 일정 목록.
      const eventLists = trackRequests(page, 'ANY', '/api/v1/calendar/events');
      await page.route(
        (url) => url.pathname === '/api/v1/calendar/events',
        (route) => {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              calendarEvent({ id: 1, title: '팀 미팅', startsAt: '2026-06-22T02:00:00Z', endsAt: '2026-06-22T03:00:00Z' }),
              calendarEvent({ id: 2, title: '점심 약속', startsAt: '2026-06-22T04:00:00Z', endsAt: '2026-06-22T05:00:00Z' }),
            ]),
          });
        },
      );

      await page.goto('/');
      await page.getByTestId('chat-launcher').click();
      await page.getByTestId('chat-input').fill('오늘 일정 보여줘');
      await page.getByRole('button', { name: '보내기' }).click();

      // 출력: 위젯 컨테이너 + 일정 목록 행이 렌더된다.
      await expect(page.getByTestId('chat-widgets')).toBeVisible();
      const items = page.getByTestId('calendar-items');
      await expect(items).toBeVisible();
      await expect(items).toContainText('팀 미팅');
      await expect(items).toContainText('점심 약속');

      // 처리: 위젯 params 가 범위 계산(resolveCalendarRange)을 거쳐 ISO datetime 으로 실린다.
      // 정규화 규칙 자체(오늘·이번 주·date-only)는 calendarRange.test.ts 가 담당.
      const sp = eventLists.lastUrl()!.searchParams;
      expect(sp.get('from')).toMatch(/^2026-06-2\dT/);
      expect(sp.get('from')).not.toBe(sp.get('to'));
    },
  );

  test('일정이 없으면 빈 상태를 표시한다', async ({ authenticatedPage: page }) => {
    await mockHomeChatGeneration(page, {
      frames: [
        { event: 'done', data: { sessionId: 's-cal-2', widgets: [{ type: 'calendar', params: {} }] } },
      ],
    });
    // 빈 목록 반환.
    await page.route(
      (url) => url.pathname === '/api/v1/calendar/events',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('오늘 일정 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    await expect(page.getByTestId('chat-widgets')).toBeVisible();
    await expect(page.getByTestId('calendar-empty')).toBeVisible();
    await expect(page.getByTestId('calendar-empty')).toContainText('일정이 없어요');
  });

  test('event 위젯이 단일 일정 상세를 렌더한다', async ({ authenticatedPage: page }) => {
    // compose 는 텍스트 없이 event 위젯(eventId=5) 지시.
    await mockHomeChatGeneration(page, {
      frames: [
        { event: 'done', data: { sessionId: 's-ev-1', widgets: [{ type: 'event', params: { eventId: 5 } }] } },
      ],
    });
    // 단일 일정 상세 API.
    await page.route(
      (url) => url.pathname === '/api/v1/calendar/events/5',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            calendarEvent({
              id: 5,
              title: '기획 발표',
              location: '3층 회의실',
              description: '분기 기획 발표 자료 리뷰',
              startsAt: '2026-06-22T06:00:00Z',
              endsAt: '2026-06-22T07:00:00Z',
            }),
          ),
        }),
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('기획 발표 일정 상세 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    await expect(page.getByTestId('chat-widgets')).toBeVisible();
    const detail = page.getByTestId('event-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('기획 발표');
    await expect(detail).toContainText('3층 회의실');
    await expect(detail).toContainText('분기 기획 발표 자료 리뷰');
  });
});
