// 이슈 상세 페이지 테스트의 실시간 도구(WP-980) — 통합 SSE 를 테스트가 프레임을 밀어 넣는 스트림으로 둔다.
// 상세 화면 조회 목은 issueDetailStubs 의 issueDetailHandlers 하나로 합쳤다(WP-995).
import { http, HttpResponse } from 'msw'

/**
 * 통합 SSE(/api/v1/events) 를 테스트가 프레임을 밀어 넣을 수 있는 열린 스트림으로 둔다 — E2E 의 mockGatedEvents·pushHeldEvents 자리.
 * 연결을 끊지 않으므로 재연결 catch-up(활성 쿼리 전체 재조회)이 끼지 않고, 밀어 넣은 프레임 처리만 검증된다.
 * push 는 열린 연결이 생길 때까지 기다린 뒤 모든 열린 연결에 같은 프레임을 보낸다.
 */
export function controllableEvents() {
  const open = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const handler = http.get('/api/v1/events', ({ request }) => {
    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        open.add(c)
      },
    })
    request.signal.addEventListener('abort', () => {
      open.delete(ctrl)
      try {
        ctrl.close()
      } catch {
        // 이미 닫혔으면 무시
      }
    })
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  })
  return {
    handler,
    /** SSE 프레임 문자열(`event: x\ndata: {...}\n\n`)을 열린 연결 모두에 보낸다. */
    async push(frame: string) {
      for (let i = 0; open.size === 0 && i < 100; i++) await new Promise((r) => setTimeout(r, 20))
      if (open.size === 0) throw new Error('열린 /api/v1/events 연결이 없다')
      const bytes = new TextEncoder().encode(frame)
      for (const c of open) c.enqueue(bytes)
    },
  }
}

/** 서버 ResourceSseDispatcher 가 보내는 resource.changed 프레임. */
export const resourceChangedFrame = (data: object) => `event: resource.changed\ndata: ${JSON.stringify(data)}\n\n`
