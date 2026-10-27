// 메일 사이드바(계정 스위처·폴더·하위 분류·보관/내 메일함) + 서버 메일함 보기 + 목록 이어 보기 — 화면 테스트(WP-984, WP-995).
// 활성 항목(aria-current)·안 읽은 수·트리 접기·메일함 목록 folderId·가져오기 POST(older)·상태 줄·모두 읽음 범위·
// 서버 이전 메일 가져오기(짧은 목록)는 브라우저 없이 판정되므로 mail-sidebar.spec.ts·mail-folders.spec.ts·mail-older.spec.ts 에서 옮겼다.
// 남은 E2E: 선택 행의 계산된 배경(@layout), 트리 들여쓰기·긴 이름 넘침(@layout), 스크롤로 다음 페이지 잇기(@layout).
// 메일 모듈만 renderScreen 으로 띄운다(testkit-b4).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { MailFolderSyncResult, MailServerFolder } from '@/types/mailFolder'
import type { EmailMessageSummary, MailOlderResult } from '@/types/mailMessage'

import { mailAccount, mailServerFolder, summary } from '../../../e2e/factories/mail.factory'
import { record, renderMail, unreadCounts } from './testkit-b4'

const LIST = '/api/v1/mail/accounts/1/messages'
const OLDER = '/api/v1/mail/accounts/1/messages/older'

// 목록 끝 감시 줄 — 짧은 목록은 끝이 바로 보이는 것과 같게, 관찰을 시작하면 곧 「보인다」고 알린다.
// jsdom 은 레이아웃이 없어 기본 구현(setup.ts)은 아무것도 알리지 않는다. 긴 목록을 스크롤해 잇는 것은 E2E @layout 이 본다.
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private cb: IntersectionObserverCallback
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb
      }
      private timer: ReturnType<typeof setTimeout> | undefined
      observe(el: Element) {
        // 브라우저처럼 다음 프레임에 첫 교차를 알린다 — 그 전에 끊기면(disconnect) 알리지 않는다.
        this.timer = setTimeout(() => this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver), 16)
      }
      unobserve() {}
      disconnect() {
        clearTimeout(this.timer)
      }
      takeRecords() {
        return []
      }
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const COUNTS = unreadCounts({ inbox: 4, byCategory: { 업무: 2, 개인: 1, 알림: 1, 프로모션: 0, 뉴스레터: 0 } })
const countsHandler = (c = COUNTS) => http.get('/api/v1/mail/accounts/:id/unread-counts', () => HttpResponse.json(c))

// ── 계정 스위처·폴더(mail-sidebar.spec) ─────────────────────────────────────────────

test('계정 스위처로 다른 계정을 고르면 /mail/:id 로 가고 폴더는 받은편지함으로 돌아간다', async () => {
  const list1 = record('get', LIST, () => HttpResponse.json([]))
  const { user, location } = renderMail('/mail/2?folder=sent', {
    accounts: [mailAccount({ id: 1, emailAddress: 'me@example.com' }), mailAccount({ id: 2, emailAddress: 'work@example.com' })],
    handlers: [list1.handler],
  })
  expect(await screen.findByTestId('mail-account-switcher')).toHaveTextContent('work@example.com')
  await user.click(screen.getByTestId('mail-account-switcher'))
  await user.click(await screen.findByTestId('mail-account-1'))
  await waitFor(() => expect(location()).toBe('/mail/1'))
  expect(screen.getByTestId('mail-account-switcher')).toHaveTextContent('me@example.com')
  await waitFor(() => expect(list1.calls.length).toBeGreaterThan(0))
  expect(list1.calls.every((c) => c.url.searchParams.get('folder') !== 'SENT')).toBe(true)
})

