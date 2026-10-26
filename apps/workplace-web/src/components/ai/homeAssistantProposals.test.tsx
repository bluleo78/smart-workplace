// 홈 AI 확인 카드(#351 다건, #843 서버 영속 제안) 실패·잠금·복원 페이지 테스트(WP-971, WP-966).
// 「모두 승인」 순차 실행과 실패 토스트 1건 집계, 전송 중 잠금(중복 승인 없음), 실패 카드의 「AI에게 수정 요청」 새 질문 payload,
// 이미 처리된 카드(409) 사유, 세션 복원 시 결과 줄·미처리 카드 복원, done 전에 온 카드 봉투의 sessionId 로 세션 확정은
// 브라우저 없이 판정되므로 e2e/pages/home-assistant-multi-action.spec.ts·home-assistant-proposal-failure.spec.ts 에서 옮겼다.
// 그 spec 들에는 대표 배선(@wiring, 일부 승인·일부 거부)과 좁은 패널에서 긴 사유가 넘치지 않는지(@layout)만 남는다.
// renderPage 를 쓰는 이유: 칩·사이드 패널·통합 SSE 구독(useEventStream)·세션 스위처가 모두 앱 셸(AppLayout)에 있어
// 컴포넌트 하나로는 「질문 → SSE 카드 → 승인 API → 결과 줄」 조립을 띄울 수 없다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test } from 'vitest'

import { chatStreams } from '@/lib/ai/chatStreams'
import { controllableEvents } from '@/test/kits/projects/issueDetailEvents'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { HomeMessage } from '@/types/home'

type Frame = { event: string; data: Record<string, unknown> }
type StartBody = { sessionId: string | null; query: string; correlationId: string }

/** home.chat.* 프레임 하나 → SSE 본문(웹이 보낸 correlationId 를 싣는다 — 실제 서버와 같음). */
const frame = (f: Frame, correlationId: string) =>
  `event: home.chat.${f.event}\ndata: ${JSON.stringify({ correlationId, ...f.data })}\n\n`

/** 확인 카드 1건 — pending_action 봉투의 actions 원소(서버가 영속한 제안). */
const proposal = (id: number, summary: string, actionType = 'calendar.create_event') => ({
  id, sessionId: 's-prop', actionType, summary, params: {}, status: 'PENDING', errorMessage: null,
})

type Reply = { status: 'DONE' | 'REJECTED' } | { status: 'FAILED'; reason: string } | { httpStatus: number; message: string }

/**
 * AI 채팅 시작 + 통합 SSE + 확인 카드 승인/거부 목. frames 는 첫 질문 시작 직후 열린 스트림으로 보낸다(없으면 테스트가 send 로 직접).
 * 승인/거부는 reply(id, op) 로 건별 결과를 정하고, 서버처럼 결과 메시지(ACTION_*)를 돌려준다. 호출 순서는 calls 에 모인다.
 */
