// #346: AI 작업 중 "유령 버블 과잉 제거" 회귀 방지.
// 기존 결함: 메시지 수 증가(messageCount)만으로 버블을 전체 제거 → AI 가 아직 작업 중인데
//   (1) 스크롤백 페이지네이션(과거 메시지 prepend)이나 (2) 다른 사용자(HUMAN) 메시지 도착에도
//   버블이 사라졌다. 수정: "신규 AGENT 메시지(기준선 초과 id) 도착" 에만 제거.
//
// 판별 전략(HUMAN-mid-response) — messaging-progress.spec.ts 와 동일한 단계별 route swap:
//   1. progress 만 전달 → 유령 버블 표시.
//   2. (재연결) HUMAN created 만 전달 → HUMAN 메시지는 렌더되지만 버블은 유지되어야 한다.
//      (구코드는 messageCount 0→1 로 버블 제거 → 이 단계에서 실패 = 회귀 감지.)
//   3. (재연결) AGENT created 만 전달 → 비로소 버블 제거 + AI 메시지 표시(백스톱 동작 보존 확인).
//
// progress 와 created 를 같은 스트림에 섞으면 StrictMode 두 연결이 progress 를 재전달해
// 구코드의 제거를 가려 판별력이 사라진다 → 반드시 단계를 분리한다.

import { createChannel, createChannelMember, createMessage } from '../factories/messaging.factory';
import { expect, test } from '../fixtures/auth.fixture';

const CHANNEL_ID = 51;
const ME_ID = 1;
const AGENT_ID = 99;
const OTHER_ID = 2;
const STREAM_ID = 'stream-keep-101';

test(
  'AI 작업 중 HUMAN 메시지 도착에는 유령 버블 유지, AGENT 메시지에만 제거된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: '잡담', memberCount: 3 });

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
                createChannelMember({ userId: OTHER_ID, name: '밥', kind: 'HUMAN' }),
                createChannelMember({ userId: AGENT_ID, name: 'AI', kind: 'AGENT' }),
              ]),
            })
          : route.fallback(),
    );

    // GET messages — 빈 목록으로 시작. data 가 정의되므로(=로드 완료) baseline=0 으로 잡힌다.
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
                  { id: OTHER_ID, username: 'bob', name: '밥', kind: 'HUMAN' },
                  { id: AGENT_ID, username: 'aibot', name: 'AI', kind: 'AGENT' },
                ],
                page: 0,
                size: 100,
                totalElements: 3,
                totalPages: 1,
              }),
            })
          : route.fallback(),
    );

    // ── SSE 페이로드 ───────────────────────────────────────────────────────
    const humanMessage = createMessage({
      id: 8000,
      channelId: CHANNEL_ID,
      authorId: OTHER_ID,
      authorName: '밥',
      authorKind: 'HUMAN',
      body: '밥의 끼어든 메시지',
    });
    const aiMessage = createMessage({
      id: 9002,
      channelId: CHANNEL_ID,
      authorId: AGENT_ID,
      authorName: 'AI',
      authorKind: 'AGENT',
      body: 'AI 최종 답변',
    });

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
      steps: [{ label: '문서 검색', status: 'running' }],
    };

    const sseProgress =
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressStarted)}\n\n` +
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressTool)}\n\n`;
    const sseHuman = `event: messaging.message.created\ndata: ${JSON.stringify(humanMessage)}\n\n`;
    const sseAgent = `event: messaging.message.created\ndata: ${JSON.stringify(aiMessage)}\n\n`;

    // ── Phase 1 SSE: 모든 초기 연결에 progress 만 전달(StrictMode 이중 마운트 대응) ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      async (route) => {
        await channelReady;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseProgress,
        });
      },
    );

    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    // ── 단언 1: 유령 버블 표시 ──
    await expect(page.getByTestId('ai-working-bubble')).toBeVisible();
    await expect(page.getByTestId('ai-working-bubble')).toContainText('문서 검색');

    // ── Phase 2(핵심 회귀): HUMAN created 만 전달(LIFO route swap) ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseHuman,
        }),
    );

    // HUMAN 메시지가 렌더됐는데도(=created 처리됨) 유령 버블이 유지되어야 한다.
    // 구코드: messageCount 0→1 → 버블 제거 → 이 단언에서 실패(회귀 감지).
    await expect(page.getByText('밥의 끼어든 메시지')).toBeVisible();
    await expect(page.getByTestId('ai-working-bubble')).toBeVisible();

    // ── Phase 3: AGENT created 만 전달 → 비로소 버블 제거 + AI 메시지 표시(백스톱 보존) ──
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body: sseAgent,
        }),
    );

    await expect(page.getByTestId('ai-working-bubble')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText('AI 최종 답변')).toBeVisible();
  },
);
