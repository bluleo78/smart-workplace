// 서버 메일함(보관·내 메일함) E2E(WP-961) — 사이드바 트리·접기, 메일함 열기(목록 folderId·가져오기 POST·상태 줄), 더 가져오기, 모두 읽음 범위.
import type { Page, Route } from '@playwright/test'

import type { MailFolderSyncResult, MailServerFolder } from '../../../src/types/mailFolder'
import type { MailUnreadCounts } from '../../../src/types/mailMessage'
import { mailAccount, mailServerFolder, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const COUNTS: MailUnreadCounts = {
  classificationActive: true,
  inbox: 4,
  byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 },
  needsReply: 0,
}

// 가져온 시각을 지금 기준으로 둬 상대시각이 「방금 전」 근처로 나온다. 기간은 90일.
const DAY = 86_400_000
const syncedAt = () => new Date().toISOString()
const since = (days: number) => new Date(Date.now() - days * DAY).toISOString()

/** 보관(안 읽은 2) + 프로젝트(3) › 견적(0) + 개인 보관(1) + 묶음(열 수 없음) › 하위. */
function folderList(over: Partial<Record<number, Partial<MailServerFolder>>> = {}): MailServerFolder[] {
  return [
    mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 2, ...over[1] }),
    mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 3, ...over[5] }),
    mailServerFolder({ id: 6, displayName: '견적', parentId: 5, unreadCount: 0, ...over[6] }),
    mailServerFolder({ id: 7, displayName: '아주 긴 이름의 개인 보관 메일함 — 사이드바 폭을 넘는 이름', unreadCount: 1, ...over[7] }),
    mailServerFolder({ id: 8, displayName: '묶음', selectable: false, unreadCount: null, ...over[8] }),
    mailServerFolder({ id: 9, displayName: '묶음 하위', parentId: 8, unreadCount: 0, ...over[9] }),
  ]
}

/** 계정·안 읽은 수·목록 + 메일함 목록(가변) 모킹. 목록 요청은 capture 로 돌려준다. */
async function stub(page: Page, folders: () => MailServerFolder[]) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/unread-counts', COUNTS)
  await page.route(
    (u) => u.pathname === '/api/v1/mail/accounts/1/folders',
    (r) => r.fulfill({ json: folders() }),
  )
  return mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [
    // AI 분류·답장필요가 붙은 메일 — 서버 메일함 보기에선 배지가 보이면 안 된다.
    summary({ id: 10, aiCategory: '업무', aiNeedsReply: true, seen: false, categoryPending: true }),
  ], { capture: true })
}

const syncResult = (over: Partial<MailFolderSyncResult> = {}): MailFolderSyncResult => ({
  running: false, fetched: 3, saved: 3, seenChanged: 0, removed: 0, syncedSince: since(90), folderSyncedAt: syncedAt(), ...over,
})

