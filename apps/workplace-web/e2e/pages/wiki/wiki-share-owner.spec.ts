// 노트 공유하는 쪽(WP-579) — 공유 창(켜기·외부 공개·재발급·해제·접근 요청 승인)이 실제 API 배선으로 도는지,
// 트리 공유 표시, 하위 포함 공유 밖으로 옮길 때의 경고, 스페이스 「공유 중인 페이지」 목록, 모바일 ⋯ 메뉴, 읽기 전용(VIEWER) 숨김을 본다.
// 서버는 상태를 가진 모킹으로 대신한다 — PUT 한 설정이 다음 GET(트리·상세·공유 상태)에 그대로 돌아와 화면이 서버 응답을 따르는지 확인한다.
// 권한·조건부 렌더·payload 경우의 수는 컴포넌트 테스트(WikiShareDialog.test.tsx 등)가 맡고, 여기는 화면별 실제 배선만 둔다.
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
    people: req.userIds.map((userId) => ({ userId, name: `사용자${userId}` })),
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
  test('공유를 켜면 기본값으로 PUT 하고 링크를 복사한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
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
      includeChildren: false,
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

  test('외부 공개로 바꾸면 확인 후 보기·30일 만료로 저장한다', async ({ authenticatedPage: page }) => {
    // 만료는 지금(Date)으로 정해진다 — 시각만 고정하고 타이머는 그대로 둔다(동기화 연결이 살아 있어야 한다).
    await page.clock.setFixedTime(new Date('2026-10-21T03:00:00.000Z'))
    const server = newServer({ share: existingShare({ permission: 'EDIT', includeChildren: true }) })
    await mockOwnerShare(page, server)
    const puts = trackRequests(page, 'PUT', `/api/v1/wiki/pages/${PAGE}/share`)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    await page.getByTestId('wiki-share-button').click()
    const dialog = dialogOf(page)
    await dialog.getByTestId('wiki-share-audience').click()
    await page.getByRole('option', { name: /링크가 있는 누구나\(외부\)/ }).click()

    // 확인을 받기 전에는 저장하지 않는다.
    const confirm = page.getByTestId('wiki-share-confirm')
    await expect(confirm).toContainText('외부에 공개할까요?')
    await expectStays(page, puts.count, 0)
    await confirm.getByRole('button', { name: '외부 공개' }).click()

    // 외부는 보기만·이 페이지만·30일 뒤 만료로 맞춰 보낸다.
    await expect.poll(() => puts.lastBody()).toEqual({
      audience: 'PUBLIC',
      permission: 'VIEW',
      includeChildren: false,
      userIds: [],
      expiresAt: '2026-11-20T03:00:00.000Z',
    })
    await expect(dialog.getByTestId('wiki-share-permission')).toBeDisabled()
    await expect(dialog.getByTestId('wiki-share-expiry')).toContainText('2026')
  })

  test('재발급·해제는 확인을 받는다', async ({ authenticatedPage: page }) => {
    const server = newServer({ share: existingShare() })
    await mockOwnerShare(page, server)
    const regen = trackRequests(page, 'POST', `/api/v1/wiki/pages/${PAGE}/share/regenerate`)
    const del = trackRequests(page, 'DELETE', `/api/v1/wiki/pages/${PAGE}/share`)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    await page.getByTestId('wiki-share-button').click()
    const dialog = dialogOf(page)
    const origin = new URL(page.url()).origin
    await expect(dialog.getByTestId('wiki-share-url')).toHaveValue(`${origin}/wiki/share/${tokenOf(1)}`)

    // 재발급 — 취소하면 보내지 않고, 확인하면 새 링크로 바뀐다.
    await dialog.getByTestId('wiki-share-regenerate').click()
    const confirm = page.getByTestId('wiki-share-confirm')
    await expect(confirm).toContainText('링크를 다시 만들까요?')
    await confirm.getByRole('button', { name: '취소' }).click()
    await expectStays(page, regen.count, 0)
    await dialog.getByTestId('wiki-share-regenerate').click()
    await confirm.getByRole('button', { name: '다시 만들기' }).click()
    await regen.waitFor()
    await expect(dialog.getByTestId('wiki-share-url')).toHaveValue(`${origin}/wiki/share/${tokenOf(2)}`)

    // 해제 — 확인해야 DELETE 가 나가고, 끝나면 공유 전 화면으로 돌아간다.
    await dialog.getByTestId('wiki-share-switch').click()
    await expect(confirm).toContainText('공유를 해제할까요?')
    await expectStays(page, del.count, 0)
    await confirm.getByRole('button', { name: '해제' }).click()
    await del.waitFor()
    await expect(dialog.getByTestId('wiki-share-url')).toHaveCount(0)
    await dialog.getByRole('button', { name: '완료' }).click()
    await expect(page.getByTestId('wiki-share-button')).toHaveText('공유')
    await expect(page.getByTestId(`wiki-tree-shared-${PAGE}`)).toHaveCount(0)
  })

  test('접근 요청을 승인하면 승인 API 를 부른다', async ({ authenticatedPage: page }) => {
    const server = newServer({
      share: existingShare({ audience: 'PEOPLE' }),
      accessRequests: [
        { id: 41, requester: { userId: 9, name: '최요청' }, requestedAt: '2026-10-20T02:00:00Z' },
        { id: 42, requester: { userId: 10, name: '정거절' }, requestedAt: '2026-10-20T03:00:00Z' },
      ],
    })
    await mockOwnerShare(page, server)
    const approve = trackRequests(page, 'POST', `/api/v1/wiki/pages/${PAGE}/share/access-requests/41/approve`)
    const deny = trackRequests(page, 'POST', `/api/v1/wiki/pages/${PAGE}/share/access-requests/42/deny`)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    await page.getByTestId('wiki-share-button').click()
    const requests = page.getByTestId('wiki-share-requests')
    await expect(requests).toContainText('접근 요청 2건')
    await requests.locator('li', { hasText: '최요청' }).getByRole('button', { name: '승인' }).click()
    await approve.waitFor()
    // 처리된 요청은 목록에서 사라진다(서버가 치운 뒤 다시 받는다).
    await expect(requests).toContainText('접근 요청 1건')
    await expect(requests).not.toContainText('최요청')

    await requests.locator('li', { hasText: '정거절' }).getByRole('button', { name: '거절' }).click()
    await deny.waitFor()
    await expect(requests).toHaveCount(0)
  })

  test('읽기 전용(VIEWER)에게는 공유 버튼이 없고 공유 상태도 조회하지 않는다', async ({ authenticatedPage: page }) => {
    const server = newServer({ share: existingShare() })
    await mockOwnerShare(page, server, 'VIEWER')
    const reads = trackRequests(page, 'GET', `/api/v1/wiki/pages/${PAGE}/share`)
    const events = trackRequests(page, 'GET', `/api/v1/wiki/pages/${PAGE}/share/events`)

    // ?share=1 로 들어와도(접근 요청 알림 링크) 창이 열리지 않는다.
    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}?share=1`)
    await expect(page.getByTestId('wiki-page-menu')).toBeVisible()
    await expect(page.getByTestId('wiki-share-button')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // 남은 ?share=1 표시는 지운다(편집자가 창을 닫을 때 지우는 것과 같게).
    await expect(page).not.toHaveURL(/share=1/)
    // 트리의 공유 표시는 읽기 전용에게도 보인다(트리 응답이 싣는 요약일 뿐 토큰은 없다).
    await expect(page.getByTestId(`wiki-tree-shared-${PAGE}`)).toBeVisible()
    // 조회가 안 나갔다는 부재 확인 — 에디터 로딩이 끝난 뒤(메뉴가 보인 뒤)에도 0건이어야 한다.
    await expectStays(page, reads.count, 0)
    await expectStays(page, events.count, 0)
  })

  test('스페이스 메뉴의 공유 중인 페이지 목록은 토큰이 있는 줄만 링크를 복사한다', async ({ authenticatedPage: page }) => {
    const server = newServer({ share: existingShare() })
    await mockOwnerShare(page, server)
    const base: WikiSharedPageItem = {
      pageId: PAGE,
      title: TITLE,
      audience: 'WORKSPACE',
      permission: 'VIEW',
      includeChildren: true,
      peopleCount: 0,
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

test.describe('노트 공유 — 이동 경고', () => {
  /** 두 점 사이를 dnd-kit PointerSensor 가 활성화되도록 단계적으로 끈다(wiki-dnd.spec 와 같은 방식). */
  async function dragRowTo(page: Page, sourceName: string, targetName: string, dx = 0) {
    // 행 버튼의 접근 가능한 이름에는 공유 표시(「상위 페이지 공유에 포함됨」)가 덧붙으므로 제목으로 시작하는 것을 찾는다.
    const source = page.getByRole('button', { name: new RegExp(`^${sourceName}`) })
    const target = page.getByRole('button', { name: new RegExp(`^${targetName}`) })
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

  test('공유 중 표식과 AI 생성 표식이 함께 보이고 가로로 넘치지 않는다', async ({ authenticatedPage: page }) => {
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

  test('휴대폰 ⋯ 메뉴로 공유 창을 연다', async ({ authenticatedPage: page }) => {
    const server = newServer({ share: existingShare() })
    await mockOwnerShare(page, server)

    await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE}`)
    await expect(page.getByTestId('mobile-shell')).toHaveCount(1)
    // 폭이 좁아 헤더 버튼 대신 제목 옆 「공유 중」 표시와 ⋯ 메뉴 항목을 쓴다.
    await expect(page.getByTestId('wiki-share-button')).toHaveCount(0)
    await expect(page.getByTestId('wiki-page-shared-badge')).toBeVisible()
    await page.getByTestId('wiki-page-menu').click()
    await page.getByTestId('wiki-menu-share').click()
    await expect(dialogOf(page)).toBeVisible()
    await expect(dialogOf(page).getByTestId('wiki-share-url')).toHaveValue(
      `${new URL(page.url()).origin}/wiki/share/${tokenOf(1)}`,
    )
  })
})
