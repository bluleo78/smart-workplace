// #460: 홈 챗 도크 채널 목록 위젯 렌더 — show_channels 지시를 받아
// 내 채널 목록(ChannelsWidget)을 렌더하는지 검증한다.
// 전략: compose done SSE 에 widgets:[{type:'channels',params:{}}] 를 포함시키고
//   위젯이 자체 훅으로 호출하는 /messaging/channels 를 모킹하여 백엔드 없이 검증한다.

import type { ChannelResponse } from '../../src/types/messaging';
import { expect, test } from '../fixtures/auth.fixture';

/** 채널 응답 팩토리 — 기본값만 채워 최소한의 ChannelResponse 생성. */
function channel(overrides: Partial<ChannelResponse> & { id: number; name: string }): ChannelResponse {
  return {
    kind: 'CHANNEL',
    visibility: 'PUBLIC',
    member: true,
    role: 'MEMBER',
    archived: false,
    memberCount: 3,
    unreadCount: 0,
    hasUnreadThreads: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

test.describe('#460 홈 챗 도크 채널 목록 위젯 렌더', () => {
  test(
    '채널 목록 위젯이 채널 목록을 렌더한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 1) compose 는 텍스트 없이 channels 위젯만 지시.
      await page.route(
        (url) => url.pathname === '/api/v1/ai/compose',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"sessionId":"s-ch-1","widgets":[{"type":"channels","params":{}}]}\n\n',
          }),
      );
      // 2) 위젯이 호출하는 채널 목록 API.
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/channels',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              channel({ id: 1, name: 'general', kind: 'CHANNEL' }),
              channel({ id: 2, name: 'engineering', kind: 'CHANNEL' }),
              channel({ id: 3, name: '홍길동, 나', kind: 'DM' }),
            ]),
          }),
      );

      await page.goto('/');
      await page.getByTestId('chat-launcher').click();
      await page.getByTestId('chat-input').fill('채널 목록 보여줘');
      await page.getByRole('button', { name: '보내기' }).click();

      // 출력: 위젯 컨테이너 + 채널 목록 행이 렌더된다.
      await expect(page.getByTestId('chat-widgets')).toBeVisible();
      const items = page.getByTestId('channels-items');
      await expect(items).toBeVisible();
      await expect(items).toContainText('general');
      await expect(items).toContainText('engineering');
      await expect(items).toContainText('홍길동, 나');

      // DM 항목 딥링크: /chat/dms/:id 로 라우팅해야 한다(채널은 /chat/channels/:id).
      const dmLink = items.getByRole('link', { name: /채널 열기: 홍길동/ });
      await expect(dmLink).toHaveAttribute('href', '/chat/dms/3');
    },
  );

  test('채널이 없으면 빈 상태를 표시한다', async ({ authenticatedPage: page }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/ai/compose',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-ch-2","widgets":[{"type":"channels","params":{}}]}\n\n',
        }),
    );
    // 빈 목록 반환.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('채널 목록 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    await expect(page.getByTestId('chat-widgets')).toBeVisible();
    await expect(page.getByTestId('channels-empty')).toBeVisible();
    await expect(page.getByTestId('channels-empty')).toContainText('채널이 없어요');
  });
});
