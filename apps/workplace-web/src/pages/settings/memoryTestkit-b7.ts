// AI 메모리 설정 화면 테스트(WP-966 웨이브 3, b7) MSW 목 — e2e/fixtures/ai-memory-mock.ts·shared-memory-mock.ts·ai-suggestions-mock.ts 와
// 같은 서버 규칙을 MSW 핸들러로 옮겼다(Playwright 픽스처는 @playwright/test 를 불러 vitest 에서 쓸 수 없다).
// 목록·쓰기는 상태를 들고 다음 GET 에 반영한다 — 화면이 서버 응답을 따르는지 본다. 받은 요청은 Call 로 모은다.
import { http, HttpResponse } from 'msw'

import type { AiMemoryChange, AiMemoryItem, AiMemorySnapshot } from '@/types/aiMemory'
import type { AiPreferences } from '@/types/aiSuggestions'
import type { SharedAiMemoryChange, SharedAiMemoryItem, SharedMemorySpace } from '@/types/sharedAiMemory'

const API = '/api/v1'

/** 받은 요청 한 건 — 메서드·주소(URL)·본문(JSON, 없으면 null). */
export type Call = { method: string; url: URL; body: unknown }

/** 요청을 Call 로 바꿔 calls 에 쌓는다. */
async function record(calls: Call[], request: Request): Promise<Call> {
  const text = await request.clone().text()
  const call = { method: request.method, url: new URL(request.url), body: text ? JSON.parse(text) : null }
  calls.push(call)
  return call
}

/** 서버 ErrorResponse 본문(errors.code 에 도메인 오류 코드). */
const errorResponse = (status: number, code: string, message: string) =>
  HttpResponse.json({ status, error: '', message, errors: { code } }, { status })

/** 프라미스와 그 풀기 함수 — 응답을 붙들어 「요청은 나갔고 응답은 아직」 상태를 만든다. */
export function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => (release = r))
  return { p, release }
}

// ── 내 메모리(WP-55·379·380·383) ──

/** 메모리 항목 팩토리 — updatedAt 은 id 가 클수록 최근(정오 UTC — 어느 시간대에서도 같은 날짜). */
export const memoryItem = (id: number, over: Partial<AiMemoryItem> = {}): AiMemoryItem => ({
  id,
  kind: 'PREFERENCE',
  content: `메모리 ${id}`,
  source: 'AI',
  createdAt: '2026-10-10T00:00:00Z',
  updatedAt: `2026-10-${String(10 + (id % 18)).padStart(2, '0')}T12:00:00Z`,
  ...over,
})

/** id 내림차순 n 개(최신순). */
export const manyMemories = (n: number) => Array.from({ length: n }, (_, i) => memoryItem(n - i))

/**
 * 설정 카드용 상태 있는 목(e2e mockAiMemories 와 같은 규칙) — 목록은 배열 순서(맨 앞 = 최신). 추가·고치기는 맨 앞으로, 지우기는 지운 항목을 돌려준다.
 * failNext 는 다음 쓰기 1건을 거절하고, holdNextList 는 다음 목록 GET 1건을 붙든다.
 */
