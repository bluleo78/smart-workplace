// messaging 채팅 E2E — 채널 진입 배선(@wiring), 입력기에 실제로 글자를 치는 전송·IME·한도·실패 보존(@input),
// 선택 행 배경·긴 이름 배지·첫 미읽음 스크롤(@layout).
// 브라우저 없이 판정되는 SSE 수신·재연결 배너·LNB 헤더·전환 클래스·미읽음 구분선 순서는 vitest 로 옮겼다(WP-984):
// src/pages/chat/realtime.test.tsx · channelSidebar.test.tsx · messageList.test.tsx.
// 백엔드 없이 page.route() 로 모든 API 모킹.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChannel, createMessage } from '../../factories/messaging.factory';
import { commitImeThenEnterInSameTask } from '../../fixtures/ime';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';
import { expectSelectedRow } from '../../fixtures/selection';

const CHANNEL_ID = 1;
// auth.fixture.ts 의 createUser() 기본 id = 1
const ME_ID = 1;

// 빈 히스토리 GET + 전송 POST 스텁 — messageId 로 확정 응답한다.
async function stubEmptyHistoryWithPost(
  page: import('@playwright/test').Page,
  messageId: number,
) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        });
      }
      const payload = route.request().postDataJSON() as { body: string };
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(createMessage({ id: messageId, channelId: CHANNEL_ID, authorId: ME_ID, body: payload.body })),
      });
    },
  );
}

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

  // GET /messaging/channels/{id} — 채널 상세(헤더). T5 이후 ChannelPage 가 호출.
  for (const ch of channels) {
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${ch.id}`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(ch),
        });
      },
    );
  }

  // GET /events — 통합 SSE 단일 스트림 (#506). 모든 도메인 이벤트(chat·messaging·notify)를 한 커넥션으로.
  await page.route(
    (url) => url.pathname === '/api/v1/events',
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
    '채널 진입 → 히스토리 렌더',
    { tag: ['@wiring', '@smoke'] },
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

  // WP-368 — 열린 채널 행만 선택 표시(막대 + bg-selected + 앞 아이콘 primary), 다른 채널 행엔 없다.
  test('사이드바 — 열린 채널 행만 bg-selected·selection-bar 를 갖는다 (WP-368)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const open = createChannel({ id: CHANNEL_ID, name: 'general', member: true });
    const other = createChannel({ id: 2, name: 'random', member: true });
    await setupChannelStubs(page, [open, other], `:\n\n`);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
          : route.fallback(),
    );
    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    const openLink = page.getByTestId(`channel-link-${CHANNEL_ID}`);
    const otherLink = page.getByTestId('channel-link-2');
    await expectSelectedRow(openLink, otherLink, { current: 'page' });
    // 앞 아이콘(# 또는 잠금)만 primary — 다른 행의 아이콘은 기본 색 그대로.
    const iconColor = (l: typeof openLink) => l.locator('svg').first().evaluate((el) => getComputedStyle(el).color);
    expect(await iconColor(openLink)).not.toBe(await iconColor(otherLink));
  });

  test('메시지 입력 → POST payload 검증 → optimistic 렌더', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true });

    await setupChannelStubs(page, [channel], `:\n\n`);
    const posts = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/messages`);
    await stubEmptyHistoryWithPost(page, 500);

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    // 메시지 입력 및 전송 (Enter 키)
    await page.getByTestId('message-composer-input').click();
    await page.keyboard.type('보낼 메시지');
    await page.keyboard.press('Enter');

    // 서버 확정 메시지 id 500 이 정확히 1개 렌더되어야 함
    await expect(page.getByTestId('message-body-500')).toHaveText('보낼 메시지');
    await expect(page.getByTestId('message-body-500')).toHaveCount(1);
    expect(posts.bodies()).toEqual([{ body: '보낼 메시지' }]);
  });

  // WP-333 — macOS Chrome 은 한글 마지막 글자 조합 중 Enter 에 "확정(DOM 변경) → compositionend → Enter" 를 한 번에 보낸다.
  // 확정 글자가 문서에 반영되기 전에 전송하면 마지막 글자("작")가 빠지거나 조합 중 글자("자")로 나간다.
  test('한글 조합을 끝내는 Enter 로 전송해도 마지막 글자까지 보낸다 (Mac Chrome 순서)', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true });
    await setupChannelStubs(page, [channel], `:\n\n`);
    const posts = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/messages`);
    await stubEmptyHistoryWithPost(page, 502);

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    const input = page.getByTestId('message-composer-input');
    await input.click();
    await page.keyboard.insertText('시');
    await commitImeThenEnterInSameTask(input, { composing: '자', committed: '작' });

    await expect(page.getByTestId('message-body-502')).toHaveText('시작');
    expect(posts.bodies()).toEqual([{ body: '시작' }]);
    // 전송 뒤 입력창에 확정 글자가 남지 않는다(늦게 반영된 글자가 빈 입력창에 되살아나지 않음).
    await expect(input).toHaveText('');
  });

  // 팀 채팅도 이슈 채팅(#357)과 같은 RichInput — Shift+Enter 는 줄바꿈, Enter 는 전송이어야 한다.
  test('Shift+Enter 줄바꿈 → Enter 전송 시 POST body 에 \\n 포함', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true });
    await setupChannelStubs(page, [channel], `:\n\n`);
    const posts = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/messages`);
    await stubEmptyHistoryWithPost(page, 501);

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await page.getByTestId('message-composer-input').click();
    await page.keyboard.type('첫 줄');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('둘째 줄');
    await page.keyboard.press('Enter');

    // 정확히 1건·두 줄 본문 — Shift+Enter 가 전송했다면 '첫 줄' 이 별도 건으로 먼저 들어와 실패한다.
    await expect.poll(() => posts.bodies<{ body: string }>().map((b) => b.body)).toEqual(['첫 줄\n둘째 줄']);
  });
});