test.describe('메일 사이드바 — 보관·내 메일함(WP-961)', () => {
  test('보관은 기본 메일함 줄, 내 메일함은 계층 트리(들여쓰기·pill·묶음 노드), 접힘은 새로 고침 뒤에도 유지', async ({ authenticatedPage: page }) => {
    await stub(page, () => folderList())
    await page.goto('/mail/1')
    const sidebar = page.getByTestId('mail-sidebar')

    // 보관 — 기본 nav 안, 서버 이름(Archive) 대신 「보관」, 안 읽은 수 2.
    const archive = page.getByTestId('mail-folder-toggle').getByTestId('mail-folder-archive')
    await expect(archive).toContainText('보관')
    await expect(archive).toHaveAttribute('href', '/mail/1?box=1')
    await expect(page.getByTestId('mail-count-archive')).toHaveText('2')

    // 내 메일함 — 구역 제목 + 트리. 보관은 트리에 다시 나오지 않는다.
    await expect(sidebar.getByText('내 메일함', { exact: true })).toBeVisible()
    const tree = page.getByTestId('mail-user-folders')
    await expect(tree.getByTestId('mail-box-1')).toHaveCount(0)
    await expect(page.getByTestId('mail-count-box-5')).toHaveText('3')
    await expect(page.getByTestId('mail-count-box-6')).toHaveCount(0) // 0 은 숨김
    // 하위(견적)는 부모(프로젝트)보다 더 들여 쓴다.
    const leftOf = async (id: number) => (await page.getByTestId(`mail-box-${id}`).boundingBox())!.x
    expect(await leftOf(6)).toBeGreaterThan(await leftOf(5))
    // 긴 이름은 말줄임 + title 로 전체 이름, 행이 사이드바 밖으로 넘치지 않는다.
    const long = page.getByTestId('mail-box-7')
    await expect(long).toHaveAttribute('title', /사이드바 폭을 넘는 이름/)
    const sb = (await sidebar.boundingBox())!
    const lb = (await long.boundingBox())!
    expect(lb.x + lb.width).toBeLessThanOrEqual(sb.x + sb.width)
    // 묶음(selectable=false)은 링크가 아니라 펼치기 버튼.
    const group = page.getByTestId('mail-box-8')
    await expect(group).toHaveJSProperty('tagName', 'BUTTON')
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await group.click()
    await expect(group).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('mail-box-9')).toHaveCount(0)
    await expect(page).toHaveURL(/\/mail\/1$/) // 묶음을 눌러도 이동하지 않는다

    // ▾ 로 프로젝트 접기 → 견적 숨김. 새로 고침 뒤에도 접힌 채(계정별 저장).
    const toggle = page.getByTestId('mail-box-toggle-5')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('mail-box-6')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('mail-box-toggle-5')).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByTestId('mail-box-6')).toHaveCount(0)
    await page.getByTestId('mail-box-toggle-5').click()
    await expect(page.getByTestId('mail-box-6')).toBeVisible()
  })

  test('사용자 메일함이 없으면 구역을 숨기고, 보관도 없으면 보관 줄도 없다', async ({ authenticatedPage: page }) => {
    const folders = trackRequests(page, 'GET', '/api/v1/mail/accounts/1/folders')
    await stub(page, () => [])
    await page.goto('/mail/1')
    await folders.waitFor()
    await expect(page.getByTestId('mail-folder-sent')).toBeVisible()
    await expect(page.getByTestId('mail-folder-archive')).toHaveCount(0)
    await expect(page.getByTestId('mail-user-folders')).toHaveCount(0)
    await expect(page.getByTestId('mail-sidebar').getByText('내 메일함', { exact: true })).toHaveCount(0)
  })

  test('접힌 부모 안의 메일함을 주소로 열면 부모를 펼쳐 활성 행을 보인다', async ({ authenticatedPage: page }) => {
    await stub(page, () => folderList({ 6: { folderSyncedAt: syncedAt(), syncedSince: since(90) } }))
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/folders/6/sync', (r) => r.fulfill({ json: syncResult() }))
    await page.addInitScript(() => localStorage.setItem('mail-folder-collapsed:1', '[5]'))
    await page.goto('/mail/1?box=6')
    await expect(page.getByTestId('mail-box-toggle-5')).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByTestId('mail-box-6')).toHaveAttribute('aria-current', 'page')
  })
})

