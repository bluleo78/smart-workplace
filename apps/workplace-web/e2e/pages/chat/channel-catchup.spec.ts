// 채널 캐치업 카드 E2E — 진입 시 카드 윗변 앵커·바닥 고정처럼 실제 스크롤 위치를 재는 판정만 남는다(@layout).
// 자동 임계(≥5)·요약 버튼(1~4)·#491 유령 미읽음·에러 폴백·「확인했어요」 읽음·기준점 null(since=0)은
// src/pages/chat/catchup.test.tsx 가 지킨다(WP-966). 채널 화면 배선(@wiring)은 chat.spec.ts.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChannel, createMessage } from '../../factories/messaging.factory';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

const CHANNEL_ID = 1;
// 하단 고정 훅이 「바닥 근처」로 보는 거리(useStickToBottom NEAR_BOTTOM_PX) — 이보다 멀면 바닥에 붙지 않은 것이다.
const NEAR_BOTTOM_GUARD_PX = 80;

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

const SAMPLE_CATCHUP = {
  unreadCount: 6,
  decisions: [{ text: '출시일 6/30 확정', sourceMessageIds: [101] }],
  yourTurn: [{ messageId: 105, authorName: '이수진', snippet: '검토 부탁해요' }],
  discussion: [{ text: 'QA 환경 이슈 논의', sourceMessageIds: [102] }],
};

// WP-256 후속: 구분선이 없고 목록 상단에 캐치업 카드/버튼이 있으면 진입 시 그 윗변으로 스크롤한다.
// 바닥에서 시작하면 카드가 화면 밖이고, 마지막 메시지가 보이는 순간 자동 읽음 처리돼 재방문 시 카드도 사라진다.
test.describe('채널 캐치업 — 상단 카드 진입 앵커', { tag: '@layout' }, () => {
  const LONG = '릴리스 일정과 QA 환경 이슈, 고객사 요구사항을 정리한 긴 메시지입니다. '.repeat(6);
  // 남(authorId=2)의 긴 메시지 n건(id start..start+n-1) — 화면을 넘칠 만큼. DESC.
  function longFromOthers(n: number, start: number) {
    return Array.from({ length: n }, (_, i) =>
      createMessage({ id: start + i, channelId: CHANNEL_ID, authorId: 2, body: `${i + 1}번째 — ${LONG}` }),
    ).sort((a, b) => b.id - a.id);
  }
  // 읽음 처리 요청 기록 + 204 응답.
  async function trackReads(page: import('@playwright/test').Page) {
    const reads = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/read`);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/read`,
      (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 204 }) : route.fallback()),
    );
    return reads;
  }
  async function stubCatchup(page: import('@playwright/test').Page) {
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/catchup`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
    );
  }

  test('기준점 null 이면 진입 시 카드가 화면 안, 마지막 메시지는 밖이고 자동 읽음 처리가 나가지 않는다', async ({ authenticatedPage: page }) => {
    await setupChannelStubs(page, createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: null }));
    await stubMessages(page, longFromOthers(20, 1));
    await stubCatchup(page);
    const reads = await trackReads(page);

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('catchup-card')).toBeInViewport();
    await expect(page.getByTestId('message-20')).not.toBeInViewport();
    // 마지막 메시지가 화면 밖이므로 읽음 처리 요청이 나가지 않아야 재방문 시에도 카드가 유지된다.
    await expectStays(page, reads.count, 0, { ms: 1000 });
  });

  test('기준점은 있지만 첫 페이지 전체가 미읽음이어도 같은 규칙으로 카드 윗변에 앵커된다', async ({ authenticatedPage: page }) => {
    // 기준점 50, 로드된 메시지는 101~120 → 위에 읽은 메시지 없음 → 구분선 없음, 카드는 목록 상단.
    await setupChannelStubs(page, createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 50 }));
    await stubMessages(page, longFromOthers(20, 101));
    await stubCatchup(page);
    const reads = await trackReads(page);

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('catchup-card')).toBeInViewport();
    await expect(page.getByTestId('unread-divider')).toHaveCount(0);
    await expect(page.getByTestId('message-120')).not.toBeInViewport();
    await expectStays(page, reads.count, 0, { ms: 1000 });
  });

  test('요약 버튼(미읽음 1~4)만 있을 때도 버튼이 화면 안에서 시작한다', async ({ authenticatedPage: page }) => {
    // 미읽음 2건(남) + 그 뒤 내 메시지 다수 — 내 메시지는 미읽음이 아니므로 버튼 게이트(1~4) 유지.
    const others = longFromOthers(2, 1);
    const mine = Array.from({ length: 18 }, (_, i) =>
      createMessage({ id: 3 + i, channelId: CHANNEL_ID, authorId: 1, body: `내 메시지 ${i + 1} — ${LONG}` }),
    );
    await setupChannelStubs(page, createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: null }));
    await stubMessages(page, [...mine, ...others].sort((a, b) => b.id - a.id));

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    await expect(page.getByTestId('catchup-summarize-btn')).toBeInViewport();
    await expect(page.getByTestId('message-20')).not.toBeInViewport();
  });
});

// 구분선 앵커(center)로 진입한 채널 — 기준점 110 → 111~120 미읽음. 아래 바닥 고정 테스트들이 같은 진입을 쓴다. 메시지 스크롤 영역을 돌려준다.
async function openAnchoredChannel(page: import('@playwright/test').Page) {
  const LONG = '앵커 진입 후 바닥 고정을 확인하는 긴 메시지입니다. '.repeat(6);
  const items = Array.from({ length: 20 }, (_, i) =>
    createMessage({ id: 101 + i, channelId: CHANNEL_ID, authorId: 2, body: `${i + 1}번째 — ${LONG}` }),
  ).sort((a, b) => b.id - a.id);
  await setupChannelStubs(page, createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: 110 }));
  await stubMessages(page, items);
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/catchup`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SAMPLE_CATCHUP) }),
  );
  await page.goto(`/chat/channels/${CHANNEL_ID}`);
  await expect(page.getByTestId('unread-divider')).toBeInViewport();
  return page.getByTestId('message-scroll-area');
}

