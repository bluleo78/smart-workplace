// 노트 공유하는 쪽(WP-579) — 공유 창(켜기·외부 공개·재발급·해제·접근 요청 승인)이 실제 API 배선으로 도는지,
// 트리 공유 표시, 하위 포함 공유 밖으로 옮길 때의 경고, 스페이스 「공유 중인 페이지」 목록, 모바일 ⋯ 메뉴, 읽기 전용(VIEWER) 숨김을 본다.
// 서버는 상태를 가진 모킹으로 대신한다 — PUT 한 설정이 다음 GET(트리·상세·공유 상태)에 그대로 돌아와 화면이 서버 응답을 따르는지 확인한다.
// 권한·조건부 렌더·payload 경우의 수는 컴포넌트 테스트(WikiShareDialog.test.tsx 등)가 맡고, 여기는 화면별 실제 배선만 둔다.
// 외부 공개 확인·재발급·해제·접근 요청 승인/거절·VIEWER 숨김(?share=1 정리)·휴대폰 ⋯ 메뉴는 src/pages/wiki/wikiPage.test.tsx·wikiMobile.test.tsx 가 지킨다(WP-983).
import type { Page } from '@playwright/test'

import type {
  WikiPageShare,
  WikiPageShareRequest,
  WikiPageShareState,
  WikiPageSummary,
  WikiShareAccessRequest,
  WikiShareEvent,
  WikiSharedPageItem,
} from '../../../src/types/wiki'
import { createMember } from '../../factories/auth.factory'
import { wikiPageDetail } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { bodyOf, trackRequests } from '../../fixtures/requests'
import { dropDnd, expectStays } from '../../fixtures/wait'
import { expectNoHorizontalOverflow } from '../../fixtures/mobile.fixture'
import { mockWikiPageEditor } from '../../fixtures/wiki-mock'

const SPACE_ID = 9
const PAGE = 101
const TITLE = '제품 로드맵'
const ME = { userId: 1, name: '나' }

/** 서버가 가진 공유 한 건(페이지 PAGE)과 그 주변 상태 — 모킹 라우트가 읽고 쓴다. */
interface ServerShare {
  share: WikiPageShare | null
  externalShareEnabled: boolean
  accessRequests: WikiShareAccessRequest[]
  events: WikiShareEvent[]
  /** 재발급할 때마다 하나씩 올라가는 토큰 번호 */
  tokenSeq: number
}

const tokenOf = (n: number) => `wsh_owner${n}`

/** PUT 요청 → 저장된 공유 모양(서버가 토큰·작성자·집계를 채운다). 토큰은 이미 있으면 유지한다. */
function toShare(req: WikiPageShareRequest, prev: WikiPageShare | null, token: string): WikiPageShare {
  return {
    pageId: PAGE,
    token: prev?.token ?? token,
    audience: req.audience,
    permission: req.permission,
    includeChildren: req.includeChildren,
    people: req.userIds.map((userId) => ({ userId, name: `사용자${userId}`, active: true })),
    groups: (req.groupIds ?? []).map((groupId) => ({ groupId, name: `부서${groupId}`, memberCount: 0 })),
    createdBy: prev?.createdBy ?? ME,
    createdAt: prev?.createdAt ?? '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    expiresAt: req.expiresAt,
    lastAccessedAt: null,
    viewCount: 0,
  }
}

/**
 * 공유하는 쪽 API 모킹 — 공유 상태·설정 저장·재발급·해제·기록·접근 요청 승인/거절·트리·페이지 상세(shared)·스페이스 공유 목록.
 * 에디터(동기화 문서·스페이스·멤버)는 mockWikiPageEditor 가 깔고, 트리·상세는 공유 표시를 싣도록 그 위에 다시 건다(나중에 등록한 라우트가 이긴다).
 */
