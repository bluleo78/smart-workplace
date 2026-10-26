// DM 캐치업 카드 E2E — channel-catchup.spec.ts 의 DM 표면 미러. 진입 시 카드 윗변 앵커(스크롤 위치)만 남는다(@layout).
// 자동 임계·요약 버튼·#491 유령 미읽음·「확인했어요」 읽음·기준점 null(since=0)은 src/pages/chat/catchup.test.tsx 가 지킨다(WP-966).
// DmPage 는 useMyDms(목록)로 렌더 + useChannelDetail(dmId)로 watermark 획득 → 두 경로 모두 모킹.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChannel, createDm, createMessage } from '../../factories/messaging.factory';
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

const SAMPLE_CATCHUP = {
  unreadCount: 6,
  decisions: [{ text: '점심 12시로 확정', sourceMessageIds: [101] }],
  yourTurn: [{ messageId: 105, authorName: '밥', snippet: '답장 줘' }],
  discussion: [{ text: '주말 약속 조율', sourceMessageIds: [102] }],
};

// WP-256 후속: 새 DM(기준점 null)도 진입 시 상단 카드 윗변으로 스크롤하고, 마지막 메시지가 화면 밖이라 자동 읽음 처리되지 않는다.
// DmPage 는 상세(기준점)가 메시지보다 늦게 와도 앵커를 놓치지 않아야 한다 → 상세 응답을 메시지 뒤로 지연시켜 검증.
test('새 DM — 상세가 늦게 와도 진입 시 카드가 화면 안, 자동 읽음 처리 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
