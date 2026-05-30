// Phase 6b — chat 실시간 SSE E2E.
// /chat/stream 을 canned text/event-stream 본문으로 모킹 → 메시지가 create POST 없이 렌더되는지 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;

async function setupCommonStubs(
  page: import('@playwright/test').Page,
  detailRef: { current: ReturnType<typeof createIssueDetail> },
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailRef.current),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

async function setupChatStubs(
  page: import('@playwright/test').Page,
  thread: ReturnType<typeof createChatThread>,
  messages: ReturnType<typeof createChatMessage>[],
) {
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(thread),
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: messages, nextCursor: null, hasMore: false }),
      });
    },
  );
  // POST create — create POST 가 호출되면 테스트가 실패하도록 빈 핸들러 등록.
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      // SSE 전용 테스트에서는 create POST 가 불려선 안 됨 — 404 로 잡아서 가시적 오류 유발.
      return route.fulfill({ status: 404 });
    },
  );
  // mark-as-read — 필수 endpoint 모킹.
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
    (route) => route.fulfill({ status: 204 }),
  );
}

test.describe('chat 실시간 SSE', () => {
  test(
    'SSE 로 도착한 메시지가 create POST 없이 즉시 렌더된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const detailRef = {
        current: createIssueDetail({
          summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'SSE 실시간 테스트' }),
        }),
      };
      const thread = createChatThread({
        threadId: THREAD_ID,
        issueId: 1,
        members: [
          createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' }),
        ],
        recentMessages: [],
      });

      await setupCommonStubs(page, detailRef);
      // 빈 메시지 목록으로 세팅 — SSE 를 통해서만 메시지가 나타나야 함.
      await setupChatStubs(page, thread, []);

      // SSE 스트림 모킹: chat.message.created 프레임 1개.
      const msg = createChatMessage({
        id: 999,
        threadId: THREAD_ID,
        authorId: ME_ID,
        authorName: '테스트 사용자',
        authorKind: 'HUMAN',
        body: 'SSE 실시간 메시지',
      });
      const sseBody =
        `event: chat.message.created\n` +
        `data: ${JSON.stringify(msg)}\n\n`;

      await page.route(
        (url) => url.pathname === '/api/v1/chat/stream',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            headers: { 'cache-control': 'no-cache' },
            body: sseBody,
          }),
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // SSE 프레임으로 도착한 메시지가 렌더돼야 한다 (create POST 없이).
      await expect(page.getByText('SSE 실시간 메시지')).toBeVisible();
    },
  );

  // #37 회귀 — 본인이 보낸 메시지의 SSE self-echo 가 create POST 응답과 같은 서버 id 를 실어
  // 도착하면, onSuccess dedup 이 없을 때 같은 id 의 행이 2개 생긴다.
  //
  // 결정론적 모델링: id=SAVED_ID 행을 GET messages 응답에 *미리 심어* "SSE self-echo 가 이미
  // 캐시에 도착한" 상태를 만든다 (live SSE→캐시 경로는 위의 렌더 테스트가 커버). 그 뒤 같은 body 를
  // send → onMutate 가 음수 temp 행 prepend → POST(+600ms) 가 SAVED_ID 로 확정 → onSuccess 가
  // temp→SAVED_ID 매핑. dedup 없으면 [SAVED_ID, SAVED_ID] (2행), dedup 면 [SAVED_ID] (1행).
  // POST-먼저 순서도 dedup 대칭으로 동일 보장.
  test('본인 메시지 send 시 SSE self-echo 가 와도 행이 1개만 보인다 (중복 제거)', async ({
    authenticatedPage: page,
  }) => {
    const SAVED_ID = 1001;
    const BODY = '셀프 에코 메시지';

    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'self-echo dedup' }),
      }),
    };
    // SAVED_ID 행을 thread.recentMessages 로 시드 — useChatMessages 가 initialData 로 캐시 첫 페이지를
    // 채운다(staleTime 5s). "self-echo 가 이미 캐시에 도착" 상태를 결정론적으로 재현.
    const seeded = createChatMessage({
      id: SAVED_ID,
      threadId: THREAD_ID,
      authorId: ME_ID,
      authorName: '테스트 사용자',
      authorKind: 'HUMAN',
      body: BODY,
    });
    const thread = createChatThread({
      threadId: THREAD_ID,
      issueId: 1,
      members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
      recentMessages: [seeded],
    });

    await setupCommonStubs(page, detailRef);

    await page.route(
      (url) =>
        url.pathname ===
        `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(thread) }),
    );

    // GET messages — 시드와 동일 행 반환(staleTime 만료 후 refetch 대비).
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [seeded], nextCursor: null, hasMore: false }),
        });
      },
    );
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
      (route) => route.fulfill({ status: 204 }),
    );

    // create POST → 동일 id(SAVED_ID) 확정. optimistic 윈도가 관찰되도록 살짝 지연.
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await new Promise((resolve) => setTimeout(resolve, 600));
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(seeded),
        });
      },
    );

    // SSE 스트림 — heartbeat 만 (실제 echo 는 GET 시드로 모델링했으므로 불필요). 프록시 에러 회피용.
    await page.route(
      (url) => url.pathname === '/api/v1/chat/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: `:\n\n`,
        }),
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 시드된 SAVED_ID 행이 먼저 렌더돼야 한다.
    await expect(page.getByTestId(`chat-message-body-${SAVED_ID}`)).toHaveCount(1);

    await page.getByTestId('chat-composer-input').click();
    await page.keyboard.type(BODY);
    await page.getByTestId('chat-composer-submit').click();

    // optimistic(음수 temp) 행 노출 → 서버 확정으로 사라질 때까지 대기. 이 전환 *이후*에야
    // dedup 대상(중복)이 형성되므로, count 단언을 transition 뒤로 게이팅해야 안정적이다.
    await expect(
      page.locator('[data-testid^=chat-message-][data-pending="true"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid^=chat-message-][data-pending="true"]'),
    ).toHaveCount(0);

    // 버그 시그니처: 같은 서버 id 행이 2개(시드 + onSuccess 매핑). dedup 이면 정확히 1개.
    // temp 행은 음수 id 라 body-1001 에 안 잡힘 → 2 면 진짜 중복뿐.
    await expect(page.getByTestId(`chat-message-body-${SAVED_ID}`)).toHaveCount(1);
  });
});