async function mockOwnerShare(
  page: Page,
  server: ServerShare,
  role: 'OWNER' | 'EDITOR' | 'VIEWER' = 'OWNER',
  { aiAttributed = false }: { aiAttributed?: boolean } = {},
) {
  await mockWikiPageEditor(page, { spaceId: SPACE_ID, pageId: PAGE, title: TITLE, body: '본문', role })
  const sharePath = `/api/v1/wiki/pages/${PAGE}/share`
  await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) => {
    const row: WikiPageSummary = {
      id: PAGE,
      parentId: null,
      title: TITLE,
      position: 0,
      aiLastUsedAt: null,
      share: server.share && { audience: server.share.audience, includeChildren: server.share.includeChildren },
    }
    return r.fulfill({ json: [row] })
  })
  await page.route((u) => u.pathname === `/api/v1/wiki/pages/${PAGE}`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: wikiPageDetail({ id: PAGE, spaceId: SPACE_ID, title: TITLE, body: '본문', shared: server.share != null, aiLastUsedAt: aiAttributed ? '2026-10-20T00:00:00Z' : null, aiLastAction: aiAttributed ? 'draft' : null }) })
      : r.fallback())
  await page.route((u) => u.pathname === sharePath, (r) => {
    const m = r.request().method()
    if (m === 'GET') {
      const state: WikiPageShareState = {
        share: server.share,
        externalShareEnabled: server.externalShareEnabled,
        inheritedFrom: null,
        accessRequests: server.accessRequests,
        excludedFromParent: false,
        excludedPages: [],
      }
      return r.fulfill({ json: state })
    }
    if (m === 'PUT') {
      server.share = toShare(r.request().postDataJSON() as WikiPageShareRequest, server.share, tokenOf(server.tokenSeq))
      return r.fulfill({ json: server.share })
    }
    if (m === 'DELETE') {
      server.share = null
      return r.fulfill({ status: 204, body: '' })
    }
    return r.fallback()
  })
  await page.route((u) => u.pathname === `${sharePath}/regenerate`, (r) => {
    server.tokenSeq += 1
    server.share = { ...(server.share as WikiPageShare), token: tokenOf(server.tokenSeq) }
    return r.fulfill({ json: server.share })
  })
  await page.route((u) => u.pathname === `${sharePath}/events`, (r) => r.fulfill({ json: server.events }))
  await page.route((u) => u.pathname.startsWith(`${sharePath}/access-requests/`), (r) => {
    const id = Number(r.request().url().split('/access-requests/')[1].split('/')[0])
    server.accessRequests = server.accessRequests.filter((x) => x.id !== id)
    return r.fulfill({ status: 204, body: '' })
  })
}

const newServer = (over: Partial<ServerShare> = {}): ServerShare => ({
  share: null,
  externalShareEnabled: true,
  accessRequests: [],
  events: [],
  tokenSeq: 1,
  ...over,
})

const existingShare = (over: Partial<WikiPageShare> = {}): WikiPageShare => ({
  ...toShare({ audience: 'WORKSPACE', permission: 'VIEW', includeChildren: false, userIds: [], expiresAt: null }, null, tokenOf(1)),
  ...over,
})

const dialogOf = (page: Page) => page.getByTestId('wiki-share-dialog')

