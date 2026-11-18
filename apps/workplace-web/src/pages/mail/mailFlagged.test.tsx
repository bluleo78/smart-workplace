// 별표한 메일 모아 보기(WP-1742) — 데스크톱 화면 테스트.
// 사이드바 「별표」 항목(별표 수·활성)·목록 API(flagged=true)·행의 원래 메일함 배지·「모든 메일함」 범위·모두 읽음 숨김·빈 화면,
// 별을 끄면 행이 빠지고 「실행 취소」로 다시 켜지는 것(행 별·읽기 창 단추), 메일별 옮기기 판정(원래 메일함 id·역할)을 본다.
// 별표 보기에서 보관·옮기기는 행을 숨기지 않고 배지만 바뀌는 것, 동기화 단추를 숨기는 것, 안 읽은 메일만 + 별 끄기에서 열린 행이 되살아나지 않는 것도.
// 브라우저 없이 판정되므로 vitest 로 둔다(apps/workplace-web/CLAUDE.md 「테스트 종류 판정」). 휴대폰은 mailFlaggedMobile.test.tsx.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { UNDO_DELETE_DELAY_MS } from '@/lib/deleteWithUndo'
import { resetMailMoveQueueForTest } from '@/lib/mailMoveQueue'
import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import type { MailMoveRequest, MailMoveResponse } from '@/types/mailFolder'
import type { EmailMessageSummary } from '@/types/mailMessage'

import { detail, mailServerFolder, summary } from '../../../e2e/factories/mail.factory'

afterEach(() => {
  vi.useRealTimers()
  // 옮기기 대기열은 모듈 상태 — 다음 테스트로 번지지 않게 비운다.
  resetMailMoveQueueForTest()
})

const LIST = '/api/v1/mail/accounts/1/messages'
const COUNTS = '/api/v1/mail/accounts/1/unread-counts'
// 보관(1) · 내 메일함 프로젝트(5) — 행의 folderId 가 이 목록의 id 다.
const FOLDERS = http.get('/api/v1/mail/accounts/1/folders', () =>
  HttpResponse.json([
    mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 0 }),
    mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 0 }),
  ]),
)
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

/**
 * 서버처럼 별표 상태를 기억하는 목록·PUT — flagged=true 목록은 지금 별표인 메일만, PUT 은 상태를 바꾼다.
 * 그래서 「행이 돌아온다」가 낙관 갱신만이 아니라 다시 받은 목록으로도 맞는지 본다. 별표 수도 같은 상태에서 센다.
 */
function flaggedServer(rows: EmailMessageSummary[]) {
  const flags = new Map(rows.map((r) => [r.id, r.flagged]))
  const current = () => rows.map((r) => ({ ...r, flagged: flags.get(r.id) ?? false }))
  const list = record('get', LIST, ({ url }) =>
    HttpResponse.json(url.searchParams.get('flagged') === 'true' ? current().filter((r) => r.flagged) : current()),
  )
  const put = record<{ flagged: boolean }>('put', '/api/v1/mail/messages/:id/flag', ({ body, url }) => {
    // 경로 /mail/messages/{id}/flag 의 id.
    flags.set(Number(url.pathname.split('/').at(-2)), body.flagged)
    return new HttpResponse(null, { status: 200 })
  })
  const counts = http.get(COUNTS, () => HttpResponse.json(unreadCounts({ flagged: current().filter((r) => r.flagged).length })))
  return { list, put, handlers: [list.handler, put.handler, counts, FOLDERS] }
}

const ROWS = [
  summary({ id: 10, seen: true, flagged: true, fromName: '김철수', subject: '견적 요청', folderName: '받은편지함', folderId: 100, folderRole: 'INBOX' }),
  summary({ id: 11, seen: true, flagged: true, fromName: '이영희', subject: '보안 점검', folderName: '보관', folderId: 1, folderRole: 'ARCHIVE' }),
]

