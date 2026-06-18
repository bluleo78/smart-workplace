// 접힘 채팅 패널 미읽음 배지 E2E (#352) — 패널이 접힌 상태에서 SSE 로 타인의
// chat.message.created 를 주입 → ChatRail 에 미읽음 배지(개수) 표시 확인 →
// 펼치면 배지 사라지고 메시지 표시 확인.
//
// dedup 검증: useChatStream 은 AppLayout 전역 1개 스트림으로, React StrictMode 이중 마운트 +
//   스트림 재연결 때마다 동일 created 를 다시 받는다. messageId 기반 dedup 이 없으면 배지가
//   2,3,… 으로 부풀어오른다. 따라서 "배지 == 1" 단언이 곧 dedup 검증이다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1; // authenticatedPage fixture 의 createUser() 기본 id
const OTHER_ID = 99; // 타인(메시지 발신자)
const MSG_ID = 9001;

test(
  '접힘 채팅 패널: 타인 메시지 도착 시 미읽음 배지 표시, 펼치면 사라진다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // ── 공통 스텁 ─────────────────────────────────────────────────────────
    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
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
          body: JSON.stringify(
            createIssueDetail({ summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '미읽음 배지 테스트' }) }),
          ),
        }),
    );
    for (const sub of ['watchers', 'labels', 'attachments']) {
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
        (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
    }
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    // ── 채팅 스텁 — 빈 스레드(접힘 기본) ──────────────────────────────────
    const thread = createChatThread({
      threadId: THREAD_ID,
      issueId: 1,
      members: [
        createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' }),
        createChatMember({ userId: OTHER_ID, username: 'other', name: '다른 사람' }),
      ],
      recentMessages: [],
    });
    // threadReady: thread 응답 완료 후에야 ChatPanelInner(접힘) 가 마운트되어 onChatMessageCreated 를
    // 구독한다. 그 전에 SSE created 를 흘리면 구독 전이라 놓친다.
    let resolveThreadReady!: () => void;
    const threadReady = new Promise<void>((resolve) => {
      resolveThreadReady = resolve;
    });
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
      (route) => {
        const res = route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(thread) });
        res.then(() => resolveThreadReady());
        return res;
      },
    );

    const incoming = createChatMessage({
      id: MSG_ID,
      threadId: THREAD_ID,
      authorId: OTHER_ID,
      authorName: '다른 사람',
      body: '안 읽은 새 메시지',
    });

    // GET messages — 펼친 뒤 호출됨. 도착 메시지를 포함해 펼침 시 본문에 보이도록.
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [incoming], nextCursor: null, hasMore: false }),
        });
      },
    );
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
      (route) => route.fulfill({ status: 204 }),
    );

    // ── SSE — 동일 created 를 한 스트림에 2번 전달 ───────────────────────
    // 단일 연결에서도 중복 전달되므로 dedup 이 없으면 배지가 '2' 가 된다(결정적 dedup 검증).
    const oneCreated = `event: chat.message.created\ndata: ${JSON.stringify(incoming)}\n\n`;
    const sseCreated = oneCreated + oneCreated;
    await page.route(
      (url) => url.pathname === '/api/v1/chat/stream',
      async (route) => {
        await threadReady;
        // 접힘 패널의 onChatMessageCreated 구독 등록 대기.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseCreated,
        });
      },
    );

    // ── 페이지 진입 — 빈 스레드라 패널 접힘(열기 토글 바 노출) ──────────────
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-chat-panel-open')).toBeVisible();

    // ── 단언 1: 미읽음 배지가 '1' 로 표시(개수 정확 = dedup 검증) ───────────
    const badge = page.getByTestId('issue-chat-unread-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('1');
    // 재연결 사이클(백오프 ~1s) 한 번 지나도 동일 메시지가 중복 카운트되지 않는다.
    await page.waitForTimeout(1500);
    await expect(badge).toHaveText('1');

    // ── Phase 2: 펼치기 → 배지 사라지고 메시지 본문 표시 ─────────────────
    await page.getByTestId('issue-chat-panel-open').click();
    await expect(page.getByTestId('issue-chat-panel-body')).toBeVisible();
    await expect(page.getByTestId('issue-chat-unread-badge')).toHaveCount(0);
    await expect(page.getByText('안 읽은 새 메시지')).toBeVisible();
  },
);
