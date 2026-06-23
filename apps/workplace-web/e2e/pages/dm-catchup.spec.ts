// DM 캐치업 카드 E2E — channel-catchup.spec.ts 의 DM 표면 미러.
// DmPage 는 useMyDms(목록)로 렌더 + useChannelDetail(dmId)로 watermark 획득 → 두 경로 모두 모킹.

import { expect, test } from '../fixtures/auth.fixture';
import { createChannel, createDm, createMessage } from '../factories/messaging.factory';

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
    (url) => url.pathname === '/api/v1/messaging/stream',
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

function readPlusUnread(n: number) {
  const read = createMessage({ id: 100, channelId: DM_ID, body: '읽은 메시지' });
  const unread = Array.from({ length: n }, (_, i) =>
    createMessage({ id: 101 + i, channelId: DM_ID, body: `미읽음 ${i + 1}` }),
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
    await expect(page.getByText('📌 내 차례')).toBeVisible();
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

  test('"확인했어요" 클릭 시 POST /read + 카드 사라짐', async ({ authenticatedPage: page }) => {
    const detail = createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: 100 });
    await setupDmStubs(page, detail);
    await stubMessages(page, readPlusUnread(6));
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/catchup`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
    );
    let readUpto = -1;
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/read`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        readUpto = (route.request().postDataJSON() as { uptoMessageId: number }).uptoMessageId;
        return route.fulfill({ status: 204 });
      },
    );

    await page.goto(`/chat/dms/${DM_ID}`);
    await expect(page.getByTestId('catchup-confirm')).toBeVisible();
    await page.getByTestId('catchup-confirm').click();
    await expect(page.getByTestId('catchup-card')).toHaveCount(0);
    await expect.poll(() => readUpto).toBe(106);
  });
});
