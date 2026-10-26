// 데스크톱 AI 사이드 패널 페이지 테스트 도우미(WP-966 웨이브 3, 묶음 b2a) — E2E 의 e2e/fixtures/ai-live-chat·home-chat-mock·
// ai-suggestions-mock·ai-memory-mock 을 MSW 로 옮긴 것. 통합 SSE(/api/v1/events)를 열린 채 두고 테스트가 원하는 순간
// home.chat.* 프레임을 밀어 넣는다(앱은 fetch + ReadableStream 으로 읽으므로 jsdom 에서도 같은 파서를 지난다).
// AI 패널은 앱 셸(AppLayout)이 SSE 구독·AI 공급자와 함께 띄우므로 renderPage 로 연다(renderScreen 으로는 셸을 다시 조립해야 한다).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { beforeEach, expect } from 'vitest'

import { chatStreams } from '@/lib/ai/chatStreams'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { ActiveChatItem, HomeMessage, HomeSessionSummary } from '@/types/home'

const API = '/api/v1'

/**
 * 대화별 스트림 저장소(chatStreams)는 모듈 전역이라 앞 테스트의 대화가 다음 테스트 패널에 남는다(브라우저에선 새로고침마다 새로 뜬다).
 * 이 도우미를 불러온 파일은 테스트마다 owner 를 비워 저장소를 초기화한다 — 다음 로그인(renderPage)이 owner 를 다시 정한다.
 */
beforeEach(() => chatStreams.setOwner(null))

// 실데이터 길이의 대화 제목 — E2E 픽스처와 같은 값.
export const TITLE_A = '3분기 매출 보고서 초안을 팀 공유용 한 장 요약으로 다시 정리'
export const TITLE_B = '다음 주 화요일 디자인 리뷰 회의 안건과 참석자 일정 확인해 줘'
export const TITLE_C = '고객 문의 메일 중 환불 요청 건만 모아서 답장 초안 만들어 줘'

export type LiveEvent = 'delta' | 'progress' | 'tool' | 'pending_action' | 'done' | 'error' | 'cancelled' | 'followups'
export type StartReply = { correlationId: string; sessionId: string } | { status: 409 | 429 }

export const summary = (id: string, title: string, minutesAgo = 5): HomeSessionSummary => ({
  id,
  title,
  lastMessageAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  widgetCount: 0,
})

export const msg = (id: number, role: HomeMessage['role'], content: string, status?: HomeMessage['status']): HomeMessage => ({
  id, role, content, widgets: null, toolCalls: null, createdAt: '2026-10-05T00:00:00Z', ...(status ? { status } : {}),
})

/** 요청 기록 — 본문은 핸들러 안에서 읽어 넣는다. */
export type Recorder<T = unknown> = { bodies: T[]; urls: string[]; count: () => number; last: () => T | undefined }
const recorder = <T>(): Recorder<T> => {
  const r: Recorder<T> = { bodies: [], urls: [], count: () => r.urls.length, last: () => r.bodies.at(-1) }
  return r
}

/** 짧게 기다린다 — 「일어나지 않음」(부재)을 확인하기 전에 앱이 이벤트·응답을 처리할 틈을 준다(E2E expectStays 대응). */
export const settle = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms))

/** 테스트가 풀 때까지 붙잡는 문(E2E fixtures/wait 의 gate 와 같음). */
export function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => (release = r))
  return { p, release }
}

/**
 * 라이브 채팅 목 — POST /ai/chat 응답 큐, 생성 중 목록, 대화 목록·이력, 열린 SSE 에 프레임 밀어 넣기.
 * handlers 를 renderPage 에 넘긴 뒤 쓴다.
 */
