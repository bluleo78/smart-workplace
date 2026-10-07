// 메인 AI 채팅 멀티 세션 E2E 픽스처(WP-190) — 열린 SSE 한 줄기에 테스트가 원하는 순간 home.chat.* 프레임을 밀어 넣는다.
// 프레임 묶음을 재연결마다 나눠 주면 1~2초 재연결 지연과 onOpen(활성 재동기화·catch-up)이 끼어 느리고 비결정적이라,
// auth.fixture 의 fetch 래퍼 방식(표식 헤더 → 닫히지 않는 본문)을 확장해 스트림 컨트롤러를 window 에 걸어 둔다.
import { expect, type Locator, type Page } from '@playwright/test'

import type { ActiveChatItem, HomeMessage, HomeSessionSummary } from '../../src/types/home'
import { mockApi } from './api-mock'
import { type RequestTracker, trackRequests } from './requests'

const LIVE_HEADER = 'x-e2e-sse-live'

// 실데이터 길이의 대화 제목(시각·말줄임 검증) — 서버는 첫 질문 40자로 제목을 만든다. 데스크톱·모바일 스펙이 공유한다.
export const TITLE_A = '3분기 매출 보고서 초안을 팀 공유용 한 장 요약으로 다시 정리'
export const TITLE_B = '다음 주 화요일 디자인 리뷰 회의 안건과 참석자 일정 확인해 줘'
export const TITLE_C = '고객 문의 메일 중 환불 요청 건만 모아서 답장 초안 만들어 줘'

declare global {
  interface Window {
    __e2eSse?: Set<ReadableStreamDefaultController<Uint8Array>>
  }
}

export type LiveEvent = 'delta' | 'progress' | 'tool' | 'pending_action' | 'done' | 'error' | 'cancelled'
export type StartReply = { correlationId: string; sessionId: string } | { status: 409 | 429 }

export interface LiveChat {
  /** 열린 SSE 에 home.chat.<event> 프레임 1개를 보낸다. correlationId 가 queueStart 의 이름이면 웹이 정한 실제 id 로 바꿔 보낸다. */
  push(event: LiveEvent, data: Record<string, unknown>): Promise<void>
  /**
   * 다음 POST /ai/chat 응답(순서대로 소비). status 면 그 오류로 거절. WP-267: 웹이 correlationId 를 정해 보내므로 응답은 실제 서버처럼
   * 그 id 를 돌려주고, reply.correlationId 는 테스트가 그 생성을 부르는 이름이 된다(push·cid 가 실제 id 로 바꾼다).
   */
  queueStart(reply: StartReply): void
  /** queueStart 이름 → 웹이 정한 실제 correlationId(아직 요청 전이면 이름 그대로). */
  cid(name: string): string
  /** 서버 생성 중 목록 — correlationId 가 queueStart 의 이름이면 실제 id 로 바꿔 돌려준다. */
  setActive(items: ActiveChatItem[], limit?: number): void
  setSessions(items: HomeSessionSummary[]): void
  setMessages(sessionId: string, messages: HomeMessage[]): void
  /** 그 대화의 이력 조회 응답을 붙잡는다 — 돌려준 함수를 부르면 그때의 메시지로 응답한다(WP-266·268 "읽는 중" 관측). */
  holdMessages(sessionId: string): () => void
  /** SSE 를 끊었다가 앱이 다시 연결할 때까지 기다린다(WP-265 재연결). */
  reconnect(): Promise<void>
  starts: RequestTracker
  cancels: RequestTracker
}

export const summary = (id: string, title: string, minutesAgo = 5): HomeSessionSummary => ({
  id,
  title,
  lastMessageAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  widgetCount: 0,
})

export const msg = (id: number, role: HomeMessage['role'], content: string, status?: HomeMessage['status']): HomeMessage => ({
  id, role, content, widgets: null, toolCalls: null, createdAt: '2026-10-05T00:00:00Z', ...(status ? { status } : {}),
})

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

