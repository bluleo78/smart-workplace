// AI 진행 유령 버블 E2E (메시징 채널) — SSE 로 messaging.message.progress 를 주입 →
// AiWorkingBubble 렌더 확인 → messaging.message.created 주입 → 유령 버블 사라지고
// 실제 AGENT 메시지 표시 확인.
//
// 전략:
//   1. SSE 첫 연결에 progress 프레임 전달 (channelReady 이후). 스트림 닫힘.
//   2. 유령 버블이 보이는지 단언 (Playwright 자동 대기).
//   3. 버블 확인 후 SSE 핸들러를 업데이트 → 다음 재연결(~1s 백오프)에 created 전달.
//   4. 버블이 사라지고 실제 메시지 텍스트가 보이는지 단언.
//
// React StrictMode 이중 마운트 대응:
//   useMessageStream 이 거의 동시에 두 번 연결을 시도한다(StrictMode 첫 마운트+정리+재마운트).
//   첫 연결(StrictMode 이 abort 할 연결)도 progress 를 받도록 모든 초기 연결에 progress 전달.
//   live 인스턴스는 두 번째 연결이므로 두 연결 모두 progress 를 받아 live 인스턴스에 도달 보장.

import { expect, test } from '../fixtures/auth.fixture';
import {
  createChannel,
  createChannelMember,
  createMessage,
} from '../factories/messaging.factory';

const CHANNEL_ID = 42;
const ME_ID = 1;
const AGENT_ID = 99;
const STREAM_ID = 'stream-msg-xyz-456';

test(
  '메시징 채널 AI 진행 유령 버블 표시 후 완성 메시지로 교체된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: '개발', memberCount: 2 });

    // ── 사이드바/레이아웃 stubs ─────────────────────────────────────────────
    // 채널/DM 목록 — 사이드바 렌더에 필요
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
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([]),
            })
          : route.fallback(),
    );

    // ── 채널 상세 스텁 ─────────────────────────────────────────────────────
    // channelReady: channel 상세 응답 완료 후 SSE progress 전달을 허용하기 위한 동기화 플래그.
    // ChannelPage 가 channelId 를 획득한 직후 onMessagingProgress listener 가 등록되므로
    // channel 조회 완료 후 React 리렌더 시간(200ms)을 두어 listener 등록을 보장한다.
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

    // ── 채널 멤버 스텁 ─────────────────────────────────────────────────────
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

    // ── GET messages — 빈 목록으로 시작 (메시지 수 0→1 전이가 버블 제거를 트리거) ──
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

    // ── mark-read 스텁 ────────────────────────────────────────────────────
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/read`,
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
          : route.fallback(),
    );

    // ── useMentionAgents GET /api/v1/users ────────────────────────────────
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
    const aiMessage = createMessage({
      id: 9002,
      channelId: CHANNEL_ID,
      authorId: AGENT_ID,
      authorName: 'AI',
      authorKind: 'AGENT',
      body: '채널 AI 최종 답변',
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
      steps: [{ label: '이슈 목록 조회', status: 'running' }],
    };

    // progress 두 프레임 (started + tool)
    const sseProgress =
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressStarted)}\n\n` +
      `event: messaging.message.progress\ndata: ${JSON.stringify(progressTool)}\n\n`;

    // created 프레임
    const sseCreated =
      `event: messaging.message.created\ndata: ${JSON.stringify(aiMessage)}\n\n`;

    // ── Phase 1 SSE 핸들러: 모든 초기 연결에 progress 전달 ─────────────────
    // React StrictMode 이중 마운트로 인해 두 연결이 거의 동시에 들어온다.
    // 두 연결 모두 progress 를 받아 live 인스턴스가 확실히 수신하도록 한다.
    // channelReady 이후 React useEffect 재실행(channelId listener 등록) 대기로 200ms 추가.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/stream',
      async (route) => {
        await channelReady;
        // React useEffect 재실행(channelId=CHANNEL_ID listener 등록) 대기
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
    await page.goto(`/chat/channels/${CHANNEL_ID}`);

    // ── 단언 1: 유령 버블이 보이고 도구 단계 레이블 포함 ─────────────────
    // Playwright 자동 대기 — live SSE 인스턴스가 progress 수신 후 React 렌더 완료까지 대기.
    await expect(page.getByTestId('ai-working-bubble')).toBeVisible();
    await expect(page.getByTestId('ai-working-bubble')).toContainText('이슈 목록 조회');

    // ── Phase 2: bubble 확인 완료 → created 핸들러로 교체 ────────────────
    // page.route()는 LIFO — 새 핸들러가 기존 핸들러보다 먼저 매칭된다.
    // 다음 SSE 재연결(~1s 백오프)이 이 핸들러에 걸려 created 수신 → 버블 제거.
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

    // ── 단언 2: 재연결 후 created 프레임 → 유령 버블 사라지고 실제 메시지 표시
    // toHaveCount(0) 자동 대기 → 재연결 + 버블 제거까지 기다림 (timeout=15s).
    await expect(page.getByTestId('ai-working-bubble')).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByText('채널 AI 최종 답변')).toBeVisible();
  },
);
