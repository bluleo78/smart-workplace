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
});
