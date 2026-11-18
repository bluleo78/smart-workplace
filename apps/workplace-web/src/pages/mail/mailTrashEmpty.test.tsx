// 메일 「휴지통 비우기」(WP-1682) — 데스크톱 화면 테스트.
// 휴지통 목록 위 비우기 줄 → 확인 창(본문 글자 그대로) → 「비우기」 → POST → 진행 글·「비우는 중…」 → 끝 토스트·목록 다시 받기,
// 끝 상태별 토스트(실패 있음·FAILED·중단), 처음 받은 상태(DONE 은 조용히, RUNNING 은 바로 진행 글),
// 실행 취소 토스트 중인 되살리기가 비우기보다 먼저 나가는지, 빈 휴지통의 비활성을 본다.
// 상태 폴링(1초)·실행 취소 대기(5초)는 가상 시계로 넘긴다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import { resetMailMoveQueueForTest } from '@/lib/mailMoveQueue'
import { TRASH_COPY_NOTE, TRASH_EMPTY_REASON } from '@/lib/mailTrashActions'
import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import type { MailMoveRequest, MailMoveResponse, MailServerFolder, MailTrashEmptyStatus } from '@/types/mailFolder'
import type { EmailMessageSummary } from '@/types/mailMessage'

import { mailServerFolder, summary } from '../../../e2e/factories/mail.factory'

afterEach(() => {
  vi.useRealTimers()
  // 옮기기 대기열은 모듈 상태 — 남은 숨김·대기가 다음 테스트로 번지지 않게 비운다.
  resetMailMoveQueueForTest()
})

const LIST = '/api/v1/mail/accounts/1/messages'
const EMPTY = '/api/v1/mail/accounts/1/trash/empty'
const st = (over: Partial<MailTrashEmptyStatus> = {}): MailTrashEmptyStatus => ({
  state: 'IDLE', total: null, deleted: 0, failed: 0, startedAt: null, finishedAt: null, errorCode: null, error: null, ...over,
})
const RUNNING = st({ state: 'RUNNING', total: 132, deleted: 40, failed: 0, startedAt: '2026-11-17T00:00:00Z' })
/** 상태 폴링 한 번(1초)을 넘긴다. */
const tick = () => act(() => vi.advanceTimersByTimeAsync(1000))

/**
 * 휴지통(id 9, 서버 전체 132통) 보기 — 비우기 상태는 status.current 를 돌려주고(테스트가 바꿔 끼운다), 시작 POST 는 start 를 돌려준다.
 * 옮기기·비우기 시작 요청은 order 에 순서대로 남긴다.
 */
function renderTrash(opts: { status?: MailTrashEmptyStatus; start?: MailTrashEmptyStatus; folder?: Partial<MailServerFolder>; rows?: EmailMessageSummary[] } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true })
  const status = { current: opts.status ?? st() }
  const order: string[] = []
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', ({ body }) => {
    order.push(`move:${body.target.kind}`)
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const starts = record('post', EMPTY, () => {
    order.push('empty')
    status.current = opts.start ?? RUNNING
    return HttpResponse.json(status.current, { status: 202 })
  })
  const rows = opts.rows ?? [summary({ id: 10, seen: true, subject: '지운 메일' })]
  const lists = record('get', LIST, () => HttpResponse.json(rows))
  const view = renderMail('/mail/1?box=9', {
    handlers: [
      moves.handler,
      starts.handler,
      lists.handler,
      http.get(EMPTY, () => HttpResponse.json(status.current)),
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ classificationActive: false }))),
      http.get('/api/v1/mail/accounts/1/folders', () =>
        HttpResponse.json([mailServerFolder({ id: 9, displayName: 'Trash', role: 'TRASH', totalCount: 132, ...opts.folder })]),
      ),
      http.post('/api/v1/mail/accounts/1/folders/9/sync', () =>
        HttpResponse.json({ running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null }),
      ),
    ],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  return { ...view, user, status, order, moves, starts, lists }
}

/** 「휴지통 비우기」 → 확인 창 「비우기」. */
async function confirmEmpty(user: ReturnType<typeof renderTrash>['user']) {
  const button = await screen.findByTestId('mail-trash-empty')
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  const dialog = await screen.findByTestId('mail-trash-empty-confirm')
  await user.click(within(dialog).getByTestId('mail-trash-empty-confirm-ok'))
  return dialog
}