test.describe('노트 공유 — 공유하는 쪽', () => {
  test('공유를 켜면 기본값으로 PUT 하고 링크를 복사한다', { tag: ['@platform', '@smoke'] }, async ({ authenticatedPage: page }) => {
    const server = newServer()
    await mockOwnerShare(page, server)
    const puts = trackRequests(page, 'PUT', `/api/v1/wiki/pages/${PAGE}/share`)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    // 공유 전 — 헤더는 「공유」, 트리에 공유 표시가 없다.
    await expect(page.getByTestId('wiki-share-button')).toHaveText('공유')
    await expect(page.getByTestId(`wiki-tree-shared-${PAGE}`)).toHaveCount(0)

    await page.getByTestId('wiki-share-button').click()
    await expect(dialogOf(page)).toBeVisible()
    await dialogOf(page).getByTestId('wiki-share-switch').click()

    await expect.poll(() => puts.lastBody()).toEqual({
      audience: 'WORKSPACE',
      permission: 'VIEW',
      includeChildren: true, // 기본은 하위 포함(WP-987)
      userIds: [],
      expiresAt: null,
    })
    // 서버 응답의 토큰이 링크 주소가 된다.
    const url = `${new URL(page.url()).origin}/wiki/share/${tokenOf(1)}`
    await expect(dialogOf(page).getByTestId('wiki-share-url')).toHaveValue(url)

    await dialogOf(page).getByTestId('wiki-share-copy').click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url)

    // 저장 결과가 화면 곳곳에 돌아온다 — 헤더 「공유 중」, 트리의 링크 표시.
    await dialogOf(page).getByRole('button', { name: '완료' }).click()
    await expect(page.getByTestId('wiki-share-button')).toHaveText('공유 중')
    await expect(page.getByTestId(`wiki-tree-shared-${PAGE}`)).toHaveAttribute('data-mark', 'own')
  })

  test('스페이스 메뉴의 공유 중인 페이지 목록은 토큰이 있는 줄만 링크를 복사한다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const server = newServer({ share: existingShare() })
    await mockOwnerShare(page, server)
    const base: WikiSharedPageItem = {
      pageId: PAGE,
      title: TITLE,
      audience: 'WORKSPACE',
      permission: 'VIEW',
      includeChildren: true,
      peopleCount: 0,
      groupCount: 0,
      createdBy: ME,
      updatedAt: '2026-10-20T00:00:00Z',
      expiresAt: null,
      lastAccessedAt: null,
      viewCount: 0,
      token: tokenOf(1),
    }
    // 스페이스 목록은 토큰을 줄 수 있는 줄과 못 주는 줄(편집 권한 미만으로 본 경우의 응답 모양)을 함께 둔다.
    const items: WikiSharedPageItem[] = [base, { ...base, pageId: 102, title: '고객 목록', audience: 'PEOPLE', peopleCount: 2, token: null }]
    const lists = trackRequests(page, 'GET', `/api/v1/wiki/spaces/${SPACE_ID}/shares`)
    await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/shares`, (r) => r.fulfill({ json: items }))
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    await page.getByTestId('wiki-space-menu').click()
    await page.getByTestId('wiki-space-shared-pages').click()
    const list = page.getByTestId('wiki-shared-pages-list')
    await expect(list).toContainText('워크스페이스 전체 · 보기 · 하위 페이지 포함')
    await expect(list).toContainText('2명 · 보기')
    expect(lists.count()).toBeGreaterThan(0)
    // 토큰이 null 인 줄에는 복사 버튼이 없다.
    await expect(page.getByRole('button', { name: '고객 목록 링크 복사' })).toHaveCount(0)
    await page.getByRole('button', { name: `${TITLE} 링크 복사` }).click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(`${new URL(page.url()).origin}/wiki/share/${tokenOf(1)}`)
  })
})

test.describe('노트 공유 — 이동 경고', { tag: '@input' }, () => {
  /** 두 점 사이를 dnd-kit PointerSensor 가 활성화되도록 단계적으로 끈다(wiki-dnd.spec 와 같은 방식). */
  async function dragRowTo(page: Page, sourceName: string, targetName: string, dx = 0) {
    // 행 버튼의 접근 가능한 이름에는 공유 표시(「상위 페이지 공유에 포함됨」)가 덧붙고, 접기·메뉴 버튼 이름도 제목으로
    // 시작하므로(WP-923) 버튼 대신 제목 글자를 잡는다.
    const rows = page.locator('[data-testid^="wiki-tree-row-"]')
    const source = rows.getByText(sourceName, { exact: true })
    const target = rows.getByText(targetName, { exact: true })
    const sourceBox = await source.boundingBox()
    const box = await target.boundingBox()
    if (!sourceBox || !box) throw new Error('드래그 좌표를 잡을 수 없습니다')
    await source.hover()
    await page.mouse.down()
    await page.mouse.move(0, 0)
    await page.mouse.move(sourceBox.x + sourceBox.width / 2 + dx, box.y + 2, { steps: 12 })
    await dropDnd(page)
  }

  /** 로드맵(하위 포함 공유) 아래 하반기, 그리고 공유와 무관한 루트 메모 — 트리·move 라우트를 깔고 하반기를 공유 밖으로 끌어 경고를 띄운다. */
  async function dragOutOfShare(page: Page) {
    const pages: WikiPageSummary[] = [
      { id: 10, parentId: null, title: '로드맵', position: 0, aiLastUsedAt: null, share: { audience: 'WORKSPACE', includeChildren: true } },
      { id: 20, parentId: 10, title: '하반기', position: 0, aiLastUsedAt: null },
      { id: 11, parentId: null, title: '메모', position: 1, aiLastUsedAt: null },
    ]
    await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
      r.request().method() === 'GET'
        ? r.fulfill({ json: [{ id: SPACE_ID, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }] })
        : r.fallback())
    await page.route((u) => u.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`, (r) =>
      r.request().method() === 'GET' ? r.fulfill({ json: pages }) : r.fallback())
    await page.route((u) => /\/api\/v1\/wiki\/pages\/\d+\/move$/.test(u.pathname), (r) =>
      r.request().method() === 'PATCH' ? r.fulfill({ status: 204, body: '' }) : r.fallback())
    const moves = trackRequests(page, 'PATCH', /\/api\/v1\/wiki\/pages\/\d+\/move$/)

    await page.goto(`/wiki/spaces/${SPACE_ID}`)
    // 트리 표시 — 로드맵은 자기 공유, 하위(하반기)는 상위 공유에 포함.
    await expect(page.getByTestId('wiki-tree-shared-10')).toHaveAttribute('data-mark', 'own')
    await expect(page.getByTestId('wiki-tree-shared-20')).toHaveAttribute('data-mark', 'inherited')

    // 하반기를 루트(공유 밖)로 끈다 — 왼쪽으로 한 단계 들여쓰기만큼.
    await dragRowTo(page, '하반기', '메모', -24)
    const warn = page.getByTestId('wiki-move-share-dialog')
    await expect(warn).toContainText('「로드맵」 공유 링크로 더 이상 보이지 않습니다')
    // 확인 전에는 move 를 보내지 않는다.
    await expectStays(page, moves.count, 0)
    return { warn, moves }
  }

  test('하위 포함 공유 밖으로 끌면 경고 후 move 를 보낸다', async ({ authenticatedPage: page }) => {
    const { warn, moves } = await dragOutOfShare(page)
    await warn.getByRole('button', { name: '옮기기' }).click()
    await moves.waitFor()
    expect(bodyOf(moves.requests()[0])).toMatchObject({ parentId: null })
    expect(moves.requests()[0].url()).toContain('/wiki/pages/20/move')
  })

  test('경고에서 취소하면 창이 닫히고 move 를 보내지 않는다', async ({ authenticatedPage: page }) => {
    const { warn, moves } = await dragOutOfShare(page)
    await warn.getByRole('button', { name: '취소' }).click()
    await expect(warn).toHaveCount(0)
    await expectStays(page, moves.count, 0)
    // 하반기는 제자리(로드맵 아래, 공유에 포함)에 남는다.
    await expect(page.getByTestId('wiki-tree-shared-20')).toHaveAttribute('data-mark', 'inherited')
  })
})

