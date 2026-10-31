// 메일 읽음 조작(WP-187·WP-214·WP-220)·모두 읽음·보관/옮기기/삭제(WP-962) — 화면 테스트(WP-984, WP-995).
// 읽음/안읽음 요청·markSeen=false·안 읽은 수 재조회·롤백 토스트·모두 읽음 범위(asOf 그대로)·옛 응답 버림·
// 옮기기 대상 메뉴·실행 취소·5초 뒤 요청 본문·화면 숨김 즉시 전송·실패 되돌림은 브라우저 없이 판정되므로
// e2e/pages/mail/mail-read-actions.spec.ts·mail-move.spec.ts 에서 옮겼다.
// 남은 E2E: 토글의 호버/포커스 투명도·터치 오탭(@input), 실제 SSE 변경 알림(@platform), 옮기기 메뉴 들여쓰기(@layout).
// 메일 모듈만 renderScreen 으로 띄운다(testkit-b4). 행의 ✉·보관·옮기기 버튼은 호버로 드러나지만 DOM 에는 늘 있어 바로 누른다.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { setAccessToken } from '@/api/client'
import { UNDO_DELETE_DELAY_MS } from '@/lib/deleteWithUndo'
import { resetMailMoveQueueForTest } from '@/lib/mailMoveQueue'
import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import type { MailMoveRequest, MailMoveResponse, MailServerFolder } from '@/types/mailFolder'
import type { EmailMessageSummary } from '@/types/mailMessage'

import { detail, mailServerFolder, summary } from '../../../e2e/factories/mail.factory'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setAccessToken(null)
  // 옮기기 대기열은 모듈 상태라, 실패한 테스트가 남긴 숨김이 다음 테스트로 번지지 않게 비운다.
  resetMailMoveQueueForTest()
})

const LIST = '/api/v1/mail/accounts/1/messages'
const AS_OF = '2026-10-03T01:00:00.123456Z'
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

/** 안 읽은 수(기록) + 목록(10=안읽음, 11=읽음). */
function readStub(rows: EmailMessageSummary[] = [summary({ id: 10, seen: false }), summary({ id: 11, seen: true })]) {
  const counts = record('get', '/api/v1/mail/accounts/1/unread-counts', () =>
    HttpResponse.json(unreadCounts({ inbox: 1, byCategory: { 업무: 1, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 } })),
  )
  return { counts, handlers: [counts.handler, http.get(LIST, () => HttpResponse.json(rows))] }
}

// ── 행 토글·열람 읽음(mail-read-actions) ─────────────────────────────────────────────

test('행 ✉ → 읽음 API, 행이 읽음 모양이 되고 열리지 않으며, 안 읽은 수를 다시 받는다', async () => {
  const { counts, handlers } = readStub()
  const read = record('post', '/api/v1/mail/messages/10/read')
  const { user } = renderMail('/mail/1', { handlers: [read.handler, ...handlers] })
  expect(await screen.findByTestId('mail-unread-bar-10')).toBeInTheDocument()
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(0))
  const before = counts.calls.length
  const toggle = screen.getByTestId('mail-row-toggle-read-10')
  expect(toggle).toHaveAttribute('aria-label', '읽음으로 표시')
  await user.click(toggle)
  await waitFor(() => expect(read.calls).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-row-10').className).not.toMatch(/bg-selected/)
  expect(screen.getByTestId('mail-detail-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-detail')).not.toBeInTheDocument()
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(before))
})

test('읽은 행 토글 → 안읽음 API, 안 읽음 막대가 생긴다', async () => {
  const { handlers } = readStub()
  const unread = record('post', '/api/v1/mail/messages/11/unread')
  const { user } = renderMail('/mail/1', { handlers: [unread.handler, ...handlers] })
  const toggle = await screen.findByTestId('mail-row-toggle-read-11')
  expect(toggle).toHaveAttribute('aria-label', '안 읽음으로 표시')
  await user.click(toggle)
  await waitFor(() => expect(unread.calls).toHaveLength(1))
  expect(await screen.findByTestId('mail-unread-bar-11')).toBeInTheDocument()
})

