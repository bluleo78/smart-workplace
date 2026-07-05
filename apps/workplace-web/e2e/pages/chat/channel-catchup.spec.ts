// 채널 캐치업 카드 E2E — 자동 임계(≥5)/수동 버튼(1~4)/없음(0)/에러 폴백/확인=읽음 5 시나리오.
// 백엔드 없이 page.route() 로 모킹. chat.spec.ts 의 setupChannelStubs 패턴 미러.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChannel, createMessage } from '../../factories/messaging.factory';

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
    (url) => url.pathname === '/api/v1/events',
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
// 미읽음은 "남(authorId=2)이 보낸" 메시지여야 한다 — 내가 보낸 메시지는 미읽음/캐치업 대상이 아니므로(#491).
function readPlusUnread(n: number) {
  const read = createMessage({ id: 100, channelId: CHANNEL_ID, body: '읽은 메시지' });
  const unread = Array.from({ length: n }, (_, i) =>
    createMessage({ id: 101 + i, channelId: CHANNEL_ID, authorId: 2, body: `미읽음 ${i + 1}` }),
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

  // #491 회귀: 다 읽은 방에서 내가 메시지를 보내면(진입-고정 watermark < 내 메시지 id)
  // 유령 미읽음 구분선/캐치업이 부활하면 안 된다. 내 메시지는 미읽음 대상에서 제외돼야 한다.
  test('다 읽은 방에서 내가 보낸 메시지는 유령 구분선/캐치업을 만들지 않는다', async ({ authenticatedPage: page }) => {
    // 진입 시 100까지 다 읽음. 진입 후 내(authorId=1)가 메시지 101 전송 → 목록에 포함.
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100 });
    await setupChannelStubs(page, channel);
    const read = createMessage({ id: 100, channelId: CHANNEL_ID, body: '읽은 메시지' });
    const mine = createMessage({ id: 101, channelId: CHANNEL_ID, authorId: 1, body: '내가 방금 보낸 메시지' });
    await stubMessages(page, [mine, read].sort((a, b) => b.id - a.id));

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('message-list')).toBeVisible();
    await expect(page.getByText('내가 방금 보낸 메시지')).toBeVisible();
    // 내 메시지뿐이므로 미읽음 0 → 구분선·카드·버튼 모두 없음.
    await expect(page.getByTestId('unread-divider')).toHaveCount(0);
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect(page.getByTestId('catchup-summarize-btn')).toHaveCount(0);
  });

  // #491 회귀(보고된 정확한 트리거): 다 읽은 방 진입 후 AI 답글이 SSE 로 "라이브 도착"해도
  // 진입 시점 이후 메시지이므로 유령 구분선/캐치업이 부활하면 안 된다. 진입 스냅샷(entryMaxId)으로 제외.
  test('진입 후 AI 답글이 SSE 로 도착해도 유령 구분선/캐치업이 생기지 않는다', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 100 });
    await setupChannelStubs(page, channel);
    // 진입 시점 목록 = 읽은 메시지 1건(id=100) → entryMaxId=100, 미읽음 0.
    await stubMessages(page, [createMessage({ id: 100, channelId: CHANNEL_ID, body: '읽은 메시지' })]);
    // 스트림 — 테스트가 __emitLive 를 세팅(진입 스냅샷 고정 후)할 때까지 대기 후 AI(authorId=2) 메시지 101 created 발행.
    // LIFO 라우트 우선순위로 setupChannelStubs 의 빈 스트림을 덮어쓴다.
    await page.route(
      (url) => url.pathname === '/api/v1/events',
      async (route) => {
        await page.waitForFunction(() => (window as unknown as { __emitLive?: boolean }).__emitLive === true);
        const live = createMessage({
          id: 101,
          channelId: CHANNEL_ID,
          authorId: 2,
          authorName: 'AI 비서',
          authorKind: 'AGENT',
          body: 'AI 답글 도착',
        });
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: `event: messaging.message.created\ndata: ${JSON.stringify(live)}\n\n`,
        });
      },
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    // 진입 직후: 읽은 메시지만 보이고 미읽음 0 → 구분선 없음.
    await expect(page.getByText('읽은 메시지')).toBeVisible();
    await expect(page.getByTestId('unread-divider')).toHaveCount(0);

    // 진입 스냅샷(entryMaxId=100) 고정 후 라이브 AI 답글 도착 트리거.
    await page.evaluate(() => {
      (window as unknown as { __emitLive?: boolean }).__emitLive = true;
    });
    await expect(page.getByText('AI 답글 도착')).toBeVisible();

    // AI 답글(id=101 > entryMaxId=100)은 진입 후 도착 → 미읽음 아님 → 유령 구분선/캐치업 없음.
    await expect(page.getByTestId('unread-divider')).toHaveCount(0);
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
