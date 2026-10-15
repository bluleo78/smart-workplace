// WP-55 AI 메모리 E2E 모킹 — 채팅 결과 줄 되돌리기(POST /users/me/ai-memories/undo)와 설정 카드의 상태 있는 목록 목,
// 메모리 도구 이벤트 push·설정 화면 진입 도우미(데스크톱·모바일 스펙 공용).
import { expect, type Page } from '@playwright/test'

import type { AiMemoryChange, AiMemoryItem, AiMemorySnapshot, UndoAiMemoryRequest } from '../../src/types/aiMemory'
import type { LiveChat } from './ai-live-chat'
import { mockMyAssistantStatus } from './my-assistant-mock'
import { type RequestTracker, trackRequests } from './requests'

/** 서버 ErrorResponse 본문(errors.code 에 도메인 오류 코드, extra 는 errors 의 다른 키 — 예: 가득 찬 범위 scope). */
const errorBody = (status: number, code: string, message: string, extra: Record<string, string> = {}) => ({
  status,
  error: '',
  message,
  errors: { code, ...extra },
})

/** 메모리 도구 start·result 한 쌍을 흘린다 — result 에 memory(결과 줄 근거)를 싣는다. ids 기본값은 스펙들이 쓰는 첫 대화. */
export async function memoryTool(
  live: LiveChat,
  seq: number,
  toolName: string,
  memory: Record<string, unknown>,
  ids = { correlationId: 'corr-a', sessionId: 's-a' },
) {
  await live.push('tool', { ...ids, seq, phase: 'start', toolName, args: {} })
  await live.push('tool', { ...ids, seq, phase: 'result', toolName, isError: false, memory })
}

/** 개인 비서 없음 + 설정 > AI 비서 진입 — 메모리 카드가 보일 때까지 기다린다. */
export async function openMemorySettings(page: Page) {
  await mockMyAssistantStatus(page, () => ({ configured: false, provider: null, model: null, suggestionModelAuto: null }))
  await page.goto('/settings/assistant')
  await expect(page.getByTestId('ai-memory-card')).toBeVisible()
}

/**
 * 되돌리기 응답을 순서대로 소비 — 비면 받은 값으로 성공({...body, undone:true}). hold 를 주면 모든 응답을 그 프라미스가 풀릴 때까지 붙잡는다
 * ("요청은 나갔고 응답은 아직" 상태를 결정적으로 만든다).
 */
