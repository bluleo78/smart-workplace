// DM 캐치업 카드 E2E — channel-catchup.spec.ts 의 DM 표면 미러.
// DmPage 는 useMyDms(목록)로 렌더 + useChannelDetail(dmId)로 watermark 획득 → 두 경로 모두 모킹.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChannel, createDm, createMessage } from '../../factories/messaging.factory';
import { mockGatedEvents } from '../../fixtures/gatedEvents';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

const DM_ID = 100;

async function setupDmStubs(
  page: import('@playwright/test').Page,
  detail: ReturnType<typeof createChannel>,
) {
  // DM 목록 — DmPage 가 dms.find(id) 로 현재 DM 객체(헤더·참가자) 획득.
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const dm = createDm({ id: DM_ID });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([dm]) });
    },
  );
  // 채널 상세 — DM 도 채널이므로 useChannelDetail 가 여기서 watermark(lastReadMessageId) 획득.
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
    },
  );
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: `:\n\n` }),
  );
}

async function stubMessages(page: import('@playwright/test').Page, items: ReturnType<typeof createMessage>[]) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, nextCursor: null, hasMore: false }) });
    },
  );
}

// 미읽음은 "상대(authorId=2)가 보낸" 메시지여야 한다 — 내가 보낸 메시지는 미읽음/캐치업 대상이 아니므로(#491).
function readPlusUnread(n: number) {
  const read = createMessage({ id: 100, channelId: DM_ID, body: '읽은 메시지' });
  const unread = Array.from({ length: n }, (_, i) =>
    createMessage({ id: 101 + i, channelId: DM_ID, authorId: 2, body: `미읽음 ${i + 1}` }),
  );
  return [...unread, read].sort((a, b) => b.id - a.id);
}

const SAMPLE_CATCHUP = {
  unreadCount: 6,
  decisions: [{ text: '점심 12시로 확정', sourceMessageIds: [101] }],
  yourTurn: [{ messageId: 105, authorName: '밥', snippet: '답장 줘' }],
  discussion: [{ text: '주말 약속 조율', sourceMessageIds: [102] }],
};

test.describe('DM 캐치업 카드', () => {
  test('미읽음 5건 이상이면 캐치업 카드가 자동으로 뜬다', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: 100 });
    await setupDmStubs(page, detail);
    await stubMessages(page, readPlusUnread(6));
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/catchup`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
    );

    await page.goto(`/chat/dms/${DM_ID}`);

    await expect(page.getByTestId('catchup-card')).toBeVisible();
    // 섹션 헤더: 이모지 → lucide 아이콘으로 교체됨. 텍스트만 검증.
    await expect(page.getByText('내 차례')).toBeVisible();
    await expect(page.getByText('점심 12시로 확정')).toBeVisible();
  });

  test('미읽음 1~4건이면 ✨요약 버튼만, 클릭 시 카드', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: 100 });
    await setupDmStubs(page, detail);
    await stubMessages(page, readPlusUnread(2));
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/catchup`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ unreadCount: 2, decisions: [], yourTurn: [], discussion: [{ text: '짧은 얘기', sourceMessageIds: [101] }] }),
        }),
    );

    await page.goto(`/chat/dms/${DM_ID}`);

    await expect(page.getByTestId('catchup-summarize-btn')).toBeVisible();
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await page.getByTestId('catchup-summarize-btn').click();
    await expect(page.getByTestId('catchup-card')).toBeVisible();
    await expect(page.getByText('짧은 얘기')).toBeVisible();
  });

  test('미읽음 0건이면 카드도 버튼도 없다', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: 200 });
    await setupDmStubs(page, detail);
    await stubMessages(page, readPlusUnread(6)); // 모든 id <= 200 → 미읽음 0

    await page.goto(`/chat/dms/${DM_ID}`);

    await expect(page.getByTestId('message-list')).toBeVisible();
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect(page.getByTestId('catchup-summarize-btn')).toHaveCount(0);
  });

  // #491 회귀: 다 읽은 DM 에서 내가 메시지를 보내면 유령 구분선/캐치업이 부활하면 안 된다.
  test('다 읽은 DM 에서 내가 보낸 메시지는 유령 구분선/캐치업을 만들지 않는다', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: 100 });
    await setupDmStubs(page, detail);
    const read = createMessage({ id: 100, channelId: DM_ID, body: '읽은 메시지' });
    const mine = createMessage({ id: 101, channelId: DM_ID, authorId: 1, body: '내가 방금 보낸 메시지' });
    await stubMessages(page, [mine, read].sort((a, b) => b.id - a.id));

    await page.goto(`/chat/dms/${DM_ID}`);

    await expect(page.getByTestId('message-list')).toBeVisible();
    await expect(page.getByText('내가 방금 보낸 메시지')).toBeVisible();
    await expect(page.getByTestId('unread-divider')).toHaveCount(0);
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect(page.getByTestId('catchup-summarize-btn')).toHaveCount(0);
  });

  test('"확인했어요" 클릭 시 POST /read + 카드 사라짐', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: 100 });
    await setupDmStubs(page, detail);
    await stubMessages(page, readPlusUnread(6));
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/catchup`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
    );
    const reads = trackRequests(page, 'POST', `/api/v1/messaging/channels/${DM_ID}/read`);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/read`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({ status: 204 });
      },
    );

    await page.goto(`/chat/dms/${DM_ID}`);
    await expect(page.getByTestId('catchup-confirm')).toBeVisible();
    await page.getByTestId('catchup-confirm').click();
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect.poll(() => reads.lastBody<{ uptoMessageId: number }>()?.uptoMessageId).toBe(106);
  });
});

