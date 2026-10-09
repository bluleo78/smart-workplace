// 노트 스페이스 0개 → 생성 흐름 모킹(WP-143) — 데스크톱·모바일 빈 상태 spec 이 공유한다.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiRole, WikiSpace } from '../../src/types/wiki'
import { wikiSpace } from '../factories/wiki.factory'
import { type CollabRole, collabNsOf, readCollabMarkdown, seedCollabDoc } from './collab'
import { trackRequests } from './requests'

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

/**
 * 저장된 본문(마크다운) — 본문은 자동저장 PUT 이 아니라 실시간 동기화로 저장되므로(WP-172) 동기화 서버(테스트 모드)의
 * page 네임스페이스 문서를 읽는다. 저장은 입력마다 바로 반영되니 `expect.poll(() => savedMarkdown(page, id))` 로 기다린다.
 */
export const savedMarkdown = (page: Page, pageId: number) => readCollabMarkdown(collabNsOf(page), pageId)

/**
 * 노트 에디터 진입에 필요한 스페이스·트리·멤버·페이지 상세(GET/PUT) 라우트를 모킹한다
 * (wiki-image·wiki-table·wiki-table-editing·wiki-markdown-paste spec 공유). 페이지 PUT 기록(tracker)을 돌려준다 — 제목 저장 확인용.
 * 본문은 동기화 서버(테스트 모드)에도 같은 내용·역할로 시드한다 — 에디터 본문은 이제 API 가 아니라 동기화 문서에서 온다(WP-172).
 * collabNs 생략 시 page 컨텍스트의 네임스페이스(auth.fixture). 같은 문서에 두 번째로 붙는 컨텍스트는 seed:false
 * (다시 시드하면 서버가 열린 문서를 닫아 먼저 붙은 쪽이 끊긴다). 본문 저장 결과는 savedMarkdown 으로 읽는다.
 */
export async function mockWikiPageEditor(
  page: Page,
  {
    spaceId, pageId, title, body, role = 'OWNER', collabNs, seed = true, collabRoles,
  }: {
    spaceId: number
    pageId: number
    title: string
    body: string
    role?: WikiRole
    collabNs?: string
    seed?: boolean
    /** 동기화 서버의 userId → 역할(같은 문서에 편집자·뷰어를 함께 둘 때, WP-173) — seedCollabDoc 의 roles. */
    collabRoles?: Record<string, CollabRole>
  },
) {
  if (seed) await seedCollabDoc(collabNs ?? collabNsOf(page), pageId, body, role, collabRoles)
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

/** 클립보드에 이미지 파일을 담아 .ProseMirror 에 paste 이벤트를 디스패치한다(handlePaste 진입점) — 노트 이미지 업로드 spec 공용. */
export async function pasteImageFile(page: Page, mimeType: string, name: string) {
  await page.locator('.ProseMirror').evaluate(
    (el, args) => {
      const file = new File([new Uint8Array([1, 2, 3])], args.name, { type: args.mimeType })
      const dt = new DataTransfer()
      dt.items.add(file)
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    },
    { mimeType, name },
  )
}

/**
 * 노트가 첫 스페이스가 아닌 팀 스페이스에 있게 한다 — 스페이스 목록을 [개인(1), 팀(spaceId)] 순으로 바꾼다(mockWikiPageEditor 뒤에 부른다,
 * 나중에 등록한 라우트가 이긴다). "노트 목록으로"가 /wiki(첫 스페이스로 리다이렉트)가 아니라 노트의 스페이스로 가는지 가르는 데 쓴다.
 * 개인 스페이스의 트리·멤버도 빈 목록으로 막아 둔다 — 잘못 그쪽으로 가도 모킹 안 된 요청이 나가지 않게.
 */
export async function mockNoteInTeamSpace(page: Page, { spaceId, name, role = 'OWNER' }: { spaceId: number; name: string; role?: WikiRole }) {
  const spaces = [
    { id: 1, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' },
    { id: spaceId, type: 'TEAM', name, ownerId: 1, role, createdAt: '2026-06-01T00:00:00Z' },
  ]
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(spaces) }) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/1/pages' || u.pathname === '/api/v1/wiki/spaces/1/members', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.fallback())
}