export async function setupLiveChat(page: Page): Promise<LiveChat> {
  const starts = trackRequests(page, 'POST', '/api/v1/ai/chat')
  const cancels = trackRequests(page, 'DELETE', /^\/api\/v1\/ai\/chat\/[^/]+$/)
  const replies: StartReply[] = []
  const ids = new Map<string, string>() // 이름 → 웹이 정한 correlationId
  const cid = (name: string) => ids.get(name) ?? name
  let active: { limit: number; items: ActiveChatItem[] } = { limit: 3, items: [] }
  let sessions: HomeSessionSummary[] = []
  const messages = new Map<string, HomeMessage[]>()
  const holds = new Map<string, Promise<void>>()

  await page.route((u) => u.pathname === '/api/v1/events', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { [LIVE_HEADER]: '1' }, body: '' }))
  await page.addInitScript((header) => {
    const prev = window.fetch.bind(window)
    window.__e2eSse = new Set()
    window.fetch = async (input, init) => {
      const res = await prev(input, init)
      if (res.headers.get(header) !== '1') return res
      // 요청 signal abort(언마운트·StrictMode 이중 마운트)면 그 스트림을 닫고 목록에서 뺀다.
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          window.__e2eSse!.add(controller)
          const abort = () => {
            window.__e2eSse!.delete(controller)
            try {
              controller.error(new DOMException('Aborted', 'AbortError'))
            } catch {
              // 이미 닫힌 스트림
            }
          }
          if (signal?.aborted) abort()
          else signal?.addEventListener('abort', abort, { once: true })
        },
      })
      return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
    }
  }, LIVE_HEADER)

  await page.route((u) => u.pathname === '/api/v1/ai/chat', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const r = replies.shift()
    if (!r) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"no reply queued"}' })
    if ('status' in r) {
      const code = r.status === 429 ? 'CHAT_CONCURRENCY_LIMIT' : 'CHAT_SESSION_BUSY'
      return route.fulfill({
        status: r.status,
        contentType: 'application/json',
        body: JSON.stringify({ status: r.status, message: r.status === 429 ? '다른 대화 3개가 답변 중이에요.' : '이 대화는 아직 답변 중이에요', errors: { code } }),
      })
    }
    const sent = (route.request().postDataJSON() as { correlationId?: string } | null)?.correlationId
    if (sent) ids.set(r.correlationId, sent)
    return route.fulfill(json({ ...r, correlationId: cid(r.correlationId) }))
  })
  await page.route((u) => /^\/api\/v1\/ai\/chat\/[^/]+$/.test(u.pathname), (route) =>
    route.request().method() === 'DELETE' ? route.fulfill(json({})) : route.fallback())
  await page.route((u) => u.pathname === '/api/v1/ai/chat/active', (route) =>
    route.fulfill(json({ ...active, items: active.items.map((i) => ({ ...i, correlationId: cid(i.correlationId) })) })))
  await page.route((u) => u.pathname === '/api/v1/home/sessions', (route) =>
    route.request().method() === 'GET' ? route.fulfill(json({ items: sessions, nextCursor: null })) : route.fallback())
  await page.route((u) => /^\/api\/v1\/home\/sessions\/[^/]+\/messages$/.test(u.pathname), async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[5]
    await holds.get(id)
    return route.fulfill(json(messages.get(id) ?? []))
  })
  await page.route((u) => /^\/api\/v1\/home\/sessions\/[^/]+$/.test(u.pathname), (route) =>
    route.request().method() === 'DELETE' ? route.fulfill({ status: 204, body: '' }) : route.fallback())

  return {
    async push(event, data) {
      // 앱이 SSE 를 아직 열지 않았을 수 있다 — 열린 스트림이 생길 때까지 기다린 뒤 보낸다.
      await expect.poll(() => page.evaluate(() => window.__e2eSse?.size ?? 0)).toBeGreaterThan(0)
      const sent = await page.evaluate(([name, payload]) => {
        const bytes = new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`)
        window.__e2eSse?.forEach((c) => c.enqueue(bytes))
        return window.__e2eSse?.size ?? 0
      }, [`home.chat.${event}`, typeof data.correlationId === 'string' ? { ...data, correlationId: cid(data.correlationId) } : data] as const)
      expect(sent, '열린 SSE 스트림이 없다').toBeGreaterThan(0)
    },
    queueStart: (r) => void replies.push(r),
    cid,
    setActive: (items, limit = 3) => void (active = { limit, items }),
    setSessions: (items) => void (sessions = items),
    setMessages: (id, m) => void messages.set(id, m),
    holdMessages(id) {
      let release!: () => void
      holds.set(id, new Promise<void>((r) => (release = r)))
      return () => {
        holds.delete(id)
        release()
      }
    },
    async reconnect() {
      await page.evaluate(() => {
        const streams = [...(window.__e2eSse ?? [])]
        window.__e2eSse?.clear()
        streams.forEach((c) => c.error(new TypeError('network')))
      })
      // 앱은 1~2초 뒤 다시 연결한다(eventStream 백오프 첫 회).
      await expect.poll(() => page.evaluate(() => window.__e2eSse?.size ?? 0), { timeout: 10_000 }).toBeGreaterThan(0)
    },
    starts,
    cancels,
  }
}

/** /projects 에서 데스크톱 AI 사이드 패널을 연다(projects 목록 빈 스텁 포함). */
export async function openChatPanel(page: Page) {
  await mockApi(page, 'GET', '/api/v1/projects', { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })
  await page.goto('/projects')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('chat-panel')).toBeVisible()
}

/** 질문을 보내고 POST 가 한 번 더 도착할 때까지 기다린다(데스크톱·모바일 공용 — 접근 이름 '보내기'). */
export async function ask(page: Page, live: LiveChat, query: string) {
  const before = live.starts.count()
  await page.getByTestId('chat-input').fill(query)
  await page.getByTestId('chat-panel').getByRole('button', { name: '보내기' }).click()
  await live.starts.waitFor(before + 1)
}

/** 대화 목록에서 제목으로 행 찾기. */
export const sessionItem = (page: Page, title: string): Locator =>
  page.getByTestId('chat-session-item').filter({ hasText: title })