test('보낸편지함에 들어가면 그 항목만 aria-current=page 와 선택 표시(bg-selected·막대)를 갖는다', async () => {
  renderMail('/mail/1?folder=sent')
  const sent = await screen.findByTestId('mail-folder-sent')
  await waitFor(() => expect(sent).toHaveAttribute('aria-current', 'page'))
  const inbox = screen.getByTestId('mail-folder-inbox')
  expect(inbox).not.toHaveAttribute('aria-current', 'page')
  expect(sent.className).toMatch(/bg-selected/)
  expect(sent.className).toMatch(/selection-bar/)
  expect(inbox.className).not.toMatch(/bg-selected/)
  expect(inbox.className).not.toMatch(/selection-bar/)
})

test('기본 진입은 업무가 활성이고 업무로 목록을 받으며, 받은편지함·하위 분류마다 안 읽은 수(0 은 숨김)를 보인다(WP-186)', async () => {
  const list = record('get', LIST, () => HttpResponse.json([]))
  renderMail('/mail/1', { handlers: [list.handler, countsHandler()] })
  await waitFor(() => expect(list.last()?.url.searchParams.get('category')).toBe('업무'))
  await waitFor(() => expect(screen.getByTestId('mail-filter-category-업무')).toHaveAttribute('aria-current', 'page'))
  expect(screen.getByTestId('mail-folder-inbox')).not.toHaveAttribute('aria-current', 'page')
  expect(await screen.findByTestId('mail-count-inbox')).toHaveTextContent('4')
  expect(screen.getByTestId('mail-count-category-업무')).toHaveTextContent('2')
  expect(screen.queryByTestId('mail-count-category-프로모션')).not.toBeInTheDocument()
  expect(within(screen.getByTestId('mail-sidebar')).queryByText('분류', { exact: true })).not.toBeInTheDocument()
})

test('받은편지함을 누르면 category=all 로 가고 활성, 목록 API 엔 category 를 싣지 않는다(WP-186)', async () => {
  const list = record('get', LIST, () => HttpResponse.json([]))
  const { user, location } = renderMail('/mail/1', { handlers: [list.handler, countsHandler()] })
  await user.click(await screen.findByTestId('mail-folder-inbox'))
  await waitFor(() => expect(location()).toBe('/mail/1?category=all'))
  await waitFor(() => expect(screen.getByTestId('mail-folder-inbox')).toHaveAttribute('aria-current', 'page'))
  await waitFor(() => expect(list.last().url.searchParams.has('category')).toBe(false))
})

test('AI 분류가 꺼지면 하위 분류를 숨기고 받은편지함이 활성(WP-186)', async () => {
  renderMail(`/mail/1?category=${encodeURIComponent('업무')}`, { handlers: [countsHandler({ ...COUNTS, classificationActive: false })] })
  await waitFor(() => expect(screen.getByTestId('mail-folder-inbox')).toHaveAttribute('aria-current', 'page'))
  expect(screen.queryByTestId('mail-filter-category-업무')).not.toBeInTheDocument()
})

// ── 보관·내 메일함(mail-folders.spec, WP-961) ─────────────────────────────────────────────

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

const syncResult = (over: Partial<MailFolderSyncResult> = {}): MailFolderSyncResult => ({
  running: false, fetched: 3, saved: 3, seenChanged: 0, removed: 0, syncedSince: since(90), folderSyncedAt: syncedAt(), ...over,
})

/** 메일함 목록(가변)·안 읽은 수·목록(AI 배지가 붙은 10) — 목록 요청은 기록한다. */
function folderHandlers(folders: () => MailServerFolder[]) {
  const list = record('get', LIST, () =>
    HttpResponse.json([summary({ id: 10, aiCategory: '업무', aiNeedsReply: true, seen: false, categoryPending: true })]),
  )
  return {
    list,
    handlers: [list.handler, countsHandler(), http.get('/api/v1/mail/accounts/1/folders', () => HttpResponse.json(folders()))],
  }
}

