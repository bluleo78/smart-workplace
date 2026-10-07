// 위키 @ 통합 멘션 E2E — 백엔드 없이 route 모킹.
// (a) '@' 입력 → 통합 검색 API 호출(query param) → 후보 렌더 → 선택 시 칩 삽입,
// (b) 멘션 포함 본문이 동기화 서버 문서(마크다운)에 토큰(<#page:id>·<@id>)으로 저장(입력→저장본, WP-172),
// (c) 토큰 포함 본문 로드 → 에디터에 칩 렌더(라운드트립) + 무편집 저장 시 본문 토큰 동일성.
import type {
  IssueResponse,
  IssueSearchResponse,
} from '../../../src/types/issue'
import type { PageResponse } from '../../../src/types/common'
import type { MemberSummary } from '../../../src/types/member'
import type {
  WikiBacklink,
  WikiMentionRef,
  WikiPageDetail,
  WikiPageSummary,
  WikiRole,
  WikiSearchResult,
  WikiSpace,
} from '../../../src/types/wiki'
import { createMember } from '../../factories/auth.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { seedCollabFor } from '../../fixtures/collab'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'
import { savedMarkdown } from '../../fixtures/wiki-mock'

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
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

// 검색 모킹 데이터 — 타입 적용(스펙 변경 시 컴파일 에러).
// 유저 후보는 구성원 디렉터리(/members) 응답 — MemberSummary 형태다(#833).
const USER: MemberSummary = createMember({
  userId: 7,
  username: 'alice',
  email: 'alice@example.com',
  name: '앨리스',
})
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

