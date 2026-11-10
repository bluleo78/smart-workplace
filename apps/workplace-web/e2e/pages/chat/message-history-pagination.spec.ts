// 채널·그룹 DM 이전 메시지 위로 스크롤 로딩 E2E(WP-1471, @layout).
// 메시지가 한 페이지(50개)를 넘으면 맨 위로 올렸을 때 앞 페이지를 받아 위에 붙여야 한다 — 고치기 전에는 sentinel 이 없어 요청조차 나가지 않았다.
// jsdom 의 IntersectionObserver 는 빈 구현이라 로드 트리거·스크롤 위치 보존(기하)은 실제 브라우저로만 잴 수 있다.
//  - 진입 시 메시지 목록 요청은 정확히 1회(첫 렌더 scrollTop 0 에서 연쇄 로드하지 않음)
//  - 맨 위로 올리면 cursor 붙은 요청
//  - 앞 페이지가 붙어도 보던 메시지(1페이지 가장 오래된 것)의 화면 위치가 그대로(±2px)
//  - 2페이지 가장 오래된 메시지까지 올라가 볼 수 있다
//  - 2페이지에 있는 메시지 링크(?message)도 여전히 그 메시지에 닿는다(useConversationLinkJump 와 위치 보존이 겹치는 경우)

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { createChannel, createDm, createDmParticipant, createMessage } from '../../factories/messaging.factory';
import { trackRequests } from '../../fixtures/requests';
import { expectStays, gate, nextFrame, stableBox } from '../../fixtures/wait';

const CHANNEL_ID = 1;
const DM_ID = 100;
// 1페이지 = id 66..17(최신 50개), 2페이지 = id 16..1(마지막 페이지).
const NEWEST = 66;
const PAGE1_OLDEST = 17;
const PAGE2_CURSOR = 'c1';
const BODY = '이전 메시지 페이지 로딩을 확인하는 메시지입니다. 화면을 넘칠 만큼 조금 길게 씁니다.';

// id 범위의 메시지(DESC) — 작성자를 번갈아 행이 묶이지 않게 해 콘텐츠가 화면보다 확실히 길다.
function messagesFor(channelId: number, from: number, to: number) {
  const items = [];
  for (let id = to; id >= from; id--) {
    items.push(createMessage({ id, channelId, authorId: id % 2 === 0 ? 2 : 3, authorName: id % 2 === 0 ? '밥' : '캐럴', body: `${id}번 — ${BODY}` }));
  }
  return items;
}

// GET 한 경로에 JSON 을 돌려준다(다른 메서드는 다음 라우트로).
async function stubGet(page: Page, path: string, body: unknown) {
  await page.route(
    (url) => url.pathname === path,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        : route.fallback(),
  );
}