export async function mockMemoryUndo(
  page: Page,
  replies: Array<{ status: number; body: unknown }> = [],
  hold?: Promise<void>,
): Promise<RequestTracker> {
  const calls = trackRequests(page, 'POST', '/api/v1/users/me/ai-memories/undo')
  let i = 0
  await page.route((u) => u.pathname === '/api/v1/users/me/ai-memories/undo', async (route) => {
    const r = replies[i++] ?? { status: 200, body: { ...(route.request().postDataJSON() as UndoAiMemoryRequest), undone: true } }
    if (hold) await hold
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  return calls
}

/** 서버 오류 응답(ErrorResponse + errors.code [+ 다른 키]). */
export const memoryError = (status: number, code: string, message = '오류', extra: Record<string, string> = {}) => ({
  status,
  body: errorBody(status, code, message, extra),
})

/** 메모리 항목 팩토리 — updatedAt 은 id 가 클수록 최근. */
export const memoryItem = (id: number, over: Partial<AiMemoryItem> = {}): AiMemoryItem => ({
  id,
  kind: 'PREFERENCE',
  content: `메모리 ${id}`,
  source: 'AI',
  createdAt: '2026-10-10T00:00:00Z',
  updatedAt: `2026-10-${String(10 + (id % 18)).padStart(2, '0')}T12:00:00Z`, // 정오 UTC — 어느 시간대에서도 같은 날짜로 보인다
  ...over,
})

export interface MemoryMock {
  /** 지금 서버 상태(최신순). */
  items: () => AiMemoryItem[]
  creates: RequestTracker
  updates: RequestTracker
  deletes: RequestTracker
  clears: RequestTracker
  /** WP-383 고정 PUT. */
  pins: RequestTracker
  /** 다음 쓰기 요청 1건을 이 오류로 거절한다. */
  failNext: (status: number, code: string, message: string) => void
  /** 다음 목록 GET 1건의 응답을 이 프라미스가 풀릴 때까지 붙잡는다("쓰기는 끝났고 목록은 아직" 상태를 결정적으로 만든다). */
  holdNextList: (until: Promise<void>) => void
}

/**
 * 설정 카드용 상태 있는 목(고정 WP-383 포함) — 목록은 배열 순서(맨 앞 = 최신)로 돌려준다. 추가·고치기는 맨 앞으로, 지우기는 지운 항목을 돌려준다.
 * 서버 규칙 중 화면이 기대는 것만 흉내 낸다(직접 추가는 USER, 고치기 응답의 previousContent·previousKind), 범위 저장·옮기기(WP-379), 기한 저장·지정·없애기(WP-380).
 */
export async function mockAiMemories(page: Page, initial: AiMemoryItem[]): Promise<MemoryMock> {
  let items = [...initial]
  let nextId = Math.max(100, ...initial.map((m) => m.id + 1))
  let failure: { status: number; code: string; message: string } | null = null
  let listHold: Promise<void> | null = null
  const creates = trackRequests(page, 'POST', '/api/v1/users/me/ai-memories')
  const updates = trackRequests(page, 'PATCH', /^\/api\/v1\/users\/me\/ai-memories\/\d+$/)
  const deletes = trackRequests(page, 'DELETE', /^\/api\/v1\/users\/me\/ai-memories\/\d+$/)
  const clears = trackRequests(page, 'DELETE', '/api/v1/users/me/ai-memories')
  const pins = trackRequests(page, 'PUT', /^\/api\/v1\/users\/me\/ai-memories\/\d+\/pin$/)
  const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route((u) => /^\/api\/v1\/users\/me\/ai-memories(\/\d+)?$/.test(u.pathname), async (route) => {
    const req = route.request()
    const method = req.method()
    const id = Number(new URL(req.url()).pathname.split('/')[6] ?? NaN)
    if (method !== 'GET' && failure) {
      const f = failure
      failure = null
      return route.fulfill(json(f.status, errorBody(f.status, f.code, f.message)))
    }
    if (method === 'GET') {
      const hold = listHold
      listHold = null
      if (hold) await hold
      return route.fulfill(json(200, { items, limit: 300, pinLimit: 10 }))
    }
    if (method === 'POST') {
      const body = req.postDataJSON() as { kind: AiMemoryItem['kind']; content: string; scope?: AiMemoryItem['scope']; expiresOn?: string }
      const created = memoryItem(nextId++, {
        kind: body.kind,
        content: body.content.trim(),
        source: 'USER',
        scope: body.scope ?? null,
        ...(body.expiresOn ? { expiresOn: body.expiresOn, expired: false } : {}),
        updatedAt: new Date().toISOString(),
      })
      items = [created, ...items]
      return route.fulfill(json(201, created))
    }
    if (method === 'PATCH') {
      const cur = items.find((m) => m.id === id)
      if (!cur) return route.fulfill(json(404, errorBody(404, 'AI_MEMORY_NOT_FOUND', '메모리를 찾을 수 없어요')))
      const body = req.postDataJSON() as { content?: string; scope?: AiMemoryItem['scope']; expiresOn?: string; clearExpiry?: boolean }
      const next = {
        ...cur,
        content: body.content?.trim() ?? cur.content,
        // present-flag — 키가 있을 때만 범위를 옮긴다(null = 공통).
        ...('scope' in body ? { scope: body.scope ?? null } : {}),
        // WP-380: 기한 지정·없애기 — 되살린 행은 만료가 풀린다(서버는 오늘 기준으로 다시 판정).
        ...(body.expiresOn ? { expiresOn: body.expiresOn, expired: false } : {}),
        ...(body.clearExpiry ? { expiresOn: null, expired: false } : {}),
        updatedAt: new Date().toISOString(),
      }
      items = [next, ...items.filter((m) => m.id !== id)]
      return route.fulfill(
        json(200, { ...next, previousContent: cur.content, previousKind: cur.kind, ...(cur.scope ? { previousScope: cur.scope } : {}), ...(cur.expiresOn ? { previousExpiresOn: cur.expiresOn } : {}) }),
      )
    }
    if (method === 'DELETE' && Number.isNaN(id)) {
      items = []
      return route.fulfill({ status: 204, body: '' })
    }
    if (method === 'DELETE') {
      const cur = items.find((m) => m.id === id)
      items = items.filter((m) => m.id !== id)
      return cur ? route.fulfill(json(200, cur)) : route.fulfill(json(404, errorBody(404, 'AI_MEMORY_NOT_FOUND', '없음')))
    }
    return route.fallback()
  })
  // WP-383 고정 — 다음 쓰기 거절(failNext)도 받는다. 토글은 updatedAt 을 바꾸지 않는다(자리는 그대로, 화면이 고정 행을 묶음 맨 위로 올린다).
  await page.route((u) => /^\/api\/v1\/users\/me\/ai-memories\/\d+\/pin$/.test(u.pathname), async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/')[6])
    if (failure) {
      const f = failure
      failure = null
      return route.fulfill(json(f.status, errorBody(f.status, f.code, f.message)))
    }
    const cur = items.find((m) => m.id === id)
    if (!cur) return route.fulfill(json(404, errorBody(404, 'AI_MEMORY_NOT_FOUND', '메모리를 찾을 수 없어요')))
    const { pinned } = route.request().postDataJSON() as { pinned: boolean }
    const next = { ...cur, pinned }
    items = items.map((m) => (m.id === id ? next : m))
    return route.fulfill(json(200, next))
  })
  return {
    items: () => items,
    creates,
    updates,
    deletes,
    clears,
    pins,
    failNext: (status, code, message) => void (failure = { status, code, message }),
    holdNextList: (until) => void (listHold = until),
  }
}

/** 기록 스냅숏 팩토리(WP-385). */
export const memorySnap = (id: number, content: string): AiMemorySnapshot => ({
  id,
  content,
  kind: 'PREFERENCE',
  scope: null,
  expiresOn: null,
  source: 'AI',
  pinned: false,
  lastUsedAt: '2026-10-15T00:00:00Z',
})

/** 기록 팩토리(WP-385) — 기본은 2026-10-15 11:40 KST 의 「새로 기억함」. */
export const memoryChange = (id: number, over: Partial<AiMemoryChange> = {}): AiMemoryChange => ({
  id,
  action: 'ADDED',
  createdAt: '2026-10-15T02:40:00Z',
  memory: memorySnap(500 + id, `기억 ${id}`),
  before: [],
  undoneAt: null,
  ...over,
})

export interface MemoryChangesMock {
  /** GET /changes 요청(cursor 쿼리 확인). */
  lists: RequestTracker
  /** POST /changes/{id}/undo 요청(경로의 id 확인). */
  undos: RequestTracker
  /** 다음 되돌리기 1건을 이 오류로 거절한다. */
  refuseNext: (status: number, code: string) => void
  /** 요청 없이 서버 상태만 되돌림으로 바꾼다 — 다른 탭·기기에서 되돌린 것 흉내(다음 목록 GET 부터 보인다). */
  markUndone: (id: number) => void
}

/** 되돌린 시각 — 화면 "되돌림 · 오후 12:00"(KST)을 결정적으로 만든다. */
export const UNDONE_AT = '2026-10-15T03:00:00Z'

/**
 * 「AI가 정리한 기록」 목(WP-385) — pages[i] 를 cursor "c<i>" 로 잇는다(첫 묶음은 cursor 없음, 마지막 묶음의 nextCursor 는 null).
 * 되돌리면 그 항목에 undoneAt(UNDONE_AT)을 붙여 { change } 로 돌려준다. auth.fixture 의 빈 기본 스텁보다 나중에 등록돼 우선한다(LIFO).
 */
export async function mockMemoryChanges(
  page: Page,
  pages: AiMemoryChange[][],
  count30d = pages.flat().length,
): Promise<MemoryChangesMock> {
  const state = pages.map((p) => [...p])
  let refusal: { status: number; code: string } | null = null
  const lists = trackRequests(page, 'GET', '/api/v1/users/me/ai-memories/changes')
  const undos = trackRequests(page, 'POST', /^\/api\/v1\/users\/me\/ai-memories\/changes\/\d+\/undo$/)
  const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
  // 그 기록에 되돌린 시각을 붙이고 바뀐 기록을 돌려준다(없으면 undefined).
  const markUndone = (id: number): AiMemoryChange | undefined => {
    for (const p of state) {
      const i = p.findIndex((c) => c.id === id)
      if (i < 0) continue
      p[i] = { ...p[i], undoneAt: UNDONE_AT }
      return p[i]
    }
    return undefined
  }
  await page.route((u) => u.pathname === '/api/v1/users/me/ai-memories/changes', (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    const i = cursor ? Number(cursor.slice(1)) : 0
    return route.fulfill(json(200, { items: state[i] ?? [], nextCursor: i + 1 < state.length ? `c${i + 1}` : null, count30d }))
  })
  await page.route((u) => /^\/api\/v1\/users\/me\/ai-memories\/changes\/\d+\/undo$/.test(u.pathname), (route) => {
    if (refusal) {
      const r = refusal
      refusal = null
      return route.fulfill(json(r.status, errorBody(r.status, r.code, '오류')))
    }
    const id = Number(new URL(route.request().url()).pathname.split('/')[7])
    const undone = markUndone(id)
    return undone ? route.fulfill(json(200, { change: undone })) : route.fulfill(json(404, errorBody(404, 'AI_MEMORY_NOT_FOUND', '없음')))
  })
  return {
    lists,
    undos,
    refuseNext: (status, code) => void (refusal = { status, code }),
    markUndone: (id) => void markUndone(id),
  }
}
