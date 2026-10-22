// 노트 스페이스 0개 → 생성 흐름 모킹(WP-143) — 데스크톱·모바일 빈 상태 spec 이 공유한다.
import { expect, type Page } from '@playwright/test'

import type {
  WikiMentionRef,
  WikiPageDetail,
  WikiRevisionDetail,
  WikiRevisionItem,
  WikiRevisionList,
  WikiRole,
  WikiSpace,
} from '../../src/types/wiki'
import { wikiPageDetail, wikiSpace } from '../factories/wiki.factory'
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

/**
 * 노트 에디터 화면을 열고(또는 새로고침하고) 본문을 조작할 수 있을 때까지 단계별로 기다린다.
 * 「주소 이동 → 본문 표시」를 단언 하나(10초)로 기다리면 앱 부팅·노트 화면 코드 로드(dev 서버 변환 — 부하 때 가장 오래 걸린다)와
 * 첫 동기화가 한 창을 나눠 써서, 전체 스위트 부하에서만 본문이 늦게 떠 깨졌다. 각 단계를 그 단계가 끝났다는 신호로 기다린다.
 * 1) 페이지 상세 GET 응답 — 노트 화면 코드가 올라와 상세를 불렀다(이 대기는 단언 창이 아니라 따로 둔 20초 마감으로 기다리고,
 *    넘기면 기다린 요청을 이름으로 밝히며 실패한다).
 * 2) 본문(.ProseMirror) 표시 — 동기화 서버와 첫 동기화를 마쳤다(그 전엔 본문 자리에 skeleton).
 * 3) 편집 가능 여부 확정 — 에디터는 첫 동기화 전(편집 불가)에 만들어지고 편집 가능 전환은 렌더 뒤 effect 가 하므로, 보이자마자
 *    붙여넣기·우클릭하면 편집 불가 뷰가 이벤트를 버릴 수 있다. 편집자는 contenteditable="true", 보기 전용은 동기화 칩 readonly 까지.
 */
export async function openWikiEditor(
  page: Page,
  { spaceId, pageId, readOnly = false, reload = false }: { spaceId: number; pageId: number; readOnly?: boolean; reload?: boolean },
) {
  const detailPath = `/api/v1/wiki/pages/${pageId}`
  // 응답 대기와 이동을 한 Promise.all 로 묶는다 — 대기를 이동 전에 등록하면서도, 이동이 실패하면 매달린 대기 없이 그 실패가 바로 올라온다.
  // 마감은 액션 제한(15초)보다 길고 테스트 제한(30초)보다 짧게 따로 둔다 — 부하 때 dev 서버의 노트 화면 코드 변환이 오래 걸리는 것 자체는
  // 결함이 아니지만, 끝없이 기다리지 않고 어느 요청을 기다리다 멈췄는지 드러나게 실패한다.
  const timeout = 20_000
  await Promise.all([
    page
      .waitForResponse(
        (r) => new URL(r.url()).pathname === detailPath && r.request().method() === 'GET',
        { timeout },
      )
      .catch((cause: unknown) => {
        throw new Error(`openWikiEditor: 노트 페이지 상세 GET ${detailPath} 응답을 ${timeout}ms 안에 받지 못했습니다`, { cause })
      }),
    reload ? page.reload() : page.goto(`/wiki/spaces/${spaceId}/pages/${pageId}`),
  ])
  if (readOnly) {
    // 보기 전용은 편집 불가(contenteditable="false")까지 확인한다 — 읽기 전용 상태 자체를 단언으로 남긴다.
    await expect(page.locator('.ProseMirror[contenteditable="false"]')).toBeVisible()
    await expect(page.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'readonly')
  } else {
    // 편집자는 contenteditable="true" 인 에디터가 보일 때까지 한 번에 기다린다(보임 → 편집 가능 두 단계를 따로 두지 않는다).
    await expect(page.locator('.ProseMirror[contenteditable="true"]')).toBeVisible()
  }
}

/**
 * 같은 노트를 여러 피어(탭·컨텍스트)로 동시에 연다 — 하나씩 열면 첫 피어의 상세 GET 대기(최대 20초)가 테스트 제한(30초)을 나눠 먹는다.
 * 보기 전용 피어는 { page, readOnly: true } 로 넘긴다. 접속 칩 live 같은 그 테스트만의 기대는 호출한 쪽이 이어서 건다.
 */
