// 위키 @ 통합 멘션 E2E — 백엔드 없이 route 모킹.
// (a) '@' 입력 → 통합 검색 API 호출(query param) → 후보 렌더 → 선택 시 칩 삽입,
// (b) 멘션 포함 본문 저장 PUT payload 에 토큰(<#page:id>·<@id>) 포함(입력→payload),
// (c) 토큰 포함 page.body 로드 → 에디터에 칩 렌더(라운드트립) + 무편집 저장 시 본문 토큰 동일성.
import type {
  IssueResponse,
  IssueSearchResponse,
} from '../../src/types/issue'
import type { UserResponse } from '../../src/types/auth'
import type { PageResponse } from '../../src/types/common'
import type {
  SavePageRequest,
  WikiBacklink,
  WikiMentionRef,
  WikiPageDetail,
  WikiPageSummary,
  WikiRole,
  WikiSearchResult,
  WikiSpace,
} from '../../src/types/wiki'
import { expect, test } from '../fixtures/auth.fixture'

const SPACE_ID = 1
const PAGE_ID = 400

function space(role: WikiRole): WikiSpace {
  return {
    id: SPACE_ID,
    type: 'TEAM',
    name: '팀 위키',
    ownerId: 1,
    role,
    createdAt: '2026-06-01T00:00:00Z',
  }
}

function pageDetail(body: string): WikiPageDetail {
  return {
    id: PAGE_ID,
    spaceId: SPACE_ID,
    parentId: null,
    title: '멘션 대상 페이지',
    body,
    version: 1,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
  }
}

// 검색 모킹 데이터 — 타입 적용(스펙 변경 시 컴파일 에러).
const USER: UserResponse = {
  id: 7,
  username: 'alice',
  email: 'alice@example.com',
  name: '앨리스',
  isActive: true,
  createdAt: '2026-06-01T00:00:00Z',
  kind: 'HUMAN',
  aiAvailable: false,
}
const WIKI_PAGE: WikiSearchResult = {
  id: 55,
  spaceId: SPACE_ID,
  spaceName: '팀 위키',
  title: '온보딩 가이드',
  snippet: '신규 입사자…',
  updatedAt: '2026-06-01T00:00:00Z',
}
const ISSUE: IssueResponse = {
  id: 99,
  projectKey: 'WP',
  number: 12,
  title: '로그인 버그',
  status: 'TODO',
  priority: 'MID',
  dueDate: null,
  startDate: null,
  milestoneId: null,
  reporterId: 1,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  labels: [],
  attachmentCount: 0,
  type: null,
  assignees: [],
  parent: null,
  childCount: 0,
  childDoneCount: 0,
  blockedBy: [],
  blocks: [],
  blocked: false,
  customFields: [],
}

// 공통 모킹: 스페이스 + 트리 + 멤버 빈 스텁 + 페이지 GET/PUT. body 와 PUT 캡처는 호출처 제어.
async function setupWikiMocks(
  page: import('@playwright/test').Page,
  opts: {
    role: WikiRole
    body: string
    onSave?: (req: SavePageRequest) => void
    mentions?: WikiMentionRef[]
    backlinks?: WikiBacklink[]
  },
) {
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([space(opts.role)]),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { id: PAGE_ID, parentId: null, title: '멘션 대상 페이지', position: 0 } as WikiPageSummary,
            ]),
          })
        : route.fallback(),
  )

  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )

  // mentions 해소(칩 라벨) — 기본 빈 배열.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}/mentions`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(opts.mentions ?? []),
          })
        : route.fallback(),
  )

  // backlinks 해소(백링크 패널) — 기본 빈 배열.
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}/backlinks`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: opts.backlinks ?? [] }),
          })
        : route.fallback(),
  )

  let version = 1
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}`,
    (route) => {
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pageDetail(opts.body)),
        })
      }
      if (method === 'PUT') {
        opts.onSave?.(route.request().postDataJSON() as SavePageRequest)
        version += 1
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...pageDetail(opts.body), version }),
        })
      }
      return route.fallback()
    },
  )
}