function homeAssistant(opts: { frames?: Frame[]; reply?: (id: number, op: 'confirm' | 'reject') => Reply; summaries?: Record<number, string>; gate?: Promise<void> }) {
  const events = controllableEvents()
  const starts: StartBody[] = []
  const calls: { id: number; op: 'confirm' | 'reject' }[] = []
  const cancels: string[] = []
  let msgId = 1000
  const handlers = [
    events.handler,
    http.post('/api/v1/ai/chat', async ({ request }) => {
      const body = (await request.json()) as StartBody
      starts.push(body)
      if (opts.frames && starts.length === 1) {
        setTimeout(() => void events.push(opts.frames!.map((f) => frame(f, body.correlationId)).join('')), 0)
      }
      return HttpResponse.json({ correlationId: body.correlationId })
    }),
    http.delete('/api/v1/ai/chat/:cid', ({ params }) => {
      cancels.push(String(params.cid))
      return HttpResponse.json({})
    }),
    http.post('/api/v1/home/proposals/:id/:op', async ({ params }) => {
      const id = Number(params.id)
      const op = params.op as 'confirm' | 'reject'
      calls.push({ id, op })
      if (opts.gate) await opts.gate
      const r = opts.reply?.(id, op) ?? { status: op === 'confirm' ? 'DONE' : 'REJECTED' }
      if ('httpStatus' in r) return HttpResponse.json({ status: r.httpStatus, message: r.message }, { status: r.httpStatus })
      const summary = opts.summaries?.[id] ?? `제안 ${id}`
      const role = r.status === 'DONE' ? 'ACTION_DONE' : r.status === 'FAILED' ? 'ACTION_FAILED' : 'ACTION_REJECTED'
      const content =
        r.status === 'DONE' ? `승인 완료: ${summary}` : r.status === 'FAILED' ? `승인 실패: ${summary} — 사유: ${r.reason}` : `사용자가 거절: ${summary}`
      return HttpResponse.json({
        proposal: { ...proposal(id, summary), status: r.status, errorMessage: r.status === 'FAILED' ? r.reason : null },
        message: { id: ++msgId, role, content, widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:00Z' },
      })
    }),
  ]
  /** 마지막 시작 요청의 correlationId 로 프레임 하나를 보낸다 — 스트림이 열린 채 카드만 먼저 오는 상황을 만든다. */
  const send = (f: Frame) => events.push(frame(f, starts.at(-1)!.correlationId))
  return { handlers, starts, calls, cancels, send }
}

// 대화 저장소(chatStreams)는 모듈 전역이라 파일 안에서 앞 테스트의 턴·카드가 남는다 — 매번 새 대화에서 시작한다.
beforeEach(() => chatStreams.newConversation())

/** 홈을 띄우고 칩으로 패널을 연 뒤 query 를 보낸다. */
async function openAndAsk(handlers: NonNullable<Parameters<typeof renderPage>[1]>['handlers'], query: string) {
  const view = renderPage('/', { handlers })
  await view.user.click(await screen.findByTestId('chat-launcher', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  fireEvent.change(await screen.findByTestId('chat-input'), { target: { value: query } })
  await view.user.click(screen.getByRole('button', { name: '보내기' }))
  return view
}

const items = () => screen.queryAllByTestId('pending-action-item')

/** 카드 한 건(주간 회의 삭제)을 띄운다 — proposal-failure spec 의 공통 시작. */
async function openWithOneCard(h: ReturnType<typeof homeAssistant>) {
  const view = await openAndAsk(h.handlers, '주간 회의 지워줘')
  await waitFor(() => expect(items()).toHaveLength(1))
  return view
}

const oneCardFrames: Frame[] = [
  { event: 'delta', data: { text: '회의를 삭제할게요.' } },
  { event: 'pending_action', data: { sessionId: 's-fail-1', actions: [proposal(31, '주간 회의 삭제', 'calendar.delete_event')] } },
  { event: 'done', data: { sessionId: 's-fail-1' } },
]

// #843 — 「모두 승인」 은 카드 순서대로 하나씩 승인하고, 실패는 토스트 1건(개수만)으로 모은다. 성공 카드는 사라지고 실패 카드만 사유와 함께 남는다.
test('모두 승인 — 순서대로 승인하고 일부 실패는 카드에 사유를 남기며 토스트 1건으로 집계한다', async () => {
  const h = homeAssistant({
    frames: [
      { event: 'delta', data: { text: '두 가지를 처리해 드릴게요.' } },
      { event: 'pending_action', data: { sessionId: 's-multi-1', actions: [proposal(21, '이슈 생성: 버그 수정', 'issue.create'), proposal(22, '일정 생성: 팀 공지 회의')] } },
      { event: 'done', data: { sessionId: 's-multi-1' } },
    ],
    reply: (id) => (id === 21 ? { status: 'DONE' } : { status: 'FAILED', reason: '필요 권한 없음: calendar:write' }),
    summaries: { 21: '이슈 생성: 버그 수정', 22: '일정 생성: 팀 공지 회의' },
  })
  const { user } = await openAndAsk(h.handlers, '두 가지 일 처리해줘')
  await user.click(await screen.findByTestId('pending-action-approve-all'))
  await waitFor(() => expect(h.calls).toEqual([{ id: 21, op: 'confirm' }, { id: 22, op: 'confirm' }]))
  await waitFor(() => expect(items()).toHaveLength(1))
  expect(items()[0]).toHaveAttribute('data-phase', 'failed')
  expect(within(items()[0]).getByTestId('pending-action-error')).toHaveTextContent('필요 권한 없음: calendar:write')
  expect(await screen.findAllByText('2건 중 1건을 처리하지 못했어요')).toHaveLength(1)
  expect(screen.getAllByTestId('action-result')).toHaveLength(2)
})

// 승인 응답을 기다리는 동안 카드는 aria-busy 이고 승인·거부가 잠긴다 — 잠긴 버튼을 다시 눌러도 요청은 1건뿐이다.
test('전송 중에는 카드 버튼이 잠겨 중복 승인되지 않는다', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const h = homeAssistant({ frames: oneCardFrames, summaries: { 31: '주간 회의 삭제' }, gate })
  await openWithOneCard(h)
  const item = items()[0]
  const approve = within(item).getByRole('button', { name: '승인' })
  fireEvent.click(approve)
  await waitFor(() => expect(item).toHaveAttribute('aria-busy', 'true'))
  expect(approve).toBeDisabled()
  expect(within(item).getByRole('button', { name: '거부' })).toBeDisabled()
  // 잠긴 버튼을 다시 눌러도(E2E 의 force 클릭 자리) 요청이 늘지 않는다.
  fireEvent.click(approve)
  release()
  await waitFor(() => expect(screen.queryByTestId('pending-action-card')).not.toBeInTheDocument())
  expect(h.calls).toHaveLength(1)
})

// 실패 카드는 같은 파라미터 재시도 대신 「AI에게 수정 요청」 — 실패 요약을 담은 새 질문을 보낸다.
test('AI에게 수정 요청 — 실패 요약을 담아 새 질문을 보낸다', async () => {
  const h = homeAssistant({ frames: oneCardFrames, reply: () => ({ status: 'FAILED', reason: '일정을 찾을 수 없습니다' }), summaries: { 31: '주간 회의 삭제' } })
  const { user } = await openWithOneCard(h)
  await user.click(within(items()[0]).getByRole('button', { name: '승인' }))
  await waitFor(() => expect(items()[0]).toHaveAttribute('data-phase', 'failed'))
  expect(within(items()[0]).queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
  expect(within(items()[0]).getByRole('button', { name: '닫기' })).toBeInTheDocument()
  // 결과 줄(대화 이력) — 다음 턴 AI 맥락과 같은 문장.
  const result = screen.getByTestId('action-result')
  expect(result).toHaveAttribute('data-status', 'failed')
  expect(result).toHaveTextContent('승인 실패: 주간 회의 삭제 — 사유: 일정을 찾을 수 없습니다')
  await user.click(within(items()[0]).getByRole('button', { name: 'AI에게 수정 요청' }))
  await waitFor(() => expect(h.starts).toHaveLength(2))
  expect(h.starts[1].query).toContain('주간 회의 삭제')
  expect(h.starts[1].query).toContain('실패')
})

// 이미 처리된 카드(409) — 서버 사유를 카드에 보이고 실패로 확정한다(다시 승인 버튼 없음).
test('이미 처리된 카드(409)는 사유를 카드에 보이고 다시 승인할 수 없다', async () => {
  const h = homeAssistant({ frames: oneCardFrames, reply: () => ({ httpStatus: 409, message: '이미 처리된 확인 카드입니다' }) })
  const { user } = await openWithOneCard(h)
  await user.click(within(items()[0]).getByRole('button', { name: '승인' }))
  await waitFor(() => expect(items()[0]).toHaveAttribute('data-phase', 'failed'))
  expect(within(items()[0]).getByTestId('pending-action-error')).toHaveTextContent('이미 처리된 확인 카드입니다')
  expect(within(items()[0]).queryByRole('button', { name: '승인' })).not.toBeInTheDocument()
})

// 세션을 다시 열면 ACTION_FAILED 는 사용자 말풍선이 아닌 결과 줄로, 미처리 제안은 카드로 함께 복원된다.
test('세션 복원 — 결과 줄과 미처리 카드가 함께 복원된다', async () => {
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: '회의 두 개 지워줘', widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: '두 건을 제안했어요.', widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:01Z' },
    { id: 3, role: 'ACTION_FAILED', content: '승인 실패: 월간 회의 삭제 — 사유: 일정을 찾을 수 없습니다', widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:02Z' },
  ]
  const { user } = renderPage('/', {
    handlers: [
      http.get('/api/v1/home/sessions', () =>
        HttpResponse.json({ items: [{ id: 's-rest', title: '회의 정리', lastMessageAt: '2026-09-23T00:00:00Z', widgetCount: 0 }], nextCursor: null })),
      http.get('/api/v1/home/sessions/s-rest/messages', () => HttpResponse.json(messages)),
      http.get('/api/v1/home/sessions/s-rest/proposals', () => HttpResponse.json([proposal(41, '주간 회의 삭제')])),
    ],
  })
  await user.click(await screen.findByTestId('chat-launcher', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await user.click(await screen.findByTestId('chat-session-switcher'))
  await user.click((await screen.findAllByTestId('chat-session-select'))[0])
  const result = await screen.findByTestId('action-result')
  expect(result).toHaveAttribute('data-status', 'failed')
  expect(result).toHaveTextContent('일정을 찾을 수 없습니다')
  await waitFor(() => expect(items()).toHaveLength(1))
  expect(screen.getByTestId('pending-action-card')).toHaveTextContent('주간 회의 삭제')
})

// 새 세션의 카드가 done 보다 먼저 와도 봉투의 sessionId 로 세션이 확정된다 — 멈추고 다음 질문을 보내면 같은 세션으로 이어진다
// (null 이면 결과가 엉뚱한 새 세션에 쌓인다).
test('새 세션 — 카드가 done 보다 먼저 와도 봉투의 sessionId 로 세션이 확정된다', async () => {
  const h = homeAssistant({})
  const { user } = await openAndAsk(h.handlers, '팀 회의 잡아줘')
  await waitFor(() => expect(h.starts).toHaveLength(1))
  await h.send({ event: 'pending_action', data: { sessionId: 's-early', actions: [proposal(51, '팀 회의 생성')] } })
  await waitFor(() => expect(items()).toHaveLength(1))
  await user.click(screen.getByTestId('chat-stop'))
  await h.send({ event: 'cancelled', data: { sessionId: 's-early', reason: 'user' } })
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '고마워' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled())
  await user.click(screen.getByRole('button', { name: '보내기' }))
  await waitFor(() => expect(h.starts.map((b) => b.sessionId)).toEqual([null, 's-early']))
})
