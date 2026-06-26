// AI 진행 유령 버블 E2E — SSE 로 chat.message.progress 를 주입 → AiWorkingBubble 렌더 확인 →
// chat.message.created 주입 → 유령 버블 사라지고 실제 메시지 표시 확인.
//
// 전략:
//   1. SSE 첫 연결에 progress 프레임 전달 (threadReady 이후). 스트림 닫힘.
//   2. 유령 버블이 보이는지 단언 (Playwright 자동 대기).
//   3. 버블 확인 후 SSE 핸들러를 업데이트 → 다음 재연결(~1s 백오프)에 created 전달.
//   4. 버블이 사라지고 실제 메시지 텍스트가 보이는지 단언.
//
// React StrictMode 이중 마운트 대응:
//   useChatStream 이 거의 동시에 두 번 연결을 시도한다(StrictMode 첫 마운트+정리+재마운트).
//   첫 연결(StrictMode 이 abort할 연결)도 progress 를 받도록 모든 초기 연결에 progress 전달.
//   live 인스턴스는 두 번째 연결이므로 두 연결 모두 progress 를 받아 live 인스턴스에 도달 보장.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;
const AGENT_ID = 99;
const STREAM_ID = 'stream-abc-123';

test(
  'AI 진행 유령 버블 표시 후 완성 메시지로 교체된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // ── 공통 스텁 ─────────────────────────────────────────────────────────
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
          body: JSON.stringify(
            createIssueDetail({
              summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'AI 버블 테스트' }),
            }),
          ),
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

    // ── 채팅 스텁 ─────────────────────────────────────────────────────────
    const thread = createChatThread({
      threadId: THREAD_ID,
      issueId: 1,
      members: [
        createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' }),
        createChatMember({ userId: AGENT_ID, username: 'ai-agent', name: 'AI', kind: 'AGENT' }),
      ],
      recentMessages: [],
    });
    // threadReady: thread API 응답 완료 후 SSE progress 전송을 허용하기 위한 동기화 플래그.
    // IssueChatSection 이 threadId 를 설정한 직후 progress 이벤트를 전달해야 필터를 통과함.
    let resolveThreadReady!: () => void;
    const threadReady = new Promise<void>((resolve) => {
      resolveThreadReady = resolve;
    });
    await page.route(
      (url) =>
        url.pathname ===
        `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
      (route) => {
        const res = route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(thread),
        });
        // thread 응답 완료 후 SSE 핸들러가 진행하도록 신호
        res.then(() => resolveThreadReady());
        return res;
      },
    );

    // GET messages — 빈 목록으로 시작 (메시지 수 0→1 전이가 버블 제거를 트리거)
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
        });
      },
    );
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
      (route) => route.fulfill({ status: 204 }),
    );

    // ── SSE 페이로드 ───────────────────────────────────────────────────────
    const aiMessage = createChatMessage({
      id: 9001,
      threadId: THREAD_ID,
      authorId: AGENT_ID,
      authorName: 'AI',
      authorKind: 'AGENT',
      body: 'AI 최종 답변',
    });

    const progressStarted = {
      threadId: THREAD_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'started',
      steps: [],
    };
    const progressTool = {
      threadId: THREAD_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'tool',
      steps: [{ label: '위키 검색', status: 'running' }],
    };

    // progress 두 프레임 (started + tool)
    const sseProgress =
      `event: chat.message.progress\ndata: ${JSON.stringify(progressStarted)}\n\n` +
      `event: chat.message.progress\ndata: ${JSON.stringify(progressTool)}\n\n`;
    // created 프레임
    const sseCreated =
      `event: chat.message.created\ndata: ${JSON.stringify(aiMessage)}\n\n`;

    // ── Phase 1 SSE 핸들러: 모든 초기 연결에 progress 전달 ─────────────────
    // React StrictMode 이중 마운트로 인해 두 연결이 거의 동시에 들어온다.
    // 두 연결 모두 progress 를 받아 live 인스턴스가 확실히 수신하도록 한다.
    // threadReady 이후 React 리렌더 시간(200ms)을 두어 threadId=100 listener 등록 보장.
    await page.route(
      (url) => url.pathname === '/api/v1/events',
      async (route) => {
        await threadReady;
        // React useEffect 재실행(threadId=100 listener 등록) 대기
        await new Promise((resolve) => setTimeout(resolve, 200));
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseProgress,
        });
      },
    );

    // ── 페이지 진입 ────────────────────────────────────────────────────────
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 채팅 패널 펼치기 — 빈 스레드는 #343 레이아웃에서 기본 접힘이라
    // IssueChatSection(SSE 구독·버블 렌더)이 미마운트된다. 펼쳐야 progress 를 수신.
    // (접힘 상태에서의 라이브 AI 반영·미읽음 배지는 #352에서 개선 예정)
    await page.getByTestId('issue-chat-panel-open').click();

    // ── 단언 1: 유령 버블이 보이고 도구 단계 레이블 포함 ─────────────────
    // Playwright 자동 대기 — live SSE 인스턴스가 progress 수신 후 React 렌더 완료까지 대기.
    await expect(page.getByTestId('ai-working-bubble')).toBeVisible();
    await expect(page.getByTestId('ai-working-bubble')).toContainText('위키 검색');

    // ── Phase 2: bubble 확인 완료 → created 핸들러로 교체 ────────────────
    // page.route()는 LIFO — 새 핸들러가 기존 핸들러보다 먼저 매칭된다.
    // 다음 SSE 재연결(~1s 백오프)이 이 핸들러에 걸려 created 수신 → 버블 제거.
    await page.route(
      (url) => url.pathname === '/api/v1/events',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseCreated,
        }),
    );

    // ── 단언 2: 재연결 후 created 프레임 → 유령 버블 사라지고 실제 메시지 표시
    // toHaveCount(0) 자동 대기 → 재연결 + 버블 제거까지 기다림 (timeout=15s).
    await expect(page.getByTestId('ai-working-bubble')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText('AI 최종 답변')).toBeVisible();
  },
);