// 통합 검색 3종(유저/위키/이슈) 모킹 + query param 캡처.
async function setupSearchMocks(
  page: import('@playwright/test').Page,
  captured: { userQ?: string; wikiQ?: string; issueQ?: string },
) {
  // 유저 검색 — GET /api/v1/users?search=
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      captured.userQ = new URL(route.request().url()).searchParams.get('search') ?? undefined
      const body: PageResponse<UserResponse> = {
        content: [USER],
        page: 0,
        size: 5,
        totalElements: 1,
        totalPages: 1,
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )
  // 위키 페이지 검색 — GET /api/v1/wiki/search?q=&spaceId=
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/search',
    (route) => {
      captured.wikiQ = new URL(route.request().url()).searchParams.get('q') ?? undefined
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([WIKI_PAGE] satisfies WikiSearchResult[]),
      })
    },
  )
  // 이슈 횡단 검색 — GET /api/v1/me/issues?q=  (fixture 의 기본 빈 스텁보다 우선)
  await page.route(
    (url) => url.pathname === '/api/v1/me/issues' && url.searchParams.has('q'),
    (route) => {
      captured.issueQ = new URL(route.request().url()).searchParams.get('q') ?? undefined
      const body: IssueSearchResponse = { items: [ISSUE], nextCursor: null, hasMore: false }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )
}

test('위키 @ 멘션 — 통합 검색 호출 → 후보 렌더 → 페이지 선택 시 칩 삽입 + 저장 토큰', {
  tag: '@smoke',
}, async ({ authenticatedPage: page }) => {
  const captured: { userQ?: string; wikiQ?: string; issueQ?: string } = {}
  let savedBody: string | null = null
  await setupWikiMocks(page, {
    role: 'EDITOR',
    body: '',
    onSave: (req) => {
      savedBody = req.body
    },
  })
  await setupSearchMocks(page, captured)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // (a) '@온보' 입력 → 통합 검색 트리거.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('@온보')

  // 검색 API 가 query param '온보' 로 호출됐는지(필터→query param 검증).
  await expect.poll(() => captured.wikiQ).toBe('온보')
  await expect.poll(() => captured.userQ).toBe('온보')
  await expect.poll(() => captured.issueQ).toBe('온보')

  // 후보 팝업 + 세 타입 행 렌더.
  await expect(page.getByTestId('wiki-mention-popover')).toBeVisible()
  await expect(page.getByTestId(`wiki-mention-option-PAGE-${WIKI_PAGE.id}`)).toBeVisible()
  await expect(page.getByTestId(`wiki-mention-option-USER-${USER.id}`)).toBeVisible()
  await expect(page.getByTestId(`wiki-mention-option-ISSUE-${ISSUE.id}`)).toBeVisible()

  // 페이지 후보 선택 → 칩(라벨) 삽입.
  await page.getByTestId(`wiki-mention-option-PAGE-${WIKI_PAGE.id}`).click()
  await expect(page.locator('.ProseMirror span[data-mtype="PAGE"]')).toHaveText(WIKI_PAGE.title)

  // (b) 자동저장 PUT payload 의 body 에 페이지 토큰(<#page:55>)이 포함된다(입력→payload).
  await expect.poll(() => savedBody).not.toBeNull()
  await expect.poll(() => savedBody).toContain(`<#page:${WIKI_PAGE.id}>`)
})