test('sidebar 별표 item shows the flagged count and opens the flagged view (list asks flagged=true only)', async () => {
  const server = flaggedServer(ROWS)
  const { user, location } = renderMail('/mail/1', { handlers: server.handlers })
  const item = await screen.findByTestId('mail-folder-flagged')
  expect(item).toHaveTextContent('별표')
  expect(await screen.findByTestId('mail-count-flagged')).toHaveTextContent('2')
  // 받은편지함 묶음 아래, 보낸편지함 위.
  const sent = screen.getByTestId('mail-folder-sent')
  expect(item.compareDocumentPosition(sent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByTestId('mail-inbox-categories').compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  await user.click(item)
  await waitFor(() => expect(location()).toBe('/mail/1?flagged=true'))
  await waitFor(() => expect(screen.getByTestId('mail-folder-flagged')).toHaveAttribute('aria-current', 'page'))
  await waitFor(() => expect(server.list.last().url.searchParams.get('flagged')).toBe('true'))
  const q = server.list.last().url.searchParams
  expect(q.has('folder')).toBe(false)
  expect(q.has('category')).toBe(false)
  expect(q.has('folderId')).toBe(false)
})

test('flagged view: folder badge per row, 「모든 메일함」 scope, no mark-all, no 분류 전 badge', async () => {
  const server = flaggedServer([
    { ...ROWS[0], aiCategory: '개인' },
    { ...ROWS[1], aiCategory: '개인' },
    summary({ id: 12, seen: false, flagged: true, categoryPending: true, folderName: '프로젝트', folderId: 5, folderRole: 'USER' }),
  ])
  renderMail('/mail/1?flagged=true', { handlers: server.handlers })
  expect(await screen.findByTestId('mail-row-folder-10')).toHaveTextContent('받은편지함')
  expect(screen.getByTestId('mail-row-folder-11')).toHaveTextContent('보관')
  expect(screen.getByTestId('mail-row-folder-12')).toHaveTextContent('프로젝트')
  // 받은편지함 밖 메일(보관·내 메일함)엔 AI 분류 배지를 두지 않는다.
  expect(screen.getByTestId('mail-badge-category-10')).toHaveTextContent('개인')
  expect(screen.queryByTestId('mail-badge-category-11')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-row-star-10')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('mail-flagged-scope')).toHaveTextContent('모든 메일함')
  expect(screen.getByTestId('mail-breadcrumb')).toHaveTextContent('별표')
  expect(screen.queryByTestId('mail-mark-all-read')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-badge-pending-12')).not.toBeInTheDocument()
  // 동기화는 받은편지함만 — 모든 메일함을 모은 보기에는 동기화 단추·마지막 동기화 상태를 두지 않는다.
  expect(screen.queryByTestId('mail-sync')).not.toBeInTheDocument()
})

test('AI badge follows folderRole, not the display name (a user folder named 받은편지함 gets none)', async () => {
  const server = flaggedServer([
    summary({ id: 10, seen: true, flagged: true, aiCategory: '개인', folderName: 'Inbox', folderId: 100, folderRole: 'INBOX' }),
    summary({ id: 11, seen: true, flagged: true, aiCategory: '개인', folderName: '받은편지함', folderId: 5, folderRole: 'USER' }),
  ])
  renderMail('/mail/1?flagged=true', { handlers: server.handlers })
  expect(await screen.findByTestId('mail-badge-category-10')).toHaveTextContent('개인')
  expect(screen.queryByTestId('mail-badge-category-11')).not.toBeInTheDocument()
})

test('row move menu per mail folder id/role — inbox mail has no 받은편지함, archive mail has no 보관, sent mail no actions', async () => {
  const server = flaggedServer([
    ...ROWS,
    summary({ id: 12, seen: true, flagged: true, folderName: '보낸편지함', folderId: null, folderRole: 'SENT' }),
  ])
  const { user } = renderMail('/mail/1?flagged=true', { handlers: server.handlers })
  // 받은편지함 메일 — 보관 있음, 옮기기 메뉴에 받은편지함 없음
  expect(await screen.findByTestId('mail-row-archive-10')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-row-move-10'))
  let menu = await screen.findByTestId('mail-move-menu')
  expect(within(menu).queryByTestId('mail-move-target-inbox')).not.toBeInTheDocument()
  expect(within(menu).getByTestId('mail-move-target-archive')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('mail-move-menu')).not.toBeInTheDocument())
  // 보관 메일 — 보관 없음, 받은편지함으로는 옮길 수 있음
  expect(screen.queryByTestId('mail-row-archive-11')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-row-move-11'))
  menu = await screen.findByTestId('mail-move-menu')
  expect(within(menu).getByTestId('mail-move-target-inbox')).toBeInTheDocument()
  expect(within(menu).queryByTestId('mail-move-target-archive')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  // 보낸 메일 — 보관·옮기기·삭제 없음
  for (const id of ['mail-row-archive-12', 'mail-row-move-12', 'mail-row-trash-12']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
})

test('deep-linked mail outside the flagged list — no 보관·옮기기·삭제 (no fallback to every target)', async () => {
  const server = flaggedServer(ROWS)
  renderMail('/mail/1?flagged=true&messageId=99', {
    handlers: [...server.handlers, http.get('/api/v1/mail/messages/99', () => HttpResponse.json(detail({ id: 99, seen: true, flagged: false })))],
  })
  await screen.findByTestId('mail-row-10')
  await screen.findByTestId('mail-flag')
  for (const id of ['mail-archive', 'mail-move', 'mail-trash']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
})

test('open mail unstarred out of the list keeps its own folder actions (snapshot folderRole)', async () => {
  const server = flaggedServer(ROWS)
  const { user } = renderMail('/mail/1?flagged=true&messageId=11', {
    handlers: [...server.handlers, http.get('/api/v1/mail/messages/11', () => HttpResponse.json(detail({ id: 11, seen: true, flagged: true })))],
  })
  const button = await screen.findByTestId('mail-flag')
  await waitFor(() => expect(button).toHaveTextContent('별표 해제'))
  await screen.findByTestId('mail-row-11')
  await user.click(button)
  await waitFor(() => expect(screen.queryByTestId('mail-row-11')).not.toBeInTheDocument())
  await waitFor(() => expect(server.list.calls.length).toBeGreaterThan(1))
  // 보관 메일 그대로 — 보관은 없고 옮기기·삭제는 있다(별표 보기 전체 범위로 떨어지지 않는다).
  expect(screen.queryByTestId('mail-archive')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-move')).toBeInTheDocument()
  expect(screen.getByTestId('mail-trash')).toBeInTheDocument()
})

test('archive in the flagged view keeps the row (no hide) and only the folder badge changes after the move', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  let row = ROWS[0]
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', ({ body }) => {
    // 서버처럼 보관으로 옮긴다 — 별표는 그대로라 별표 목록에 남고 메일함만 바뀐다.
    row = { ...row, folderName: '보관', folderId: 1, folderRole: 'ARCHIVE' }
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const list = record('get', LIST, () => HttpResponse.json([row]))
  renderMail('/mail/1?flagged=true', {
    handlers: [moves.handler, list.handler, FOLDERS, http.get(COUNTS, () => HttpResponse.json(unreadCounts({ flagged: 1 })))],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(await screen.findByTestId('mail-row-archive-10'))
  expect(await screen.findByText('보관했습니다')).toBeInTheDocument()
  // 숨기지 않는다 — 토스트 동안에도 행이 그대로 있고, 배지는 곧바로 목적지(보관)로 바뀌어 같은 행에 「보관」이 다시 보이지 않는다.
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-folder-10')).toHaveTextContent('보관')
  expect(screen.queryByTestId('mail-row-archive-10')).not.toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_DELAY_MS))
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
  // 다시 받은 목록으로 배지만 「보관」, 보관 단추는 빠진다.
  await waitFor(() => expect(screen.getByTestId('mail-row-folder-10')).toHaveTextContent('보관'))
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-row-archive-10')).not.toBeInTheDocument()
})

test('archive from the reading pane in the flagged view: pending row and pane show 보관 (no second 보관); 실행 취소 restores the original folder', async () => {
  // WP-1742 반려 — 대기 중에 옛 메일함(받은편지함) 값이 남아 같은 행·읽기 창에 「보관」이 또 보이고, 누르면 같은 이동이 대기열에 하나 더 들어갔다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const server = flaggedServer(ROWS)
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', () => HttpResponse.json({ results: [] }))
  renderMail('/mail/1?flagged=true&messageId=10', {
    handlers: [...server.handlers, moves.handler, http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true, flagged: true })))],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(await screen.findByTestId('mail-archive'))
  expect(await screen.findByText('보관했습니다')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-folder-10')).toHaveTextContent('보관')
  expect(screen.queryByTestId('mail-archive')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-row-archive-10')).not.toBeInTheDocument()
  // 보관 메일처럼 옮기기는 받은편지함으로 돌릴 수 있다.
  expect(screen.getByTestId('mail-move')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '실행 취소' }))
  await waitFor(() => expect(screen.getByTestId('mail-row-folder-10')).toHaveTextContent('받은편지함'))
  expect(screen.getByTestId('mail-archive')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-archive-10')).toBeInTheDocument()
  await act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_DELAY_MS))
  expect(moves.calls).toHaveLength(0)
})

/**
 * 안 읽은 메일만 + 별표 보기 — 연 메일은 읽음 처리돼 서버 목록에서 빠지고 유지 스냅샷·열린 행 스냅샷으로만 보인다.
 * 보관한 뒤 목록을 다시 받아도 그 스냅샷이 옛 메일함(받은편지함)으로 돌아가 「보관」이 다시 보이면 안 된다.
 */
async function archiveSnapshotRow(closeDetail: boolean) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  let row = summary({ id: 10, seen: false, flagged: true, subject: '견적 요청', folderName: '받은편지함', folderId: 100, folderRole: 'INBOX' })
  const list = record('get', LIST, ({ url }) => HttpResponse.json(url.searchParams.get('unread') === 'true' && row.seen ? [] : [row]))
  const read = record('post', '/api/v1/mail/messages/:id/read', () => {
    row = { ...row, seen: true }
    return new HttpResponse(null, { status: 200 })
  })
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', ({ body }) => {
    row = { ...row, folderName: '보관', folderId: 1, folderRole: 'ARCHIVE' }
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  renderMail('/mail/1?flagged=true&unread=true', {
    handlers: [
      list.handler, read.handler, moves.handler, FOLDERS,
      http.get(COUNTS, () => HttpResponse.json(unreadCounts({ flagged: 1 }))),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: false, flagged: true }))),
    ],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(read.calls).toHaveLength(1))
  if (closeDetail) {
    act(() => {
      window.history.pushState(null, '', '/mail/1?flagged=true&unread=true')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(screen.queryByTestId('mail-archive')).not.toBeInTheDocument())
  }
  await user.click(await screen.findByTestId('mail-row-archive-10'))
  expect(screen.getByTestId('mail-row-folder-10')).toHaveTextContent('보관')
  const before = list.calls.length
  await act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_DELAY_MS))
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  await waitFor(() => expect(list.calls.length).toBeGreaterThan(before))
  await wait(50)
  // 서버 목록(안 읽은 메일만)엔 없고 스냅샷으로만 보이는 행 — 옮긴 뒤에도 목적지(보관)로 남는다.
  expect(screen.getByTestId('mail-row-folder-10')).toHaveTextContent('보관')
  expect(screen.queryByTestId('mail-row-archive-10')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-archive')).not.toBeInTheDocument()
}

test('unread-only flagged view: archived open row (open-row/kept snapshot) stays 보관 after the move and refetch', async () => {
  await archiveSnapshotRow(false)
})

test('unread-only flagged view: archived kept row (detail closed) stays 보관 after the move and refetch', async () => {
  await archiveSnapshotRow(true)
})

test('unstar toast goes away when the PUT fails (the error toast still shows)', async () => {
  const server = flaggedServer(ROWS)
  const { user } = renderMail('/mail/1?flagged=true', {
    handlers: [http.put('/api/v1/mail/messages/:id/flag', () => new HttpResponse(null, { status: 500 })), ...server.handlers],
  })
  await user.click(await screen.findByTestId('mail-row-star-10'))
  expect(await screen.findByTestId('mail-unflag-toast')).toBeInTheDocument()
  expect(await screen.findByText(/별표를 바꾸지 못했어요/)).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-unflag-toast')).not.toBeInTheDocument())
  // 실패라 행은 별표 그대로 돌아온다.
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
})

test('unstar 실행 취소 after switching views does not wipe the new view\'s kept rows (uses the latest state)', async () => {
  // 안 읽은 메일만 + 별표 보기에서 연 메일(유지 집합)을 별 끄고, 안 읽은 받은편지함으로 옮겨 메일을 열어(새 보기의 유지 집합) 둔 채 실행 취소한다.
  // 옛 렌더의 applyFlag 는 옛 보기 키로 유지 집합을 덮어써 새 보기에서 연 메일이 목록에서 사라졌다.
  const flags = new Map([[10, true], [20, false]])
  const seen = new Map([[10, false], [20, false]])
  const base = [
    summary({ id: 10, subject: '견적 요청', folderName: '받은편지함', folderId: 100, folderRole: 'INBOX' }),
    summary({ id: 20, subject: '주간 보고' }),
  ]
  const current = () => base.map((r) => ({ ...r, flagged: flags.get(r.id)!, seen: seen.get(r.id)! }))
  const list = record('get', LIST, ({ url }) => {
    let rows = current()
    if (url.searchParams.get('flagged') === 'true') rows = rows.filter((r) => r.flagged)
    if (url.searchParams.get('unread') === 'true') rows = rows.filter((r) => !r.seen)
    return HttpResponse.json(rows)
  })
  const id = (url: URL) => Number(url.pathname.split('/').at(-2))
  const put = record<{ flagged: boolean }>('put', '/api/v1/mail/messages/:id/flag', ({ body, url }) => {
    flags.set(id(url), body.flagged)
    return new HttpResponse(null, { status: 200 })
  })
  // 첫 열람 읽음 처리 — POST /mail/messages/{id}/read.
  const read = record('post', '/api/v1/mail/messages/:id/read', ({ url }) => {
    seen.set(id(url), true)
    return new HttpResponse(null, { status: 200 })
  })
  const { user, queryClient } = renderMail('/mail/1?flagged=true&unread=true', {
    handlers: [
      list.handler, put.handler, read.handler, FOLDERS,
      http.get(COUNTS, () => HttpResponse.json(unreadCounts({ flagged: 1 }))),
      http.get('/api/v1/mail/messages/:mid', ({ params }) => HttpResponse.json(detail({ id: Number(params.mid), seen: false }))),
    ],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(read.calls.length).toBeGreaterThan(0))
  await user.click(screen.getByTestId('mail-row-star-10'))
  await waitFor(() => expect(put.last()?.body).toEqual({ flagged: false }))
  expect(await screen.findByTestId('mail-unflag-toast')).toBeInTheDocument()

  act(() => {
    window.history.pushState(null, '', '/mail/1?category=all&unread=true')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await user.click(await screen.findByTestId('mail-row-20'))
  await waitFor(() => expect(seen.get(20)).toBe(true))
  // 상세를 닫는다 — 이제 20 은 유지 집합으로만 보인다(서버의 안 읽은 메일만 목록엔 없다).
  act(() => {
    window.history.pushState(null, '', '/mail/1?category=all&unread=true')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await wait(100)
  expect(screen.getByTestId('mail-row-20')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '실행 취소' }))
  await waitFor(() => expect(put.last()?.body).toEqual({ flagged: true }))
  // 주기 재조회처럼 목록을 다시 받는다 — 서버 목록엔 20 이 없어 유지 집합이 지워졌다면 행이 사라진다.
  const before = list.calls.length
  await act(() => queryClient.invalidateQueries({ queryKey: ['mail-messages'] }))
  await waitFor(() => expect(list.calls.length).toBeGreaterThan(before))
  await wait(50)
  // 새 보기에서 연(읽음 처리한) 메일은 유지 집합으로 그대로 남는다.
  expect(screen.getByTestId('mail-row-20')).toBeInTheDocument()
})

test('delete (trash) in the flagged view still removes the row', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const server = flaggedServer(ROWS)
  renderMail('/mail/1?flagged=true', { handlers: server.handlers })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(await screen.findByTestId('mail-row-trash-10'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(await screen.findByText('삭제했습니다')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
})

test('unread-only flagged view: unstarring the open row does not revive it from the open-row snapshot', async () => {
  // 서버 목록이 별을 끈 행을 뺀 뒤에도 열린 행 스냅샷(선택 순간의 별표 행)이 되살리지 않아야 한다. 상세 조회를 끝내지 않아
  // 첫 열람 읽음 처리(유지 집합)가 끼지 않게 한다 — 열린 행 스냅샷만으로 보이는 상태.
  const server = flaggedServer([{ ...ROWS[0], seen: false }, ROWS[1]].map((r) => ({ ...r, seen: false })))
  const { user, location } = renderMail('/mail/1?flagged=true&unread=true', {
    handlers: [...server.handlers, http.get('/api/v1/mail/messages/10', () => new Promise<never>(() => {}))],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  await waitFor(() => expect(location()).toMatch(/messageId=10/))
  const before = server.list.calls.length
  await user.click(screen.getByTestId('mail-row-star-10'))
  await waitFor(() => expect(server.put.last()?.body).toEqual({ flagged: false }))
  await waitFor(() => expect(server.list.calls.length).toBeGreaterThan(before))
  await wait(50)
  expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
})

test('other views show no folder badge', async () => {
  renderMail('/mail/1?category=all', {
    handlers: [http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, folderName: '받은편지함', folderId: 100, folderRole: 'INBOX' })]))],
  })
  await screen.findByTestId('mail-row-10')
  expect(screen.queryByTestId('mail-row-folder-10')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-flagged-scope')).not.toBeInTheDocument()
})

test('flagged view empty state', async () => {
  const server = flaggedServer([])
  renderMail('/mail/1?flagged=true', { handlers: server.handlers })
  expect(await screen.findByTestId('mail-flagged-empty')).toHaveTextContent('별표한 메일 없음')
  // 별표 수 0 은 숨김.
  expect(screen.queryByTestId('mail-count-flagged')).not.toBeInTheDocument()
})

test('unstarring a row in the flagged view removes it; 실행 취소 stars it again and the row comes back', async () => {
  const server = flaggedServer(ROWS)
  const { user } = renderMail('/mail/1?flagged=true', { handlers: server.handlers })
  await user.click(await screen.findByTestId('mail-row-star-10'))
  // 응답을 기다리지 않고 바로 빠진다.
  expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  expect(await screen.findByTestId('mail-unflag-toast')).toHaveTextContent('별표를 해제했습니다')
  await waitFor(() => expect(server.put.calls).toHaveLength(1))
  expect(server.put.last().body).toEqual({ flagged: false })
  // 별표 수도 다시 받는다.
  await waitFor(() => expect(screen.getByTestId('mail-count-flagged')).toHaveTextContent('1'))
  // 다시 받은 목록에서도 빠져 있다(서버 상태).
  await waitFor(() => expect(server.list.calls.length).toBeGreaterThan(1))
  expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: '실행 취소' }))
  await waitFor(() => expect(server.put.calls).toHaveLength(2))
  expect(server.put.last().body).toEqual({ flagged: true })
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-star-10')).toHaveAttribute('aria-pressed', 'true')
  await waitFor(() => expect(screen.getByTestId('mail-count-flagged')).toHaveTextContent('2'))
})

test('reading pane 별표 해제 in the flagged view also removes the row (detail stays open)', async () => {
  const server = flaggedServer(ROWS)
  const { user } = renderMail('/mail/1?flagged=true&messageId=10', {
    handlers: [...server.handlers, http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true, flagged: true })))],
  })
  const button = await screen.findByTestId('mail-flag')
  await waitFor(() => expect(button).toHaveTextContent('별표 해제'))
  await screen.findByTestId('mail-row-10')
  await user.click(button)
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(await screen.findByText('별표를 해제했습니다')).toBeInTheDocument()
  await waitFor(() => expect(server.put.last()?.body).toEqual({ flagged: false }))
  // 읽던 메일은 그대로 열려 있고 단추는 「별표」로 돌아온다.
  expect(screen.getByTestId('mail-flag')).not.toHaveTextContent('별표 해제')
})

test('starring in other views shows no undo toast', async () => {
  const server = flaggedServer([summary({ id: 10, seen: true, flagged: false })])
  const { user } = renderMail('/mail/1?category=all', { handlers: server.handlers })
  await user.click(await screen.findByTestId('mail-row-star-10'))
  await waitFor(() => expect(server.put.calls).toHaveLength(1))
  // 별표 보기가 아니면 끄더라도 행이 빠지지 않아 실행 취소가 필요 없다.
  await user.click(screen.getByTestId('mail-row-star-10'))
  await waitFor(() => expect(server.put.calls).toHaveLength(2))
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  expect(screen.queryByText('별표를 해제했습니다')).not.toBeInTheDocument()
})