test('메일을 열면 상세는 markSeen=false 로 받고, 읽음 요청은 한 번만 따로 보낸 뒤 안 읽은 수를 다시 받는다(WP-214)', async () => {
  const { counts, handlers } = readStub()
  const det = record('get', '/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10 })))
  const read = record('post', '/api/v1/mail/messages/10/read')
  const { user } = renderMail('/mail/1', { handlers: [det.handler, read.handler, ...handlers] })
  await screen.findByTestId('mail-row-10')
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(0))
  const before = counts.calls.length
  await user.click(screen.getByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  await waitFor(() => expect(read.calls).toHaveLength(1))
  expect(det.calls[0].url.searchParams.get('markSeen')).toBe('false')
  await waitFor(() => expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument())
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(before))
  expect(read.calls).toHaveLength(1)
})

test('이미 읽은 메일을 열면 읽음 요청이 없고, 선택 행은 배경만(막대·굵기 없이) aria-current=true(WP-214·WP-368)', async () => {
  const { handlers } = readStub()
  const read = record('post', '/api/v1/mail/messages/11/read')
  const { user } = renderMail('/mail/1', {
    handlers: [read.handler, http.get('/api/v1/mail/messages/11', () => HttpResponse.json({ ...detail({ id: 11 }), seen: true })), ...handlers],
  })
  await user.click(await screen.findByTestId('mail-row-11'))
  await screen.findByTestId('mail-detail')
  const row11 = screen.getByTestId('mail-row-11')
  const row10 = screen.getByTestId('mail-row-10')
  await waitFor(() => expect(row11).toHaveAttribute('aria-current', 'true'))
  expect(row10).not.toHaveAttribute('aria-current')
  expect(row11.className).toMatch(/bg-selected/)
  expect(row10.className).not.toMatch(/bg-selected/)
  expect(row11.className).not.toMatch(/selection-bar/)
  expect(row11.className).not.toMatch(/font-semibold/)
  expect(screen.queryByTestId('mail-unread-bar-11')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-unread-bar-10')).toBeInTheDocument()
  await wait(150)
  expect(read.calls).toHaveLength(0)
})

test('목록에 없는 메일 딥링크 — 상세가 안 읽음이면 읽음 요청을 한 번 보낸다(WP-214)', async () => {
  const { handlers } = readStub()
  const read = record('post', '/api/v1/mail/messages/12/read')
  renderMail('/mail/1?messageId=12', {
    handlers: [read.handler, http.get('/api/v1/mail/messages/12', () => HttpResponse.json(detail({ id: 12 }))), ...handlers],
  })
  await screen.findByTestId('mail-detail')
  await waitFor(() => expect(read.calls).toHaveLength(1))
  await wait(100)
  expect(read.calls).toHaveLength(1)
})

test('목록 첫 조회 중 읽음 요청이 나가도 목록이 비지 않고, 읽음 반영된 목록을 다시 받는다(WP-220)', async () => {
  // 첫 목록 응답을 읽음 처리 완료(안 읽은 수 재조회) 뒤까지 붙잡아 가장 나쁜 순서를 고정한다.
  let settle!: () => void
  const settled = new Promise<void>((r) => (settle = r))
  let seen = false
  renderMail('/mail/1?messageId=10', {
    handlers: [
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10 }))),
      http.post('/api/v1/mail/messages/10/read', () => {
        seen = true
        return new HttpResponse(null, { status: 200 })
      }),
      http.get('/api/v1/mail/accounts/1/unread-counts', () => {
        if (seen) settle()
        return HttpResponse.json(unreadCounts())
      }),
      http.get(LIST, async () => {
        const rows = [summary({ id: 10, seen }), summary({ id: 11, seen: true })]
        if (!seen) await settled
        return HttpResponse.json(rows)
      }),
    ],
  })
  await screen.findByTestId('mail-detail')
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument())
})

test('상세 안읽음 → API 후 상세가 닫히고, 다시 열면 다시 읽음 요청(WP-214)', async () => {
  const { handlers } = readStub()
  const read = record('post', '/api/v1/mail/messages/10/read')
  const unread = record('post', '/api/v1/mail/messages/10/unread')
  const { user } = renderMail('/mail/1', {
    handlers: [read.handler, unread.handler, http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10 }))), ...handlers],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  await waitFor(() => expect(read.calls).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mail-mark-unread'))
  await waitFor(() => expect(unread.calls).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-detail')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-unread-bar-10')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  await waitFor(() => expect(read.calls).toHaveLength(2))
  await waitFor(() => expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument())
})

