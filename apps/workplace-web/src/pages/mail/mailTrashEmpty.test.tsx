// 메일 「휴지통 비우기」(WP-1682) — 데스크톱 화면 테스트.
// 휴지통 목록 위 비우기 줄 → 확인 창(본문 글자 그대로) → 「비우기」 → POST → 진행 글·「비우는 중…」 → 끝 토스트·목록 다시 받기,
// 끝 상태별 토스트(실패 있음·FAILED·중단), 처음 받은 상태(DONE 은 조용히, RUNNING 은 바로 진행 글),
// 실행 취소 토스트 중인 되살리기가 비우기보다 먼저 나가는지, 빈 휴지통의 비활성을 본다.
// WP-1708 실시간 수 — 확인 창 본문은 서버 실시간 수가 먼저고(로딩·실패 시 수 없는 문구), 줄 글자만 folder.totalCount 로 폴백한다.
// 확인 창을 열 때마다 수를 다시 요청한다(오래 열어 둔 화면에서도 최신 수를 받는다) — 닫을 때는 다시 요청하지 않는다.
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
const COUNT = '/api/v1/mail/accounts/1/trash/count'
const st = (over: Partial<MailTrashEmptyStatus> = {}): MailTrashEmptyStatus => ({
  state: 'IDLE', total: null, deleted: 0, failed: 0, startedAt: null, finishedAt: null, errorCode: null, error: null, ...over,
})
const RUNNING = st({ state: 'RUNNING', total: 132, deleted: 40, failed: 0, startedAt: '2026-11-17T00:00:00Z' })
/** 상태 폴링 한 번(1초)을 넘긴다. */
const tick = () => act(() => vi.advanceTimersByTimeAsync(1000))

/**
 * 휴지통(id 9, 서버 전체 132통) 보기 — 비우기 상태는 status.current 를 돌려주고(테스트가 바꿔 끼운다), 시작 POST 는 start 를 돌려준다.
 * 실시간 휴지통 수(count)는 기본이 폴더 수와 같은 값이라 기존 시나리오가 그대로 흐르고, 테스트가 세기를 따로 지정할 때만 갈린다.
 * 옮기기·비우기 시작 요청은 order 에 순서대로 남긴다.
 */
