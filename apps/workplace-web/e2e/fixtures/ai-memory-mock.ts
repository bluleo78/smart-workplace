// WP-55 AI 메모리 E2E 모킹 — 채팅 결과 줄 되돌리기(POST /users/me/ai-memories/undo)와 설정 카드의 상태 있는 목록 목.
import type { Page } from '@playwright/test'

import type { AiMemoryItem, UndoAiMemoryRequest } from '../../src/types/aiMemory'
import { type RequestTracker, trackRequests } from './requests'

/** 되돌리기 응답을 순서대로 소비 — 비면 받은 값으로 성공({...body, undone:true}). */
export async function mockMemoryUndo(page: Page, replies: Array<{ status: number; body: unknown }> = []): Promise<RequestTracker> {
  const calls = trackRequests(page, 'POST', '/api/v1/users/me/ai-memories/undo')
  let i = 0
  await page.route((u) => u.pathname === '/api/v1/users/me/ai-memories/undo', (route) => {
    const r = replies[i++] ?? { status: 200, body: { ...(route.request().postDataJSON() as UndoAiMemoryRequest), undone: true } }
    return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) })
  })
  return calls
}

/** 서버 오류 응답(ErrorResponse + errors.code). */
export const memoryError = (status: number, code: string, message = '오류') => ({
  status,
  body: { status, error: '', message, errors: { code } },
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
  /** 다음 쓰기 요청 1건을 이 오류로 거절한다. */
  failNext: (status: number, code: string, message: string) => void
  /** 다음 목록 GET 1건의 응답을 이 프라미스가 풀릴 때까지 붙잡는다("쓰기는 끝났고 목록은 아직" 상태를 결정적으로 만든다). */
  holdNextList: (until: Promise<void>) => void
}

/**
 * 설정 카드용 상태 있는 목 — 목록은 배열 순서(맨 앞 = 최신)로 돌려준다. 추가·고치기는 맨 앞으로, 지우기는 지운 항목을 돌려준다.
 * 서버 규칙 중 화면이 기대는 것만 흉내 낸다(직접 추가는 USER, 고치기 응답의 previousContent·previousKind).
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
  const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route((u) => /^\/api\/v1\/users\/me\/ai-memories(\/\d+)?$/.test(u.pathname), async (route) => {
    const req = route.request()
    const method = req.method()
    const id = Number(new URL(req.url()).pathname.split('/')[6] ?? NaN)
    if (method !== 'GET' && failure) {
      const f = failure
      failure = null
      return route.fulfill(json(f.status, { status: f.status, error: '', message: f.message, errors: { code: f.code } }))
    }
    if (method === 'GET') {
      const hold = listHold
      listHold = null
      if (hold) await hold
      return route.fulfill(json(200, { items, limit: 50 }))
    }
    if (method === 'POST') {
      const body = req.postDataJSON() as { kind: AiMemoryItem['kind']; content: string }
      const created = memoryItem(nextId++, { kind: body.kind, content: body.content.trim(), source: 'USER', updatedAt: new Date().toISOString() })
      items = [created, ...items]
      return route.fulfill(json(201, created))
    }
    if (method === 'PATCH') {
      const cur = items.find((m) => m.id === id)
      if (!cur) return route.fulfill(json(404, { status: 404, message: '메모리를 찾을 수 없어요', errors: { code: 'AI_MEMORY_NOT_FOUND' } }))
      const body = req.postDataJSON() as { content?: string }
      const next = { ...cur, content: body.content?.trim() ?? cur.content, updatedAt: new Date().toISOString() }
      items = [next, ...items.filter((m) => m.id !== id)]
      return route.fulfill(json(200, { ...next, previousContent: cur.content, previousKind: cur.kind }))
    }
    if (method === 'DELETE' && Number.isNaN(id)) {
      items = []
      return route.fulfill({ status: 204, body: '' })
    }
    if (method === 'DELETE') {
      const cur = items.find((m) => m.id === id)
      items = items.filter((m) => m.id !== id)
      return cur ? route.fulfill(json(200, cur)) : route.fulfill(json(404, { status: 404, message: '없음', errors: { code: 'AI_MEMORY_NOT_FOUND' } }))
    }
    return route.fallback()
  })
  return {
    items: () => items,
    creates,
    updates,
    deletes,
    clears,
    failNext: (status, code, message) => void (failure = { status, code, message }),
    holdNextList: (until) => void (listHold = until),
  }
}
