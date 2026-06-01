// messaging 채팅 E2E — 히스토리 렌더 / SSE 수신 / 메시지 전송 3가지 시나리오.
// 백엔드 없이 page.route() 로 모든 API 모킹.

import { expect, test } from '../fixtures/auth.fixture';
import { createChannel, createMessage } from '../factories/messaging.factory';

const CHANNEL_ID = 1;
// auth.fixture.ts 의 createUser() 기본 id = 1
const ME_ID = 1;

// 채널 목록 + SSE 스트림을 공통으로 모킹하는 헬퍼.
async function setupChannelStubs(
  page: import('@playwright/test').Page,
  channels: ReturnType<typeof createChannel>[],
  sseBody: string,
) {
  // GET /messaging/channels — 채널 목록
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channels),
      });
    },
  );

  // GET /messaging/stream — SSE (fetch + ReadableStream 방식이므로 canned body 사용)
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: sseBody,
      }),
  );
}

test.describe('messaging 채팅 E2E', () => {
  test(
    '@smoke 채널 진입 → 히스토리 렌더',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const channel = createChannel({ id: CHANNEL_ID, member: true });
      const historyMsg = createMessage({ id: 10, channelId: CHANNEL_ID, body: '기존 메시지' });

      await setupChannelStubs(page, [channel], `:\n\n`);

      // GET /messaging/channels/1/messages — 히스토리 1건
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [historyMsg], nextCursor: null, hasMore: false }),
          });
        },
      );

      await page.goto(`/chat/channels/${CHANNEL_ID}`);

      await expect(page.getByTestId(`message-body-10`)).toHaveText('기존 메시지');
    },
  );

  test('SSE 로 도착한 메시지가 POST 없이 렌더된다', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true });
    const sseMsg = createMessage({ id: 999, channelId: CHANNEL_ID, body: 'SSE 실시간' });
    const sseBody =
      `event: messaging.message.created\n` +
      `data: ${JSON.stringify(sseMsg)}\n\n`;

    await setupChannelStubs(page, [channel], sseBody);

    // GET messages — 빈 목록 (SSE 로만 도착해야 함)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        });
      },
    );

    // POST messages — SSE 전용 테스트에서 POST 가 불려서는 안 됨 → 404 로 가시적 오류 유발
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({ status: 404 });
      },
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByText('SSE 실시간')).toBeVisible();
  });

  test('메시지 입력 → POST payload 검증 → optimistic 렌더', async ({
    authenticatedPage: page,
  }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true });

    await setupChannelStubs(page, [channel], `:\n\n`);

    // GET messages — 빈 목록
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        });
      },
    );

    // POST messages — payload 검증 후 201 확정 응답
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        expect(payload).toEqual({ body: '보낼 메시지' });
        const saved = createMessage({
          id: 500,
          channelId: CHANNEL_ID,
          authorId: ME_ID,
          body: '보낼 메시지',
        });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(saved),
        });
      },
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    // 메시지 입력 및 전송 (Enter 키)
    await page.getByTestId('message-composer-input').click();
    await page.keyboard.type('보낼 메시지');
    await page.keyboard.press('Enter');

    // 서버 확정 메시지 id 500 이 정확히 1개 렌더되어야 함
    await expect(page.getByTestId('message-body-500')).toHaveText('보낼 메시지');
    await expect(page.getByTestId('message-body-500')).toHaveCount(1);
  });
});