// 앵커 진입 후 사용자가 바닥까지 내려 읽으면 다시 하단 고정 — 이후 콘텐츠가 비동기로 커져도(이미지·마크다운) 바닥을 따라가야 한다.
// 앵커 스크롤 완료 뒤 "앵커 대기" 상태가 남으면 ResizeObserver 가 하단 고정을 포기한다.
test('구분선 앵커로 진입 후 바닥까지 내리면 콘텐츠가 커져도 바닥에 붙어 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const area = await openAnchoredChannel(page);
  const distFromBottom = () => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await area.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(distFromBottom).toBeLessThanOrEqual(1);

  // 마지막 메시지 높이가 뒤늦게 커지는 상황(이미지 로드 등)을 흉내 낸다.
  await page.getByTestId('message-120').evaluate((el) => {
    const grow = document.createElement('div');
    grow.style.height = '400px';
    el.appendChild(grow);
  });
  await expect.poll(distFromBottom).toBeLessThanOrEqual(1);
});

// WP-1200 — 바닥까지 내린 스크롤의 scroll 이벤트보다 콘텐츠 성장이 먼저 레이아웃에 들어가면(부하에서 내리기와 성장이 같은 프레임에 옴),
// scroll 처리가 이미 커진 높이로 거리를 재 「바닥에서 400px」로 보고 고정을 켜지 않았다 — 뒤이은 ResizeObserver 도 고정이 꺼져 있어
// 따라가지 않았다(392px 떨어짐). 위 테스트는 두 일이 다른 프레임에 오면 통과해 부하에서만 깨졌다 — 여기서는 한 번에 일으켜 순서를 고정한다.
test('구분선 앵커 진입 뒤 바닥까지 내린 같은 순간 콘텐츠가 커져도 바닥을 따라간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const area = await openAnchoredChannel(page);
  // 바닥까지 내리고, scroll 이벤트가 처리되기 전에(같은 작업 안에서) 마지막 메시지를 키운다.
  await area.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    const grow = document.createElement('div');
    grow.style.height = '400px';
    el.querySelector('[data-testid="message-120"]')!.appendChild(grow);
  });
  const distFromBottom = () => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await expect.poll(distFromBottom).toBeLessThanOrEqual(1);
});