test('줄 「메일 서버 휴지통 132통」 → 「휴지통 비우기」 → 확인 창 본문 글자 그대로 + 「비우기」 → POST → RUNNING 진행 글 「휴지통을 비우는 중… 40/132통」·단추 「비우는 중…」 비활성 → DONE 토스트 「휴지통을 비웠습니다 (132통)」·목록 다시 받음', async () => {
  const { user, status, starts, lists } = renderTrash()
  const row = await screen.findByTestId('mail-trash-empty-row')
  // 비우기 줄은 메일함 상태 줄 바로 위에 있다.
  expect(row.nextElementSibling).toBe(screen.getByTestId('mail-box-status'))
  await waitFor(() => expect(within(row).getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 132통$/))
  const button = within(row).getByTestId('mail-trash-empty')
  expect(button).toHaveTextContent(/^휴지통 비우기$/)
  await user.click(button)
  const dialog = await screen.findByTestId('mail-trash-empty-confirm')
  expect(within(dialog).getByRole('heading')).toHaveTextContent('휴지통을 비울까요?')
  expect(dialog).toHaveTextContent(
    '메일 서버 휴지통의 메일 132통을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.',
  )
  expect(within(dialog).getByTestId('delete-impact')).toHaveTextContent(TRASH_COPY_NOTE)
  const ok = within(dialog).getByTestId('mail-trash-empty-confirm-ok')
  expect(ok).toHaveTextContent(/^비우기$/)
  expect(starts.calls).toHaveLength(0)
  await user.click(ok)
  await waitFor(() => expect(starts.calls).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-trash-empty-confirm')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty-text')).toHaveTextContent(/^휴지통을 비우는 중… 40\/132통$/))
  expect(screen.getByTestId('mail-trash-empty')).toHaveTextContent(/^비우는 중…$/)
  expect(screen.getByTestId('mail-trash-empty')).toBeDisabled()
  // 실패가 생기면 진행 글에 붙는다.
  status.current = { ...RUNNING, deleted: 90, failed: 2 }
  await tick()
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty-text')).toHaveTextContent(/^휴지통을 비우는 중… 92\/132통 · 실패 2$/))
  const listsBefore = lists.calls.length
  status.current = st({ state: 'DONE', total: 132, deleted: 132, failed: 0 })
  await tick()
  expect(await screen.findByText('휴지통을 비웠습니다 (132통)')).toBeInTheDocument()
  await waitFor(() => expect(lists.calls.length).toBeGreaterThan(listsBefore))
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty')).toHaveTextContent(/^휴지통 비우기$/))
})

test('DONE 실패 있음 경고 · FAILED 「휴지통을 비우지 못했습니다 — 메일 서버에 연결하지 못했습니다」 · RUNNING→IDLE 「휴지통 비우기가 중단됐습니다. 남은 메일이 있으면 다시 비워 주세요.」', async () => {
  const { user, status, starts } = renderTrash()
  const ends: [MailTrashEmptyStatus, string][] = [
    [st({ state: 'DONE', total: 132, deleted: 130, failed: 2 }), '130통을 지우고 2통은 지우지 못했습니다. 다시 비워 주세요.'],
    [
      st({ state: 'FAILED', total: 132, deleted: 0, failed: 132, errorCode: 'SERVER_UNREACHABLE', error: '메일 서버에 연결하지 못했습니다' }),
      '휴지통을 비우지 못했습니다 — 메일 서버에 연결하지 못했습니다',
    ],
    [st(), '휴지통 비우기가 중단됐습니다. 남은 메일이 있으면 다시 비워 주세요.'],
  ]
  for (const [i, [end, message]] of ends.entries()) {
    await confirmEmpty(user)
    await waitFor(() => expect(starts.calls).toHaveLength(i + 1))
    await waitFor(() => expect(screen.getByTestId('mail-trash-empty')).toHaveTextContent('비우는 중…'))
    status.current = end
    await tick()
    expect(await screen.findByText(message)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('mail-trash-empty')).toBeEnabled())
    // 한 번만 알린다(상태 폴링이 더 돌아도 같은 끝을 다시 알리지 않는다).
    await tick()
    expect(screen.getAllByText(message)).toHaveLength(1)
    // 다음 끝 토스트와 겹치지 않게 닫아 둔다 — jsdom 에서 앞 토스트가 저절로 닫히는 순간 새 토스트가 그려지지 않는 일이 있다.
    act(() => {
      toast.dismiss()
    })
    await waitFor(() => expect(screen.queryByText(message)).not.toBeInTheDocument())
  }
})

test('처음 받은 상태가 DONE 이면 토스트가 없고, RUNNING 이면 진행 글이 바로 보인다', async () => {
  const done = renderTrash({ status: st({ state: 'DONE', total: 132, deleted: 132, failed: 0 }) })
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 132통$/))
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty')).toBeEnabled())
  await tick()
  expect(screen.queryByText('휴지통을 비웠습니다 (132통)')).not.toBeInTheDocument()
  done.unmount()
  vi.useRealTimers()

  renderTrash({ status: RUNNING })
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty-text')).toHaveTextContent(/^휴지통을 비우는 중… 40\/132통$/))
  expect(screen.getByTestId('mail-trash-empty')).toBeDisabled()
  expect(screen.getByTestId('mail-trash-empty')).toHaveTextContent(/^비우는 중…$/)
})

test('실행 취소 토스트 중인 되살리기가 있으면 비우기 POST 전에 move(RESTORE) 가 먼저 나간다', async () => {
  const { user, order, moves, starts } = renderTrash({
    rows: [summary({ id: 10, seen: true, subject: '지운 메일' }), summary({ id: 11, seen: true, subject: '다른 메일' })],
  })
  await user.click(await screen.findByTestId('mail-row-restore-10'))
  expect(await screen.findByText('되살렸습니다')).toBeInTheDocument()
  expect(moves.calls).toHaveLength(0)
  await confirmEmpty(user)
  await waitFor(() => expect(starts.calls).toHaveLength(1))
  expect(order).toEqual(['move:RESTORE', 'empty'])
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'RESTORE' } })
})

test('totalCount 0 이고 목록이 비면 비우기 비활성 + 「휴지통이 비어 있어요」', async () => {
  const { starts } = renderTrash({ folder: { totalCount: 0 }, rows: [] })
  await screen.findByTestId('mail-box-empty')
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 0통$/))
  expect(screen.getByTestId('mail-trash-empty')).toBeDisabled()
  fireEvent.focus(screen.getByTestId('mail-trash-empty-reason'))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(TRASH_EMPTY_REASON)
  expect(starts.calls).toHaveLength(0)
})
