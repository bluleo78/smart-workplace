// #461: 홈 챗 도크 위젯 점진 렌더 — show_* 도구 이벤트(event: tool, phase=start) 도착 즉시
// 위젯을 렌더하는지 검증한다. done 이벤트가 위젯을 늦게(전체 처리 완료 후) 주더라도,
// tool 이벤트만으로 위젯이 떠야 한다. 격리 전략: done.widgets 를 비워두고 tool 이벤트로만
// 위젯을 전달 → 위젯이 보이면 점진 경로(tool 이벤트)로 온 것임이 증명된다.

import { calendarEvent } from '../factories/calendar.factory';
import { expect, test } from '../fixtures/auth.fixture';

test.describe('#461 홈 챗 도크 위젯 점진 렌더', () => {
  test(
    'show_calendar tool 이벤트 도착 즉시 위젯을 렌더한다(done 위젯 없이)',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // tool(start)로 show_calendar 가 도착하고 done.widgets 는 빈 배열.
      // 점진 렌더가 동작하면 tool 이벤트만으로 캘린더 위젯이 떠야 한다.
      await page.route(
        (url) => url.pathname === '/api/v1/ai/compose',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body:
              'event: tool\ndata: {"seq":1,"phase":"start","toolName":"mcp__workplace__show_calendar","args":{"params":{"from":"2026-06-22","to":"2026-06-22"}}}\n\n' +
              'event: tool\ndata: {"seq":1,"phase":"result","toolName":"mcp__workplace__show_calendar","isError":false}\n\n' +
              'event: done\ndata: {"sessionId":"s-prog-1","widgets":[]}\n\n',
          }),
      );
      await page.route(
        (url) => url.pathname === '/api/v1/calendar/events',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              calendarEvent({
                id: 1,
                title: '점진 미팅',
                startsAt: '2026-06-22T02:00:00Z',
                endsAt: '2026-06-22T03:00:00Z',
              }),
            ]),
          }),
      );

      await page.goto('/');
      await page.getByTestId('chat-launcher').click();
      await page.getByTestId('chat-input').fill('오늘 일정 보여줘');
      await page.getByRole('button', { name: '보내기' }).click();

      // done.widgets 가 비어 있으므로, 위젯이 보이면 tool 이벤트(점진 렌더)로 온 것.
      await expect(page.getByTestId('chat-widgets')).toBeVisible();
      await expect(page.getByTestId('calendar-items')).toContainText('점진 미팅');
    },
  );

  test('done.widgets 가 tool 누적을 최종 덮어쓴다(중복 없이)', async ({
    authenticatedPage: page,
  }) => {
    // tool 로 한 번 누적된 뒤 done 이 같은 위젯을 authoritative 로 줘도 캘린더 위젯은 1개만 렌더.
    await page.route(
      (url) => url.pathname === '/api/v1/ai/compose',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body:
            'event: tool\ndata: {"seq":1,"phase":"start","toolName":"mcp__workplace__show_calendar","args":{"params":{"from":"2026-06-22","to":"2026-06-22"}}}\n\n' +
            'event: tool\ndata: {"seq":1,"phase":"result","toolName":"mcp__workplace__show_calendar","isError":false}\n\n' +
            'event: done\ndata: {"sessionId":"s-prog-2","widgets":[{"type":"calendar","params":{"from":"2026-06-22","to":"2026-06-22"}}]}\n\n',
        }),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/calendar/events',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            calendarEvent({
              id: 1,
              title: '중복 점검 미팅',
              startsAt: '2026-06-22T02:00:00Z',
              endsAt: '2026-06-22T03:00:00Z',
            }),
          ]),
        }),
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('오늘 일정 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    await expect(page.getByTestId('calendar-items')).toContainText('중복 점검 미팅');
    // 캘린더 목록 위젯은 정확히 1개여야 한다(tool + done 이중 누적 금지).
    await expect(page.getByTestId('calendar-items')).toHaveCount(1);
  });
});