test('토글 실패 → 서버 문구 토스트, 안 읽음으로 되돌린다', async () => {
  const { handlers } = readStub()
  const read = record('post', '/api/v1/mail/messages/10/read', () => HttpResponse.json({ message: 'boom' }, { status: 500 }))
  const { user } = renderMail('/mail/1', { handlers: [read.handler, ...handlers] })
  await user.click(await screen.findByTestId('mail-row-toggle-read-10'))
  await waitFor(() => expect(read.calls).toHaveLength(1))
  expect(await screen.findByText('boom')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('mail-unread-bar-10')).toBeInTheDocument())
  expect(screen.getByTestId('mail-row-toggle-read-10')).toHaveAttribute('aria-label', '읽음으로 표시')
})

// ── 모두 읽음(mail-read-actions) ─────────────────────────────────────────────

const markAll = (count = 2, updated = count) => ({
  count: record('get', '/api/v1/mail/accounts/1/messages/unread-count', () => HttpResponse.json({ count, asOf: AS_OF })),
  run: record('post', '/api/v1/mail/accounts/1/messages/mark-all-read', () => HttpResponse.json({ updated })),
})

test('모두 읽음 → 업무 범위 건수 다이얼로그 → 확인하면 asOf 를 그대로 되돌려 실행, 토스트, 안 읽은 수 재조회', async () => {
  const { counts, handlers } = readStub()
  const { count, run } = markAll(2)
  const { user } = renderMail('/mail/1', { handlers: [count.handler, run.handler, ...handlers] })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await waitFor(() => expect(count.calls).toHaveLength(1))
  expect(count.last().url.searchParams.get('category')).toBe('업무')
  expect(count.last().url.searchParams.get('needsReply')).toBeNull()
  const dlg = await screen.findByTestId('mail-mark-all-dialog')
  expect(dlg).toHaveTextContent('받은편지함 › 업무')
  expect(dlg).toHaveTextContent('2통')
  expect(dlg).toHaveTextContent('연결된 메일 서버')
  const before = counts.calls.length
  await user.click(screen.getByTestId('mail-mark-all-confirm'))
  await waitFor(() => expect(run.calls).toHaveLength(1))
  expect(run.last().body).toEqual({ category: '업무', needsReply: false, query: null, asOf: AS_OF })
  expect(await screen.findByText('2통 읽음 처리')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-mark-all-dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(before))
})

test('회신필요 보기 — 안 읽은 메일만 토글은 없어도 버튼이 있고 needsReply 범위로 조회·실행', async () => {
  const { handlers } = readStub()
  const { count, run } = markAll(1)
  const { user } = renderMail('/mail/1?needsReply=true', {
    handlers: [
      count.handler,
      run.handler,
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ inbox: 1, needsReply: 1 }))),
      ...handlers,
    ],
  })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  expect(screen.queryByTestId('mail-unread-toggle')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await waitFor(() => expect(count.calls).toHaveLength(1))
  expect(count.last().url.searchParams.get('needsReply')).toBe('true')
  expect(count.last().url.searchParams.get('category')).toBeNull()
  expect(await screen.findByTestId('mail-mark-all-dialog')).toHaveTextContent('회신필요')
  await user.click(screen.getByTestId('mail-mark-all-confirm'))
  await waitFor(() => expect(run.calls).toHaveLength(1))
  expect(run.last().body).toEqual({ category: null, needsReply: true, query: null, asOf: AS_OF })
})

