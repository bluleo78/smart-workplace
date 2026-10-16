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
import { pushHeldEvents } from '../../fixtures/gatedEvents';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

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
    await page.getByTestId('issue-chat-open').click();

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

// ── WP-418 회귀 가드 — 이슈 채팅도 채널/DM 과 같은 유령 버블 규칙(useAiWorkingBubbles)을 쓴다 ────────────
// 예전 이슈 채팅은 자체 리듀서 사본이라 채널에서 고친 두 결함이 남아 있었다:
//   (a) done 뒤 늦게 도착한 progress 가 버블을 되살린다(종료 스트림 기록 없음)
//   (b) 다른 이슈로 옮겨도 버블 상태가 비워지지 않아 이전 이슈의 버블이 새 이슈 채팅에 보인다.

/** 이슈 한 건의 상세·하위 목록·채팅 스레드·메시지 스텁. thread 응답 완료 시 onThreadServed 호출(SSE 동기화용). */
async function stubIssueWithThread(
  page: import('@playwright/test').Page,
  opts: {
    number: number;
    title: string;
    threadId: number;
    recentMessages?: ReturnType<typeof createChatMessage>[];
    onThreadServed?: () => void;
  },
) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${opts.number}`,
    (route) =>
      route.fulfill(
        json(createIssueDetail({ summary: createIssue({ id: opts.number, number: opts.number, title: opts.title }) })),
      ),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${opts.number}/${sub}`,
      (route) => route.fulfill(json([])),
    );
  }
  const thread = createChatThread({
    threadId: opts.threadId,
    issueId: opts.number,
    members: [
      createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' }),
      createChatMember({ userId: AGENT_ID, username: 'ai-agent', name: 'AI', kind: 'AGENT' }),
    ],
    recentMessages: opts.recentMessages ?? [],
  });
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${opts.number}/chat/thread`,
    async (route) => {
      await route.fulfill(json(thread));
      opts.onThreadServed?.();
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${opts.threadId}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill(json({ items: opts.recentMessages ?? [], nextCursor: null, hasMore: false }))
        : route.fallback(),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${opts.threadId}/read`,
    (route) => route.fulfill({ status: 204 }),
  );
}

/** 프로젝트 공통 스텁(이슈 상세 화면 진입에 필요한 것). */
async function stubProject(page: import('@playwright/test').Page) {
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) => route.fulfill(json(createProject())));
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => route.fulfill(json([])));
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill(json([])),
  );
}

/** SSE 프레임 문자열 — chat.* 이벤트 여러 개를 한 응답 본문으로. */
function sseFrames(frames: { event: string; data: unknown }[]): string {
  return frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join('');
}