// WP-256: 새 DM 은 생성 시 메시지가 0건이라 양쪽 모두 서버 읽음 기준점이 null 이다.
// null→0 해석으로 캐치업 카드/버튼이 떠야 한다(서버 배지·요약 coalesce 와 일치). 구분선은 현행 유지.
test.describe('DM 캐치업 — 기준점 null(새 DM)', () => {
  function othersFromStart(n: number) {
    return Array.from({ length: n }, (_, i) =>
      createMessage({ id: 1 + i, channelId: DM_ID, authorId: 2, body: `새 DM 대화 ${i + 1}` }),
    ).sort((a, b) => b.id - a.id);
  }

  test('미읽음 5건 이상이면 카드가 자동으로 뜨고 since=0 으로 요약한다', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: null });
    await setupDmStubs(page, detail);
    await stubMessages(page, othersFromStart(6));
    const catchupCalls = trackRequests(page, 'GET', `/api/v1/messaging/channels/${DM_ID}/catchup`);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/catchup`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
    );

    await page.goto(`/chat/dms/${DM_ID}`);

    await expect(page.getByTestId('catchup-card')).toBeVisible();
    await expect(page.getByText('점심 12시로 확정')).toBeVisible();
    await expect.poll(() => catchupCalls.lastUrl()?.searchParams.get('since')).toBe('0');
    await expect(page.getByTestId('unread-divider')).toHaveCount(0);
  });

  test('미읽음 1~4건이면 ✨요약 버튼이 뜬다', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: null });
    await setupDmStubs(page, detail);
    await stubMessages(page, othersFromStart(2));

    await page.goto(`/chat/dms/${DM_ID}`);

    await expect(page.getByTestId('catchup-summarize-btn')).toBeVisible();
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
  });

  // #491 회귀 가드: 빈 DM 에 머무는 중 상대 첫 메시지가 라이브로 도착해도 유령 캐치업이 뜨면 안 된다.
  test('빈 DM 진입 후 상대 첫 메시지가 SSE 로 도착해도 캐치업/구분선이 생기지 않는다', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: null });
    await setupDmStubs(page, detail);
    await stubMessages(page, []);
    // SSE 는 빈 상태 확인(진입 스냅샷 고정) 뒤에만 흘려보낸다.
    const events = await mockGatedEvents(page);
    await page.goto(`/chat/dms/${DM_ID}`);
    await expect(page.getByTestId('chat-empty-state')).toBeVisible();

    const live = createMessage({ id: 1, channelId: DM_ID, authorId: 2, authorName: '밥', body: '상대 첫 메시지' });
    events.deliver(`event: messaging.message.created\ndata: ${JSON.stringify(live)}\n\n`);
    await expect(page.getByText('상대 첫 메시지')).toBeVisible();

    // 버튼은 메시지와 같은 커밋이 아니라 뒤이은 렌더에서 나타날 수 있어 즉시 0 판정은 결함을 놓친다
    // (스냅샷 수정 전 코드로 확인) → 일정 시간 0 유지로 부재를 확인한다.
    await expectStays(page, () => page.getByTestId('catchup-summarize-btn').count(), 0, { ms: 1000 });
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect(page.getByTestId('unread-divider')).toHaveCount(0);
  });
});

// WP-256 후속: 새 DM(기준점 null)도 진입 시 상단 카드 윗변으로 스크롤하고, 마지막 메시지가 화면 밖이라 자동 읽음 처리되지 않는다.
// DmPage 는 상세(기준점)가 메시지보다 늦게 와도 앵커를 놓치지 않아야 한다 → 상세 응답을 메시지 뒤로 지연시켜 검증.
test('새 DM — 상세가 늦게 와도 진입 시 카드가 화면 안, 자동 읽음 처리 없음', async ({ authenticatedPage: page }) => {
  const LONG = '주말 약속과 점심 장소, 다음 주 일정 조율에 관한 긴 메시지입니다. '.repeat(6);
  const items = Array.from({ length: 20 }, (_, i) =>
    createMessage({ id: 1 + i, channelId: DM_ID, authorId: 2, body: `${i + 1}번째 — ${LONG}` }),
  ).sort((a, b) => b.id - a.id);
  const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: null });
  await setupDmStubs(page, detail);
  // 상세는 메시지가 화면에 렌더된 뒤에만 응답(LIFO 로 setupDmStubs 의 상세 라우트를 덮음).
  let releaseDetail!: () => void;
  const detailGate = new Promise<void>((r) => (releaseDetail = r));
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await detailGate;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/messages`,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, nextCursor: null, hasMore: false }) });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/catchup`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
  );
  const reads = trackRequests(page, 'POST', `/api/v1/messaging/channels/${DM_ID}/read`);
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/read`,
    (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 204 }) : route.fallback()),
  );

  await page.goto(`/chat/dms/${DM_ID}`);
  // 메시지가 먼저 렌더된 상태(상세 미도착 — 앵커 판단 보류)를 만든 뒤 상세를 흘려보낸다.
  await expect(page.getByTestId('message-20')).toBeAttached();
  releaseDetail();

  await expect(page.getByTestId('catchup-card')).toBeInViewport();
  await expect(page.getByTestId('message-20')).not.toBeInViewport();
  await expectStays(page, reads.count, 0, { ms: 1000 });
});
