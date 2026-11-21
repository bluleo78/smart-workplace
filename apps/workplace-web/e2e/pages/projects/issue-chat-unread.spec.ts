// 접힘 채팅 패널 미읽음 배지 E2E (#352) — 패널이 접힌 상태에서 SSE 로 타인의
// chat.message.created 를 주입 → ChatRail 에 미읽음 배지(개수) 표시 확인 →
// 펼치면 배지 사라지고 메시지 표시 확인.
//
// dedup 검증: useChatStream 은 AppLayout 전역 1개 스트림으로, React StrictMode 이중 마운트 +
//   중복 전달(한 스트림에 같은 created 2번 + 열린 스트림이 둘일 때의 추가 전달)로 동일 created 를 다시 받는다. messageId 기반 dedup 이 없으면 배지가
//   2,3,… 으로 부풀어오른다. 따라서 "배지 == 1" 단언이 곧 dedup 검증이다.

import { expect, test } from '../../fixtures/auth.fixture';
import { PUSH_RETRY_ASSERT_MS, pushHeldEvents, pushHeldEventsUntil, reconnectHeldEvents } from '../../fixtures/gatedEvents';
import { expectStays } from '../../fixtures/wait';
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
  // 실제 열린 SSE 스트림으로 같은 created 를 거듭 받아 dedup 을 본다 — @platform(WP-980).
  { tag: ['@platform', '@smoke'] },
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
    // threadReady: thread 응답 완료 후에야 IssueChatButton 이 threadId 를 얻어 onChatMessageCreated 를
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
    // dedup 이 없으면 배지가 '2' 이상이 된다(결정적 dedup 검증). events 는 route 하지 않고 auth.fixture 의 열린 스트림에 밀어 넣는다(WP-1877).
    // StrictMode 로 열린 스트림이 둘이면 중복이 늘 뿐 dedup 검증만 강해진다.
    const oneCreated = `event: chat.message.created\ndata: ${JSON.stringify(incoming)}\n\n`;
    const sseCreated = oneCreated + oneCreated;

    // ── 페이지 진입 — 채팅 드로워 닫힘, 헤더 채팅 버튼 노출 ──────────────
    // 채팅 버튼은 제목 '앞'(최좌측) 고정이라 중앙 상단 AI 런처 칩과 겹치지 않는다(뷰포트 우회 불필요).
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-chat-open')).toBeVisible();

    // IssueChatButton 은 threadId 가 생긴 뒤에야 구독하므로 push 와 첫 단언을 함께 재시도한다(재시도는 dedup 검증을 오히려 강하게 한다).
    await threadReady;

    // ── 단언 1: 미읽음 배지가 '1' 로 표시(개수 정확 = dedup 검증) ───────────
    const badge = page.getByTestId('issue-chat-unread-badge');
    await pushHeldEventsUntil(page, sseCreated, () => expect(badge).toHaveText('1', { timeout: PUSH_RETRY_ASSERT_MS }));
    // push 가 끝난 뒤에도 같은 메시지가 중복 카운트되지 않는다(두 프레임이 모두 처리된 뒤 일정 시간 '1' 유지).
    await expectStays(page, () => badge.textContent(), '1', { ms: 200 });

    // 재연결 사이클 한 번 지나도 동일 메시지가 중복 카운트되지 않는다 — 열린 스트림을 끊어 재연결시킨 뒤 같은 created 를 새 스트림에 다시 보낸다.
    // 재연결 catch-up(reconnectCatchUp)은 보호 키(chat)를 뺀 활성 쿼리 — 화면에 떠 있는 이슈 상세 — 를 다시 받아 온다. 그 응답을 재연결 전에 걸어 둔다.
    // 앱 재연결 백오프(1~2s)는 가짜 시계로 넘기고(여기서 설치한 시계를 아래에서 fastForward 가 이어 쓴다), 실시간 대기를 없앤다.
    await page.clock.install();
    const catchUpRefetched = page.waitForResponse(
      (res) => new URL(res.url()).pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    );
    await reconnectHeldEvents(page, { advance: (ms) => page.clock.runFor(ms) });
    await catchUpRefetched;
    // 새 스트림에 같은 created 를 다시 보낸다 — 프레임이 소비돼 배지에 반영될 시간을 stays 창으로 준다.
    await pushHeldEvents(page, oneCreated);
    await expectStays(page, () => badge.textContent(), '1', { ms: 500 });

    // ── Phase 2: 드로워 열기 → 배지 사라지고 메시지 본문 표시 ─────────────────
    await page.getByTestId('issue-chat-open').click();
    await expect(page.getByTestId('issue-chat-drawer')).toBeVisible();
    await expect(page.getByTestId('issue-chat-unread-badge')).toHaveCount(0);
    await expect(page.getByText('안 읽은 새 메시지')).toBeVisible();
  },
);
