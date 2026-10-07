// 홈 AI 채팅 E2E 모킹 헬퍼(#593 편입) — POST /api/v1/ai/chat 는 이제 { correlationId } 를 즉시
// 반환하고, 실제 delta/progress/pending_action/tool/done/error 는 통합 /api/v1/events 채널로
// home.chat.* 이벤트로 도착한다(wiki-ai.spec.ts 의 mockWikiAiGeneration/buildWikiAiSse 패턴 미러).
//
// 모킹 방식: POST 라우트가 도착했다는 신호로 프라미스를 resolve 하고, /events 라우트가 그 프라미스를
// await 한 뒤에야 SSE 본문을 흘린다 — /events 는 앱 마운트 시 1회 연결되므로, 응답을 즉시 fulfill 하면
// 사용자 액션(전송 클릭)보다 먼저 도착해 유실된다.
import type { Page, Route } from '@playwright/test'

import type { AiScreenContext } from '../../src/types/aiScreenContext'
import { type RequestTracker, trackRequests } from './requests'

/** home.chat.* 프레임 1개 — event 이름은 'home.chat.' 프리픽스를 뺀 부분만 지정한다. */
export interface HomeChatFrame {
  event: 'delta' | 'progress' | 'pending_action' | 'tool' | 'done' | 'error' | 'cancelled'
  data: Record<string, unknown>
}

/** HomeChatFrame[] → SSE 본문(각 프레임에 correlationId 를 최상위로 병합). */
export function buildHomeChatSse(frames: HomeChatFrame[], correlationId: string): string {
  return frames
    .map(
      (f) =>
        `event: home.chat.${f.event}\ndata: ${JSON.stringify({ correlationId, ...f.data })}\n\n`,
    )
    .join('')
}

/**
 * POST /api/v1/ai/chat 시작(JSON correlationId) + /api/v1/events(SSE, 그 correlationId 로 프레임)
 * 를 함께 설정한다. 시작 요청 기록(tracker)을 돌려준다 — payload 는 `lastBody<HomeChatStartBody>()` 로 확인(WP-54).
 *
 * 델타/누적 텍스트 대신 완성된 frames 배열을 그대로 넘기면 되므로, 기존에
 * `event: delta\ndata: {...}` 형태로 직접 SSE 본문을 조립하던 스펙들은 frames 배열로만 옮기면 된다.
 */
/** POST /api/v1/ai/chat 시작 요청 본문. WP-234: fileIds 는 첨부가 있을 때만 실린다. WP-267: correlationId 는 웹이 정한다. */
export type HomeChatStartBody = {
  sessionId: string | null
  query: string
  correlationId: string
  screenContext?: AiScreenContext
  fileIds?: number[]
}

/** 실제 서버처럼 웹이 보낸 correlationId 를 그대로 쓴다(WP-267). */
const sentCorrelationId = (route: Route): string => (route.request().postDataJSON() as HomeChatStartBody).correlationId

export async function mockHomeChatGeneration(
  page: Page,
  opts: {
    frames: HomeChatFrame[]
    /** 테스트가 resolve 할 때까지 SSE 프레임을 보류한다. */
    gate?: Promise<void>
  },
): Promise<RequestTracker> {
  const starts = trackRequests(page, 'POST', '/api/v1/ai/chat')
  let resolveStarted: (correlationId: string) => void
  const started = new Promise<string>((resolve) => {
    resolveStarted = resolve
  })

  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const correlationId = sentCorrelationId(route)
      resolveStarted(correlationId)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ correlationId }),
      })
    },
  )

  await page.route(
    (url) => url.pathname === '/api/v1/events',
    async (route) => {
      const correlationId = await started
      // gate: 테스트가 resolve 할 때까지 프레임을 보류 — 생성 중(pending) 상태를 관측하기 위함(WP-191).
      if (opts.gate) await opts.gate
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildHomeChatSse(opts.frames, correlationId),
      })
    },
  )
  return starts
}

// 스트리밍 SSE 를 시간에 걸쳐 흘리는 하네스 — route.fulfill 은 본문을 한 번에 보내므로, 마커 헤더가 붙은 /events 응답을
// fetch 래퍼가 '테스트가 밀어 넣는 스트림'으로 바꾼다(auth.fixture 의 SSE_HOLD 와 같은 방식, 마커만 다르다).
// 래퍼는 fixture 래퍼 위에 덧씌워지고 route 는 나중 등록이 우선(LIFO)이라 이 하네스를 부른 스펙에서만 기본 스트림을 대체한다.
const SSE_PUSH_HEADER = 'x-e2e-sse-push'

/**
 * POST /api/v1/ai/chat 시작(웹이 보낸 correlationId 그대로) + 테스트가 프레임을 하나씩 밀어 넣는 /api/v1/events 스트림(WP-234).
 * delta(text) 는 home.chat.delta 프레임 하나를 보낸다 — 델타가 여러 프레임에 걸쳐 도착하는 실제 스트리밍을 재현한다.
 * send(frame) 는 마지막 시작 요청의 correlationId 로 임의 프레임 하나를 보낸다.
 * page.goto 전에 불러야 한다(init script).
 */