export function aiMemoriesApi(initial: AiMemoryItem[]) {
  let items = [...initial]
  let nextId = Math.max(100, ...initial.map((m) => m.id + 1))
  let failure: { status: number; code: string; message: string } | null = null
  let listHold: Promise<void> | null = null
  const calls: Call[] = []
  let lists = 0
  const takeFailure = () => {
    const f = failure
    failure = null
    return f ? errorResponse(f.status, f.code, f.message) : null
  }
  const of = (method: string, path: RegExp) => calls.filter((c) => c.method === method && path.test(c.url.pathname))
  const handlers = [
    http.get(`${API}/users/me/ai-memories`, async () => {
      lists++
      const hold = listHold
      listHold = null
      if (hold) await hold
      return HttpResponse.json({ items, limit: 300, pinLimit: 10 })
    }),
    http.post(`${API}/users/me/ai-memories`, async ({ request }) => {
      const body = (await record(calls, request)).body as { kind: AiMemoryItem['kind']; content: string; scope?: AiMemoryItem['scope']; expiresOn?: string }
      const fail = takeFailure()
      if (fail) return fail
      const created = memoryItem(nextId++, {
        kind: body.kind,
        content: body.content.trim(),
        source: 'USER',
        scope: body.scope ?? null,
        ...(body.expiresOn ? { expiresOn: body.expiresOn, expired: false } : {}),
        updatedAt: new Date().toISOString(),
      })
      items = [created, ...items]
      return HttpResponse.json(created, { status: 201 })
    }),
    http.delete(`${API}/users/me/ai-memories`, async ({ request }) => {
      await record(calls, request)
      items = []
      return new HttpResponse(null, { status: 204 })
    }),
    http.put(`${API}/users/me/ai-memories/:id/pin`, async ({ request, params }) => {
      const { pinned } = (await record(calls, request)).body as { pinned: boolean }
      const fail = takeFailure()
      if (fail) return fail
      const id = Number(params.id)
      const cur = items.find((m) => m.id === id)
      if (!cur) return errorResponse(404, 'AI_MEMORY_NOT_FOUND', '없음')
      const next = { ...cur, pinned }
      items = items.map((m) => (m.id === id ? next : m))
      return HttpResponse.json(next)
    }),
    http.patch(`${API}/users/me/ai-memories/:id`, async ({ request, params }) => {
      const body = (await record(calls, request)).body as { content?: string; scope?: AiMemoryItem['scope']; expiresOn?: string; clearExpiry?: boolean }
      const fail = takeFailure()
      if (fail) return fail
      const id = Number(params.id)
      const cur = items.find((m) => m.id === id)
      if (!cur) return errorResponse(404, 'AI_MEMORY_NOT_FOUND', '없음')
      const next = {
        ...cur,
        content: body.content?.trim() ?? cur.content,
        ...('scope' in body ? { scope: body.scope ?? null } : {}),
        ...(body.expiresOn ? { expiresOn: body.expiresOn, expired: false } : {}),
        ...(body.clearExpiry ? { expiresOn: null, expired: false } : {}),
        updatedAt: new Date().toISOString(),
      }
      items = [next, ...items.filter((m) => m.id !== id)]
      return HttpResponse.json({ ...next, previousContent: cur.content, previousKind: cur.kind })
    }),
    http.delete(`${API}/users/me/ai-memories/:id`, async ({ request, params }) => {
      await record(calls, request)
      const fail = takeFailure()
      if (fail) return fail
      const id = Number(params.id)
      const cur = items.find((m) => m.id === id)
      items = items.filter((m) => m.id !== id)
      return cur ? HttpResponse.json(cur) : errorResponse(404, 'AI_MEMORY_NOT_FOUND', '없음')
    }),
  ]
  return {
    handlers,
    calls,
    /** 목록 GET 횟수. */
    lists: () => lists,
    creates: () => of('POST', /\/ai-memories$/),
    updates: () => of('PATCH', /\/ai-memories\/\d+$/),
    deletes: () => of('DELETE', /\/ai-memories\/\d+$/),
    clears: () => of('DELETE', /\/ai-memories$/),
    pins: () => of('PUT', /\/pin$/),
    failNext: (status: number, code: string, message: string) => void (failure = { status, code, message }),
    holdNextList: (until: Promise<void>) => void (listHold = until),
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

/** 되돌린 시각 — 화면 「되돌림 · 오후 12:00」(KST). */
export const UNDONE_AT = '2026-10-15T03:00:00Z'

/**
 * 「AI가 정리한 기록」 목(e2e mockMemoryChanges 와 같은 규칙) — pages[i] 를 cursor "c<i>" 로 잇는다. 되돌리면 그 항목에 UNDONE_AT 을 붙여 돌려준다.
 * failList 를 주면 그 판정이 참인 목록 GET 을 500 으로 돌려준다(hold 로 붙들 수 있다).
 */
export function memoryChangesApi(pages: AiMemoryChange[][], count30d = pages.flat().length) {
  const state = pages.map((p) => [...p])
  let refusal: { status: number; code: string } | null = null
  let failList: { when: (url: URL) => boolean; hold?: Promise<void> } | null = null
  const lists: URL[] = []
  const undos: URL[] = []
  const markUndone = (id: number) => {
    for (const p of state) {
      const i = p.findIndex((c) => c.id === id)
      if (i < 0) continue
      p[i] = { ...p[i], undoneAt: UNDONE_AT }
      return p[i]
    }
    return undefined
  }
  const handlers = [
    http.get(`${API}/users/me/ai-memories/changes`, async ({ request }) => {
      const url = new URL(request.url)
      lists.push(url)
      if (failList?.when(url)) {
        if (failList.hold) await failList.hold
        return HttpResponse.json({ code: 'INTERNAL', message: '오류' }, { status: 500 })
      }
      const cursor = url.searchParams.get('cursor')
      const i = cursor ? Number(cursor.slice(1)) : 0
      return HttpResponse.json({ items: state[i] ?? [], nextCursor: i + 1 < state.length ? `c${i + 1}` : null, count30d })
    }),
    http.post(`${API}/users/me/ai-memories/changes/:id/undo`, ({ request, params }) => {
      undos.push(new URL(request.url))
      if (refusal) {
        const r = refusal
        refusal = null
        return errorResponse(r.status, r.code, '오류')
      }
      const undone = markUndone(Number(params.id))
      return undone ? HttpResponse.json({ change: undone }) : errorResponse(404, 'AI_MEMORY_NOT_FOUND', '없음')
    }),
  ]
  return {
    handlers,
    lists,
    undos,
    refuseNext: (status: number, code: string) => void (refusal = { status, code }),
    markUndone: (id: number) => void markUndone(id),
    failListWhen: (when: ((url: URL) => boolean) | null, hold?: Promise<void>) => void (failList = when ? { when, hold } : null),
  }
}

/**
 * 사용자 AI 설정 목(e2e mockAiPreferences 와 같은 규칙) — PUT 은 보낸 필드만 바꾸고 두 값을 돌려준다.
 * holdFirstPut 을 주면 첫 PUT 의 응답을 도착 시점 값으로 찍어 둔 채 그 프라미스가 풀릴 때까지 붙든다.
 */
export function aiPreferencesApi(suggestionsEnabled = true, opts: { holdFirstPut?: Promise<void> } = {}) {
  let current: AiPreferences = { suggestionsEnabled, memoryEnabled: true }
  const puts: unknown[] = []
  const handlers = [
    http.get(`${API}/users/me/ai-preferences`, () => HttpResponse.json(current)),
    http.put(`${API}/users/me/ai-preferences`, async ({ request }) => {
      const body = (await request.json()) as Partial<AiPreferences>
      puts.push(body)
      current = { ...current, ...body }
      const snapshot = current
      if (puts.length === 1 && opts.holdFirstPut) await opts.holdFirstPut
      return HttpResponse.json(snapshot)
    }),
  ]
  return { handlers, puts }
}

// ── 공용 메모리(WP-386) ──

/** 공간 팩토리 — 기본은 WP 프로젝트(id 12), 추가만 되는 구성원. */
export const sharedSpace = (over: Partial<SharedMemorySpace> = {}): SharedMemorySpace => ({
  type: 'PROJECT', id: 12, key: 'WP', name: 'Smart Workplace', label: 'Smart Workplace(WP)', count: 0, limit: 50, canAdd: true, canManage: false, ...over,
})

/** 공용 메모리 팩토리 — updatedAt 은 id 가 클수록 최근. */
export const sharedItem = (id: number, over: Partial<SharedAiMemoryItem> = {}): SharedAiMemoryItem => ({
  id,
  content: `공용 메모리 ${id}`,
  origin: 'AI_EXTRACTED',
  createdAt: '2026-10-10T12:00:00Z',
  updatedAt: `2026-10-${String(10 + (id % 18)).padStart(2, '0')}T12:00:00Z`,
  canEdit: false,
  ...over,
})

/** 기록 팩토리. */
export const sharedChange = (id: number, over: Partial<SharedAiMemoryChange> = {}): SharedAiMemoryChange => ({
  id, action: 'ADDED', actor: { kind: 'AI' }, createdAt: '2026-10-15T02:00:00Z',
  memory: { id: 100 + id, content: `기록 ${id}`, origin: 'AI_EXTRACTED' }, before: [], undoneAt: null, undoable: true, ...over,
})

const paramOf = (s: Pick<SharedMemorySpace, 'type' | 'id'>) => (s.type === 'ORG' ? 'ORG' : `${s.type}:${s.id}`)
const paramOfUrl = (u: URL) => {
  const t = u.searchParams.get('spaceType')
  return t === 'ORG' ? 'ORG' : `${t}:${u.searchParams.get('spaceId')}`
}

/** 공용 메모리 상태 목(e2e mockSharedMemory 와 같은 규칙) — 직접 추가는 USER_ADDED + 내 이름 + canEdit. */
export function sharedMemoryApi(opts: {
  spaces: SharedMemorySpace[]
  items?: Record<string, SharedAiMemoryItem[]>
  changes?: Record<string, SharedAiMemoryChange[]>
  me?: string
}) {
  const items: Record<string, SharedAiMemoryItem[]> = Object.fromEntries(opts.spaces.map((s) => [paramOf(s), [...(opts.items?.[paramOf(s)] ?? [])]]))
  const changes: Record<string, SharedAiMemoryChange[]> = { ...(opts.changes ?? {}) }
  const ownerOf = new Map<number, string>()
  for (const [p, list] of Object.entries(items)) for (const m of list) ownerOf.set(m.id, p)
  let nextId = 1000
  let failure: { status: number; code: string; message: string } | null = null
  let failChangeList: Promise<void> | null | 'off' = 'off'
  const calls: Call[] = []
  const takeFailure = () => {
    const f = failure
    failure = null
    return f ? errorResponse(f.status, f.code, f.message) : null
  }
  const of = (method: string, path: RegExp) => calls.filter((c) => c.method === method && path.test(c.url.pathname))
  const handlers = [
    http.get(`${API}/shared-ai-memories/spaces`, () =>
      HttpResponse.json({ items: opts.spaces.map((s) => ({ ...s, count: items[paramOf(s)]?.length ?? 0 })) }),
    ),
    http.get(`${API}/shared-ai-memories/changes`, async ({ request }) => {
      const url = (await record(calls, request)).url
      if (failChangeList !== 'off') {
        if (failChangeList) await failChangeList
        return HttpResponse.json({ code: 'INTERNAL', message: '오류' }, { status: 500 })
      }
      const all = changes[paramOfUrl(url)] ?? []
      const from = Number(url.searchParams.get('cursor') ?? 0)
      return HttpResponse.json({ items: all.slice(from, from + 30), nextCursor: from + 30 < all.length ? String(from + 30) : null })
    }),
    http.post(`${API}/shared-ai-memories/changes/:id/undo`, async ({ request, params }) => {
      await record(calls, request)
      const fail = takeFailure()
      if (fail) return fail
      for (const list of Object.values(changes)) {
        const c = list.find((x) => x.id === Number(params.id))
        if (c) {
          c.undoneAt = '2026-10-15T03:00:00Z'
          return HttpResponse.json({ change: c })
        }
      }
      return errorResponse(404, 'SHARED_MEMORY_NOT_FOUND', '없음')
    }),
    http.get(`${API}/shared-ai-memories`, async ({ request }) => {
      const url = (await record(calls, request)).url
      const all = items[paramOfUrl(url)] ?? []
      const space = opts.spaces.find((s) => paramOf(s) === paramOfUrl(url))
      const q = url.searchParams.get('q')
      if (q) return HttpResponse.json({ items: all.filter((m) => m.content.includes(q)), nextCursor: null, count: all.length, limit: space?.limit ?? 50 })
      const from = Number(url.searchParams.get('cursor') ?? 0)
      const size = Number(url.searchParams.get('size') ?? 30)
      return HttpResponse.json({
        items: all.slice(from, from + size),
        nextCursor: from + size < all.length ? String(from + size) : null,
        count: all.length,
        limit: space?.limit ?? 50,
      })
    }),
    http.post(`${API}/shared-ai-memories`, async ({ request }) => {
      const body = (await record(calls, request)).body as { spaceType: string; spaceId: number | null; content: string }
      const fail = takeFailure()
      if (fail) return fail
      const p = body.spaceType === 'ORG' ? 'ORG' : `${body.spaceType}:${body.spaceId}`
      const now = new Date().toISOString()
      const created = sharedItem(nextId++, { content: body.content.trim(), origin: 'USER_ADDED', author: { name: opts.me ?? '양동희' }, canEdit: true, createdAt: now, updatedAt: now })
      items[p] = [created, ...(items[p] ?? [])]
      ownerOf.set(created.id, p)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch(`${API}/shared-ai-memories/:id`, async ({ request, params }) => {
      const body = (await record(calls, request)).body as { content: string }
      const fail = takeFailure()
      if (fail) return fail
      const id = Number(params.id)
      const p = ownerOf.get(id)!
      const cur = items[p].find((m) => m.id === id)!
      const next = { ...cur, content: body.content.trim(), updatedAt: new Date().toISOString() }
      items[p] = [next, ...items[p].filter((m) => m.id !== id)]
      return HttpResponse.json(next)
    }),
    http.delete(`${API}/shared-ai-memories/:id`, async ({ request, params }) => {
      await record(calls, request)
      const fail = takeFailure()
      if (fail) return fail
      const id = Number(params.id)
      const p = ownerOf.get(id)!
      items[p] = items[p].filter((m) => m.id !== id)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return {
    handlers,
    calls,
    lists: () => of('GET', /\/shared-ai-memories$/),
    creates: () => of('POST', /\/shared-ai-memories$/),
    updates: () => of('PATCH', /\/shared-ai-memories\/\d+$/),
    deletes: () => of('DELETE', /\/shared-ai-memories\/\d+$/),
    changeLists: () => of('GET', /\/shared-ai-memories\/changes$/),
    undos: () => of('POST', /\/undo$/),
    failNext: (status: number, code: string, message = '오류') => void (failure = { status, code, message }),
    /** 기록 목록 GET 을 500 으로 돌려준다(hold 를 주면 그동안 붙든다). null 이면 정상으로 돌아온다. */
    failChangeLists: (hold: Promise<void> | null | 'off') => void (failChangeList = hold),
  }
}