// 공통 모킹: 스페이스 + 트리 + 멤버 빈 스텁 + 페이지 GET/PUT(제목 저장). 본문 저장 결과는 동기화 서버에서 읽는다.
async function setupWikiMocks(
  page: import('@playwright/test').Page,
  opts: {
    role: WikiRole
    body: string
    mentions?: WikiMentionRef[]
    backlinks?: WikiBacklink[]
  },
) {
  // 에디터 본문·역할은 동기화 서버 문서에서 온다(WP-172) — 모킹한 상세 본문·스페이스 역할과 같게 시드한다.
  await seedCollabFor(page, PAGE_ID, opts.body, opts.role)
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

// 통합 검색 3종(유저/위키/이슈) 모킹. 검색별 요청 tracker 를 돌려준다(query param 확인용).
async function setupSearchMocks(page: import('@playwright/test').Page) {
  const issueSearch = (url: URL) => url.pathname === '/api/v1/me/issues' && url.searchParams.has('q')
  const search = {
    users: trackRequests(page, 'ANY', '/api/v1/members'),
    wiki: trackRequests(page, 'ANY', '/api/v1/wiki/search'),
    issues: trackRequests(page, 'ANY', issueSearch),
  }
  // 유저 검색 — 구성원 디렉터리 GET /api/v1/members?search= (#833)
  await page.route(
    (url) => url.pathname === '/api/v1/members',
    (route) => {
      const body: PageResponse<MemberSummary> = {
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
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([WIKI_PAGE] satisfies WikiSearchResult[]),
      })
    },
  )
  // 이슈 횡단 검색 — GET /api/v1/me/issues?q=  (fixture 의 기본 빈 스텁보다 우선)
  await page.route(
    issueSearch,
    (route) => {
      const body: IssueSearchResponse = { items: [ISSUE], nextCursor: null, hasMore: false }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )
  return search
}

test('위키 @ 멘션 — 통합 검색 호출 → 후보 렌더 → 페이지 선택 시 칩 삽입 + 저장 토큰', {
  tag: '@smoke',
}, async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, { role: 'EDITOR', body: '' })
  const search = await setupSearchMocks(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // (a) '@온보' 입력 → 통합 검색 트리거.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('@온보')

  // 검색 API 가 query param '온보' 로 호출됐는지(필터→query param 검증).
  await expect.poll(() => search.wiki.lastUrl()?.searchParams.get('q')).toBe('온보')
  await expect.poll(() => search.users.lastUrl()?.searchParams.get('search')).toBe('온보')
  await expect.poll(() => search.issues.lastUrl()?.searchParams.get('q')).toBe('온보')

  // 후보 팝업 + 세 타입 행 렌더.
  await expect(page.getByTestId('wiki-mention-popover')).toBeVisible()
  await expect(page.getByTestId(`wiki-mention-option-PAGE-${WIKI_PAGE.id}`)).toBeVisible()
  await expect(page.getByTestId(`wiki-mention-option-USER-${USER.userId}`)).toBeVisible()
  await expect(page.getByTestId(`wiki-mention-option-ISSUE-${ISSUE.id}`)).toBeVisible()

  // 페이지 후보 선택 → 칩(라벨) 삽입. PAGE 는 멘션이 아닌 참조 링크라 "@" 프리픽스 없음.
  // 누르는 순간(mousedown) 포커스가 에디터에 그대로 있어야 한다(WP-302) — 예전엔 포커스가 후보 버튼으로 갔다가
  // 삽입 명령의 focus() 로 다음 프레임에 돌아와, 그 틈에 친 키(' '·'@')가 에디터 밖으로 샜다(preview 에서 재현).
  // mousedown 의 기본 동작(포커스 이동)은 동기로 일어나므로 즉시 확인한다.
  await page.getByTestId(`wiki-mention-option-PAGE-${WIKI_PAGE.id}`).hover()
  await page.mouse.down()
  expect(await page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'))).toBe(true)
  await page.mouse.up()
  // (c) 기다림 없이 곧바로 이어 친다 — 키 입력이 새지 않으면 두 번째 멘션 팝업이 뜬다.
  await page.keyboard.type(' @온보')
  await expect(page.locator('.ProseMirror span[data-mtype="PAGE"]')).toHaveText(WIKI_PAGE.title)
  await expect(page.getByTestId('wiki-mention-popover')).toBeVisible()

  // USER 멘션은 채팅 칩과 동일하게 "@" 프리픽스가 붙어야 한다(#703).
  await page.getByTestId(`wiki-mention-option-USER-${USER.userId}`).click()
  await expect(page.locator(`.ProseMirror span[data-mtype="USER"]`)).toHaveText(`@${USER.name}`)

  // (b) 동기화 서버에 저장된 마크다운에 페이지 토큰(<#page:55>)이 들어간다(입력→저장본).
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain(`<#page:${WIKI_PAGE.id}>`)
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
  await setupWikiMocks(page, { role: 'EDITOR', body: BODY, mentions: MENTIONS })
  // 검색 모킹은 불필요하나 누수 방지로 깔아둔다.
  await setupSearchMocks(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // (c) 두 토큰이 칩(노드)으로 치환되고 라벨이 mentions 해소 결과로 채워진다.
  // USER 는 채팅 칩과 동일하게 "@" 프리픽스, PAGE는 참조 링크라 프리픽스 없음(#703).
  await expect(page.locator('.ProseMirror span[data-mtype="USER"]')).toHaveText('@앨리스')
  await expect(page.locator('.ProseMirror span[data-mtype="PAGE"]')).toHaveText('온보딩 가이드')
  // 토큰 텍스트는 더 이상 raw 로 보이지 않는다.
  await expect(page.locator('.ProseMirror')).not.toContainText('<@7>')
  await expect(page.locator('.ProseMirror')).not.toContainText('<#page:55>')

  // 무편집 상태에서 글자를 하나 더 쳐 저장을 유발 → 본문 토큰이 동일하게 보존돼야 한다(라운드트립).
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')

  // 토큰뿐 아니라 주변 텍스트·공백까지 보존되는지(직렬화 인접성 회귀)를 함께 검증한다.
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toBe('담당 <@7> 은 <#page:55> 문서를 본다!')
})

test('위키 @ 멘션 — 코드 안의 토큰은 칩이 되지 않고 글자 그대로 저장된다', async ({
  authenticatedPage: page,
}) => {
  // 인라인 코드·코드블록 안 토큰은 문서 예시일 뿐 멘션이 아니다. 예전 클라 치환은 코드블록에서 RangeError,
  // 인라인 코드에서 백틱 손실을 냈다(WP-294) — 이제 마크다운 파서가 코드 밖 토큰만 칩으로 만든다.
  const BODY = '담당 <@7> 예시 `<@7>` 끝\n\n```\n<#page:55>\n```'
  const MENTIONS: WikiMentionRef[] = [
    { type: 'USER', id: 7, label: '앨리스', spaceId: null, projectKey: null, number: null },
  ]
  await setupWikiMocks(page, { role: 'EDITOR', body: BODY, mentions: MENTIONS })
  await setupSearchMocks(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror span[data-mtype="USER"]')).toHaveText('@앨리스')
  // 코드 밖 토큰 하나만 칩 — 코드 안 토큰은 글자로 보인다.
  await expect(page.locator('.ProseMirror [data-mtype]')).toHaveCount(1)
  await expect(page.locator('.ProseMirror code').first()).toHaveText('<@7>')
  await expect(page.locator('.ProseMirror pre')).toContainText('<#page:55>')

  // 편집 후 저장 본문에서 코드 안 토큰·백틱이 그대로 보존된다.
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type('!')
  await expect.poll(() => savedMarkdown(page, PAGE_ID)).toContain('담당 <@7> 예시 `<@7>` 끝!')
  expect(await savedMarkdown(page, PAGE_ID)).toContain('```\n<#page:55>\n```')
})

test('위키 @ 멘션 — 검색 결과 없을 때 결과 없음 메시지 표시(피드백)', async ({
  authenticatedPage: page,
}) => {
  // 모든 검색 API 가 빈 배열/객체를 반환 → 후보 없음 상태를 재현.
  await setupWikiMocks(page, { role: 'EDITOR', body: '' })

  // 검색 API — 빈 결과 반환
  await page.route(
    (url) => url.pathname === '/api/v1/members',
    (route) => {
      const body: PageResponse<MemberSummary> =
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
      const body: import('../../../src/types/issue').IssueSearchResponse = {
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
  await setupWikiMocks(page, { role: 'VIEWER', body: '' })
  const search = await setupSearchMocks(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  // '@' 입력해도 allow 게이트(canEditRef=false)로 팝업이 뜨지 않고, 검색 API 도 호출되지 않는다.
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('@온보')
  await expectStays(page, () => page.getByTestId('wiki-mention-popover').count(), 0)
  expect(search.wiki.count()).toBe(0)
})

// ── S4: 멘션 칩 내비게이션 ──────────────────────────────────────────────────
// 칩 노드 attrs 는 {mtype,id} 뿐이라 라우트의 spaceId/projectKey/number 는
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
  await setupSearchMocks(page)

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
  await setupSearchMocks(page)

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
  await setupSearchMocks(page)

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
  const MANY_USERS: MemberSummary[] = Array.from({ length: 5 }, (_, i) =>
    createMember({
      userId: 200 + i,
      username: `user${i}`,
      email: `user${i}@example.com`,
      name: `유저 ${i + 1}`,
    }),
  )
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
    (url) => url.pathname === '/api/v1/members',
    (route) => {
      const body: PageResponse<MemberSummary> = {
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
  await setupSearchMocks(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()

  await expect(page.getByTestId('wiki-backlinks-panel')).toHaveCount(0)
})