export function liveChat() {
  const enc = new TextEncoder()
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const replies: StartReply[] = []
  const ids = new Map<string, string>() // 이름 → 웹이 정한 correlationId
  const cid = (name: string) => ids.get(name) ?? name
  let active: { limit: number; items: ActiveChatItem[] } = { limit: 3, items: [] }
  let sessions: HomeSessionSummary[] = []
  const messages = new Map<string, HomeMessage[]>()
  const holds = new Map<string, Promise<void>>()
  const starts = recorder<Record<string, unknown>>()
  const cancels = recorder()
  const deletes = recorder() // 취소·대화 삭제 DELETE 순서

  const handlers: RequestHandler[] = [
    http.get(`${API}/events`, ({ request }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streams.add(controller)
          request.signal.addEventListener('abort', () => {
            streams.delete(controller)
            try {
              controller.close()
            } catch {
              // 이미 닫힘
            }
          })
        },
      })
      return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }),
    http.post(`${API}/ai/chat`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      starts.urls.push(request.url)
      starts.bodies.push(body)
      const r = replies.shift()
      if (!r) return HttpResponse.json({ message: 'no reply queued' }, { status: 500 })
      if ('status' in r) {
        const code = r.status === 429 ? 'CHAT_CONCURRENCY_LIMIT' : 'CHAT_SESSION_BUSY'
        const message = r.status === 429 ? '다른 대화 3개가 답변 중이에요.' : '이 대화는 아직 답변 중이에요'
        return HttpResponse.json({ status: r.status, message, errors: { code } }, { status: r.status })
      }
      if (typeof body.correlationId === 'string') ids.set(r.correlationId, body.correlationId)
      return HttpResponse.json({ ...r, correlationId: cid(r.correlationId) })
    }),
    http.get(`${API}/ai/chat/active`, () =>
      HttpResponse.json({ ...active, items: active.items.map((i) => ({ ...i, correlationId: cid(i.correlationId) })) })),
    http.delete(`${API}/ai/chat/:cid`, ({ request }) => {
      cancels.urls.push(new URL(request.url).pathname)
      deletes.urls.push(new URL(request.url).pathname)
      return HttpResponse.json({})
    }),
    http.get(`${API}/home/sessions`, () => HttpResponse.json({ items: sessions, nextCursor: null })),
    http.get(`${API}/home/sessions/:id/messages`, async ({ params }) => {
      const id = String(params.id)
      await holds.get(id)
      return HttpResponse.json(messages.get(id) ?? [])
    }),
    http.delete(`${API}/home/sessions/:id`, ({ request }) => {
      deletes.urls.push(new URL(request.url).pathname)
      return new HttpResponse(null, { status: 204 })
    }),
  ]

  return {
    handlers,
    starts,
    cancels,
    deletes,
    cid,
    queueStart: (r: StartReply) => void replies.push(r),
    setActive: (items: ActiveChatItem[], limit = 3) => void (active = { limit, items }),
    setSessions: (items: HomeSessionSummary[]) => void (sessions = items),
    setMessages: (id: string, m: HomeMessage[]) => void messages.set(id, m),
    /** 그 대화의 이력 조회 응답을 붙잡는다 — 돌려준 함수를 부르면 그때의 메시지로 응답한다. */
    holdMessages(id: string) {
      let release!: () => void
      holds.set(id, new Promise<void>((r) => (release = r)))
      return () => {
        holds.delete(id)
        release()
      }
    },
    /** 열린 SSE 에 home.chat.<event> 프레임 1개. correlationId 가 queueStart 의 이름이면 웹이 정한 실제 id 로 바꿔 보낸다. */
    async push(event: LiveEvent, data: Record<string, unknown>) {
      await waitFor(() => expect(streams.size).toBeGreaterThan(0))
      const payload = typeof data.correlationId === 'string' ? { ...data, correlationId: cid(data.correlationId) } : data
      const bytes = enc.encode(`event: home.chat.${event}\ndata: ${JSON.stringify(payload)}\n\n`)
      streams.forEach((c) => c.enqueue(bytes))
      // 리더가 조각을 읽고 React 가 반영할 틈.
      await settle(20)
    },
    /** SSE 를 끊었다가 앱이 다시 연결할 때까지 기다린다(첫 백오프 1~2초). */
    async reconnect() {
      const old = [...streams]
      streams.clear()
      old.forEach((c) => c.error(new TypeError('network')))
      await waitFor(() => expect(streams.size).toBeGreaterThan(0), { timeout: 5_000 })
    },
  }
}
export type LiveChat = ReturnType<typeof liveChat>

/** 추천 질문 응답 — replies 를 순서대로 소비(마지막 반복). gate 는 모든 응답을, gates[i] 는 i 번째만 붙잡는다. */
export function starterSuggestions(opts: {
  replies: Array<{ items: string[]; enabled: boolean } | { status: number }>
  gate?: Promise<void>
  gates?: Array<Promise<void> | undefined>
}) {
  const calls = recorder<Record<string, unknown>>()
  let answered = 0
  let i = 0
  const handler = http.post(`${API}/ai/suggestions`, async ({ request }) => {
    calls.urls.push(request.url)
    calls.bodies.push((await request.json()) as Record<string, unknown>)
    const n = i++
    const reply = opts.replies[Math.min(n, opts.replies.length - 1)]
    if (opts.gate) await opts.gate
    if (opts.gates?.[n]) await opts.gates[n]
    answered++
    if ('status' in reply) return HttpResponse.json({ message: '오류' }, { status: reply.status })
    return HttpResponse.json(reply)
  })
  return { handler, calls, answered: () => answered }
}