test('보관은 기본 메일함 줄(「보관」·?box=1·안 읽은 2), 내 메일함은 트리(0 숨김·묶음은 펼치기 버튼)이고 접힘은 다시 그려도 남는다', async () => {
  const { handlers } = folderHandlers(() => folderList())
  const view = renderMail('/mail/1', { handlers })
  const { user, location } = view
  const archive = await within(await screen.findByTestId('mail-folder-toggle')).findByTestId('mail-folder-archive')
  expect(archive).toHaveTextContent('보관')
  expect(archive).toHaveAttribute('href', '/mail/1?box=1')
  expect(screen.getByTestId('mail-count-archive')).toHaveTextContent('2')

  expect(within(screen.getByTestId('mail-sidebar')).getByText('내 메일함', { exact: true })).toBeInTheDocument()
  const tree = screen.getByTestId('mail-user-folders')
  expect(within(tree).queryByTestId('mail-box-1')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-count-box-5')).toHaveTextContent('3')
  expect(screen.queryByTestId('mail-count-box-6')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-box-7')).toHaveAttribute('title', expect.stringMatching(/사이드바 폭을 넘는 이름/))

  // 묶음(selectable=false)은 링크가 아니라 펼치기 버튼 — 눌러도 이동하지 않는다.
  const group = screen.getByTestId('mail-box-8')
  expect(group.tagName).toBe('BUTTON')
  expect(group).toHaveAttribute('aria-expanded', 'true')
  await user.click(group)
  expect(group).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('mail-box-9')).not.toBeInTheDocument()
  expect(location()).toBe('/mail/1')

  // ▾ 로 프로젝트 접기 → 견적 숨김. 화면을 다시 그려도(새로 고침과 같이 계정별 저장소에서 읽어) 접힌 채.
  await user.click(screen.getByTestId('mail-box-toggle-5'))
  expect(screen.getByTestId('mail-box-toggle-5')).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('mail-box-6')).not.toBeInTheDocument()
  view.unmount()
  const again = renderMail('/mail/1', { handlers: folderHandlers(() => folderList()).handlers })
  expect(await screen.findByTestId('mail-box-toggle-5')).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByTestId('mail-box-6')).not.toBeInTheDocument()
  await again.user.click(screen.getByTestId('mail-box-toggle-5'))
  expect(screen.getByTestId('mail-box-6')).toBeInTheDocument()
})

