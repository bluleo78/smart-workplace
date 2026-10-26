// 노트 공유 링크 받는 쪽(WP-579) — /wiki/share/:token 으로 연 화면이 공유 토큰을 헤더(API)·쿼리(동기화 서버)로 싣고,
// 보기·편집·해제·다른 워크스페이스·지정한 사람 아님·로그인 복귀·알림 진입(/wiki/open/:pageId)을 실제 배선으로 확인한다.
// 동기화 서버는 테스트 모드(playwright.config webServer) — 시드 shares 로 공유 역할을 주고, revoke-share + 재검증으로 해제를 재현한다.
// 외부 보기 전환(409)·5xx 다시 시도·접근 요청·알림 입구의 404/500/멤버 이동은 src/pages/wiki/wikiShare.test.tsx·wikiPage.test.tsx 가,
// 휴대폰 선택 상자는 wikiMobile.test.tsx 가 지킨다(WP-983).
import type { Page, Request } from '@playwright/test'

import type { WikiMentionRef, WikiPageEntry, WikiShareResolved } from '../../../src/types/wiki'
import { createLoginResponse, createMembership, createTokenResponse } from '../../factories/auth.factory'
import { wikiPageDetail, wikiPageSummary } from '../../factories/wiki.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { type CollabShareRole, collabNsOf, revokeCollabShare, seedCollabDoc, typeAtEnd } from '../../fixtures/collab'
import { solidPng } from '../../fixtures/png'
import { trackRequests } from '../../fixtures/requests'
import { savedMarkdown } from '../../fixtures/wiki-mock'

// 동기화 서버가 받는 토큰 모양(^[A-Za-z0-9_-]{1,128}$)에 맞춘다 — 어긋나면 API 를 묻지도 않고 거부한다.
const TOKEN = 'wsh_e2eShare1'
const SHARE_HEADER = 'x-wiki-share-token' // Playwright 는 헤더 이름을 소문자로 준다
const SPACE_ID = 9
const ROOT = 31
const CHILD = 32
const IMAGE_PATH = `/api/v1/wiki/pages/${ROOT}/attachments/7/content`
// 사람 멘션(볼 수 있음)·이슈 멘션(볼 수 없음)·이미지를 함께 둔다 — 셋 다 공유 토큰을 실어 읽어야 한다.
const ROOT_BODY = `공유된 본문입니다\n\n담당 <@2> 관련 <#issue:77>\n\n![그림](${IMAGE_PATH})`
const CHILD_BODY = '하위 페이지 본문'
const PAGES = [
  wikiPageSummary({ id: ROOT, title: '제품 로드맵', position: 0 }),
  wikiPageSummary({ id: CHILD, parentId: ROOT, title: '하반기 계획', position: 0 }),
]
const MENTIONS: WikiMentionRef[] = [
  { type: 'USER', id: 2, label: '김민지', spaceId: null, projectKey: null, number: null, inaccessible: false },
  // 이동할 주소(projectKey·number)가 있어도 볼 수 없는 칩은 이동하지 않아야 한다 — 실서버는 싣지 않지만 칩 판정만으로 막는지 본다.
  { type: 'ISSUE', id: 77, label: null, spaceId: null, projectKey: 'WP', number: 12, inaccessible: true },
]

const resolved = (over: Partial<WikiShareResolved> = {}): WikiShareResolved => ({
  rootPageId: ROOT,
  spaceId: SPACE_ID,
  permission: 'VIEW',
  includeChildren: true,
  sharedBy: { userId: 2, name: '김민지' },
  member: false,
  pages: PAGES,
  ...over,
})

/** 동기화 문서를 공유로만 들어오게 심는다 — 기본 사용자(uid 1)는 멤버가 아니고(NONE), 토큰이 역할을 준다. */
async function seedShared(page: Page, pageId: number, body: string, shareRole: CollabShareRole) {
  await seedCollabDoc(collabNsOf(page), pageId, body, 'NONE', undefined, { [TOKEN]: shareRole })
}

/**
 * 받는 사람 쪽 API — 링크 열기(resolve)·페이지 상세·멘션·이미지·제목 저장. 링크 열기 응답은 resolveBody() 로 매번 다시 정한다
 * (전환 뒤 200 으로 바뀌는 시나리오용). 페이지 GET 은 라우트 핸들러가 받은 헤더를 모아 돌려준다(brief: route.request().headers()).
 */