export async function openWikiEditors(spaceId: number, pageId: number, peers: Array<Page | { page: Page; readOnly?: boolean }>) {
  await Promise.all(peers.map((p) => openWikiEditor('page' in p ? p.page : p, { spaceId, pageId, readOnly: 'page' in p && p.readOnly })))
}

/** 한 spec 이 늘 같은 노트를 여는 경우를 위해 스페이스·페이지를 고정한 openWikiEditor 를 만든다. */
export function wikiEditorOpener(spaceId: number, pageId: number) {
  return (page: Page, opts: Omit<Parameters<typeof openWikiEditor>[1], 'spaceId' | 'pageId'> = {}) =>
    openWikiEditor(page, { spaceId, pageId, ...opts })
}

/** 노트 멘션 칩 라벨 해소(GET /pages/{id}/mentions) 응답을 고정한다. */
export async function mockWikiMentions(page: Page, pageId: number, list: WikiMentionRef[]) {
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${pageId}/mentions`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: list }) : r.fallback())
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

/**
 * 노트 버전 기록 API 모킹(WP-282) — 목록·판 본문·복원. 목록은 상태가 있다: 복원하면 "복원 직전" 판을 맨 위에 더해
 * (서버가 복원 전에 지금 본문을 스냅샷으로 남기는 것과 같게) 다음 목록 조회에 보인다.
 * onRestore 는 복원 POST 를 받을 때 부른다 — 실서버처럼 동기화 서버에 복원 본문을 적용하는 데 쓴다(applyCollabMarkdown).
 * 복원 POST 기록(restores)과, 목록을 바꿔 서버 쪽 새 판을 흉내 내는 setList 를 돌려준다.
 */
export async function mockWikiRevisions(
  page: Page,
  {
    pageId,
    list,
    details,
    status,
    onRestore,
  }: {
    pageId: number
    list: WikiRevisionList
    /** version → 본문. 목록 항목의 메타와 합쳐 상세로 돌려준다. */
    details: Record<number, string>
    /** 복원 응답 상태(기본 200) — 403 등 실패를 흉내 낸다. */
    status?: number
    onRestore?: (version: number, body: string) => Promise<void>
  },
) {
  let current = list
  const restores = trackRequests(page, 'POST', new RegExp(`/api/v1/wiki/pages/${pageId}/revisions/\\d+/restore$`))
  await page.route(
    (u) => new RegExp(`^/api/v1/wiki/pages/${pageId}/revisions(/\\d+(/restore)?)?$`).test(u.pathname),
    async (r) => {
      const m = new URL(r.request().url()).pathname.match(/\/revisions(?:\/(\d+))?(\/restore)?$/)!
      const version = m[1] ? Number(m[1]) : null
      const method = r.request().method()
      if (version == null && method === 'GET') return r.fulfill({ json: current })
      const item = current.items.find((i) => i.version === version)
      if (version != null && !m[2] && method === 'GET') {
        if (!item) return r.fulfill({ status: 404, json: { message: '버전을 찾을 수 없습니다' } })
        const detail: WikiRevisionDetail = { ...item, body: details[version] ?? '' }
        return r.fulfill({ json: detail })
      }
      if (version != null && m[2] && method === 'POST') {
        if (status && status >= 400) return r.fulfill({ status, json: { message: '권한이 없습니다' } })
        await onRestore?.(version, details[version] ?? '')
        // 복원 직전 판(지금 판)이 새 스냅샷으로 맨 위에 생긴다.
        const before: WikiRevisionItem = {
          version: current.current.version,
          title: item?.title ?? '',
          editedAt: current.current.editedAt,
          createdAt: current.current.editedAt,
          reason: 'RESTORE',
          editors: current.current.editors,
          aiActor: null,
        }
        current = { current: { ...current.current, version: current.current.version + 1 }, items: [before, ...current.items] }
        return r.fulfill({
          json: wikiPageDetail({
            id: pageId,
            title: item?.title ?? '',
            body: details[version] ?? '',
            version: current.current.version,
            updatedAt: current.current.editedAt,
          }),
        })
      }
      return r.fallback()
    },
  )
  return {
    restores,
    /** 목록을 바꾼다 — 다음 목록 조회부터 보인다(다른 사람의 편집·복원으로 서버에 새 판이 생긴 것처럼). */
    setList: (next: WikiRevisionList) => {
      current = next
    },
  }
}
