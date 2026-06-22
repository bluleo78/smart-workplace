// #460: 홈 챗 도크 캘린더 위젯 렌더 — show_calendar / show_event 지시를 받아
// 일정 목록(CalendarWidget) 및 단일 일정 상세(EventWidget)를 렌더하는지 검증한다.
// 전략: compose done SSE 에 widgets:[{type:'calendar',...}] 를 포함시키고
//   위젯이 자체 훅으로 호출하는 /calendar/events 를 모킹하여 백엔드 없이 검증한다.

import { calendarEvent } from '../factories/calendar.factory';
import { expect, test } from '../fixtures/auth.fixture';

test.describe('#460 홈 챗 도크 캘린더 위젯 렌더', () => {
  test(
    '캘린더 위젯이 일정 목록을 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 1) compose 는 텍스트 없이 calendar 위젯만 지시.
      await page.route(
        (url) => url.pathname === '/api/v1/ai/compose',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"sessionId":"s-cal-1","widgets":[{"type":"calendar","params":{}}]}\n\n',
          }),
      );
      // 2) 위젯이 오늘 범위로 호출하는 일정 목록.
      let calendarRequestFrom: string | null = null;
      await page.route(
        (url) => url.pathname === '/api/v1/calendar/events',
        (route) => {
          calendarRequestFrom = new URL(route.request().url()).searchParams.get('from');
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

      // 처리: from 파라미터가 전달됐는지(오늘 범위 계산) 검증.
      expect(calendarRequestFrom).not.toBeNull();
    },
  );

  test('date-only params 를 ISO datetime 범위로 정규화해 호출한다', async ({
    authenticatedPage: page,
  }) => {
    // AI 가 show_calendar 에 date-only("2026-06-22") 를 주는 실제 케이스. 백엔드는
    // @DateTimeFormat(ISO.DATE_TIME) OffsetDateTime 을 요구하므로 위젯이 ISO datetime 으로
    // 정규화해야 한다. date-only 를 그대로 보내면 400 → 위젯 에러(#460 회귀).
    await page.route(
      (url) => url.pathname === '/api/v1/ai/compose',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-cal-3","widgets":[{"type":"calendar","params":{"from":"2026-06-22","to":"2026-06-22"}}]}\n\n',
        }),
    );
    let reqFrom: string | null = null;
    let reqTo: string | null = null;
    await page.route(
      (url) => url.pathname === '/api/v1/calendar/events',
      (route) => {
        const sp = new URL(route.request().url()).searchParams;
        reqFrom = sp.get('from');
        reqTo = sp.get('to');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      },
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('오늘 일정 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();
    await expect(page.getByTestId('calendar-empty')).toBeVisible();

    // from/to 모두 ISO datetime(시각 포함, 'T' 구분자)이어야 하고, 빈 범위(from==to)가 아니어야 한다.
    expect(reqFrom).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(reqTo).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(reqFrom).not.toBe(reqTo);
  });

  test('일정이 없으면 빈 상태를 표시한다', async ({ authenticatedPage: page }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/ai/compose',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-cal-2","widgets":[{"type":"calendar","params":{}}]}\n\n',
        }),
    );
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
    await page.route(
      (url) => url.pathname === '/api/v1/ai/compose',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-ev-1","widgets":[{"type":"event","params":{"eventId":5}}]}\n\n',
        }),
    );
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