test('사용자 메일함이 없으면 구역을 숨기고, 보관도 없으면 보관 줄도 없다', async () => {
  const folders = record('get', '/api/v1/mail/accounts/1/folders', () => HttpResponse.json([]))
  renderMail('/mail/1', { handlers: [folders.handler, countsHandler()] })
  await waitFor(() => expect(folders.calls.length).toBeGreaterThan(0))
  expect(await screen.findByTestId('mail-folder-sent')).toBeInTheDocument()
  await act(() => new Promise((r) => setTimeout(r, 50)))
  expect(screen.queryByTestId('mail-folder-archive')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-user-folders')).not.toBeInTheDocument()
  expect(within(screen.getByTestId('mail-sidebar')).queryByText('내 메일함', { exact: true })).not.toBeInTheDocument()
})

test('접힌 부모 안의 메일함을 주소로 열면 부모를 펼쳐 활성 행을 보인다', async () => {
  window.localStorage.setItem('mail-folder-collapsed:1', '[5]')
  const { handlers } = folderHandlers(() => folderList({ 6: { folderSyncedAt: syncedAt(), syncedSince: since(90) } }))
  renderMail('/mail/1?box=6', {
    handlers: [...handlers, http.post('/api/v1/mail/accounts/1/folders/6/sync', () => HttpResponse.json(syncResult()))],
  })
  await waitFor(() => expect(screen.getByTestId('mail-box-toggle-5')).toHaveAttribute('aria-expanded', 'true'))
  expect(screen.getByTestId('mail-box-6')).toHaveAttribute('aria-current', 'page')
})

test('메일함 클릭 → folderId 로만 목록, 열 때 가져오기(older=false)·상태 줄·제목·배지 없음, 새로 고침·더 가져오기·토글·행 열기', async () => {
  let synced = false
  const { list, handlers } = folderHandlers(() => folderList(synced ? { 6: { folderSyncedAt: syncedAt(), syncedSince: since(90) } } : {}))
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  const syncs = record('post', '/api/v1/mail/accounts/1/folders/6/sync', async ({ url }) => {
    const older = url.searchParams.get('older') === 'true'
    if (!older) await held
    synced = true
    return HttpResponse.json(syncResult(older ? { saved: 4, syncedSince: since(180) } : {}))
  })
  const { user, location } = renderMail('/mail/1', {
    handlers: [syncs.handler, ...handlers, http.get('/api/v1/mail/messages/10', () => HttpResponse.json({}))],
  })
  await user.click(await screen.findByTestId('mail-box-6'))
  await waitFor(() => expect(location()).toBe('/mail/1?box=6'))
  await waitFor(() => expect(screen.getByTestId('mail-box-6')).toHaveAttribute('aria-current', 'page'))
  expect(screen.getByTestId('mail-filter-category-업무')).not.toHaveAttribute('aria-current', 'page')

  await waitFor(() => expect(list.last().url.searchParams.get('folderId')).toBe('6'))
  const q = list.last().url.searchParams
  expect(q.has('category')).toBe(false)
  expect(q.has('needsReply')).toBe(false)
  expect(q.has('folder')).toBe(false)

  await waitFor(() => expect(syncs.calls).toHaveLength(1))
  expect(syncs.last().url.searchParams.get('older')).toBe('false')
  expect(await screen.findByTestId('mail-box-status-text')).toHaveTextContent('메일함을 가져오는 중…')
  const listCalls = list.calls.length
  release()
  await waitFor(() => expect(screen.getByTestId('mail-box-status-text').textContent).toMatch(/^최근 90일 · .+에 가져옴$/))
  await waitFor(() => expect(list.calls.length).toBeGreaterThan(listCalls))
  expect(syncs.calls).toHaveLength(1)

  // 경로는 최상위 메일함부터 — 사이드바 구역 이름 「내 메일함」은 넣지 않는다(WP-979 §B-1).
  // 보이는 줄(첫 ol)만 본다 — 같은 nav 안의 접기 판정용 측정 사본(숨김)이 글자를 한 벌 더 갖는다.
  expect(screen.getByTestId('mail-breadcrumb').querySelector('ol')!.textContent).toMatch(/^프로젝트\s*견적$/)
  expect(screen.getByTestId('page-header').querySelector('h1')!.textContent).toBe('견적')
  await waitFor(() => expect(document.title).toMatch(/^견적 · 메일/))
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  for (const id of ['mail-badge-category-10', 'mail-badge-needsreply-10', 'mail-badge-pending-10', 'mail-sync']) {
    expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  }
  expect(screen.getByTestId('mail-unread-toggle')).toBeInTheDocument()

  await user.click(screen.getByTestId('mail-box-refresh'))
  await waitFor(() => expect(syncs.calls).toHaveLength(2))
  expect(syncs.last().url.searchParams.get('older')).toBe('false')

  await user.click(screen.getByTestId('mail-box-older'))
  await waitFor(() => expect(syncs.calls).toHaveLength(3))
  expect(syncs.last().url.searchParams.get('older')).toBe('true')
  expect(await screen.findByText('이전 메일 4통을 더 가져왔어요')).toBeInTheDocument()

  await user.click(screen.getByTestId('mail-unread-toggle'))
  await waitFor(() => expect(location()).toMatch(/box=6&unread=true|unread=true&box=6/))
  await waitFor(() => expect(list.last().url.searchParams.get('unread')).toBe('true'))
  expect(list.last().url.searchParams.get('folderId')).toBe('6')

  await user.click(screen.getByTestId('mail-row-10'))
  await waitFor(() => expect(location()).toMatch(/messageId=10/))
  expect(location()).toMatch(/box=6/)
})

test('보관을 열면 제목 「보관」, 가져오기는 보관 id 로 — 다른 보기에 갔다 다시 열면 또 가져온다', async () => {
  const { list, handlers } = folderHandlers(() => folderList())
  const syncs = record('post', '/api/v1/mail/accounts/1/folders/1/sync', () => HttpResponse.json(syncResult()))
  const { user } = renderMail('/mail/1', { handlers: [syncs.handler, ...handlers] })
  await user.click(await screen.findByTestId('mail-folder-archive'))
  await waitFor(() => expect(screen.getByTestId('mail-folder-archive')).toHaveAttribute('aria-current', 'page'))
  expect(screen.getByTestId('page-header').querySelector('h1')).toHaveTextContent(/^보관$/)
  await waitFor(() => expect(list.last().url.searchParams.get('folderId')).toBe('1'))
  await waitFor(() => expect(syncs.calls).toHaveLength(1))
  expect(syncs.last().url.searchParams.get('older')).toBe('false')
  await user.click(screen.getByTestId('mail-folder-inbox'))
  await waitFor(() => expect(screen.getByTestId('mail-folder-inbox')).toHaveAttribute('aria-current', 'page'))
  await user.click(screen.getByTestId('mail-folder-archive'))
  await waitFor(() => expect(syncs.calls).toHaveLength(2))
})

test('목록에 없는 메일함 id 는 「찾을 수 없어요」, 더 가져오기 비활성, 가져오기를 보내지 않는다', async () => {
  const { handlers } = folderHandlers(() => folderList())
  const syncs = record('post', '/api/v1/mail/accounts/1/folders/:id/sync', () => HttpResponse.json(syncResult()))
  renderMail('/mail/1?box=404', { handlers: [syncs.handler, ...handlers] })
  await waitFor(() => expect(screen.getByTestId('mail-box-status-text')).toHaveTextContent('메일함을 찾을 수 없어요'))
  expect(screen.getByTestId('mail-box-older')).toBeDisabled()
  await act(() => new Promise((r) => setTimeout(r, 50)))
  expect(syncs.calls).toHaveLength(0)
})

test('메일함 모두 읽음 — 건수 조회·실행 모두 folderId 범위(분류 없음), 본문은 asOf 그대로', async () => {
  const AS_OF = '2026-10-25T01:00:00.123456Z'
  const { handlers } = folderHandlers(() => folderList({ 5: { folderSyncedAt: syncedAt(), syncedSince: since(90) } }))
  const count = record('get', '/api/v1/mail/accounts/1/messages/unread-count', () => HttpResponse.json({ count: 3, asOf: AS_OF }))
  const run = record('post', '/api/v1/mail/accounts/1/messages/mark-all-read', () => HttpResponse.json({ updated: 3 }))
  const { user } = renderMail('/mail/1?box=5', {
    handlers: [count.handler, run.handler, http.post('/api/v1/mail/accounts/1/folders/5/sync', () => HttpResponse.json(syncResult())), ...handlers],
  })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await waitFor(() => expect(count.calls).toHaveLength(1))
  expect(count.last().url.searchParams.get('folderId')).toBe('5')
  expect(count.last().url.searchParams.has('category')).toBe(false)
  const dlg = await screen.findByTestId('mail-mark-all-dialog')
  expect(dlg).toHaveTextContent('프로젝트')
  expect(dlg).not.toHaveTextContent('내 메일함')
  expect(dlg).toHaveTextContent('3통')
  await user.click(screen.getByTestId('mail-mark-all-confirm'))
  await waitFor(() => expect(run.calls).toHaveLength(1))
  expect(run.last().url.searchParams.get('folderId')).toBe('5')
  expect(run.last().body).toEqual({ category: null, needsReply: false, query: null, asOf: AS_OF })
  expect(await screen.findByText('3통 읽음 처리')).toBeInTheDocument()
})

test('메일함 안 읽은 수가 0 이면 모두 읽음이 꺼지고, 가져오기 실패는 서버 문구 토스트', async () => {
  const { handlers } = folderHandlers(() => folderList())
  renderMail('/mail/1?box=6', {
    handlers: [
      http.post('/api/v1/mail/accounts/1/folders/6/sync', () =>
        HttpResponse.json({ status: 502, message: '메일 서버에 연결하지 못했습니다' }, { status: 502 }),
      ),
      ...handlers,
    ],
  })
  expect(await screen.findByText('메일 서버에 연결하지 못했습니다')).toBeInTheDocument()
  expect(screen.getByTestId('mail-box-status-text')).toHaveTextContent('아직 가져오지 않았어요')
  expect(screen.getByTestId('mail-mark-all-read')).toBeDisabled()
})

// ── 목록 이어 보기 — 서버 이전 메일(mail-older.spec, WP-965) ─────────────────────────────────────────────

const HOUR = 3_600_000
const BASE = Date.parse('2026-10-20T10:00:00Z')
const row = (id: number): EmailMessageSummary =>
  summary({ id, subject: `메일 ${id}`, seen: true, hasAttachment: false, receivedAt: `${new Date(BASE - (1000 - id) * HOUR).toISOString().slice(0, 19)}.123456Z` })
const rows = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => row(from - i))
const olderResult = (over: Partial<MailOlderResult> = {}): MailOlderResult => ({
  running: false, fetched: 0, saved: 0, syncedSince: null, hasMore: false, ...over,
})