test('건수 조회 중 보기를 바꾸면 옛 응답은 버리고, 새 보기 범위로만 실행한다', async () => {
  const { handlers } = readStub()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const count = record('get', '/api/v1/mail/accounts/1/messages/unread-count', async (_c, n) => {
    if (n === 1) await gate
    return HttpResponse.json({ count: n === 1 ? 5 : 1, asOf: AS_OF })
  })
  const run = record('post', '/api/v1/mail/accounts/1/messages/mark-all-read', () => HttpResponse.json({ updated: 1 }))
  const { user, location } = renderMail('/mail/1', { handlers: [count.handler, run.handler, ...handlers] })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await waitFor(() => expect(count.calls).toHaveLength(1))
  expect(count.calls[0].url.searchParams.get('category')).toBe('업무')
  await user.click(screen.getByTestId('mail-folder-inbox'))
  await waitFor(() => expect(location()).toMatch(/category=all/))
  release()
  await wait(150)
  expect(screen.queryByTestId('mail-mark-all-dialog')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await waitFor(() => expect(count.calls).toHaveLength(2))
  expect(count.calls[1].url.searchParams.get('category')).toBeNull()
  const dlg = await screen.findByTestId('mail-mark-all-dialog')
  expect(dlg).toHaveTextContent('1통')
  expect(dlg).not.toHaveTextContent('업무')
  await user.click(screen.getByTestId('mail-mark-all-confirm'))
  await waitFor(() => expect(run.calls).toHaveLength(1))
  expect(run.last().body).toEqual({ category: null, needsReply: false, query: null, asOf: AS_OF })
})

test('AI 분류가 꺼진 계정 — 받은편지함에 버튼이 있고 category 없이 조회·실행', async () => {
  const { handlers } = readStub()
  const { count, run } = markAll(2)
  const { user } = renderMail('/mail/1', {
    handlers: [
      count.handler,
      run.handler,
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ classificationActive: false, inbox: 2 }))),
      ...handlers,
    ],
  })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await waitFor(() => expect(count.calls).toHaveLength(1))
  expect(count.last().url.searchParams.get('category')).toBeNull()
  expect(await screen.findByTestId('mail-mark-all-dialog')).toHaveTextContent('받은편지함')
  await user.click(screen.getByTestId('mail-mark-all-confirm'))
  await waitFor(() => expect(run.calls).toHaveLength(1))
  expect(run.last().body).toEqual({ category: null, needsReply: false, query: null, asOf: AS_OF })
})

test('검색 없이 안 읽은 수 0 → 모두 읽음 버튼 비활성', async () => {
  renderMail('/mail/1')
  await screen.findByTestId('mail-mark-all-read')
  await wait(50)
  expect(screen.getByTestId('mail-mark-all-read')).toBeDisabled()
})

test('검색 중 건수 0 → 「안 읽은 메일이 없어요」 토스트만, 다이얼로그 없음', async () => {
  const { handlers } = readStub()
  const { count } = markAll(0)
  const { user } = renderMail(`/mail/1?q=${encodeURIComponent('없는단어')}`, { handlers: [count.handler, ...handlers] })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await waitFor(() => expect(count.calls).toHaveLength(1))
  expect(count.last().url.searchParams.get('query')).toBe('없는단어')
  expect(await screen.findByText('안 읽은 메일이 없어요')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-mark-all-dialog')).not.toBeInTheDocument()
})

test('검색 중 다이얼로그 — 표시 이름에 검색어를 붙인다', async () => {
  const { handlers } = readStub()
  const { count } = markAll(1)
  const { user } = renderMail(`/mail/1?q=${encodeURIComponent('견적')}`, { handlers: [count.handler, ...handlers] })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  await user.click(screen.getByTestId('mail-mark-all-read'))
  expect(await screen.findByTestId('mail-mark-all-dialog')).toHaveTextContent('받은편지함 › 업무 · "견적"')
})

test('안 읽은 메일만 보기 — 유지 중인 안읽음 행도 모두 읽음 뒤엔 읽음으로 보인다', async () => {
  const { handlers } = readStub()
  let rows = [summary({ id: 10, seen: false })]
  const { count, run } = markAll(1)
  const { user } = renderMail('/mail/1?unread=true', {
    handlers: [
      count.handler,
      run.handler,
      http.get(LIST, () => HttpResponse.json(rows)),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10 }))),
      ...handlers,
    ],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  await user.click(screen.getByTestId('mail-mark-unread'))
  expect(await screen.findByTestId('mail-unread-bar-10')).toBeInTheDocument()
  rows = []
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await user.click(await screen.findByTestId('mail-mark-all-confirm'))
  await waitFor(() => expect(run.calls).toHaveLength(1))
  expect(await screen.findByText('1통 읽음 처리')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
})

test('모두 읽음 취소 → 실행하지 않는다', async () => {
  const { handlers } = readStub()
  const { count, run } = markAll(1)
  const { user } = renderMail('/mail/1', { handlers: [count.handler, run.handler, ...handlers] })
  await waitFor(() => expect(screen.getByTestId('mail-mark-all-read')).toBeEnabled())
  await user.click(screen.getByTestId('mail-mark-all-read'))
  await screen.findByTestId('mail-mark-all-dialog')
  await user.click(screen.getByTestId('mail-mark-all-cancel'))
  await waitFor(() => expect(screen.queryByTestId('mail-mark-all-dialog')).not.toBeInTheDocument())
  expect(run.calls).toHaveLength(0)
})