/** 앱을 새로 띄우지 않고 클라이언트 라우팅으로 이동(BrowserRouter 가 popstate 로 location 을 다시 읽는다). */
async function clientNavigate(page: import('@playwright/test').Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

const progressOf = (threadId: number, streamId: string, phase: string, label = '위키 검색') => ({
  threadId,
  streamId,
  agentName: 'AI',
  phase,
  steps: [{ label, status: phase === 'done' ? 'done' : 'running' }],
});

test('이슈 채팅 — done 뒤 늦게 도착한 진행 이벤트는 유령 버블을 되살리지 않는다', async ({
  authenticatedPage: page,
}) => {
  // /api/v1/events 는 route 하지 않는다 — auth.fixture 의 열린 SSE 스트림에 pushHeldEvents 로 단계마다 프레임을 밀어 넣어
  // 각 단계의 화면 상태를 확인한 뒤 다음 프레임을 보낸다(한 번에 몰아 보내면 구독 전 도착·중간 상태 미확인으로 판정이 흐려진다).
  await stubProject(page);
  // 기존 메시지 하나 — 채팅 섹션에 이 메시지가 보이면 스레드가 로드돼 진행 이벤트 구독(threadId 확정)이 걸린 것이다.
  // (IssueChatButton 도 같은 스레드를 불러오므로 thread 응답 시점만으로는 섹션 구독을 보장하지 못한다.)
  const existing = createChatMessage({
    id: 500,
    threadId: THREAD_ID,
    authorId: ME_ID,
    authorName: '테스트 사용자',
    authorKind: 'HUMAN',
    body: '스레드 로드 표식 메시지',
  });
  await stubIssueWithThread(page, {
    number: ISSUE_NUMBER,
    title: '늦은 이벤트 테스트',
    threadId: THREAD_ID,
    recentMessages: [existing],
  });
  const progressFrame = (phase: string, label?: string) =>
    sseFrames([{ event: 'chat.message.progress', data: progressOf(THREAD_ID, STREAM_ID, phase, label) }]);

  await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
  await page.getByTestId('issue-chat-open').click();
  const section = page.getByTestId('chat-section');
  await expect(section.getByText('스레드 로드 표식 메시지')).toBeVisible();

  // 1) started → 버블 등장. 구독 effect 가 표식 렌더 직후에 걸리므로, 혹시 그보다 먼저 도착해 놓친 경우를 대비해
  //    버블이 보일 때까지 started 를 다시 보낸다(같은 streamId 의 started 반복은 같은 버블 갱신이라 무해).
  const bubble = page.getByTestId('ai-working-bubble');
  await expect(async () => {
    await pushHeldEvents(page, progressFrame('started'));
    await expect(bubble).toBeVisible({ timeout: 1_000 });
  }).toPass();

  // 2) done → 버블 제거.
  await pushHeldEvents(page, progressFrame('done'));
  await expect(bubble).toHaveCount(0);

  // 3) 순서 역전으로 늦게 온 tool → 이어서 HUMAN 메시지. HUMAN 메시지는 버블을 지우지 않으므로(#346)
  //    이 메시지가 보이는 시점이면 늦은 tool 까지 처리된 뒤다 — 그때 버블이 있으면 부활 회귀.
  const human = createChatMessage({
    id: 501,
    threadId: THREAD_ID,
    authorId: 2,
    authorName: '밥',
    authorKind: 'HUMAN',
    body: '늦은 이벤트 뒤 표식 메시지',
  });
  await pushHeldEvents(
    page,
    progressFrame('tool', '답변 작성') + sseFrames([{ event: 'chat.message.created', data: human }]),
  );
  await expect(section.getByText('늦은 이벤트 뒤 표식 메시지')).toBeVisible();
  // 구코드: done 으로 지운 뒤 늦은 tool 이 다시 set → 버블 부활(여기서 실패).
  await expectStays(page, () => bubble.count(), 0);
});

test('이슈 채팅 — AI 작업 중 다른 이슈로 옮기면 이전 이슈의 유령 버블이 따라오지 않는다', async ({
  authenticatedPage: page,
}) => {
  const OTHER_NUMBER = 2;
  const OTHER_THREAD_ID = 200;
  await stubProject(page);
  let resolveThreadReady!: () => void;
  const threadReady = new Promise<void>((resolve) => (resolveThreadReady = resolve));
  await stubIssueWithThread(page, {
    number: ISSUE_NUMBER,
    title: '버블 있는 이슈',
    threadId: THREAD_ID,
    onThreadServed: () => resolveThreadReady(),
  });
  // 옮겨 갈 이슈 — AGENT 메시지 없음(새 AGENT 메시지 백스톱이 우연히 버블을 지우지 않게), HUMAN 메시지 하나를 로드 표식으로.
  await stubIssueWithThread(page, {
    number: OTHER_NUMBER,
    title: '옮겨 간 이슈',
    threadId: OTHER_THREAD_ID,
    recentMessages: [
      createChatMessage({
        id: 601,
        threadId: OTHER_THREAD_ID,
        authorId: ME_ID,
        authorName: '테스트 사용자',
        authorKind: 'HUMAN',
        body: '두 번째 이슈의 기존 메시지',
      }),
    ],
  });

  // 첫 이슈 스레드의 진행 이벤트만(끝도 AGENT 메시지도 없음) — 첫 이슈에선 버블이 남아 있는 상태.
  const body = sseFrames([{ event: 'chat.message.progress', data: progressOf(THREAD_ID, STREAM_ID, 'tool') }]);
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    async (route) => {
      await threadReady;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body,
      });
    },
  );

  // 두 번째 이슈를 먼저 열어 상세를 캐시해 둔다 — 캐시가 있어야 이슈 전환 때 상세 화면이 로딩으로 내려가지 않고
  // 채팅 드로워(IssueChatSection)가 같은 자리에 재사용된다(결함이 드러나는 경로).
  await page.goto(`/projects/${PROJECT_KEY}/issues/${OTHER_NUMBER}`);
  await expect(page.getByText('옮겨 간 이슈').first()).toBeVisible();

  await clientNavigate(page, `/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}?chat=1`);
  await expect(page.getByTestId('ai-working-bubble')).toBeVisible();
  await expect(page.getByTestId('ai-working-bubble')).toContainText('위키 검색');

  await clientNavigate(page, `/projects/${PROJECT_KEY}/issues/${OTHER_NUMBER}?chat=1`);
  await expect(page.getByText('두 번째 이슈의 기존 메시지')).toBeVisible();
  // 구코드: 버블 상태가 이슈를 넘어 남아 두 번째 이슈 채팅에도 그대로 보인다(여기서 실패).
  await expectStays(page, () => page.getByTestId('ai-working-bubble').count(), 0);
});