test('보낸편지함 — 짧은 목록은 끝이 바로 보여 서버 보낸편지함(SENT) 이전 메일을 가져오고 「더 이전 메일 없음」', async () => {
  const olders = record('post', OLDER, () => HttpResponse.json(olderResult()))
  renderMail('/mail/1?folder=sent', { messages: rows(1000, 999), handlers: [olders.handler] })
  expect(await screen.findByTestId('mail-row-999')).toBeInTheDocument()
  await waitFor(() => expect(olders.calls).toHaveLength(1))
  expect(olders.last().url.searchParams.get('folder')).toBe('SENT')
  expect(await screen.findByTestId('mail-list-no-older')).toHaveTextContent('더 이전 메일 없음')
})

test('최근 범위에 보낸 메일이 하나도 없어도 빈 목록에서 이전 메일을 가져와 붙인다', async () => {
  let loaded = false
  renderMail('/mail/1?folder=sent', {
    handlers: [
      http.get(LIST, () => HttpResponse.json(loaded ? [row(500)] : [])),
      http.post(OLDER, () => {
        loaded = true
        return HttpResponse.json(olderResult({ fetched: 1, saved: 1 }))
      }),
    ],
  })
  expect(await screen.findByTestId('mail-row-500')).toBeInTheDocument()
  expect(await screen.findByTestId('mail-list-no-older')).toBeInTheDocument()
})

