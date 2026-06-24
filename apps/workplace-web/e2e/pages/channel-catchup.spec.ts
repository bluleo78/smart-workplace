// 채널 캐치업 카드 E2E — 자동 임계(≥5)/수동 버튼(1~4)/없음(0)/에러 폴백/확인=읽음 5 시나리오.
// 백엔드 없이 page.route() 로 모킹. chat.spec.ts 의 setupChannelStubs 패턴 미러.

import { expect, test } from '../fixtures/auth.fixture';
import { createChannel, createMessage } from '../factories/messaging.factory';

const CHANNEL_ID = 1;

// 채널 목록/상세/SSE 공통 모킹.
async function setupChannelStubs(
  page: import('@playwright/test').Page,
  channel: ReturnType<typeof createChannel>,
) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) });
    },
  );
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: `:\n\n`,
      }),
  );
}

// 미읽음 메시지 목록 모킹(DESC). watermark 위 read 메시지 1건 포함 → 구분선이 보이고 카드가 그 아래 렌더.
async function stubMessages(page: import('@playwright/test').Page, items: ReturnType<typeof createMessage>[]) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
      });
    },
  );
}

// read(100) + unread(101..100+n) — DESC 정렬로 반환.
function readPlusUnread(n: number) {
  const read = createMessage({ id: 100, channelId: CHANNEL_ID, body: '읽은 메시지' });
  const unread = Array.from({ length: n }, (_, i) =>
    createMessage({ id: 101 + i, channelId: CHANNEL_ID, body: `미읽음 ${i + 1}` }),
  );
  return [...unread, read].sort((a, b) => b.id - a.id); // DESC
}

const SAMPLE_CATCHUP = {
  unreadCount: 6,
  decisions: [{ text: '출시일 6/30 확정', sourceMessageIds: [101] }],
  yourTurn: [{ messageId: 105, authorName: '이수진', snippet: '검토 부탁해요' }],
  discussion: [{ text: 'QA 환경 이슈 논의', sourceMessageIds: [102] }],
};

test.describe('채널 캐치업 카드', () => {
  test('미읽음 5건 이상이면 캐치업 카드가 자동으로 뜨고 3묶음이 렌더된다', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100 });
    await setupChannelStubs(page, channel);
    await stubMessages(page, readPlusUnread(6)); // 미읽음 6
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/catchup`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('catchup-card')).toBeVisible();
    // 섹션 헤더: 이모지 → lucide 아이콘으로 교체됨. 텍스트만 검증.
    await expect(page.getByText('결정된 것')).toBeVisible();
    await expect(page.getByText('내 차례')).toBeVisible();
    await expect(page.getByText('오간 이야기')).toBeVisible();
    await expect(page.getByText('출시일 6/30 확정')).toBeVisible();
  });

  test('미읽음 1~4건이면 자동 카드 없이 ✨요약 버튼만, 클릭 시 카드 등장', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100 });
    await setupChannelStubs(page, channel);
    await stubMessages(page, readPlusUnread(2)); // 미읽음 2
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/catchup`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ unreadCount: 2, decisions: [], yourTurn: [], discussion: [{ text: '짧은 논의', sourceMessageIds: [101] }] }),
        }),
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('catchup-summarize-btn')).toBeVisible();
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);

    await page.getByTestId('catchup-summarize-btn').click();
    await expect(page.getByTestId('catchup-card')).toBeVisible();
    await expect(page.getByText('짧은 논의')).toBeVisible();
  });

  test('미읽음 0건이면 카드도 버튼도 없다', async ({ authenticatedPage: page }) => {
    // watermark 가 최신 이상 → 미읽음 0.
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 200 });
    await setupChannelStubs(page, channel);
    await stubMessages(page, readPlusUnread(6)); // 모든 id <= 200 이므로 미읽음 0

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('message-list')).toBeVisible();
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect(page.getByTestId('catchup-summarize-btn')).toHaveCount(0);
  });

  test('catchup API 실패 시 에러 폴백, 메시지 리스트는 정상', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100 });
    await setupChannelStubs(page, channel);
    await stubMessages(page, readPlusUnread(6));
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/catchup`,
      (route) => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'AI 실패' }) }),
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('catchup-error')).toBeVisible();
    await expect(page.getByTestId('message-list')).toBeVisible();
  });

  test('내 차례가 3건을 넘으면 3건만 보이고 "+N건 더" 표기', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100 });
    await setupChannelStubs(page, channel);
    await stubMessages(page, readPlusUnread(6));
    const yourTurn = Array.from({ length: 4 }, (_, i) => ({
      messageId: 101 + i,
      authorName: `사람${i + 1}`,
      snippet: `요청 ${i + 1}`,
    }));
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/catchup`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ unreadCount: 6, decisions: [], yourTurn, discussion: [] }),
        }),
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('catchup-card')).toBeVisible();
    await expect(page.getByText('요청 1')).toBeVisible();
    await expect(page.getByText('요청 3')).toBeVisible();
    await expect(page.getByText('요청 4')).toHaveCount(0);
    await expect(page.getByTestId('catchup-yourturn-more')).toHaveText('+1건 더');
  });

  test('"확인했어요" 클릭 시 읽음 처리(POST /read) 호출 + 카드 사라짐', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100 });
    await setupChannelStubs(page, channel);
    await stubMessages(page, readPlusUnread(6));
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/catchup`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
    );

    let readUpto = -1;
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/read`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        readUpto = (route.request().postDataJSON() as { uptoMessageId: number }).uptoMessageId;
        return route.fulfill({ status: 204 });
      },
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await expect(page.getByTestId('catchup-confirm')).toBeVisible();

    await page.getByTestId('catchup-confirm').click();

    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect.poll(() => readUpto).toBe(106); // 최신 미읽음 id 까지 읽음 처리
  });
});
