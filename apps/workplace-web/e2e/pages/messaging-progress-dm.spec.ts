// #345: AI 진행 유령 버블 E2E (DM 페이지) — DmPage 가 ChannelPage 와 동일하게
// onMessagingProgress 를 구독해 작업 중 유령 버블을 렌더하고, created 수신 시 실제
// 메시지로 교체하는지 검증한다. messaging-progress.spec.ts(채널)의 DM 버전.
//
// 전략은 채널 스펙과 동일:
//   1. SSE 첫 연결에 progress 프레임 전달 (dmReady 이후). 스트림 닫힘.
//   2. 유령 버블이 보이는지 단언.
//   3. created 핸들러로 교체 → 다음 재연결에 created 전달.
//   4. 버블이 사라지고 실제 메시지 표시 확인.

import { createDm, createDmParticipant, createMessage } from '../factories/messaging.factory';
import { expect, test } from '../fixtures/auth.fixture';

const DM_ID = 77;
const ME_ID = 1;
const AGENT_ID = 99;
const STREAM_ID = 'stream-dm-abc-789';

test(
  'DM 페이지 AI 진행 유령 버블 표시 후 완성 메시지로 교체된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const dm = createDm({
      id: DM_ID,
      participants: [
        createDmParticipant({ userId: ME_ID, name: '나' }),
        createDmParticipant({ userId: AGENT_ID, name: 'AI', kind: 'AGENT' }),
      ],
    });

    // ── 사이드바/레이아웃 stubs ─────────────────────────────────────────────
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          : route.fallback(),
    );

    // ── DM 목록 — dmReady: 목록 응답 완료 후 SSE progress 허용 동기화 플래그 ──
    // DmPage 가 dmId 를 획득한 직후 onMessagingProgress listener 가 등록되므로
    // 목록 조회 완료 후 React 리렌더 시간을 두어 listener 등록을 보장한다.
    let resolveDmReady!: () => void;
    const dmReady = new Promise<void>((resolve) => {
      resolveDmReady = resolve;
    });
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const res = route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([dm]),
        });
        res.then(() => resolveDmReady());
        return res;
      },
    );

    // ── GET messages — 빈 목록으로 시작 (메시지 수 0→1 전이가 버블 제거를 트리거) ──
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/messages`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
            })
          : route.fallback(),
    );

    // ── mark-read 스텁 ────────────────────────────────────────────────────
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/read`,
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
          : route.fallback(),
    );

    // ── SSE 페이로드 ───────────────────────────────────────────────────────
    const aiMessage = createMessage({
      id: 9077,
      channelId: DM_ID,
      authorId: AGENT_ID,
      authorName: 'AI',
      authorKind: 'AGENT',
      body: 'DM AI 최종 답변',
    });

    const progressStarted = {
      channelId: DM_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'started',
      steps: [],
    };
    const progressTool = {
      channelId: DM_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'tool',
      steps: [{ label: '메일 검색', status: 'running' }],
    };

    const sseProgress =
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressStarted)}\n\n` +
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressTool)}\n\n`;
    const sseCreated =
      `event: messaging.message.created\ndata: ${JSON.stringify(aiMessage)}\n\n`;

    // ── Phase 1 SSE 핸들러: 모든 초기 연결에 progress 전달 (StrictMode 이중 마운트 대응) ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      async (route) => {
        await dmReady;
        // React useEffect 재실행(dmId 리스너 등록) 대기
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
    await page.goto(`/chat/dms/${DM_ID}`);

    // ── 단언 1: 유령 버블이 보이고 도구 단계 레이블 포함 ─────────────────
    await expect(page.getByTestId('ai-working-bubble')).toBeVisible();
    await expect(page.getByTestId('ai-working-bubble')).toContainText('메일 검색');

    // ── Phase 2: bubble 확인 완료 → created 핸들러로 교체 (page.route LIFO) ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseCreated,
        }),
    );

    // ── 단언 2: 재연결 후 created → 유령 버블 사라지고 실제 메시지 표시 ──
    await expect(page.getByTestId('ai-working-bubble')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText('DM AI 최종 답변')).toBeVisible();
  },
);
