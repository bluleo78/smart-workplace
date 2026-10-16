// WP-386 공용 메모리 E2E 목 — 공간 목록(개수는 항목 수로 계산)·공간별 목록(검색은 한 묶음, 아니면 30개씩 커서)·직접 추가·고치기·지우기·기록·되돌리기.
// 서버 규칙 중 화면이 기대는 것만 흉내 낸다(직접 추가는 USER_ADDED + 내 이름 + canEdit, 고치기는 origin 유지).
import { expect, type Page } from '@playwright/test'

import type { SharedAiMemoryChange, SharedAiMemoryItem, SharedMemorySpace } from '../../src/types/sharedAiMemory'
import { mockMyAssistantStatus } from './my-assistant-mock'
import { type RequestTracker, trackRequests } from './requests'

const errorBody = (status: number, code: string, message: string) => ({ status, error: '', message, errors: { code } })
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** 공간 팩토리 — 기본은 WP 프로젝트(id 12), 추가만 되는 구성원. */
export const sharedSpace = (over: Partial<SharedMemorySpace> = {}): SharedMemorySpace => ({
  type: 'PROJECT', id: 12, key: 'WP', name: 'Smart Workplace', label: 'Smart Workplace(WP)', count: 0, limit: 50, canAdd: true, canManage: false, ...over,
})

/** 공용 메모리 팩토리 — updatedAt 은 id 가 클수록 최근(정오 UTC — 어느 시간대에서도 같은 날짜). */
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

export interface SharedMemoryMock {
  lists: RequestTracker
  creates: RequestTracker
  updates: RequestTracker
  deletes: RequestTracker
  changeLists: RequestTracker
  undos: RequestTracker
  /** 다음 쓰기(POST·PATCH·DELETE·되돌리기) 1건을 이 오류로 거절한다. */
  failNext: (status: number, code: string, message?: string) => void
}