async function mockShareViewer(
  page: Page,
  resolve: () => { status: number; body: unknown } = () => ({ status: 200, body: resolved() }),
) {
  // 받는 사람 자신의 스페이스(공유한 스페이스 9 는 없다) — 에디터가 역할 판정에 쓰는 목록.
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.fulfill({ json: [{ id: 5, type: 'PERSONAL', name: '내 노트', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }] }))
  await page.route((u) => u.pathname === `/api/v1/wiki/shares/${TOKEN}`, (r) => {
    const { status, body } = resolve()
    return r.fulfill({ status, json: body })
  })
  const pageGetHeaders: Record<string, string>[] = []
  await page.route((u) => /^\/api\/v1\/wiki\/pages\/\d+$/.test(u.pathname), (r) => {
    const id = Number(new URL(r.request().url()).pathname.split('/').pop())
    const detail = wikiPageDetail({ id, spaceId: SPACE_ID, parentId: id === CHILD ? ROOT : null, title: PAGES.find((p) => p.id === id)?.title ?? '', body: id === ROOT ? ROOT_BODY : CHILD_BODY })
    if (r.request().method() === 'GET') {
      pageGetHeaders.push(r.request().headers())
      return r.fulfill({ json: detail })
    }
    if (r.request().method() === 'PUT') return r.fulfill({ json: { ...detail, ...(r.request().postDataJSON() as object), version: 2 } })
    return r.fallback()
  })
  await page.route((u) => /^\/api\/v1\/wiki\/pages\/\d+\/mentions$/.test(u.pathname), (r) => r.fulfill({ json: MENTIONS }))
  await page.route((u) => u.pathname === IMAGE_PATH, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: solidPng(1, 1) }))
  return { pageGetHeaders }
}

const tokenOf = (req: Request) => req.headers()[SHARE_HEADER]