test('위키 @ 멘션 — 토큰 포함 본문 로드 시 칩 렌더 + 무편집 저장 라운드트립(토큰 동일성)', async ({
  authenticatedPage: page,
}) => {
  // 본문에 유저·페이지 토큰이 텍스트로 들어있는 페이지. 로드 시 칩으로 치환돼야 한다.
  const BODY = '담당 <@7> 은 <#page:55> 문서를 본다'
  const MENTIONS: WikiMentionRef[] = [
    { type: 'USER', id: 7, label: '앨리스', spaceId: null, projectKey: null, number: null },
    { type: 'PAGE', id: 55, label: '온보딩 가이드', spaceId: SPACE_ID, projectKey: null, number: null },
  ]
  let savedBody: string | null = null
  await setupWikiMocks(page, {
    role: 'EDITOR',
    body: BODY,
    mentions: MENTIONS,
    onSave: (req) => {
      savedBody = req.body
    },
  })
  // 검색 모킹은 불필요하나 누수 방지로 빈 캡처 객체로 깔아둔다.
  await setupSearchMocks(page, {})

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // (c) 두 토큰이 칩(노드)으로 치환되고 라벨이 mentions 해소 결과로 채워진다.
  await expect(page.locator('.ProseMirror span[data-mtype="USER"]')).toHaveText('앨리스')
  await expect(page.locator('.ProseMirror span[data-mtype="PAGE"]')).toHaveText('온보딩 가이드')
  // 토큰 텍스트는 더 이상 raw 로 보이지 않는다.
  await expect(page.locator('.ProseMirror')).not.toContainText('<@7>')
  await expect(page.locator('.ProseMirror')).not.toContainText('<#page:55>')

  // 무편집 상태에서 글자를 하나 더 쳐 자동저장을 유발 → 본문 토큰이 동일하게 보존돼야 한다(라운드트립).
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')

  // 토큰뿐 아니라 주변 텍스트·공백까지 보존되는지(직렬화 인접성 회귀)를 함께 검증한다.
  await expect.poll(() => savedBody).not.toBeNull()
  await expect.poll(() => savedBody).toContain('담당 <@7> 은 <#page:55> 문서를')
})

