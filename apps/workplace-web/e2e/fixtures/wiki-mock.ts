// 노트 스페이스 0개 → 생성 흐름 모킹(WP-143) — 데스크톱·모바일 빈 상태 spec 이 공유한다.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiRole, WikiSpace } from '../../src/types/wiki'
import { wikiSpace } from '../factories/wiki.factory'
import { type RequestTracker, trackRequests } from './requests'

/**
 * 스페이스 목록은 POST 전엔 비어 있고, POST 후엔 새로 만든 스페이스 1개(id=newSpaceId)를 돌려준다.
 * 스페이스별 페이지 트리는 항상 빈 목록. POST 기록(tracker)을 돌려준다 — payload 는 `lastBody()` 로 확인.
 */
export async function mockWikiNoSpaces(page: Page, newSpaceId: number) {
  const posts = trackRequests(page, 'POST', '/api/v1/wiki/spaces')
  let created: WikiSpace | null = null
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => {
    if (r.request().method() === 'POST') {
      created = wikiSpace({ id: newSpaceId, name: (r.request().postDataJSON() as { name: string }).name, role: 'OWNER' })
      return r.fulfill({ json: created })
    }
    return r.fulfill({ json: created ? [created] : [] })
  })
  await page.route((u) => /^\/api\/v1\/wiki\/spaces\/\d+\/pages$/.test(u.pathname), (r) => r.fulfill({ json: [] }))
  return posts
}

/**
 * 델타 배열 → wiki.ai.* SSE 본문(correlationId 포함, delta N개 + done). done=false 면 생성 중인 채로 끝낸다
 * (wiki-ai·wiki-remote-sync spec 공유).
 */
export function buildWikiAiSse(deltas: string[], correlationId: string, done = true): string {
  const parts = deltas.map(
    (text) => `event: wiki.ai.delta\ndata: ${JSON.stringify({ correlationId, text })}\n\n`,
  )
  if (done) parts.push(`event: wiki.ai.done\ndata: ${JSON.stringify({ correlationId })}\n\n`)
  return parts.join('')
}

/** 마지막 PUT 저장 본문(마크다운). */
export const lastSaved = (puts: RequestTracker) => puts.lastBody<{ body: string }>()?.body ?? ''

/**
 * 노트 에디터 진입에 필요한 스페이스·트리·멤버·페이지 상세(GET/PUT) 라우트를 모킹한다
 * (wiki-image·wiki-table·wiki-table-editing·wiki-markdown-paste spec 공유). 페이지 PUT 기록(tracker)을 돌려준다.
 */
export async function mockWikiPageEditor(
  page: Page,
  { spaceId, pageId, title, body, role = 'OWNER' }: { spaceId: number; pageId: number; title: string; body: string; role?: WikiRole },
) {
  const puts = trackRequests(page, 'PUT', `/api/v1/wiki/pages/${pageId}`)
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: spaceId, type: 'PERSONAL', name: '내 노트', ownerId: 1, role, createdAt: '2026-06-01T00:00:00Z' }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${spaceId}/pages`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: pageId, parentId: null, title, position: 0, aiLastUsedAt: null }]) })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${spaceId}/members`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${pageId}`, (r) => {
    const d: WikiPageDetail = { id: pageId, spaceId, parentId: null, title, body, version: 1, updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: null, aiLastAction: null }
    const m = r.request().method()
    if (m === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) })
    if (m === 'PUT') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...d, version: 2 }) })
    return r.fallback()
  })
  return puts
}
