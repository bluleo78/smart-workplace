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

// MessageComposer 4000자 한도 프론트엔드 검증 (#165)
// page.evaluate 로 4001자를 TipTap 에 삽입 후 전송 버튼 비활성화 + POST 차단을 검증한다.
test.describe('MessageComposer 4000자 한도 검증', () => {
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

  // TipTap contenteditable 에 텍스트 삽입. pressSequentially 로 키보드 이벤트를 발생시켜
  // React/TipTap 상태를 올바르게 갱신한다 (deprecated execCommand 대체).
  async function insertText(page: import('@playwright/test').Page, text: string) {
    const input = page.getByTestId('message-composer-input');
    await input.click();
    await input.pressSequentially(text, { delay: 0 });
  }

  test('4001자 입력 → 전송 버튼 비활성화 + Enter POST 차단', async ({
    authenticatedPage: page,
  }) => {
    await setupForLimit(page);

    // POST 가 발생하면 실패로 기록한다.
    let postFired = false;
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        postFired = true;
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
    expect(postFired).toBe(false);
  });

  test('4000자 이하 → 전송 버튼 활성화 + POST 정상 발송', async ({
    authenticatedPage: page,
  }) => {
    await setupForLimit(page);

    let capturedBody: string | null = null;
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        capturedBody = payload.body;
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
    expect(capturedBody).toHaveLength(4000);
  });
});

// 메시지 전송 실패 시 입력 텍스트 보존 (#169)
// POST 가 503 으로 실패할 때 입력창 텍스트가 사라지지 않아야 한다(clearOnSubmit 성공 시에만).
test.describe('MessageComposer 전송 실패 입력 보존', () => {
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

// SSE 재연결 배너(#167) — 스트림이 끊긴 경우 배너가 표시된다.
test('SSE 끊김 시 재연결 배너가 표시된다 (#167)', async ({ authenticatedPage: page }) => {
  const channel = createChannel({ id: CHANNEL_ID, member: true });

  // 채널 목록 모킹
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([channel]),
      });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channel),
      });
    },
  );
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

  // SSE 스트림 503 — isConnected=false 유지 → 배너 항상 보임
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) => route.fulfill({ status: 503 }),
  );

  await page.goto(`/chat/channels/${CHANNEL_ID}`);

  // SSE 연결 실패 시 배너가 표시되어야 한다
  await expect(page.getByTestId('chat-reconnecting-banner')).toBeVisible();
  // 배너 텍스트 및 ARIA 속성 검증
  await expect(page.getByTestId('chat-reconnecting-banner')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('chat-reconnecting-banner')).toContainText('실시간 연결 중');
});

// LNB 표준화(#98) — 대화 사이드바가 표준 셸(레일과 동일 아이콘+이름 타이틀 헤더)을 갖춘다.
test('대화 사이드바 — 표준 LNB 타이틀 헤더', async ({ authenticatedPage: page }) => {
  await setupChannelStubs(page, [createChannel({ id: CHANNEL_ID, member: true })], `:\n\n`);
  await page.goto(`/chat/channels/${CHANNEL_ID}`);
  const sidebar = page.getByTestId('channel-sidebar');
  await expect(sidebar).toBeVisible();
  // h-14 앱 타이틀 헤더에 "대화"(레일 라벨과 동일) 노출
  await expect(sidebar.getByText('대화', { exact: true })).toBeVisible();
});

// #297 — 채널·DM 링크 hover 배경 전환이 즉시(0ms) 일어나지 않도록 transition-colors 보유.
test('대화 사이드바 — 채널·DM 링크에 transition-colors 적용', async ({ authenticatedPage: page }) => {
  await setupChannelStubs(page, [createChannel({ id: CHANNEL_ID, member: true })], `:\n\n`);
  await page.goto(`/chat/channels/${CHANNEL_ID}`);
  // 채널 링크 — hover 페이드를 위한 transition-colors 유틸리티가 className 에 포함되어야 한다
  await expect(page.getByTestId(`channel-link-${CHANNEL_ID}`)).toHaveClass(/transition-colors/);
  // self-DM("나") 링크도 동일 DM 목록 패턴 → 동일하게 적용
  await expect(page.getByTestId('dm-self-link')).toHaveClass(/transition-colors/);
});