// MessageComposer 4000자 한도 프론트엔드 검증 (#165)
// page.evaluate 로 4001자를 TipTap 에 삽입 후 전송 버튼 비활성화 + POST 차단을 검증한다.
test.describe('MessageComposer 4000자 한도 검증', { tag: '@input' }, () => {
  // 채널 스텁 + GET messages 스텁 공통 setup.
  async function setupForLimit(page: import('@playwright/test').Page) {
    const channel = createChannel({ id: CHANNEL_ID, member: true });
    await setupChannelStubs(page, [channel], `:\n\n`);
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
    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await page.getByTestId('message-composer-input').waitFor({ state: 'visible' });
  }

  // TipTap contenteditable 에 텍스트 삽입. keyboard.insertText 는 문자당 keydown 없이
  // 단일 삽입 이벤트로 처리돼 React/TipTap 상태를 올바르게 갱신하면서도(execCommand 미사용)
  // 4000자+ 길이에서 pressSequentially(문자당 이벤트) 대비 CPU 부하가 훨씬 낮다.
  // 5-worker 병렬 풀스위트 실행 시 pressSequentially 가 15s 타임아웃을 넘기던 flake 대응.
  async function insertText(page: import('@playwright/test').Page, text: string) {
    const input = page.getByTestId('message-composer-input');
    await input.click();
    await page.keyboard.insertText(text);
  }

  test('4001자 입력 → 전송 버튼 비활성화 + Enter POST 차단', async ({
    authenticatedPage: page,
  }) => {
    await setupForLimit(page);

    const posts = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/messages`);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({ status: 400 });
      },
    );

    await insertText(page, 'A'.repeat(4001));

    // 전송 버튼 비활성화 검증.
    await expect(page.getByTestId('message-composer-submit')).toBeDisabled();

    // 글자 수 카운터가 "4001 / 4000" 으로 표시되어야 한다.
    await expect(page.getByTestId('char-count')).toBeVisible();
    await expect(page.getByTestId('char-count')).toContainText('4001 / 4000');

    // Enter 키로 전송 시도해도 POST 가 발생하지 않아야 한다.
    await page.getByTestId('message-composer-input').press('Enter');
    await expectStays(page, posts.count, 0);
  });

  test('4000자 이하 → 전송 버튼 활성화 + POST 정상 발송', async ({
    authenticatedPage: page,
  }) => {
    await setupForLimit(page);

    const posts = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/messages`);
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        const saved = createMessage({
          id: 501,
          channelId: CHANNEL_ID,
          authorId: ME_ID,
          body: payload.body,
        });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(saved),
        });
      },
    );

    await insertText(page, 'A'.repeat(4000));

    // 전송 버튼 활성화 검증.
    await expect(page.getByTestId('message-composer-submit')).toBeEnabled();

    // Enter 전송 → POST payload 에 4000자가 그대로 담겨야 한다.
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('message-body-501')).toBeVisible();
    expect(posts.lastBody<{ body: string }>()?.body).toHaveLength(4000);
  });
});