// ── 보관·옮기기·삭제(mail-move, WP-962) ─────────────────────────────────────────────

const FOLDERS: MailServerFolder[] = [
  mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 0 }),
  mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 0 }),
  mailServerFolder({ id: 6, displayName: '견적', parentId: 5, unreadCount: 0 }),
]

/**
 * 옮기기 화면 — 토스트 대기(5초)를 가상 시계로 넘긴다(setTimeout 만 가짜, 나머지는 실시간). 목록은 서버처럼 옮겨진 메일을 뺀다.
 * moveReply 로 옮기기 응답을 바꾼다(기본: 모두 성공).
 */
function renderMove(path = '/mail/1', opts: { moveReply?: (b: MailMoveRequest) => Response; extra?: Parameters<typeof renderMail>[1] } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const rows = [summary({ id: 10, subject: '보관할 메일' }), summary({ id: 11, subject: '다른 메일' })]
  const moved = new Set<number>()
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', ({ body }) => {
    if (opts.moveReply) return opts.moveReply(body)
    body.messageIds.forEach((id) => moved.add(id))
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const lists = record('get', LIST, () => HttpResponse.json(rows.filter((m) => !moved.has(m.id))))
  const view = renderMail(path, {
    ...opts.extra,
    handlers: [
      moves.handler,
      lists.handler,
      ...(opts.extra?.handlers ?? []),
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ classificationActive: false }))),
      http.get('/api/v1/mail/accounts/1/folders', () => HttpResponse.json(FOLDERS)),
    ],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  return { ...view, user, moves, lists }
}
const passUndoDelay = (times = 1) => act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_DELAY_MS * times))

test('행 보관 → 바로 빠지고 「보관했습니다」, 토스트 동안은 보내지 않다가 5초 뒤 ARCHIVE 로 보낸다', async () => {
  const { user, moves } = renderMove()
  await user.click(await screen.findByTestId('mail-row-archive-10'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  expect(await screen.findByText('보관했습니다')).toBeInTheDocument()
  expect(moves.calls).toHaveLength(0)
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
  await wait(100)
  expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()
})

test('삭제 후 실행 취소 → 행이 돌아오고 요청은 나가지 않는다', async () => {
  const { user, moves } = renderMove()
  await user.click(await screen.findByTestId('mail-row-trash-10'))
  expect(await screen.findByText('삭제했습니다')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '실행 취소' }))
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
  await passUndoDelay(2)
  await wait(50)
  expect(moves.calls).toHaveLength(0)
})

test('화면이 숨으면 토스트를 기다리지 않고 보내고, 다시 보이면 목록을 받아 행이 그대로 빠져 있으며 다시 보내지 않는다', async () => {
  // 숨을 때는 페이지가 내려가도 끊기지 않는 keepalive fetch(토큰 필요)로 보낸다 — 로그인 토큰을 두고,
  // 상대 주소를 jsdom 문서 기준으로 풀어 MSW 가 받게 한다(Node fetch 는 상대 주소를 받지 않는다).
  setAccessToken('test-token')
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === 'string' ? new URL(input, window.location.href) : input, init),
  )
  const { user, moves, lists } = renderMove()
  await user.click(await screen.findByTestId('mail-row-archive-10'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(moves.calls).toHaveLength(0)
  const setVisibility = (v: 'hidden' | 'visible') =>
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
      document.dispatchEvent(new Event('visibilitychange'))
    })
  setVisibility('hidden')
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
  const listsBefore = lists.calls.length
  setVisibility('visible')
  await waitFor(() => expect(lists.calls.length).toBeGreaterThan(listsBefore))
  await wait(50)
  expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  await passUndoDelay(2)
  await wait(50)
  expect(moves.calls).toHaveLength(1)
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
})

