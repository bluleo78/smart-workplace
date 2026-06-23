// AI 작업 중 "유령 버블 부활" 회귀 방지.
// 결함: ai-agent 가 답변 메시지 게시 후 emit('tool')(답변 작성 done)·emit('done') 을 fire-and-forget 로
//   각각 POST → 두 progress SSE 가 순서 보장 없이 도착한다. 'done' 이 먼저 처리돼 버블이 제거된 뒤
//   뒤늦은 'tool' 이벤트가 같은 streamId 로 도착하면 구코드는 버블을 다시 set → 답변이 이미 떠 있는데도
//   "입력 중…/✓ 답변 작성" 유령 버블이 60초 TTL 까지 남았다.
// 수정: 종료된(done/error) streamId 를 기록해 이후 비종료 이벤트의 부활을 차단.
//
// 판별 전략 — messaging-progress-keep.spec.ts 와 동일한 단계별 route swap:
//   1. progress started+tool → 유령 버블 표시.
//   2. (재연결) progress done → 버블 제거.
//   3. (재연결) 뒤늦은 progress tool(같은 streamId, 답변 작성 done) → 버블이 되살아나면 안 된다(회귀 감지).

import { createChannel, createChannelMember } from '../factories/messaging.factory';
import { expect, test } from '../fixtures/auth.fixture';

const CHANNEL_ID = 52;
const ME_ID = 1;
const AGENT_ID = 99;
const STREAM_ID = 'stream-stale-202';

test(
  '종료된 스트림의 뒤늦은 tool 이벤트는 유령 버블을 부활시키지 않는다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: '잡담', memberCount: 2 });

    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([channel]),
            })
          : route.fallback(),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          : route.fallback(),
    );

    // channelReady: 채널 상세 응답 완료 후 SSE progress 전달 허용 동기화.
    let resolveChannelReady!: () => void;
    const channelReady = new Promise<void>((resolve) => {
      resolveChannelReady = resolve;
    });
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const res = route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(channel),
        });
        res.then(() => resolveChannelReady());
        return res;
      },
    );

    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/members`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([
                createChannelMember({ userId: ME_ID, name: '나', kind: 'HUMAN' }),
                createChannelMember({ userId: AGENT_ID, name: 'AI', kind: 'AGENT' }),
              ]),
            })
          : route.fallback(),
    );

    // GET messages — 빈 목록으로 시작. data 가 정의되므로 baseline=0 으로 잡힌다.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
            })
          : route.fallback(),
    );

    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/read`,
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
          : route.fallback(),
    );

    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                content: [
                  { id: ME_ID, username: 'me', name: '나', kind: 'HUMAN' },
                  { id: AGENT_ID, username: 'aibot', name: 'AI', kind: 'AGENT' },
                ],
                page: 0,
                size: 100,
                totalElements: 2,
                totalPages: 1,
              }),
            })
          : route.fallback(),
    );

    // ── SSE 페이로드 ───────────────────────────────────────────────────────
    const progressStarted = {
      channelId: CHANNEL_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'started',
      steps: [],
    };
    const progressTool = {
      channelId: CHANNEL_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'tool',
      steps: [{ label: '답변 작성', status: 'running' }],
    };
    const progressDone = {
      channelId: CHANNEL_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'done',
      steps: [{ label: '답변 작성', status: 'done' }],
    };
    // 뒤늦게 도착한 tool — done 보다 늦게 처리되는 재정렬 이벤트(같은 streamId).
    const progressStaleTool = {
      channelId: CHANNEL_ID,
      streamId: STREAM_ID,
      agentName: 'AI',
      phase: 'tool',
      steps: [{ label: '답변 작성', status: 'done' }],
    };

    const sseStartedTool =
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressStarted)}\n\n` +
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressTool)}\n\n`;
    const sseDone = `event: messaging.message.progress\ndata: ${JSON.stringify(progressDone)}\n\n`;
    const sseStaleTool = `event: messaging.message.progress\ndata: ${JSON.stringify(progressStaleTool)}\n\n`;

    // ── Phase 1 SSE: 모든 초기 연결에 started+tool 전달(StrictMode 이중 마운트 대응) ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      async (route) => {
        await channelReady;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseStartedTool,
        });
      },
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    // ── 단언 1: 유령 버블 표시 ──
    await expect(page.getByTestId('ai-working-bubble')).toBeVisible();
    await expect(page.getByTestId('ai-working-bubble')).toContainText('답변 작성');

    // ── Phase 2: done 전달 → 버블 제거 ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseDone,
        }),
    );
    await expect(page.getByTestId('ai-working-bubble')).toHaveCount(0, { timeout: 15000 });

    // ── Phase 3(핵심 회귀): 뒤늦은 tool(같은 streamId) → 버블이 되살아나면 안 된다 ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseStaleTool,
        }),
    );

    // 구코드: 종료 추적 없음 → tool 이벤트가 다시 set → 버블 부활(이 단언에서 실패 = 회귀 감지).
    // 잠시 대기해 뒤늦은 tool 이 처리될 시간을 준 뒤에도 버블이 없어야 한다.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('ai-working-bubble')).toHaveCount(0);
  },
);
