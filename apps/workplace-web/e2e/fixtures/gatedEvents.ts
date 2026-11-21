// /api/v1/events 게이트 SSE 모킹 공용 픽스처 (WP-59).
import { expect, type Page } from '@playwright/test';

/** 서버 ResourceSseDispatcher 가 보내는 resource.changed SSE 프레임 문자열 — spec 마다 인라인 조립을 반복하지 않게 한다. */
export function resourceChangedFrame(data: object): string {
  return `event: resource.changed\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 열린 SSE 스트림이 하나 이상 생길 때까지 기다린다 — pushHeldEvents·reconnectHeldEvents 공용. */
async function waitForHeldStream(page: Page): Promise<void> {
  await page.waitForFunction(
    () => ((window as unknown as { __e2eHeldSse?: Set<unknown> }).__e2eHeldSse?.size ?? 0) > 0,
  );
}

/**
 * openEventStream.ts 의 기본 '열린 채 유지되는' SSE 스트림에 프레임을 밀어 넣는다 — 연결을 끊지 않는다.
 * mockGatedEvents 는 deliver() 전까지 응답을 보류해 클라이언트가 '연결 안 됨'으로 남고, 채팅 화면은 800ms 뒤
 * 재연결 배너를 띄워 레이아웃을 밀어 낸다. 호버·좌표에 기대는 시나리오는 연결이 유지되는 이 헬퍼를 쓴다.
 * 스펙이 /api/v1/events 를 따로 route 하지 않아야 하며, 열린 스트림이 아직 없으면 생길 때까지 기다린다.
 */
export async function pushHeldEvents(page: Page, body: string): Promise<void> {
  await waitForHeldStream(page);
  const pushed = await page.evaluate((frame) => {
    const held = (window as unknown as { __e2eHeldSse: Set<ReadableStreamDefaultController<Uint8Array>> }).__e2eHeldSse;
    const bytes = new TextEncoder().encode(frame);
    let count = 0;
    for (const controller of [...held]) {
      // 닫히거나 에러난 controller 의 enqueue 는 throw — 죽은 스트림은 모음에서 빼고 건너뛴다.
      try {
        controller.enqueue(bytes);
        count++;
      } catch {
        held.delete(controller);
      }
    }
    return count;
  }, body);
  // 살아 있는 스트림이 하나도 없으면 아무도 받지 못한 것 — toPass 재시도(또는 단독 호출의 실패)로 드러낸다.
  if (pushed === 0) throw new Error('pushHeldEvents: 프레임을 받을 살아 있는 열린 스트림이 없다');
}

/**
 * 열린 SSE 스트림을 서버가 끊은 것처럼 정상 종료하고, 클라이언트가 /api/v1/events 로 다시 붙는 요청을 기다린다.
 * 왜: 재연결 뒤 같은 프레임을 다시 받아도 중복 반영되지 않는지 보려면 '끊김→재연결'을 실제로 일으켜야 한다.
 * 종료 후 재연결 지연은 1000ms + random(<1000ms)이다. 기본은 실시간으로 기다린다(최대 RECONNECT_WAIT_MS).
 * page.clock 이 설치된 페이지는 앱 타이머가 가짜 시계라 호출 측이 advance(ms)(예: ms => clock.runFor(ms))로 백오프를 넘긴다 —
 * advance 는 재연결 요청이 관찰될 때까지 반복 호출되므로 한 번에 백오프 전체를 넘길 필요가 없다.
 * 재연결 응답은 래퍼가 새 열린 스트림으로 바꿔치기하므로, 이어서 pushHeldEvents(Until)로 프레임을 밀어 넣을 수 있다.
 */
export const RECONNECT_WAIT_MS = 8000;
/** 앱 재연결 백오프 상한(1000ms + random(<1000ms))과, 가짜 시계를 한 번에 넘기는 걸음(ms). */
export const RECONNECT_BACKOFF_MAX_MS = 2000;
export const RECONNECT_ADVANCE_STEP_MS = 500;
export async function reconnectHeldEvents(page: Page, opts: { advance?: (ms: number) => Promise<void> } = {}): Promise<void> {
  await waitForHeldStream(page);
  // 재연결 요청 관찰을 종료보다 먼저 걸어 둔다 — 종료 직후의 빠른 재연결을 놓치지 않게.
  let reconnected = false;
  const onRequest = (req: { url(): string }) => {
    if (new URL(req.url()).pathname === '/api/v1/events') reconnected = true;
  };
  page.on('request', onRequest);
  try {
    await page.evaluate(() => {
      const held = (window as unknown as { __e2eHeldSse: Set<ReadableStreamDefaultController<Uint8Array>> }).__e2eHeldSse;
      for (const controller of [...held]) {
        held.delete(controller);
        // 이미 닫힌 스트림이면 무시.
        try {
          controller.close();
        } catch {
          // noop
        }
      }
    });
    if (opts.advance) {
      // 앱이 재연결 타이머를 거는 시점은 스트림 종료 뒤 비동기라, 한 번만 넘기면 타이머가 걸리기 전에 시계가 끝날 수 있다.
      // 그래서 매 시도마다 먼저 재연결 요청을 확인하고, 아직이면 시계를 조금씩 넘긴다.
      // 넘긴 가짜 시간은 백오프 최대치(2s)까지만 — 그 뒤에는 시계를 더 넘기지 않고 요청만 기다려(앱 쪽 다른 타이머를 건드리지 않게) 검증을 흐리지 않는다.
      let advanced = 0;
      await expect(async () => {
        if (!reconnected && advanced < RECONNECT_BACKOFF_MAX_MS) {
          advanced += RECONNECT_ADVANCE_STEP_MS;
          await opts.advance!(RECONNECT_ADVANCE_STEP_MS);
        }
        expect(reconnected).toBe(true);
      }).toPass({ timeout: RECONNECT_WAIT_MS });
    } else {
      // 실시간 대기 — 백오프(1~2s)가 지나 요청이 나갈 때까지 기다린다.
      await expect.poll(() => reconnected, { timeout: RECONNECT_WAIT_MS }).toBe(true);
    }
  } finally {
    page.off('request', onRequest);
  }
}

/** pushHeldEventsUntil 안쪽 단언의 한 번 시도 제한(ms) — 짧게 끊고 push 부터 다시 해 구독이 늦게 걸려도 따라잡는다. */
export const PUSH_RETRY_ASSERT_MS = 1000;

/**
 * 프레임을 밀어 넣고 첫 단언이 통과할 때까지 push 와 단언을 함께 재시도한다.
 * 왜: 화면 구독은 스레드 응답이 도착한 뒤에야 걸려, 그 전에 넣은 프레임은 버려진다(고정 대기·재연결 백오프에 기대지 않는다 — WP-1877).
 * 같은 프레임을 되풀이해 넣어도 같은 id(stream id·messageId)라 중복 반영되지 않아 안전하다.
 * assertion 안의 expect 에는 `{ timeout: PUSH_RETRY_ASSERT_MS }` 를 넘긴다.
 */
export async function pushHeldEventsUntil(page: Page, body: string, assertion: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await pushHeldEvents(page, body);
    await assertion();
  }).toPass();
}

/**
 * /api/v1/events 를 게이트된 단일 프레임으로 모킹한다.
 * - deliver() 이전에 도착한 요청은 보류한다. StrictMode 이중 마운트로 첫 연결 요청이 2번 올 수 있어(앞선 것은 취소됨)
 *   '몇 번째 요청인가'가 아니라 '릴리스 이전에 도착했는가'로 구분한다.
 * - deliver(body) 시 보류 요청이 그 본문으로 응답한다.
 * - deliver() 이후 도착하는 재연결 요청은 abort 한다. 유한 본문 SSE 는 응답 직후 종료되어 클라이언트가 재연결하는데,
 *   재연결 catch-up(활성 쿼리 전체 재조회)이 스텁 없는 API 를 때리거나 resource.changed 분기가 없어도 테스트가 통과해 버리기 때문이다.
 * 호출 측은 화면이 첫 렌더·캐시 준비를 마친 것을 확인한 뒤에만 deliver() 해야 한다 — 그 전에 프레임이 오면 무효화할 캐시가 없어 검증이 무의미해진다.
 */
export async function mockGatedEvents(page: Page): Promise<{ deliver(body: string): void }> {
  let open!: (body: string) => void;
  const gate = new Promise<string>((r) => (open = r));
  let delivered = false;
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    async (route) => {
      if (delivered) return route.abort();
      const body = await gate;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body,
      });
    },
  );
  return {
    deliver: (body) => {
      delivered = true; // 이후 도착하는 재연결 요청은 abort
      open(body);
    },
  };
}