test('옮기기 메뉴 — 받은편지함 보기엔 받은편지함이 없고 보관·내 메일함, 고르면 행을 열지 않고 FOLDER 로 보낸다', async () => {
  const { user, moves, location } = renderMove()
  await user.click(await screen.findByTestId('mail-row-move-10'))
  const menu = await screen.findByTestId('mail-move-menu')
  expect(within(menu).queryByTestId('mail-move-target-inbox')).not.toBeInTheDocument()
  expect(within(menu).getByTestId('mail-move-target-archive')).toHaveTextContent(/^보관$/)
  expect(within(menu).getByTestId('mail-move-target-folder-5')).toHaveTextContent(/^프로젝트$/)
  expect(within(menu).getByTestId('mail-move-target-folder-6')).toHaveTextContent(/^견적$/)
  await user.click(within(menu).getByTestId('mail-move-target-folder-6'))
  expect(location()).not.toMatch(/messageId=/)
  expect(await screen.findByText("'견적' 메일함으로 옮겼습니다")).toBeInTheDocument()
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'FOLDER', folderId: 6 } })
})

test('열린 메일을 상세 툴바에서 삭제 → 상세가 닫히고 TRASH 로 보낸다', async () => {
  const { user, moves } = renderMove('/mail/1', {
    extra: { handlers: [http.get('/api/v1/mail/messages/10', () => HttpResponse.json({ ...detail({ id: 10 }), seen: true }))] },
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  await user.click(screen.getByTestId('mail-trash'))
  await waitFor(() => expect(screen.queryByTestId('mail-detail')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-detail-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument()
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'TRASH' } })
})

test('옮기기 서버 오류 → 행이 돌아오고 서버 문구 토스트', async () => {
  const { user, moves } = renderMove('/mail/1', {
    moveReply: () => HttpResponse.json({ status: 400, message: '보관 메일함이 없습니다' }, { status: 400 }),
  })
  await user.click(await screen.findByTestId('mail-row-archive-10'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(await screen.findByText('보관 메일함이 없습니다')).toBeInTheDocument()
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
})

test('일부 실패 → 실패한 메일만 돌아오고 사유를 알린다', async () => {
  const { user, moves } = renderMove('/mail/1', {
    moveReply: (b) =>
      HttpResponse.json({ results: b.messageIds.map((id) => ({ messageId: id, ok: false, error: '메일 서버에서 메일을 찾을 수 없습니다' })) }),
  })
  await user.click(await screen.findByTestId('mail-row-archive-10'))
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(await screen.findByText('메일을 옮기지 못했어요 — 메일 서버에서 메일을 찾을 수 없습니다')).toBeInTheDocument()
  expect(await screen.findByTestId('mail-row-10')).toBeInTheDocument()
})

test('보관 보기 — 보관 버튼이 없고, 옮기기 메뉴 맨 앞의 받은편지함으로 INBOX', async () => {
  const { user, moves } = renderMove('/mail/1?box=1', {
    extra: {
      handlers: [
        http.post('/api/v1/mail/accounts/1/folders/1/sync', () =>
          HttpResponse.json({ running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null }),
        ),
      ],
    },
  })
  expect(await screen.findByTestId('mail-row-trash-10')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-row-archive-10')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-row-move-10'))
  const menu = await screen.findByTestId('mail-move-menu')
  expect(within(menu).queryByTestId('mail-move-target-archive')).not.toBeInTheDocument()
  await user.click(within(menu).getByTestId('mail-move-target-inbox'))
  expect(await screen.findByText('받은편지함으로 옮겼습니다')).toBeInTheDocument()
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'INBOX' } })
})

test('보낸편지함엔 행·상세 모두 보관·옮기기·삭제가 없다', async () => {
  const { user } = renderMove('/mail/1?folder=sent', {
    extra: { handlers: [http.get('/api/v1/mail/messages/10', () => HttpResponse.json({ ...detail({ id: 10 }), seen: true }))] },
  })
  await screen.findByTestId('mail-row-10')
  expect(screen.queryByTestId('mail-row-move-actions-10')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  for (const id of ['mail-archive', 'mail-move', 'mail-trash']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
})

test('상세 동작 줄 끝 🔗 는 이 메일 링크(계정·messageId)를 복사한다(WP-1234)', async () => {
  const { handlers } = readStub()
  const read = record('post', '/api/v1/mail/messages/10/read')
  const { user } = renderMail('/mail/1', {
    handlers: [read.handler, http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10 }))), ...handlers],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  const panel = await screen.findByTestId('mail-detail')
  await user.click(within(panel).getByRole('button', { name: /^링크 복사 / }))
  await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/mail/1?messageId=10`))
  expect(await screen.findByText('링크를 복사했어요')).toBeInTheDocument()
})