test.describe('노트 공유 — 휴대폰', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('공유 중 표식과 AI 생성 표식이 함께 보이고 가로로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const server = newServer({ share: existingShare() })
    await mockOwnerShare(page, server, 'OWNER', { aiAttributed: true })

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    await expect(page.getByTestId('wiki-page-shared-badge')).toBeVisible()
    await expect(page.getByTestId('wiki-page-ai-attribution-badge')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    // 두 표식 모두 헤더 폭 안에 있다(오른쪽 도구에 밀려 잘리지 않는다).
    const header = await page.getByTestId('wiki-page-header').boundingBox()
    for (const id of ['wiki-page-shared-badge', 'wiki-page-ai-attribution-badge']) {
      const box = await page.getByTestId(id).boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(header!.x + header!.width)
    }
  })
})

// 사람·팀 추가 목록 스크롤(WP-1048) — 공유 창(Dialog)이 바깥 스크롤을 막아(RemoveScroll), 포털로 그린 검색 팝오버의 목록이 휠로 내려가지 않았다.
// 휠 이벤트가 막히는지는 jsdom 이 잴 수 없어 실제 브라우저로 본다. 목록 내용·고르기는 src/pages/wiki/wikiShare.test.tsx 가 맡는다.
test.describe('노트 공유 — 사람·팀 추가 목록(WP-1048)', () => {
  test('공유 창 안의 후보 목록이 휠로 내려간다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const server = newServer({ share: existingShare({ audience: 'PEOPLE' }) })
    await mockOwnerShare(page, server)
    // 목록 높이(300px)를 넘기도록 사람 20명.
    const people = Array.from({ length: 20 }, (_, i) => createMember({ userId: 100 + i, username: `p${i}`, name: `사람${i}` }))
    await page.route((u) => u.pathname === '/api/v1/members', (r) =>
      r.fulfill({ json: { content: people, page: 0, size: 20, totalElements: people.length, totalPages: 1 } }),
    )
    await page.route((u) => u.pathname === '/api/v1/user-groups', (r) => r.fulfill({ json: { shared: [], personal: [] } }))

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    await page.getByTestId('wiki-share-button').click()
    await dialogOf(page).getByTestId('wiki-share-add-person').click()
    const list = page.getByTestId('share-target-search').locator('[cmdk-list]')
    await expect(page.getByTestId('share-target-person-119')).toBeAttached()
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    const box = await list.boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.wheel(0, 600)
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  })
})