// WP-1200 반대쪽 — 바닥에서 떨어져 읽는 중에 화면 위쪽 메시지가 커져도 바닥으로 끌어내리지 않는다(바닥의 마지막 메시지가 보이면
// 읽음 처리까지 된다). 위 보정이 「성장 전 맨 끝에 멈춘 스크롤」만 바닥으로 보는 이유를 지키는 테스트다. 다만 Chromium 은 위쪽 성장의
// 스크롤 앵커링 보정을 ResizeObserver 가 같은 프레임에 먼저 관측해 이 보정 분기에 닿지 않으므로, 판정 창을 넓힌 변형도 여기서는 통과한다 —
// 위쪽 성장 전반의 회귀(앵커링·하단 고정이 위치를 흔드는 것)를 잡는 용도다.
test('구분선 앵커 진입 뒤 화면 위쪽 메시지가 커져도 읽던 위치를 지키고 바닥으로 끌어내리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const area = await openAnchoredChannel(page);
  const distFromBottom = () => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  // 화면 위의 첫 메시지를 「지금 바닥까지 거리 − 40px」만큼 키운다 — 성장 전 높이로 재면 바닥에서 40px(80px 안쪽)가 되는 크기다.
  const before = await area.evaluate((el) => {
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const grow = document.createElement('div');
    grow.style.height = `${dist - 40}px`;
    el.querySelector('[data-testid="message-101"]')!.appendChild(grow);
    return dist;
  });
  expect(before).toBeGreaterThan(NEAR_BOTTOM_GUARD_PX);
  // 앵커링이 위치를 보정하는 동안 바닥에서의 거리는 그대로여야 한다(바닥으로 끌려가면 0 이 된다).
  await expectStays(page, async () => (await distFromBottom()) > NEAR_BOTTOM_GUARD_PX, true, { ms: 1000 });
});

// WP-1076 — 앵커 진입 뒤 보이는 높이가 먼저 바뀌고(입력창·카드 높이 변화) 사용자가 바닥까지 내리면, 높이가 바뀐 뒤 첫 scroll 이
// 그 스크롤이다. 이 scroll 을 「높이 변화 보정」으로만 보고 끝내면 바닥에 와 있어도 고정이 돌아오지 않아 콘텐츠 성장을 놓쳤다.
// 위 테스트는 높이 변화와 스크롤의 순서가 타이밍에 달려 가끔만 깨졌다 — 여기서는 높이를 먼저 줄여 순서를 고정한다.
test('구분선 앵커 진입 뒤 보이는 높이가 줄고 나서 바닥까지 내려도 콘텐츠 성장을 따라간다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const area = await openAnchoredChannel(page);
  // 보이는 높이를 먼저 40px 줄인다 — scrollTop 이 그대로라 scroll 이벤트 없이 높이만 바뀐다(입력창이 커진 것과 같다).
  // 재기와 줄이기를 한 번에 한다 — 둘을 나눠 부르면 그 사이 입력창·카드 높이가 바뀌어(부하에서) 잰 값과 줄인 기준이 어긋났다(WP-1087).
  // 메시지 영역은 div 다 — offsetHeight 는 HTMLElement 에만 있어 타입을 좁힌다(E2E 타입 검사).
  const before = await area.evaluate((el: HTMLElement) => {
    const clientHeight = el.clientHeight;
    // flex 를 풀기 전에 잰다 — 풀고 나면 높이가 콘텐츠 높이로 커진다.
    const h = el.offsetHeight - 40;
    el.style.flex = 'none';
    el.style.height = `${h}px`;
    return clientHeight;
  });
  await expect.poll(() => area.evaluate((el) => el.clientHeight)).toBe(before - 40);

  const distFromBottom = () => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  await area.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(distFromBottom).toBeLessThanOrEqual(1);

  await page.getByTestId('message-120').evaluate((el) => {
    const grow = document.createElement('div');
    grow.style.height = '400px';
    el.appendChild(grow);
  });
  await expect.poll(distFromBottom).toBeLessThanOrEqual(1);
});