test('다른 분류(개인) 보기에서는 서버에서 가져오지 않는다', async () => {
  const olders = record('post', OLDER, () => HttpResponse.json(olderResult()))
  renderMail(`/mail/1?category=${encodeURIComponent('개인')}`, { messages: rows(1000, 999), handlers: [olders.handler] })
  expect(await screen.findByTestId('mail-row-999')).toBeInTheDocument()
  await act(() => new Promise((r) => setTimeout(r, 100)))
  expect(olders.calls).toHaveLength(0)
  expect(screen.queryByTestId('mail-list-no-older')).not.toBeInTheDocument()
})

test('가져오기에 실패하면 목록 끝에 「다시 시도」 — 스스로 다시 부르지 않고, 누르면 다시 불러 끝을 보인다', async () => {
  let fail = true
  const olders = record('post', OLDER, () =>
    fail ? HttpResponse.json({ message: '메일 서버에 연결하지 못했습니다' }, { status: 502 }) : HttpResponse.json(olderResult()),
  )
  const { user } = renderMail('/mail/1', { messages: rows(1000, 999), handlers: [olders.handler] })
  const retry = await within(await screen.findByTestId('mail-list-end')).findByRole('button', {
    name: '이전 메일을 가져오지 못했습니다 — 다시 시도',
  })
  await act(() => new Promise((r) => setTimeout(r, 100)))
  expect(olders.calls).toHaveLength(1)
  fail = false
  await user.click(retry)
  expect(await screen.findByTestId('mail-list-no-older')).toBeInTheDocument()
  expect(olders.calls).toHaveLength(2)
})
