// 홈 AI 채팅 E2E 모킹 헬퍼(#593 편입) — POST /api/v1/ai/chat 는 이제 { correlationId } 를 즉시
// 반환하고, 실제 delta/progress/pending_action/tool/done/error 는 통합 /api/v1/events 채널로
// home.chat.* 이벤트로 도착한다(wiki-ai.spec.ts 의 mockWikiAiGeneration/buildWikiAiSse 패턴 미러).
//
// 모킹 방식: POST 라우트가 도착했다는 신호로 프라미스를 resolve 하고, /events 라우트가 그 프라미스를
// await 한 뒤에야 SSE 본문을 흘린다 — /events 는 앱 마운트 시 1회 연결되므로, 응답을 즉시 fulfill 하면
// 사용자 액션(전송 클릭)보다 먼저 도착해 유실된다.
import type { Page } from '@playwright/test'

import type { AiScreenContext } from '../../src/types/aiScreenContext'

/** home.chat.* 프레임 1개 — event 이름은 'home.chat.' 프리픽스를 뺀 부분만 지정한다. */
export interface HomeChatFrame {
  event: 'delta' | 'progress' | 'pending_action' | 'tool' | 'done' | 'error'
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
 * 를 함께 설정한다. onStart 로 요청 payload(sessionId/query/screenContext — WP-54)를 캡처할 수 있다.
 *
 * 델타/누적 텍스트 대신 완성된 frames 배열을 그대로 넘기면 되므로, 기존에
 * `event: delta\ndata: {...}` 형태로 직접 SSE 본문을 조립하던 스펙들은 frames 배열로만 옮기면 된다.
 */
export async function mockHomeChatGeneration(
  page: Page,
  opts: {
    frames: HomeChatFrame[]
    correlationId?: string
    onStart?: (body: { sessionId: string | null; query: string; screenContext?: AiScreenContext }) => void
  },
) {
  let resolveStarted: (correlationId: string) => void
  const started = new Promise<string>((resolve) => {
    resolveStarted = resolve
  })

  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const body = route.request().postDataJSON() as { sessionId: string | null; query: string; screenContext?: AiScreenContext }
      opts.onStart?.(body)
      const correlationId = opts.correlationId ?? `corr-${Math.random().toString(36).slice(2)}`
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
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildHomeChatSse(opts.frames, correlationId),
      })
    },
  )
}

/** DELETE /api/v1/ai/chat/{correlationId} 취소 모킹 — 스탑 버튼 E2E 용. 호출 여부/횟수를 검증할 수 있다. */
export async function mockHomeChatCancel(page: Page): Promise<{ calls: string[] }> {
  const calls: string[] = []
  await page.route(
    (url) => /^\/api\/v1\/ai\/chat\/[^/]+$/.test(url.pathname),
    (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      calls.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    },
  )
  return { calls }
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
): Promise<{ calls: { id: number; op: 'confirm' | 'reject' }[] }> {
  const calls: { id: number; op: 'confirm' | 'reject' }[] = []
  let msgId = 1000
  await page.route(
    (url) => /^\/api\/v1\/home\/proposals\/\d+\/(confirm|reject)$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      const [, idStr, op] = new URL(route.request().url()).pathname.match(/proposals\/(\d+)\/(confirm|reject)$/)!
      const id = Number(idStr)
      calls.push({ id, op: op as 'confirm' | 'reject' })
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      const r = opts.reply(id, op as 'confirm' | 'reject')
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
  return { calls }
}
