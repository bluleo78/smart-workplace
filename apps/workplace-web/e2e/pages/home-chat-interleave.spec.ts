// #463: 인터리브 렌더 — delta·tool 도착순으로 text↔widget 섞여 렌더.
import { calendarEvent } from '../factories/calendar.factory';
import { expect, test } from '../fixtures/auth.fixture';

test('delta→show_calendar→delta 가 text·widget·text 순서로 렌더', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/ai/chat', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream',
      body:
        'event: delta\ndata: {"text":"오늘 일정입니다: "}\n\n' +
        'event: tool\ndata: {"seq":1,"phase":"start","toolName":"mcp__workplace__show_calendar","args":{"params":{}}}\n\n' +
        'event: delta\ndata: {"text":"확인하세요."}\n\n' +
        'event: done\ndata: {"sessionId":"s1","widgets":[]}\n\n' }));
  await page.route((u) => u.pathname === '/api/v1/calendar/events', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([calendarEvent({ id: 1, title: '인터리브 미팅', startsAt: '2026-06-23T02:00:00Z', endsAt: '2026-06-23T03:00:00Z' })]) }));

  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-input').fill('오늘 일정');
  await page.getByRole('button', { name: '보내기' }).click();

  // DOM 순서 검증: 첫 텍스트 → 캘린더 위젯 → 둘째 텍스트.
  const blocks = page.getByTestId('chat-block');
  await expect(blocks.nth(0)).toContainText('오늘 일정입니다:');
  await expect(blocks.nth(1).getByTestId('calendar-items')).toContainText('인터리브 미팅');
  await expect(blocks.nth(2)).toContainText('확인하세요.');
});
