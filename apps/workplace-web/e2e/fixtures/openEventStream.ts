import type { Page } from '@playwright/test'

// 통합 SSE(/api/v1/events)를 '열린 채 유지되는' 스트림으로 스텁하는 장치.
// auth.fixture(setupAuthMocks·installPageInitScripts)와, setupAuthMocks 를 안 쓰는 맨 page spec 이 함께 쓴다.

// 기본 /api/v1/events 스텁 응답을 '열린 스트림'으로 바꿔치기하라는 표식 헤더(아래 fetch 래퍼가 인식).
export const SSE_HOLD_HEADER = 'x-e2e-sse-hold'

/**
 * fetch 래퍼를 문서마다 깐다(addInitScript) — 마커 헤더가 붙은 응답을 닫히지 않는 본문으로 바꿔치기한다.
 * 반드시 page.goto 전에 불러야 한다(init script 는 문서가 열릴 때 도는 스크립트).
 */
export async function installOpenEventStreamWrapper(page: Page): Promise<void> {
  await page.addInitScript((holdHeader) => {
    // 이미 깔렸으면 다시 감싸지 않는다 — 이어 쓰는 page 에서 이 호출이 중복돼도 fetch 가 겹겹이 감기지 않게.
    const flagged = window as unknown as { __e2eSseWrapped?: boolean }
    if (flagged.__e2eSseWrapped) return
    flagged.__e2eSseWrapped = true
    const origFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init)
      if (res.headers.get(holdHeader) !== '1') return res
      // 요청 signal abort(언마운트·재연결 정리) 시에만 본문을 에러로 끝내 reader.read() 루프를 풀어준다.
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      // 열린 스트림 controller 모음 — pushHeldEvents(gatedEvents.ts)가 연결을 끊지 않고 프레임을 밀어 넣을 때 쓴다.
      const w = window as unknown as { __e2eHeldSse?: Set<ReadableStreamDefaultController<Uint8Array>> }
      const held = (w.__e2eHeldSse ??= new Set())
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          held.add(controller)
          const abort = () => {
            held.delete(controller)
            try {
              controller.error(new DOMException('Aborted', 'AbortError'))
            } catch {
              // 이미 닫힌 스트림이면 무시
            }
          }
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        },
      })
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
    }
  }, SSE_HOLD_HEADER)
}

/**
 * /api/v1/events(glob 전체 경로) 를 마커 헤더만 붙인 200 빈 본문으로 응답하는 route 를 깐다.
 *
 * 통합 SSE 단일 스트림 (#506): /api/v1/events 가 chat·messaging·notify 모두 대체.
 * 미스텁 시 백엔드 프록시로 누수되며, 백엔드 부재 시 503 재연결이 페이지 네비게이션과 레이스를
 * 일으켜(page.goto ERR_ABORTED/frame detached) 상세→목록 이동 테스트가 타임아웃된다.
 * 기본 스텁은 '열린 채 유지되는' 스트림이어야 한다(WP-59): 유한 본문은 응답 직후 끝나 클라이언트가 ~1초 뒤
 * 재연결하고, 재연결 catch-up(활성 쿼리 전체 재조회)이 스펙의 요청 카운트·시도 카운터·캐시를 흔든다.
 * route.fulfill 은 스트리밍 본문을 지원하지 않으므로 마커 헤더만 붙여 응답하고, installOpenEventStreamWrapper 의
 * fetch 래퍼가 마커 응답을 '닫히지 않는 본문'으로 바꿔치기한다(onOpen 은 첫 연결 1회만 → catch-up 없음, isConnected=true 유지).
 * 미완료 route 핸들러를 남기지 않으므로 teardown 이 멈추지 않는다. SSE 를 검증하는 스펙은 자체 route 를
 * 나중에 등록(LIFO 우선)하며, 마커가 없으므로 기존처럼 동작한다.
 * 스펙에서 /api/v1/events 를 유한 본문(`:\n\n` 등)으로 덮어쓰지 않는다 — 이벤트를 보내야 하면
 * e2e/fixtures/gatedEvents.ts 의 mockGatedEvents·pushHeldEvents 를 쓴다(WP-1861).
 * e2e 스펙(*.spec.ts 전부)에서는 린트 규칙 e2e/no-closing-event-stream 이 이를 막는다(WP-1877).
 */
export async function routeOpenEventStream(page: Page): Promise<void> {
  await page.route('**/api/v1/events', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { [SSE_HOLD_HEADER]: '1' },
      body: '',
    }),
  )
}

/** 래퍼와 route 를 차례로 깐다 — setupAuthMocks 를 안 쓰는 맨 page spec 용(goto 전에 부른다). */
export async function stubOpenEventStream(page: Page): Promise<void> {
  await installOpenEventStreamWrapper(page)
  await routeOpenEventStream(page)
}