// WP-418 리뷰 후속 — 이슈별 key 리마운트가 1초 디바운스 대기 중인 읽음 처리를 버리지 않는다.
// 이슈를 바꾸면 채팅 본문이 언마운트되며 디바운스 타이머도 사라지므로, 언마운트 때 떠나는 스레드의 읽음을 바로 보내야 한다.
// (flush 가 없으면 최신 메시지까지 본 직후 1초 안에 다른 이슈로 옮길 때 이전 스레드 읽음이 영영 안 간다.)
test('이슈 채팅 — 최신 메시지를 본 직후 다른 이슈로 옮겨도 이전 스레드 읽음 처리가 전송된다', async ({
  authenticatedPage: page,
}) => {
  const OTHER_NUMBER = 2;
  const OTHER_THREAD_ID = 200;
  await stubProject(page);
  await stubIssueWithThread(page, {
    number: ISSUE_NUMBER,
    title: '읽음 보낼 이슈',
    threadId: THREAD_ID,
    recentMessages: [
      createChatMessage({
        id: 500,
        threadId: THREAD_ID,
        authorId: 2,
        authorName: '밥',
        authorKind: 'HUMAN',
        body: '첫 이슈의 최신 메시지',
      }),
    ],
  });
  await stubIssueWithThread(page, {
    number: OTHER_NUMBER,
    title: '옮겨 간 이슈',
    threadId: OTHER_THREAD_ID,
    recentMessages: [
      createChatMessage({
        id: 601,
        threadId: OTHER_THREAD_ID,
        authorId: ME_ID,
        authorName: '테스트 사용자',
        authorKind: 'HUMAN',
        body: '두 번째 이슈의 기존 메시지',
      }),
    ],
  });
  const reads = trackRequests(page, 'POST', `/api/v1/chat/threads/${THREAD_ID}/read`);

  // 두 번째 이슈를 먼저 열어 상세를 캐시 — 전환 때 채팅 드로워가 같은 자리에 남아 key 리마운트 경로를 탄다(위 테스트와 같은 이유).
  await page.goto(`/projects/${PROJECT_KEY}/issues/${OTHER_NUMBER}`);
  await expect(page.getByText('옮겨 간 이슈').first()).toBeVisible();

  await clientNavigate(page, `/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}?chat=1`);
  await expect(page.getByTestId('chat-section').getByText('첫 이슈의 최신 메시지')).toBeVisible();
  // 마지막 메시지 IntersectionObserver 콜백(→ 읽음 요청 디바운스 시작)은 렌더링 단계에서 돈다 — 두 프레임 넘겨 확실히 돌린 뒤,
  // 디바운스(1초)가 끝나기 전에 바로 다른 이슈로 옮긴다.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await clientNavigate(page, `/projects/${PROJECT_KEY}/issues/${OTHER_NUMBER}?chat=1`);
  await expect(page.getByTestId('chat-section').getByText('두 번째 이슈의 기존 메시지')).toBeVisible();

  // 구코드: 언마운트로 디바운스 타이머가 사라져 thread 100 읽음 요청이 오지 않는다(여기서 실패).
  await reads.waitFor(1, { timeout: 5_000 });
  expect(reads.lastBody()).toEqual({ uptoMessageId: 500 });
  // 언마운트 flush 와 디바운스 발화가 겹쳐 두 번 보내지 않는다.
  await expectStays(page, reads.count, 1, { ms: 1_500 });
});