function renderTrash(
  opts: {
    status?: MailTrashEmptyStatus
    start?: MailTrashEmptyStatus
    folder?: Partial<MailServerFolder>
    rows?: EmailMessageSummary[]
    /** 서버 실시간 휴지통 수 응답 — 지연·실패를 넣어 로딩→도착·폴백을 본다. */
    count?: () => Response | Promise<Response>
  } = {},
) {
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
  // WP-1708 서버 실시간 휴지통 수 — 테스트가 세기를 지정하면 그 값을, 아니면 기본(folder.totalCount 와 같은 값)을 준다(기존 시나리오 132통이 그대로 흐른다).
  const counts = record('get', COUNT, () => opts.count?.() ?? HttpResponse.json({ count: opts.folder?.totalCount ?? 132 }))
  const view = renderMail('/mail/1?box=9', {
    handlers: [
      moves.handler,
      starts.handler,
      lists.handler,
      counts.handler,
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
  return { ...view, user, status, order, moves, starts, lists, counts }
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

test('확인 창 — 실시간 수 로딩 중엔 수 없는 문구(폴더 낡은 132통 안 씀), 도착하면 「메일 302통을」·줄도 서버 수로', async () => {
  // count 응답을 붙잡아 두었다가 확인 창을 연 뒤에 푼다 — 로딩→도착 두 시점을 같은 화면에서 본다.
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const { user, counts } = renderTrash({
    count: async () => {
      await held
      return HttpResponse.json({ count: 302 })
    },
  })
  const row = await screen.findByTestId('mail-trash-empty-row')
  // 수가 오기 전 — 줄 글자만 folder.totalCount(마지막 동기화 132)로 폴백한다.
  await waitFor(() => expect(within(row).getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 132통$/))
  const button = within(row).getByTestId('mail-trash-empty')
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  const dialog = await screen.findByTestId('mail-trash-empty-confirm')
  // 확인 창 본문은 폴더 낡은 수를 폴백으로 쓰지 않는다 — 수가 없으면(로딩) 수 없는 문구.
  expect(dialog).toHaveTextContent(
    '메일 서버 휴지통의 메일을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.',
  )
  expect(dialog).not.toHaveTextContent('132통')
  // 줄 마운트 시 조회와 확인 창 열 때 재조회 모두 붙잡혀 있으므로(수도착 전이라) 본문에 아직 수가 없다.
  expect(counts.calls.length).toBeGreaterThanOrEqual(1)
  release()
  // 도착 후 확인 창 본문이 서버 실시간 수로 바뀐다(창이 열린 채 갱신된다).
  await waitFor(() =>
    expect(dialog).toHaveTextContent(
      '메일 서버 휴지통의 메일 302통을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.',
    ),
  )
  // 줄 글자도 폴더 값이 아니라 서버 수를 쓴다.
  await waitFor(() => expect(within(row).getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 302통$/))
})

test('확인 창 — 실시간 수 조회 실패(502)면 수 없는 문구·재시도 없음, 줄 글자는 folder.totalCount 132 유지', async () => {
  const { user, counts } = renderTrash({ count: () => HttpResponse.json({ message: '메일 서버에 연결하지 못했습니다' }, { status: 502 }) })
  const row = await screen.findByTestId('mail-trash-empty-row')
  const button = within(row).getByTestId('mail-trash-empty')
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  const dialog = await screen.findByTestId('mail-trash-empty-confirm')
  // 실패해도 확인 창은 낡은 수(132통)를 보여 주지 않고 수 없는 문구로 둔다.
  expect(dialog).toHaveTextContent(
    '메일 서버 휴지통의 메일을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.',
  )
  expect(dialog).not.toHaveTextContent('132통')
  // 줄 글자는 폴더 값(132)으로 폴백해 그대로 쓴다.
  await waitFor(() => expect(within(row).getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 132통$/))
  // 재시도하지 않는다 — 확인 창을 열 때 재조회(마운트 1회 + 열기 1회 = 2회)한 뒤 1초가 지나도 요청은 더 늘지 않고 본문은 수 없는 문구 그대로.
  // (메일함 동기화가 끝나면 WP-1708 로 수를 한 번 더 받을 수 있다 — 재시도로 계속 늘지 않는 것만 본다.)
  await tick()
  const settledCalls = counts.calls.length
  await tick()
  expect(counts.calls).toHaveLength(settledCalls)
  expect(dialog).toHaveTextContent(
    '메일 서버 휴지통의 메일을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.',
  )
})

const NO_COUNT_BODY =
  '메일 서버 휴지통의 메일을 모두 완전히 삭제합니다. 앱에 보이지 않는 30일 지난 메일도 함께 지워집니다. 되돌릴 수 없습니다.'

test('WP-1708 첫 조회 5통 성공 뒤 확인 창을 열 때 재조회가 502 → 낡은 「5통」을 보이지 않고 수 없는 문구', async () => {
  // 메일함 동기화가 수를 한 번 더 받을 수 있어 호출 순서가 아니라 「확인 창을 열었는가」로 첫 성공·이후 실패를 가른다.
  let opened = false
  const { user, counts } = renderTrash({
    count: () => (opened ? HttpResponse.json({ message: '메일 서버에 연결하지 못했습니다' }, { status: 502 }) : HttpResponse.json({ count: 5 })),
  })
  const row = await screen.findByTestId('mail-trash-empty-row')
  // 첫 조회 5통이 줄에 보인 뒤(캐시에 5 가 남은 상태)에 연다.
  await waitFor(() => expect(within(row).getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 5통$/))
  const before = counts.calls.length
  opened = true
  await user.click(within(row).getByTestId('mail-trash-empty'))
  const dialog = await screen.findByTestId('mail-trash-empty-confirm')
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(before))
  await waitFor(() => expect(dialog).toHaveTextContent(NO_COUNT_BODY))
  expect(dialog).not.toHaveTextContent('5통')
})

test('WP-1708 재조회가 응답 전(지연)인 동안 확인 창에 이전 수가 없고, 도착하면 새 수', async () => {
  let opened = false
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  const { user, counts } = renderTrash({
    count: async () => {
      if (!opened) return HttpResponse.json({ count: 5 })
      await held
      return HttpResponse.json({ count: 1234 })
    },
  })
  const row = await screen.findByTestId('mail-trash-empty-row')
  await waitFor(() => expect(within(row).getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 5통$/))
  const before = counts.calls.length
  opened = true
  await user.click(within(row).getByTestId('mail-trash-empty'))
  const dialog = await screen.findByTestId('mail-trash-empty-confirm')
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(before))
  expect(dialog).toHaveTextContent(NO_COUNT_BODY)
  expect(dialog).not.toHaveTextContent('5통')
  release()
  await waitFor(() => expect(dialog).toHaveTextContent('메일 1234통을'))
})

test('확인 창을 열 때 실시간 수를 다시 요청한다 — 오래 열어 둔 화면에서도 최신 수를 받는다, 닫을 때는 다시 요청하지 않는다', async () => {
  const { user, counts } = renderTrash()
  const row = await screen.findByTestId('mail-trash-empty-row')
  const button = within(row).getByTestId('mail-trash-empty')
  await waitFor(() => expect(button).toBeEnabled())
  // 비우기 줄 마운트 시 1회 조회가 끝난 뒤에 연다 — 확인 창이 여는 순간 추가 조회를 하는지에만 초점을 둔다.
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(0))
  const before = counts.calls.length
  await user.click(button)
  await screen.findByTestId('mail-trash-empty-confirm')
  // 스펙은 "확인 창을 열 때" 서버 실시간 수를 받는 것 — staleTime(30초)과 무관하게 여는 순간 재조회한다.
  await waitFor(() => expect(counts.calls.length).toBe(before + 1))
  // 닫는 쪽에서는 재조회하지 않는다 — 여는 쪽에만 건다.
  await user.click(within(screen.getByTestId('mail-trash-empty-confirm')).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('mail-trash-empty-confirm')).not.toBeInTheDocument())
  expect(counts.calls.length).toBe(before + 1)
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

test('RUNNING 동안 비우기 단추는 감싸개 안에 남고 감싸개 이름과 포커스 툴팁이 진행 이유다 (WP-1856)', async () => {
  renderTrash({ status: RUNNING })
  const wrapper = await screen.findByTestId('mail-trash-empty-reason')
  expect(wrapper).toHaveAccessibleName('휴지통 비우기 — 휴지통을 비우는 중이에요')
  expect(within(wrapper).getByTestId('mail-trash-empty')).toBeDisabled()
  fireEvent.focus(wrapper)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('휴지통을 비우는 중이에요')
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

test('totalCount 0 이고 목록이 비면 비우기 비활성 + 중립 빈 상태 「이 메일함에 메일이 없어요」', async () => {
  const { starts } = renderTrash({ folder: { totalCount: 0 }, rows: [] })
  // WP-1947: 규격 레이아웃(아이콘+제목+설명).
  const emptyBox = await screen.findByTestId('mail-box-empty')
  expect(emptyBox.querySelector('svg')).not.toBeNull()
  expect(await within(emptyBox).findByText('이 메일함에 메일이 없어요')).toBeInTheDocument()
  // WP-1947 리뷰: 휴지통에는 「메일이 오면 모여요」 같은 받은편지함 문구를 두지 않는다(중립 문구).
  expect(within(emptyBox).queryByText(/여기에 모여요/)).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 0통$/))
  expect(screen.getByTestId('mail-trash-empty')).toBeDisabled()
  fireEvent.focus(screen.getByTestId('mail-trash-empty-reason'))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(TRASH_EMPTY_REASON)
  expect(starts.calls).toHaveLength(0)
})