test('위키 @ 멘션 — 검색 결과 없을 때 결과 없음 메시지 표시(피드백)', async ({
  authenticatedPage: page,
}) => {
  // 모든 검색 API 가 빈 배열/객체를 반환 → 후보 없음 상태를 재현.
  await setupWikiMocks(page, { role: 'EDITOR', body: '' })

  // 검색 API — 빈 결과 반환
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      const body: import('../../src/types/common').PageResponse<import('../../src/types/auth').UserResponse> =
        { content: [], page: 0, size: 5, totalElements: 0, totalPages: 0 }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/search',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/me/issues' && url.searchParams.has('q'),
    (route) => {
      const body: import('../../src/types/issue').IssueSearchResponse = {
        items: [],
        nextCursor: null,
        hasMore: false,
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 존재하지 않는 이름 입력 → 결과 없음 팝업이 떠야 한다(null 반환으로 사라지면 회귀).
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('@zzzzzzz')

  // 후보 팝업은 없고 "결과 없음" 메시지 div 가 보인다.
  await expect(page.getByTestId('wiki-mention-empty')).toBeVisible()
  await expect(page.getByTestId('wiki-mention-empty')).toHaveText('결과 없음')
  await expect(page.getByTestId('wiki-mention-popover')).toHaveCount(0)
})

test('위키 @ 멘션 — VIEWER 는 @ 멘션 피커가 노출되지 않는다(역할 게이트)', async ({
  authenticatedPage: page,
}) => {
  const captured: { userQ?: string; wikiQ?: string; issueQ?: string } = {}
  await setupWikiMocks(page, { role: 'VIEWER', body: '' })
  await setupSearchMocks(page, captured)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // '@' 입력해도 allow 게이트(canEditRef=false)로 팝업이 뜨지 않고, 검색 API 도 호출되지 않는다.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('@온보')
  await page.waitForTimeout(500)
  await expect(page.getByTestId('wiki-mention-popover')).toHaveCount(0)
  expect(captured.wikiQ).toBeUndefined()
})

// ── S4: 멘션 칩 내비게이션 ──────────────────────────────────────────────────
// 칩 노드 attrs 는 {mtype,id,label} 뿐이라 라우트의 spaceId/projectKey/number 는
// useWikiMentions 해소 결과(WikiMentionRef)에서 룩업한다(노드 attrs 미추가 결정).

test('위키 멘션 칩 — PAGE 칩 클릭 시 위키 페이지 경로로 이동(해소 spaceId 사용)', async ({
  authenticatedPage: page,
}) => {
  // PAGE 토큰 본문 + 해소 결과(spaceId=1). 칩 클릭 시 /wiki/spaces/1/pages/55 로 이동해야 한다.
  const BODY = '<#page:55> 참고'
  const MENTIONS: WikiMentionRef[] = [
    { type: 'PAGE', id: 55, label: '온보딩 가이드', spaceId: SPACE_ID, projectKey: null, number: null },
  ]
  await setupWikiMocks(page, { role: 'EDITOR', body: BODY, mentions: MENTIONS })
  await setupSearchMocks(page, {})

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror span[data-mtype="PAGE"]')).toHaveText('온보딩 가이드')

  // 칩 클릭 → 라우트 이동(URL 검증).
  await page.locator('.ProseMirror span[data-mtype="PAGE"]').click()
  await page.waitForURL(`**/wiki/spaces/${SPACE_ID}/pages/55`)
  expect(new URL(page.url()).pathname).toBe(`/wiki/spaces/${SPACE_ID}/pages/55`)
})

test('위키 멘션 칩 — ISSUE 칩 클릭 시 이슈 상세 경로로 이동(해소 projectKey/number 사용)', async ({
  authenticatedPage: page,
}) => {
  // ISSUE 토큰 본문 + 해소 결과(projectKey=WP, number=12). /projects/WP/issues/12 로 이동.
  const BODY = '<#issue:99> 확인'
  const MENTIONS: WikiMentionRef[] = [
    { type: 'ISSUE', id: 99, label: '로그인 버그', spaceId: null, projectKey: 'WP', number: 12 },
  ]
  await setupWikiMocks(page, { role: 'EDITOR', body: BODY, mentions: MENTIONS })
  await setupSearchMocks(page, {})

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror span[data-mtype="ISSUE"]')).toHaveText('로그인 버그')

  await page.locator('.ProseMirror span[data-mtype="ISSUE"]').click()
  await page.waitForURL('**/projects/WP/issues/12')
  expect(new URL(page.url()).pathname).toBe('/projects/WP/issues/12')
})

// ── S4: 백링크 패널 ─────────────────────────────────────────────────────────

test('위키 백링크 패널 — 참조 페이지 칩 렌더 + 클릭 시 출처 페이지로 이동', async ({
  authenticatedPage: page,
}) => {
  // 이 페이지를 참조하는 두 출처 페이지 — 서로 다른 스페이스(1·2)로 둬 "각 백링크 자신의 spaceId 로
  // 이동" 로직을 실검증한다(현재 페이지 spaceId 하드코딩이면 두 번째 항목에서 깨진다).
  const OTHER_SPACE_ID = 2
  const BACKLINKS: WikiBacklink[] = [
    { pageId: 501, spaceId: SPACE_ID, spaceName: '팀 위키', title: '회의록 2026', updatedAt: '2026-06-10T00:00:00Z' },
    { pageId: 502, spaceId: OTHER_SPACE_ID, spaceName: '엔지니어링', title: '제품 로드맵', updatedAt: '2026-06-11T00:00:00Z' },
  ]
  await setupWikiMocks(page, { role: 'EDITOR', body: '', backlinks: BACKLINKS })
  await setupSearchMocks(page, {})

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // 패널 + 두 백링크가 셀 단위로 렌더되는지(제목·스페이스명).
  const panel = page.getByTestId('wiki-backlinks-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('이 페이지를 참조하는 곳')
  await expect(page.getByTestId('wiki-backlink-501')).toContainText('회의록 2026')
  await expect(page.getByTestId('wiki-backlink-501')).toContainText('팀 위키')
  await expect(page.getByTestId('wiki-backlink-502')).toContainText('제품 로드맵')
  await expect(page.getByTestId('wiki-backlink-502')).toContainText('엔지니어링')

  // 두 번째 백링크 클릭 → 자신의 spaceId(2)/pageId(502)로 이동(현재 페이지 spaceId=1 아님).
  await page.getByTestId('wiki-backlink-502').click()
  await page.waitForURL(`**/wiki/spaces/${OTHER_SPACE_ID}/pages/502`)
  expect(new URL(page.url()).pathname).toBe(`/wiki/spaces/${OTHER_SPACE_ID}/pages/502`)
})

// ── 팝업 max-height 회귀 (#250) ─────────────────────────────────────────────
// WikiMentionList 에 max-h-60(240px) 이 적용되어 결과가 많아도 팝업이 뷰포트를 넘지 않는다.

test('위키 @ 멘션 팝업 — 결과 多 경우 max-height(240px) 적용으로 스크롤 생성(뷰포트 넘침 방지)', async ({
  authenticatedPage: page,
}) => {
  // PER_TYPE=5 제한으로 유저·페이지·이슈 각 5개 = 총 15개 항목 렌더 → 팝업 높이가 240px 초과.
  const MANY_USERS: UserResponse[] = Array.from({ length: 5 }, (_, i) => ({
    id: 200 + i,
    username: `user${i}`,
    email: `user${i}@example.com`,
    name: `유저 ${i + 1}`,
    isActive: true,
    createdAt: '2026-06-01T00:00:00Z',
    kind: 'HUMAN' as const,
    aiAvailable: false,
  }))
  const MANY_PAGES: WikiSearchResult[] = Array.from({ length: 5 }, (_, i) => ({
    id: 100 + i,
    spaceId: SPACE_ID,
    spaceName: '팀 위키',
    title: `문서 ${i + 1}`,
    snippet: '내용',
    updatedAt: '2026-06-01T00:00:00Z',
  }))
  const MANY_ISSUES: IssueResponse[] = Array.from({ length: 5 }, (_, i) => ({
    id: 300 + i,
    projectKey: 'WP',
    number: 100 + i,
    title: `이슈 ${i + 1}`,
    status: 'TODO' as const,
    priority: 'MID' as const,
    dueDate: null,
    startDate: null,
    milestoneId: null,
    reporterId: 1,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    labels: [],
    attachmentCount: 0,
    type: null,
    assignees: [],
    parent: null,
    childCount: 0,
    childDoneCount: 0,
    blockedBy: [],
    blocks: [],
    blocked: false,
    customFields: [],
  }))

  await setupWikiMocks(page, { role: 'EDITOR', body: '' })

  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) => {
      const body: import('../../src/types/common').PageResponse<UserResponse> = {
        content: MANY_USERS,
        page: 0,
        size: 5,
        totalElements: 5,
        totalPages: 1,
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/search',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MANY_PAGES satisfies WikiSearchResult[]),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/me/issues' && url.searchParams.has('q'),
    (route) => {
      const body: IssueSearchResponse = {
        items: MANY_ISSUES,
        nextCursor: null,
        hasMore: false,
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('@문')

  const popover = page.getByTestId('wiki-mention-popover')
  await expect(popover).toBeVisible()

  // max-height(240px = 15rem)가 적용되어 팝업 높이가 240px 이하여야 한다.
  const height = await popover.evaluate((el) => el.getBoundingClientRect().height)
  expect(height).toBeLessThanOrEqual(240)

  // 넘치는 항목은 스크롤로 접근 가능해야 한다(overflow 존재 = scrollHeight > clientHeight).
  const hasScroll = await popover.evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(hasScroll).toBe(true)
})

test('위키 백링크 패널 — 백링크가 없으면 패널이 숨겨진다', async ({
  authenticatedPage: page,
}) => {
  // 빈 백링크 → 패널 미노출(절제).
  await setupWikiMocks(page, { role: 'EDITOR', body: '', backlinks: [] })
  await setupSearchMocks(page, {})

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await expect(page.getByTestId('wiki-backlinks-panel')).toHaveCount(0)
})