export async function mockSharedMemory(
  page: Page,
  opts: { spaces: SharedMemorySpace[]; items?: Record<string, SharedAiMemoryItem[]>; changes?: Record<string, SharedAiMemoryChange[]>; me?: string },
): Promise<SharedMemoryMock> {
  const items: Record<string, SharedAiMemoryItem[]> = Object.fromEntries(opts.spaces.map((s) => [paramOf(s), [...(opts.items?.[paramOf(s)] ?? [])]]))
  const changes: Record<string, SharedAiMemoryChange[]> = { ...(opts.changes ?? {}) }
  const ownerOf = new Map<number, string>()
  let nextId = 1000
  let failure: { status: number; code: string; message: string } | null = null
  const lists = trackRequests(page, 'GET', '/api/v1/shared-ai-memories')
  const creates = trackRequests(page, 'POST', '/api/v1/shared-ai-memories')
  const updates = trackRequests(page, 'PATCH', /^\/api\/v1\/shared-ai-memories\/\d+$/)
  const deletes = trackRequests(page, 'DELETE', /^\/api\/v1\/shared-ai-memories\/\d+$/)
  const changeLists = trackRequests(page, 'GET', '/api/v1/shared-ai-memories/changes')
  const undos = trackRequests(page, 'POST', /^\/api\/v1\/shared-ai-memories\/changes\/\d+\/undo$/)
  const takeFailure = () => {
    const f = failure
    failure = null
    return f ? json(f.status, errorBody(f.status, f.code, f.message)) : null
  }
  for (const [p, list] of Object.entries(items)) for (const m of list) ownerOf.set(m.id, p)

  await page.route((u) => u.pathname.startsWith('/api/v1/shared-ai-memories'), async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    const method = req.method()
    if (path === '/api/v1/shared-ai-memories/spaces') {
      return route.fulfill(json(200, { items: opts.spaces.map((s) => ({ ...s, count: items[paramOf(s)]?.length ?? 0 })) }))
    }
    if (path === '/api/v1/shared-ai-memories/changes' && method === 'GET') {
      const all = changes[paramOfUrl(url)] ?? []
      const from = Number(url.searchParams.get('cursor') ?? 0)
      const page30 = all.slice(from, from + 30)
      return route.fulfill(json(200, { items: page30, nextCursor: from + 30 < all.length ? String(from + 30) : null }))
    }
    const undo = /\/changes\/(\d+)\/undo$/.exec(path)
    if (undo) {
      const fail = takeFailure()
      if (fail) return route.fulfill(fail)
      const id = Number(undo[1])
      for (const list of Object.values(changes)) {
        const c = list.find((x) => x.id === id)
        if (c) {
          c.undoneAt = '2026-10-15T03:00:00Z'
          return route.fulfill(json(200, { change: c }))
        }
      }
      return route.fulfill(json(404, errorBody(404, 'SHARED_MEMORY_NOT_FOUND', '기록을 찾을 수 없어요')))
    }
    if (path === '/api/v1/shared-ai-memories' && method === 'GET') {
      const all = items[paramOfUrl(url)] ?? []
      const space = opts.spaces.find((s) => paramOf(s) === paramOfUrl(url))
      const q = url.searchParams.get('q')
      if (q) return route.fulfill(json(200, { items: all.filter((m) => m.content.includes(q)), nextCursor: null, count: all.length, limit: space?.limit ?? 50 }))
      const from = Number(url.searchParams.get('cursor') ?? 0)
      const size = Number(url.searchParams.get('size') ?? 30)
      return route.fulfill(json(200, {
        items: all.slice(from, from + size),
        nextCursor: from + size < all.length ? String(from + size) : null,
        count: all.length,
        limit: space?.limit ?? 50,
      }))
    }
    const fail = takeFailure()
    if (fail) return route.fulfill(fail)
    if (path === '/api/v1/shared-ai-memories' && method === 'POST') {
      const body = req.postDataJSON() as { spaceType: string; spaceId: number | null; content: string }
      const p = body.spaceType === 'ORG' ? 'ORG' : `${body.spaceType}:${body.spaceId}`
      const now = new Date().toISOString()
      const created = sharedItem(nextId++, { content: body.content.trim(), origin: 'USER_ADDED', author: { name: opts.me ?? '양동희' }, canEdit: true, createdAt: now, updatedAt: now })
      items[p] = [created, ...(items[p] ?? [])]
      ownerOf.set(created.id, p)
      return route.fulfill(json(201, created))
    }
    const id = Number(path.split('/').pop())
    const p = ownerOf.get(id)
    const cur = p ? items[p].find((m) => m.id === id) : undefined
    if (!p || !cur) return route.fulfill(json(404, errorBody(404, 'SHARED_MEMORY_NOT_FOUND', '공용 메모리를 찾을 수 없어요')))
    if (method === 'PATCH') {
      const next = { ...cur, content: (req.postDataJSON() as { content: string }).content.trim(), updatedAt: new Date().toISOString() }
      items[p] = [next, ...items[p].filter((m) => m.id !== id)]
      return route.fulfill(json(200, next))
    }
    if (method === 'DELETE') {
      items[p] = items[p].filter((m) => m.id !== id)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })
  return { lists, creates, updates, deletes, changeLists, undos, failNext: (status, code, message = '오류') => void (failure = { status, code, message }) }
}

/** 개인 비서 없음 + 설정 › AI 비서 › 메모리 「공용 메모리」 탭 진입(공간을 주면 그 공간). */
export async function openSharedMemory(page: Page, space?: string) {
  await mockMyAssistantStatus(page, () => ({ configured: false, provider: null, model: null, suggestionModelAuto: null }))
  const q = new URLSearchParams({ memoryTab: 'shared', ...(space ? { space } : {}) })
  await page.goto(`/settings/assistant?${q.toString()}`)
  await expect(page.getByTestId('shared-memory-tab')).toBeVisible()
}