export async function mockStreamingHomeChat(
  page: Page,
): Promise<{
  push: (frame: string) => Promise<void>
  delta: (text: string) => Promise<void>
  send: (frame: HomeChatFrame) => Promise<void>
}> {
  let correlationId = ''
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      correlationId = sentCorrelationId(route)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ correlationId }) })
    },
  )
  await page.route('**/api/v1/events', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { [SSE_PUSH_HEADER]: '1' }, body: '' }),
  )
  await page.addInitScript((marker) => {
    const w = window as unknown as { __ssePush?: (text: string) => void }
    const prev = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const res = await prev(input, init)
      if (res.headers.get(marker) !== '1') return res
      const enc = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          w.__ssePush = (text) => controller.enqueue(enc.encode(text))
        },
      })
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
    }
  }, SSE_PUSH_HEADER)
  const push = async (frame: string) => {
    await page.waitForFunction(() => typeof (window as unknown as { __ssePush?: unknown }).__ssePush === 'function')
    await page.evaluate((f) => (window as unknown as { __ssePush: (t: string) => void }).__ssePush(f), frame)
  }
  const send = (frame: HomeChatFrame) => push(buildHomeChatSse([frame], correlationId))
  const delta = (text: string) => send({ event: 'delta', data: { text } })
  return { push, delta, send }
}

/** DELETE /api/v1/ai/chat/{correlationId} 취소 모킹 — 스탑 버튼 E2E 용. 호출 여부/횟수를 검증할 수 있다. */
export async function mockHomeChatCancel(page: Page): Promise<{ readonly calls: string[] }> {
  const path = /^\/api\/v1\/ai\/chat\/[^/]+$/
  const cancels = trackRequests(page, 'DELETE', path)
  await page.route(
    (url) => path.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    },
  )
  return {
    get calls() {
      return cancels.urls().map(String)
    },
  }
}

/** #843: 확인카드 1건(pending_action 봉투의 actions 원소 = 서버 영속 제안). */
export function proposal(id: number, summary: string, params: Record<string, unknown> = {}, actionType = 'calendar.create_event') {
  return { id, sessionId: 's-prop', actionType, summary, params, status: 'PENDING', errorMessage: null }
}

/** #843: 승인/거부 응답 결과 지정 — status 가 FAILED 면 reason 이 errorMessage·결과 줄 사유가 된다. */
export type ProposalReply =
  | { status: 'DONE' | 'REJECTED' }
  | { status: 'FAILED'; reason: string }
  | { httpStatus: number; message: string }

/**
 * #843: POST /api/v1/home/proposals/{id}/(confirm|reject) 모킹. reply(id, op) 로 건별 결과를 정하고,
 * delayMs 로 응답을 늦춰 전송 중(submitting) 상태를 관측할 수 있다. 호출 순서를 calls 로 돌려준다.
 */
export async function mockHomeProposals(
  page: Page,
  opts: {
    reply: (id: number, op: 'confirm' | 'reject') => ProposalReply
    summaries?: Record<number, string>
    delayMs?: number
  },
): Promise<{ readonly calls: { id: number; op: 'confirm' | 'reject' }[] }> {
  const path = /^\/api\/v1\/home\/proposals\/(\d+)\/(confirm|reject)$/
  const parse = (pathname: string) => {
    const [, idStr, op] = pathname.match(path)!
    return { id: Number(idStr), op: op as 'confirm' | 'reject' }
  }
  const sent = trackRequests(page, 'POST', path)
  let msgId = 1000
  await page.route(
    (url) => path.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const { id, op } = parse(new URL(route.request().url()).pathname)
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const r = opts.reply(id, op)
      if ('httpStatus' in r) {
        return route.fulfill({
          status: r.httpStatus,
          contentType: 'application/json',
          body: JSON.stringify({ status: r.httpStatus, message: r.message }),
        })
      }
      const summary = opts.summaries?.[id] ?? `제안 ${id}`
      const role = r.status === 'DONE' ? 'ACTION_DONE' : r.status === 'FAILED' ? 'ACTION_FAILED' : 'ACTION_REJECTED'
      const content =
        r.status === 'DONE'
          ? `승인 완료: ${summary}`
          : r.status === 'FAILED'
            ? `승인 실패: ${summary} — 사유: ${r.reason}`
            : `사용자가 거절: ${summary}`
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          proposal: {
            ...proposal(id, summary),
            status: r.status,
            errorMessage: r.status === 'FAILED' ? r.reason : null,
          },
          message: { id: ++msgId, role, content, widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:00Z' },
        }),
      })
    },
  )
  return {
    get calls() {
      return sent.urls().map((u) => parse(u.pathname))
    },
  }
}