/** 사용자 AI 설정(추천 켜짐/꺼짐) — GET 응답 횟수를 센다(꺼짐 반영 뒤 부재 확인용). */
export function aiPreferences(enabled: boolean) {
  let gets = 0
  const handler = http.get(`${API}/users/me/ai-preferences`, () => {
    gets++
    return HttpResponse.json({ suggestionsEnabled: enabled, memoryEnabled: true })
  })
  return { handler, gets: () => gets }
}

/** 시작 요청을 받으면 그 correlationId 로 frames 를 흘리는 단순 생성 목(E2E mockHomeChatGeneration 대응). 기록을 돌려준다. */
export function homeChatGeneration(frames: Array<{ event: LiveEvent; data: Record<string, unknown> }>) {
  const live = liveChat()
  let finish!: () => void
  /** 모든 프레임을 보낸 뒤 풀린다 — 테스트가 끝나기 전에 기다려 다음 테스트로 프레임이 새지 않게 한다. */
  const done = new Promise<void>((r) => (finish = r))
  const handlers = [
    http.post(`${API}/ai/chat`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      live.starts.urls.push(request.url)
      live.starts.bodies.push(body)
      const correlationId = String(body.correlationId)
      // 응답이 화면에 반영된 뒤 프레임을 흘린다.
      setTimeout(() => {
        void (async () => {
          for (const f of frames) await live.push(f.event, { correlationId, ...f.data })
        })().finally(finish)
      }, 30)
      return HttpResponse.json({ correlationId })
    }),
    ...live.handlers,
  ]
  return { handlers, starts: live.starts, done }
}

/** 되돌리기 응답 — 순서대로 소비, 비면 받은 값으로 성공. hold 를 주면 모든 응답을 붙잡는다. */
export function memoryUndo(replies: Array<{ status: number; body: unknown }> = [], hold?: Promise<void>) {
  const calls = recorder<Record<string, unknown>>()
  let i = 0
  const handler = http.post(`${API}/users/me/ai-memories/undo`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    calls.urls.push(request.url)
    calls.bodies.push(body)
    const r = replies[i++] ?? { status: 200, body: { ...body, undone: true } }
    if (hold) await hold
    return HttpResponse.json(r.body as never, { status: r.status })
  })
  return { handler, calls }
}

/** 서버 오류 응답(ErrorResponse + errors.code [+ 다른 키]). */
export const memoryError = (status: number, code: string, message = '오류', extra: Record<string, string> = {}) => ({
  status,
  body: { status, error: '', message, errors: { code, ...extra } },
})

/** 메모리 도구 start·result 한 쌍 — result 에 memory(결과 줄 근거)를 싣는다. */
export async function memoryTool(live: LiveChat, seq: number, toolName: string, memory: Record<string, unknown>, ids = { correlationId: 'corr-a', sessionId: 's-a' }) {
  await live.push('tool', { ...ids, seq, phase: 'start', toolName, args: {} })
  await live.push('tool', { ...ids, seq, phase: 'result', toolName, isError: false, memory })
}

/** path(기본 /projects)를 띄우고 데스크톱 AI 사이드 패널을 연다. */
export async function openChatPanel(handlers: RequestHandler[], path = '/projects') {
  const view = renderPage(path, { handlers })
  await view.user.click(await screen.findByTestId('chat-launcher', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  return { ...view, panel: await screen.findByTestId('chat-panel') }
}

/** 입력창에 값을 채운다(키마다 의미가 없어 change 한 번). */
export function fillInput(text: string) {
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: text } })
}

/** 패널의 보내기 버튼. */
export const sendButton = () => within(screen.getByTestId('chat-panel')).getByRole('button', { name: '보내기' })

/** 질문을 보내고 시작 요청이 하나 더 도착할 때까지 기다린다. */
export async function ask(live: { starts: Recorder }, text: string) {
  const before = live.starts.count()
  // 앞 동작(새 대화·시작 응답)이 반영돼 보내기 버튼이 설 때까지 기다린다.
  const button = await waitFor(() => sendButton())
  fillInput(text)
  fireEvent.click(button)
  await waitFor(() => expect(live.starts.count()).toBe(before + 1))
}

/** 대화 목록에서 제목으로 행 찾기(목록이 열려 있어야 한다). */
export const sessionItem = (title: string) =>
  screen.getAllByTestId('chat-session-item').find((el) => el.textContent?.includes(title)) as HTMLElement

/** 헤더 대화 목록을 열고 제목의 대화를 고른다. */
export async function openSession(user: { click: (el: Element) => Promise<void> }, title: string) {
  await user.click(screen.getByTestId('chat-session-switcher'))
  await waitFor(() => expect(sessionItem(title)).toBeTruthy())
  await user.click(within(sessionItem(title)).getByTestId('chat-session-select'))
}

/** a 가 문서 순서상 b 보다 앞인가(흐름 위치 — 그려질 자리 순서. 실제 기하는 E2E @layout 이 본다). */
export const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