// 회귀(#338) — 팀 채팅 멀티데이 대화에서 날짜 구분선이 렌더되어야 한다.
test('팀 채팅 — 멀티데이 메시지 목록 → 날짜 구분선 삽입 (#338)', async ({
  authenticatedPage: page,
}) => {
  const channel = createChannel({ id: CHANNEL_ID, member: true });

  // 3일에 걸친 메시지 4건: day1 × 2, day2 × 1, day3 × 1
  // MessageList는 DESC 정렬로 수신하므로 역순으로 전달(최신이 앞)
  const messages = [
    createMessage({ id: 13, channelId: CHANNEL_ID, body: 'day3-msg1', createdAt: '2026-06-03T06:00:00Z' }),
    createMessage({ id: 12, channelId: CHANNEL_ID, body: 'day2-msg1', createdAt: '2026-06-02T03:00:00Z' }),
    createMessage({ id: 11, channelId: CHANNEL_ID, body: 'day1-msg2', createdAt: '2026-06-01T10:00:00Z' }),
    createMessage({ id: 10, channelId: CHANNEL_ID, body: 'day1-msg1', createdAt: '2026-06-01T01:00:00Z' }),
  ]

  await setupChannelStubs(page, [channel], `:\n\n`)

  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: messages, nextCursor: null, hasMore: false }),
      })
    },
  )

  await page.goto(`/chat/channels/${CHANNEL_ID}`)

  // 날짜 구분선 3개(첫 메시지 앞 + 날짜 전환 2회)
  await expect(page.getByTestId('date-divider')).toHaveCount(3)

  // 날짜 텍스트 포함 확인
  const dividers = page.getByTestId('date-divider')
  await expect(dividers.nth(0)).toContainText('2026년')
  await expect(dividers.nth(1)).toContainText('2026년')
  await expect(dividers.nth(2)).toContainText('2026년')
});

// 진입 시 첫 미읽음(구분선)으로 스크롤 — 30개 메시지(id 1~30), watermark=10 이면
// 구분선이 뷰포트 안에 보여야 하고(맨 아래가 아님) 메시지 30개가 모두 로드된다.
test('진입 시 첫 미읽음(구분선)으로 스크롤된다', async ({ authenticatedPage: page }) => {
  const many = Array.from({ length: 30 }, (_, i) => createMessage({ id: i + 1, channelId: 78, createdAt: new Date(Date.UTC(2026, 5, 1, 0, i)).toISOString() }))
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

// 미읽음 구분선(#unread-divider) — watermark=2 이면 id=3 메시지 바로 앞에 구분선이 렌더된다.
test('미읽음 구분선이 첫 미읽음 메시지 앞에 렌더된다', async ({ authenticatedPage: page }) => {
  // 채널 상세 watermark=2, 메시지 id 1~4 → 구분선은 id=3 앞.
  const channel = createChannel({ id: 77, lastReadMessageId: 2 })

  await setupChannelStubs(page, [channel], `:\n\n`)

  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels/77/messages',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // MessageList 는 DESC 수신 후 reverse() 로 오래된 메시지를 위에 렌더한다.
          items: [
            createMessage({ id: 4, channelId: 77, createdAt: '2026-06-01T04:00:00Z' }),
            createMessage({ id: 3, channelId: 77, createdAt: '2026-06-01T03:00:00Z' }),
            createMessage({ id: 2, channelId: 77, createdAt: '2026-06-01T02:00:00Z' }),
            createMessage({ id: 1, channelId: 77, createdAt: '2026-06-01T01:00:00Z' }),
          ],
          nextCursor: null,
          hasMore: false,
        }),
      })
    },
  )

  await page.goto('/chat/channels/77')

  const divider = page.getByTestId('unread-divider')
  await expect(divider).toBeVisible()

  // 구분선의 Y 가 message-2 아래, message-3 위.
  const yDivider = (await divider.boundingBox())!.y
  const y2 = (await page.getByTestId('message-2').boundingBox())!.y
  const y3 = (await page.getByTestId('message-3').boundingBox())!.y
  expect(y2).toBeLessThan(yDivider)
  expect(yDivider).toBeLessThan(y3)
})