test.describe('서버 메일함 보기(WP-961)', () => {
  test('메일함 클릭 → 목록은 folderId 로(분류 없이), 열 때 가져오기(older=false), 상태 줄·제목·배지', async ({ authenticatedPage: page }) => {
    // 처음엔 아직 안 가져온 메일함 — 가져오기가 끝나면 서버 목록이 가져온 시각·기간을 준다.
    let synced = false
    const list = await stub(page, () =>
      folderList(synced ? { 6: { folderSyncedAt: syncedAt(), syncedSince: since(90) } } : {}),
    )
    const syncs = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/folders/6/sync')
    // 가져오기 응답을 붙잡아 「가져오는 중」을 확인한 뒤 풀어 준다.
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/folders/6/sync', async (r: Route) => {
      const older = new URL(r.request().url()).searchParams.get('older') === 'true'
      if (!older) await held
      synced = true
      await r.fulfill({ json: syncResult(older ? { saved: 4, syncedSince: since(180) } : {}) })
    })

    await page.goto('/mail/1')
    await page.getByTestId('mail-box-6').click()
    await expect(page).toHaveURL(/\/mail\/1\?box=6$/)
    await expect(page.getByTestId('mail-box-6')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('mail-filter-category-업무')).not.toHaveAttribute('aria-current', 'page')

    // 목록 요청 — folderId=6, 분류·회신필요·folder 파라미터 없음.
    await expect.poll(() => list.lastRequest()?.searchParams.get('folderId')).toBe('6')
    const q = list.lastRequest()!.searchParams
    expect(q.has('category')).toBe(false)
    expect(q.has('needsReply')).toBe(false)
    expect(q.has('folder')).toBe(false)

    // 열자마자 한 번 가져온다(older=false 명시). 끝나기 전엔 「가져오는 중」.
    await syncs.waitFor()
    expect(syncs.lastUrl()!.searchParams.get('older')).toBe('false')
    await expect(page.getByTestId('mail-box-status-text')).toHaveText('메일함을 가져오는 중…')
    const listCalls = list.requests.length
    release()
    await expect(page.getByTestId('mail-box-status-text')).toHaveText(/^최근 90일 · .+에 가져옴$/)
    // 끝나면 목록을 다시 받는다. 자동 가져오기는 한 번뿐.
    await expect.poll(() => list.requests.length).toBeGreaterThan(listCalls)
    expect(syncs.count()).toBe(1)

    // 헤더 경로·탭 제목, AI 배지 없음, 동기화(계정) 버튼 대신 메일함 새로 고침.
    // 경로는 최상위 메일함부터 — 사이드바 구역 이름 「내 메일함」은 넣지 않는다(WP-979 §B-1).
    // 보이는 줄(첫 ol)만 본다 — 같은 nav 안의 접기 판정용 측정 사본(숨김)이 글자를 한 벌 더 갖는다.
    await expect(page.getByTestId('mail-breadcrumb').locator('ol').first()).toHaveText(/^프로젝트\s*견적$/)
    await expect(page.getByTestId('page-header').locator('h1')).toHaveText('견적')
    await expect(page).toHaveTitle(/^견적 · 메일/)
    await expect(page.getByTestId('mail-row-10')).toBeVisible()
    await expect(page.getByTestId('mail-badge-category-10')).toHaveCount(0)
    await expect(page.getByTestId('mail-badge-needsreply-10')).toHaveCount(0)
    await expect(page.getByTestId('mail-badge-pending-10')).toHaveCount(0)
    await expect(page.getByTestId('mail-sync')).toHaveCount(0)
    await expect(page.getByTestId('mail-unread-toggle')).toBeVisible()

    // 새로 고침 → older=false 로 다시.
    await page.getByTestId('mail-box-refresh').click()
    await syncs.waitFor(2)
    expect(syncs.lastUrl()!.searchParams.get('older')).toBe('false')

    // 더 가져오기 → older=true, 결과 토스트, 기간이 180일로.
    await page.getByTestId('mail-box-older').click()
    await syncs.waitFor(3)
    expect(syncs.lastUrl()!.searchParams.get('older')).toBe('true')
    await expect(page.getByText('이전 메일 4통을 더 가져왔어요')).toBeVisible()

    // 안 읽은 메일만 토글도 folderId 를 유지한다.
    await page.getByTestId('mail-unread-toggle').click()
    await expect(page).toHaveURL(/box=6&unread=true|unread=true&box=6/)
    await expect.poll(() => list.lastRequest()?.searchParams.get('unread')).toBe('true')
    expect(list.lastRequest()!.searchParams.get('folderId')).toBe('6')

    // 행을 열어도 메일함 보기 그대로(?box 유지).
    await page.getByTestId('mail-row-10').click()
    await expect(page).toHaveURL(/box=6/)
    await expect(page).toHaveURL(/messageId=10/)
  })

  test('보관을 열면 제목 「보관」, 가져오기 POST 는 보관 id 로', async ({ authenticatedPage: page }) => {
    const list = await stub(page, () => folderList())
    const syncs = trackRequests(page, 'POST', '/api/v1/mail/accounts/1/folders/1/sync')
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/folders/1/sync', (r) => r.fulfill({ json: syncResult() }))
    await page.goto('/mail/1')
    await page.getByTestId('mail-folder-archive').click()
    await expect(page.getByTestId('mail-folder-archive')).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('page-header').locator('h1')).toHaveText('보관')
    await expect.poll(() => list.lastRequest()?.searchParams.get('folderId')).toBe('1')
    await syncs.waitFor()
    expect(syncs.lastUrl()!.searchParams.get('older')).toBe('false')
    // 다른 보기로 갔다가 다시 열면 또 가져온다(열 때마다).
    await page.getByTestId('mail-folder-inbox').click()
    await expect(page.getByTestId('mail-folder-inbox')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('mail-folder-archive').click()
    await syncs.waitFor(2)
  })

  test('목록에 없는 메일함 id 는 「찾을 수 없어요」, 가져오기를 보내지 않는다', async ({ authenticatedPage: page }) => {
    await stub(page, () => folderList())
    const syncs = trackRequests(page, 'POST', /\/folders\/\d+\/sync$/)
    await page.goto('/mail/1?box=404')
    await expect(page.getByTestId('mail-box-status-text')).toHaveText('메일함을 찾을 수 없어요')
    await expect(page.getByTestId('mail-box-older')).toBeDisabled()
    expect(syncs.count()).toBe(0)
  })

  test('모두 읽음 — 건수 조회·실행 모두 folderId 범위(분류 없음)', async ({ authenticatedPage: page }) => {
    const AS_OF = '2026-10-25T01:00:00.123456Z'
    await stub(page, () => folderList({ 5: { folderSyncedAt: syncedAt(), syncedSince: since(90) } }))
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/folders/5/sync', (r) => r.fulfill({ json: syncResult() }))
    const count = await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages/unread-count', { count: 3, asOf: AS_OF }, { capture: true })
    const run = await mockApi(page, 'POST', '/api/v1/mail/accounts/1/messages/mark-all-read', { updated: 3 }, { capture: true })
    await page.goto('/mail/1?box=5')
    // 이 메일함 안 읽은 수(3)가 있어 버튼이 켜져 있다.
    await expect(page.getByTestId('mail-mark-all-read')).toBeEnabled()
    await page.getByTestId('mail-mark-all-read').click()
    const countReq = await count.waitForRequest()
    expect(countReq.searchParams.get('folderId')).toBe('5')
    expect(countReq.searchParams.has('category')).toBe(false)
    const dlg = page.getByTestId('mail-mark-all-dialog')
    await expect(dlg).toContainText('프로젝트')
    await expect(dlg).not.toContainText('내 메일함')
    await expect(dlg).toContainText('3통')
    await page.getByTestId('mail-mark-all-confirm').click()
    const req = await run.waitForRequest()
    // 메일함은 쿼리 파라미터(백엔드 @RequestParam), 본문은 기존 모양 + asOf 그대로.
    expect(req.searchParams.get('folderId')).toBe('5')
    expect(req.payload).toEqual({ category: null, needsReply: false, query: null, asOf: AS_OF })
    await expect(page.getByText('3통 읽음 처리')).toBeVisible()
  })

  test('메일함 안 읽은 수가 0 이면 모두 읽음이 꺼지고, 가져오기 실패는 토스트', async ({ authenticatedPage: page }) => {
    await stub(page, () => folderList())
    await page.route((u) => u.pathname === '/api/v1/mail/accounts/1/folders/6/sync', (r) =>
      r.fulfill({ status: 502, json: { status: 502, message: '메일 서버에 연결하지 못했습니다' } }),
    )
    await page.goto('/mail/1?box=6')
    await expect(page.getByText('메일 서버에 연결하지 못했습니다')).toBeVisible()
    await expect(page.getByTestId('mail-box-status-text')).toHaveText('아직 가져오지 않았어요')
    await expect(page.getByTestId('mail-mark-all-read')).toBeDisabled()
  })
})