// 읽음 처리 모킹. SSE(/events)는 fixture 의 기본 「열린 스트림」을 그대로 쓴다 — 유한 본문으로 덮으면 재연결 catch-up 이
// 메시지 목록을 다시 조회해 「진입 시 요청 1회」 판정을 흔든다(WP-59).
async function stubRead(page: Page, channelId: number) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/read`,
    (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 204 }) : route.fallback()),
  );
}

// 메시지 목록 — cursor 없으면 1페이지(nextCursor 있음), cursor=c1 이면 2페이지(마지막). 2페이지 응답은 게이트로 붙잡아
// 「요청은 나갔지만 아직 붙지 않은」 순간에 기준 위치를 잴 수 있게 한다. 요청 기록은 trackRequests 가 맡는다.
async function stubPagedMessages(page: Page, channelId: number, page2Gate: Promise<void>) {
  const path = `/api/v1/messaging/channels/${channelId}/messages`;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const isPage2 = new URL(route.request().url()).searchParams.get('cursor') === PAGE2_CURSOR;
      if (isPage2) await page2Gate;
      const body = isPage2
        ? { items: messagesFor(channelId, 1, PAGE1_OLDEST - 1), nextCursor: null, hasMore: false }
        : { items: messagesFor(channelId, PAGE1_OLDEST, NEWEST), nextCursor: PAGE2_CURSOR, hasMore: true };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );
  return {
    all: trackRequests(page, 'GET', path),
    // 앞 페이지(cursor) 요청만 — 진입 뒤 첫 페이지 재조회(무효화)와 섞이지 않게 따로 센다.
    older: trackRequests(page, 'GET', (url) => url.pathname === path && url.searchParams.get('cursor') === PAGE2_CURSOR),
  };
}

// 메시지 스크롤 영역을 맨 위로 올린다.
async function scrollToTop(page: Page) {
  await page.getByTestId('message-scroll-area').evaluate((el) => {
    el.scrollTop = 0;
  });
}

// 채널 진입 준비 — 읽음 기준점을 최신(66)으로 둬 구분선·캐치업 카드 없이 하단으로 진입한다(앵커가 위면 sentinel 이 바로 보인다).
async function stubChannel(page: Page) {
  const channel = createChannel({ id: CHANNEL_ID, member: true, lastReadMessageId: NEWEST });
  await stubGet(page, '/api/v1/messaging/channels', [channel]);
  await stubGet(page, `/api/v1/messaging/channels/${CHANNEL_ID}`, channel);
  await stubRead(page, CHANNEL_ID);
}

// 그룹 DM(나 + 2명) 진입 준비 — DmPage 는 DM 목록으로 그리고 채널 상세로 기준점을 받는다.
async function stubGroupDm(page: Page) {
  const dm = createDm({
    id: DM_ID,
    participants: [
      createDmParticipant({ userId: 1, name: '나' }),
      createDmParticipant({ userId: 2, name: '밥' }),
      createDmParticipant({ userId: 3, name: '캐럴' }),
    ],
  });
  await stubGet(page, '/api/v1/messaging/dms', [dm]);
  await stubGet(page, `/api/v1/messaging/channels/${DM_ID}`, createChannel({ id: DM_ID, kind: 'DM', member: true, lastReadMessageId: NEWEST }));
  await stubRead(page, DM_ID);
}

// 공통 시나리오 — 진입 1회 요청 → 맨 위로 → cursor 요청 → 붙은 뒤 기준 메시지 위치 유지 → 가장 오래된 메시지 도달.
async function expectOlderPagesLoad(page: Page, path: string, channelId: number) {
  const page2 = gate();
  const requests = await stubPagedMessages(page, channelId, page2.p);
  await page.goto(path);

  await expect(page.getByTestId(`message-${NEWEST}`)).toBeInViewport();
  // 하단 진입 뒤 앞 페이지를 저절로 받지 않는다(첫 렌더 scrollTop 0 이나 앵커 대기 중에 sentinel 이 켜지면 연쇄 로드된다).
  await expectStays(page, requests.all.count, 1, { ms: 1000 });

  // 맨 위로 올리면 앞 페이지(cursor) 요청이 나간다.
  await scrollToTop(page);
  await requests.older.waitFor(1);

  // 응답이 붙기 전 기준 메시지(1페이지 가장 오래된 것)의 화면 위치를 재고, 붙은 뒤 다시 잰다 — 보던 자리가 그대로여야 한다.
  const reference = page.getByTestId(`message-${PAGE1_OLDEST}`);
  await nextFrame(page);
  const before = await stableBox(reference);
  page2.release();
  await expect(page.getByTestId(`message-${PAGE1_OLDEST - 1}`)).toBeAttached();
  await nextFrame(page);
  const after = await stableBox(reference);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);

  // 2페이지 가장 오래된 메시지까지 올라가 볼 수 있고, 마지막 페이지라 더 요청하지 않는다.
  await scrollToTop(page);
  await expect(page.getByTestId('message-1')).toBeInViewport();
  await expectStays(page, requests.older.count, 1, { ms: 500 });
}

test.describe('이전 메시지 위로 스크롤 로딩 (WP-1471)', { tag: '@layout' }, () => {
  test('채널 — 맨 위로 올리면 앞 페이지를 붙이고 보던 위치를 지킨다', async ({ authenticatedPage: page }) => {
    await stubChannel(page);
    await expectOlderPagesLoad(page, `/chat/channels/${CHANNEL_ID}`, CHANNEL_ID);
  });

  test('그룹 DM — 맨 위로 올리면 앞 페이지를 붙이고 보던 위치를 지킨다', async ({ authenticatedPage: page }) => {
    await stubGroupDm(page);
    await expectOlderPagesLoad(page, `/chat/dms/${DM_ID}`, DM_ID);
  });

  // 진입 앵커가 아직 DOM 에 없는 동안(링크 대상이 2페이지) sentinel 이 꺼져 있고, 링크 점프가 받은 2페이지가 붙어도 위치 보존이
  // 앵커 스크롤을 덮어쓰지 않아 그 메시지가 화면 안에 보인다.
  test('채널 — 2페이지에 있는 메시지 링크로 들어오면 그 메시지가 화면 안에 보인다', async ({ authenticatedPage: page }) => {
    await stubChannel(page);
    const requests = await stubPagedMessages(page, CHANNEL_ID, Promise.resolve());
    await page.goto(`/chat/channels/${CHANNEL_ID}?message=5`);

    await expect(page.getByTestId('message-5')).toBeInViewport();
    await expectStays(page, requests.older.count, 1, { ms: 500 });
  });

  // 앞 페이지 요청이 실패하면 자동 로드가 멈추고(같은 실패를 반복하지 않음) 위쪽 로더에 「다시 시도」가 보인다 — 누르면 앞 페이지가 붙는다.
  test('채널 — 앞 페이지 요청이 실패하면 다시 시도로 이어 받는다', async ({ authenticatedPage: page }) => {
    await stubChannel(page);
    const requests = await stubPagedMessages(page, CHANNEL_ID, Promise.resolve());
    // 실패 모드 동안 cursor 요청은 500(앱 정책상 5xx 는 1회 재시도 — 그 재시도도 실패). 나중 등록 라우트가 먼저 받는다.
    let failing = true;
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages` && url.searchParams.get('cursor') === PAGE2_CURSOR,
      (route) => (failing ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) : route.fallback()),
    );
    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await expect(page.getByTestId(`message-${NEWEST}`)).toBeInViewport();

    await scrollToTop(page);
    const retry = page.getByRole('button', { name: '이전 메시지를 불러오지 못했습니다 — 다시 시도' });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    // 실패한 뒤엔 sentinel 이 보여도 저절로 다시 요청하지 않는다.
    const failedCount = requests.older.count();
    await expectStays(page, requests.older.count, failedCount, { ms: 500 });

    failing = false;
    await retry.click();
    await expect(page.getByTestId('message-1')).toBeAttached();
    await expect(page.getByTestId('message-older-loader')).toHaveCount(0);
  });
});