test.describe('노트 공유 링크 — 받는 사람', () => {
  test('받는 사람이 보기 전용으로 연다', { tag: ['@platform', '@smoke'] }, async ({ authenticatedPage: page }) => {
    await seedShared(page, ROOT, ROOT_BODY, 'VIEWER')
    const { pageGetHeaders } = await mockShareViewer(page)
    const mentions = trackRequests(page, 'GET', `/api/v1/wiki/pages/${ROOT}/mentions`)
    const image = trackRequests(page, 'GET', IMAGE_PATH)
    // 동기화 서버 접속 주소 — 공유 토큰을 share 쿼리로 싣는다.
    const sockets: string[] = []
    page.on('websocket', (ws) => sockets.push(ws.url()))

    await page.goto(`/wiki/share/${TOKEN}`)
    await expect(page.locator('.ProseMirror')).toContainText('공유된 본문입니다')
    await expect(page.getByTestId('wiki-page-shared-by')).toHaveText('김민지님이 공유')
    // 보기 전용 — 본문·제목을 고칠 수 없다.
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
    await expect(page.getByPlaceholder('제목 없음')).toHaveAttribute('readonly', '')
    // 하위 포함 공유 — 공유된 페이지 트리만 보인다.
    await expect(page.getByTestId('wiki-share-tree')).toContainText('하반기 계획')

    // 페이지·멘션·이미지 요청 모두 공유 토큰 헤더를 싣는다.
    expect(pageGetHeaders.at(-1)?.[SHARE_HEADER]).toBe(TOKEN)
    await mentions.waitFor()
    expect(tokenOf(mentions.requests()[0])).toBe(TOKEN)
    await expect(page.getByTestId('wiki-image')).toBeVisible()
    // 이미지는 앱이 인증 헤더를 실어 blob 으로 받는다 — 그 요청은 모두 공유 토큰을 싣는다.
    // (에디터가 마크다운을 DOM 으로 풀 때 브라우저가 헤더 없이 한 번 더 부르는 <img> 요청은 앱 요청이 아니라 뺀다.)
    const appImageRequests = image.requests().filter((r) => r.headers()['authorization'])
    expect(appImageRequests.length).toBeGreaterThan(0)
    expect(appImageRequests.map(tokenOf)).toEqual(appImageRequests.map(() => TOKEN))
    expect(sockets.some((u) => new URL(u).searchParams.get('share') === TOKEN)).toBe(true)

    // 볼 수 없는 대상(이슈) 멘션은 링크 없는 「접근 권한 없음」 칩, 볼 수 있는 사람 멘션은 이름 그대로.
    const hidden = page.locator('[data-mtype="ISSUE"][data-id="77"]')
    await expect(hidden).toHaveText('접근 권한 없음')
    await expect(hidden).toHaveAttribute('data-inaccessible', 'true')
    await expect(page.locator('[data-mtype="USER"][data-id="2"]')).toHaveText('@김민지')
    await hidden.click()

    // 트리로 하위 페이지로 옮겨도 공유 주소 안에서 연다.
    await seedShared(page, CHILD, CHILD_BODY, 'VIEWER')
    await page.getByTestId('wiki-share-tree').getByRole('button', { name: '하반기 계획' }).click()
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}/pages/${CHILD}$`))
    await expect(page.locator('.ProseMirror')).toContainText(CHILD_BODY)
    // 칩을 누른 뒤의 기록 — 칩이 이슈로 이동했다면(클릭 핸들러의 navigate 는 바로 기록에 쌓인다) 한 칸 뒤가 이슈 주소다.
    // 트리 이동이라는 확정 신호 뒤에 되돌아가 보면, 칩 클릭은 기록을 남기지 않았어야 한다.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}$`))
  })

  test('편집 가능 공유는 본문을 고치면 동기화 문서에 반영된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await seedShared(page, ROOT, ROOT_BODY, 'EDITOR')
    await mockShareViewer(page, () => ({ status: 200, body: resolved({ permission: 'EDIT' }) }))
    const titlePuts = trackRequests(page, 'PUT', `/api/v1/wiki/pages/${ROOT}`)

    await page.goto(`/wiki/share/${TOKEN}`)
    await expect(page.getByTestId('wiki-page-shared-by')).toHaveText('김민지님이 공유 · 편집 가능')
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true')
    await typeAtEnd(page, '공유된 본문입니다', ' 추가함')
    await expect.poll(() => savedMarkdown(page, ROOT)).toContain('공유된 본문입니다 추가함')

    // 제목은 REST 로 저장한다 — 공유 토큰 헤더를 싣고 제목만 보낸다.
    await page.getByPlaceholder('제목 없음').fill('제품 로드맵 v2')
    await titlePuts.waitFor()
    expect(titlePuts.lastBody()).toEqual({ title: '제품 로드맵 v2', body: null })
    expect(tokenOf(titlePuts.requests()[0])).toBe(TOKEN)
    // 공유된 페이지 트리(링크 열기 결과)도 새 제목으로 바뀐다.
    await expect(page.getByTestId('wiki-share-tree').getByRole('button', { name: '제품 로드맵 v2' })).toBeVisible()

    // 공유 화면엔 AI·이슈 만들기가 없다(설계 「하지 않는 것」) — 서식만 남는다.
    // 슬래시 메뉴: 서식·삽입 항목은 있고 AI 항목(초안·이어쓰기)은 없다.
    await typeAtEnd(page, '공유된 본문입니다 추가함', '')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await expect(page.getByTestId('wiki-slash-popover')).toBeVisible()
    await expect(page.getByTestId('wiki-slash-option-heading2')).toBeVisible()
    await expect(page.getByTestId('wiki-slash-option-draft')).toHaveCount(0)
    await expect(page.getByTestId('wiki-slash-option-continue')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // 글을 고르면 서식 툴바는 뜨지만 AI 변형·「이슈로 만들기」는 없다.
    await page.locator('.ProseMirror p', { hasText: '공유된 본문입니다 추가함' }).evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      el.dispatchEvent(new Event('mouseup', { bubbles: true }))
    })
    const toolbar = page.getByTestId('wiki-ai-toolbar')
    await expect(toolbar.getByTestId('wiki-format-tb-bold')).toBeVisible()
    await expect(toolbar.getByTestId('wiki-ai-tb-polish')).toHaveCount(0)
    await expect(toolbar.getByTestId('wiki-ai-tb-create-issue')).toHaveCount(0)
  })

  test('편집 공유로 연 빈 페이지에도 AI 초안 안내가 없다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await seedShared(page, CHILD, '', 'EDITOR')
    await mockShareViewer(page, () => ({ status: 200, body: resolved({ permission: 'EDIT' }) }))

    await page.goto(`/wiki/share/${TOKEN}/pages/${CHILD}`)
    await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByTestId('wiki-page-shared-by')).toHaveText('김민지님이 공유 · 편집 가능')
    // 같은 조건의 멤버 화면이면 빈 페이지 AI 초안 안내가 뜬다 — 공유 화면은 AI 를 쓰지 않는다.
    await expect(page.getByTestId('wiki-ai-empty-cta')).toHaveCount(0)
    // 빈 본문 안내 문구에도 AI 언급이 없다 — 슬래시 메뉴엔 AI 항목이 없으므로 블록 추가로 안내한다.
    await expect(page.locator('.ProseMirror p.is-empty').first()).toHaveAttribute(
      'data-placeholder',
      "내용을 입력하거나 '/' 를 눌러 블록 추가",
    )
  })

  test('해제되면 열린 화면이 닫히고 안내가 뜬다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await seedShared(page, ROOT, ROOT_BODY, 'VIEWER')
    await mockShareViewer(page)
    await page.goto(`/wiki/share/${TOKEN}`)
    await expect(page.locator('.ProseMirror')).toContainText('공유된 본문입니다')

    await revokeCollabShare(collabNsOf(page), ROOT, TOKEN)
    // 동기화 서버가 4403 으로 닫으면 화면을 닫는다 — 본문이 남아 계속 보이면 안 된다(안티 목표).
    await expect(page.getByTestId('wiki-share-unavailable')).toContainText('링크가 더 이상 열리지 않습니다')
    await expect(page.locator('.ProseMirror')).toHaveCount(0)
    await expect(page.getByText('공유된 본문입니다')).toHaveCount(0)

    // 같은 링크로 돌아와도(새로고침 없이 앱 안에서) 해제된 공유의 페이지 제목이 캐시에서 다시 그려지면 안 된다.
    // 링크 열기 응답을 붙잡아 두고, 다시 묻는 동안 트리가 없는지 본 뒤 해제(404) 응답을 놓아 준다.
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    await page.route((u) => u.pathname === `/api/v1/wiki/shares/${TOKEN}`, async (r) => {
      await held
      return r.fulfill({ status: 404, json: { status: 404, message: '링크를 찾을 수 없습니다' } })
    })
    const reopen = trackRequests(page, 'GET', `/api/v1/wiki/shares/${TOKEN}`)
    // 「노트로 가기」 → 내 노트(스페이스 5)가 실제로 그려질 때까지 기다린다 — 노트 화면이 아직 불러오는 중에 돌아가면
    // 라우터가 이동을 버리고 닫힌 화면을 그대로 둔다(다시 묻지 않는다).
    await page.route((u) => u.pathname === '/api/v1/wiki/spaces/5/pages', (r) => r.fulfill({ json: [] }))
    await page.getByRole('button', { name: '노트로 가기' }).click()
    await expect(page).toHaveURL(/\/wiki\/spaces\/5$/)
    await expect(page.getByTestId('wiki-share-unavailable')).toHaveCount(0)
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}$`))
    await reopen.waitFor()
    await expect(page.getByTestId('wiki-share-skeleton')).toBeVisible()
    await expect(page.getByTestId('wiki-share-tree')).toHaveCount(0)
    await expect(page.getByText('하반기 계획')).toHaveCount(0)
    release()
    await expect(page.getByTestId('wiki-share-unavailable')).toContainText('링크가 더 이상 열리지 않습니다')
  })

  test('다른 워크스페이스 링크는 전환 후 연다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const T1 = createMembership({ tenantId: 1, tenantName: 'A', tenantSlug: 'a' })
    const T2 = createMembership({ tenantId: 2, tenantName: 'B', tenantSlug: 'b' })
    // 처음 열 때만 워크스페이스 A 로 둔다 — 전환(selectTenant)이 일으키는 새로고침에서 다시 A 로 되돌리지 않게.
    await page.addInitScript((m) => {
      if (sessionStorage.getItem('e2e:tenantSeeded')) return
      sessionStorage.setItem('e2e:tenantSeeded', '1')
      localStorage.setItem('activeTenant', JSON.stringify(m))
    }, T1)
    await mockApi(page, 'GET', '/api/v1/auth/memberships', [T1, T2])
    // 전환(select-tenant) 전엔 다른 워크스페이스라 409, 전환 뒤 다시 열면 그 워크스페이스에서 열린다.
    let switched = false
    await page.route((u) => u.pathname === '/api/v1/auth/select-tenant', (r) => {
      switched = true
      return r.fulfill({ json: createTokenResponse() })
    })
    const selects = trackRequests(page, 'POST', '/api/v1/auth/select-tenant')
    await seedShared(page, CHILD, CHILD_BODY, 'VIEWER')
    await mockShareViewer(page, () =>
      switched
        ? { status: 200, body: resolved() }
        : { status: 409, body: { status: 409, error: 'Conflict', message: '다른 워크스페이스의 링크입니다', code: 'WIKI_SHARE_OTHER_TENANT', tenantId: 2 } },
    )

    await page.goto(`/wiki/share/${TOKEN}/pages/${CHILD}`)
    await selects.waitFor()
    expect(selects.lastBody()).toEqual({ tenantId: 2 })
    // 전환은 전체 새로고침 — 하위 페이지 주소를 그대로 다시 연다.
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}/pages/${CHILD}$`))
    await expect(page.locator('.ProseMirror')).toContainText(CHILD_BODY)
    // 새로고침 뒤 활성 워크스페이스는 B — 전환이 실제로 일어났다.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('activeTenant') ?? 'null')?.tenantId)).toBe(2)
    expect(selects.count()).toBe(1)
  })

  test('로그인 뒤 링크로 돌아온다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
    // 처음 열 때만 로그인하지 않은 상태 — 로그인 뒤엔 새로고침 없이 앱 안에서 이어 간다.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e:loggedOutOnce')) return
      sessionStorage.setItem('e2e:loggedOutOnce', '1')
      localStorage.removeItem('hasSession')
    })
    await mockApi(page, 'GET', '/api/v1/auth/signup-available', { available: true })
    await mockApi(page, 'GET', '/api/v1/auth/sso/status', { m365: false })
    await mockApi(page, 'POST', '/api/v1/auth/login', createLoginResponse())
    // 내부 링크를 로그인 없이 열면 서버는 401 {loginRequired} — 외부 보기 대신 로그인으로 보낸다.
    await page.route((u) => u.pathname === `/api/v1/public/wiki/shares/${TOKEN}`, (r) =>
      r.fulfill({ status: 401, json: { loginRequired: true } }))
    await seedShared(page, ROOT, ROOT_BODY, 'VIEWER')
    await mockShareViewer(page)

    await page.goto(`/wiki/share/${TOKEN}`)
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel('아이디').fill('user@example.com')
    await page.locator('#password').fill('Workplace1')
    await page.getByRole('button', { name: '로그인' }).click()

    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}$`))
    await expect(page.locator('.ProseMirror')).toContainText('공유된 본문입니다')
    expect(await page.evaluate(() => sessionStorage.getItem('pendingPushTarget'))).toBeNull()
  })
})

test.describe('노트 알림 진입 — /wiki/open/:pageId', () => {
  /** 알림이 가리키는 노트의 입구 판정(GET /wiki/pages/{id}/entry). */
  async function mockEntry(page: Page, pageId: number, entry: WikiPageEntry) {
    await page.route((u) => u.pathname === `/api/v1/wiki/pages/${pageId}/entry`, (r) => r.fulfill({ json: entry }))
  }

  test('공유 대상이면 지금 링크의 공유 화면으로 연다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
    await seedShared(page, CHILD, CHILD_BODY, 'VIEWER')
    await mockShareViewer(page)
    await mockEntry(page, CHILD, { spaceId: SPACE_ID, member: false, shareToken: TOKEN })
    await page.goto(`/wiki/open/${CHILD}`)
    await expect(page).toHaveURL(new RegExp(`/wiki/share/${TOKEN}/pages/${CHILD}$`))
    await expect(page.locator('.ProseMirror')).toContainText(CHILD_BODY)
  })
})