// 메시지 전송 실패 시 입력 텍스트 보존 (#169)
// POST 가 503 으로 실패할 때 입력창 텍스트가 사라지지 않아야 한다(clearOnSubmit 성공 시에만).
test.describe('MessageComposer 전송 실패 입력 보존', { tag: '@input' }, () => {
  test('메시지 POST 503 실패 → 입력창 텍스트 보존', async ({ authenticatedPage: page }) => {
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

    // POST messages — 503 반환(전송 실패 시뮬레이션)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({ status: 503, body: JSON.stringify({ message: '서비스 불가' }) });
      },
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);
    await page.getByTestId('message-composer-input').waitFor({ state: 'visible' });

    // 메시지 입력 후 전송
    await page.getByTestId('message-composer-input').click();
    await page.keyboard.type('재전송해야 할 중요한 메시지');
    await page.keyboard.press('Enter');

    // 전송 실패 후에도 입력창에 텍스트가 그대로 남아있어야 한다 (#169)
    await expect(page.getByTestId('message-composer-input')).toContainText('재전송해야 할 중요한 메시지');
  });
});

// 회귀 — 긴 채널명 옆 미읽음 배지(99+)가 이름에 밀려 찌그러지지 않는다(배지 shrink-0).
test('대화 사이드바 — 긴 채널명이어도 미읽음 배지가 줄어들지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const longName = 'smart-workplace-모바일-개선-태스크포스-2026-하반기-로드맵'
  await setupChannelStubs(
    page,
    [createChannel({ id: CHANNEL_ID, member: true, name: longName, unreadCount: 150 })],
    `:\n\n`,
  );
  await page.goto(`/chat/channels/${CHANNEL_ID}`);
  const badge = page.getByTestId(`channel-unread-${CHANNEL_ID}`);
  await expect(badge).toHaveText('99+');
  // 배지 내용이 잘리지 않고(스크롤폭 ≤ 표시폭) 행 안에 온전히 들어온다.
  expect(await badge.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const row = (await page.getByTestId(`channel-link-${CHANNEL_ID}`).boundingBox())!;
  const b = (await badge.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(row.x + row.width);
});

// 진입 시 첫 미읽음(구분선)으로 스크롤 — 30개 메시지(id 1~30), watermark=10 이면
// 구분선이 뷰포트 안에 보여야 하고(맨 아래가 아님) 메시지 30개가 모두 로드된다.
test('진입 시 첫 미읽음(구분선)으로 스크롤된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 미읽음(id>10)은 남(authorId=2)이 보낸 메시지여야 구분선이 뜬다 — 내 메시지는 미읽음 제외(#491).
  const many = Array.from({ length: 30 }, (_, i) => createMessage({ id: i + 1, channelId: 78, authorId: 2, createdAt: new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString() }))
  const channel = createChannel({ id: 78, lastReadMessageId: 10 })

  await setupChannelStubs(page, [channel], `:\n\n`)

  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels/78/messages',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [...many].reverse(), nextCursor: null, hasMore: false }),
      })
    },
  )

  await page.goto('/chat/channels/78')

  // 구분선(id=11 앞)이 로드 직후 뷰포트 안에 보여야 한다(맨 아래로 가지 않음).
  const divider = page.getByTestId('unread-divider')
  await expect(divider).toBeInViewport()
})
