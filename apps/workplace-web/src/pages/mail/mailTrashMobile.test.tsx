// 메일 휴지통 되살리기(WP-1681)·완전히 삭제·비우기(WP-1682) — 휴대폰 화면 테스트.
// 휴지통 보기에서 상세 ⋯ 메뉴·목록 길게 누르기(contextmenu 로 연다) 시트가 보관·옮기기·삭제 대신 「되살리기」만 보이고,
// 되살리기가 실행 취소 토스트 뒤 RESTORE 로 나가는지 본다. 한 파일 한 뷰포트라 데스크톱 판정(mailReadMove)과 나눴다.
// WP-1682: 목록 위 비우기 줄, 상세 ⋯ 메뉴 맨 아래 「완전히 삭제」(미지원이면 꺼짐 + 작은 글), 길게 누르기 시트에는 없음.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { UNDO_DELETE_DELAY_MS } from '@/lib/deleteWithUndo'
import { resetMailMoveQueueForTest } from '@/lib/mailMoveQueue'
import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'
import type { MailMoveRequest, MailMoveResponse, MailTrashEmptyStatus } from '@/types/mailFolder'

import { detail, mailServerFolder, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

afterEach(() => {
  vi.useRealTimers()
  // 옮기기 대기열은 모듈 상태 — 남은 숨김이 다음 테스트로 번지지 않게 비운다.
  resetMailMoveQueueForTest()
})

const LIST = '/api/v1/mail/accounts/1/messages'
// 휴대폰 메일 머리줄의 🔔 가 부르는 안 읽은 알림 수 — 이 파일의 관심사가 아니라 0 으로 둔다.
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))

const IDLE: MailTrashEmptyStatus = { state: 'IDLE', total: null, deleted: 0, failed: 0, startedAt: null, finishedAt: null, errorCode: null, error: null }

/**
 * 휴지통(id 9, 서버 이름 Trash, 서버 전체 132통) 보기 — 옮기기·완전 삭제·비우기 시작 요청을 기록하고 목록은 옮겨진 메일을 뺀다.
 * 토스트 대기(5초)는 가상 시계로 넘긴다. unsupported 면 휴지통이 UIDPLUS 없음으로 기록된 서버다.
 */
function renderTrash(path: string, { unsupported = false }: { unsupported?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const moved = new Set<number>()
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', ({ body }) => {
    body.messageIds.forEach((id) => moved.add(id))
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const deletes = record<{ messageIds: number[] }>('post', '/api/v1/mail/accounts/1/messages/permanent-delete', ({ body }) => {
    body.messageIds.forEach((id) => moved.add(id))
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const empties = record('post', '/api/v1/mail/accounts/1/trash/empty', () =>
    HttpResponse.json({ ...IDLE, state: 'RUNNING', total: 132 } satisfies MailTrashEmptyStatus, { status: 202 }),
  )
  const view = renderMail(path, {
    handlers: [
      BELL,
      moves.handler,
      deletes.handler,
      empties.handler,
      http.get('/api/v1/mail/accounts/1/trash/empty', () => HttpResponse.json(IDLE)),
      http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, subject: '지운 메일' })].filter((m) => !moved.has(m.id)))),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true }))),
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ classificationActive: false }))),
      http.get('/api/v1/mail/accounts/1/folders', () =>
        HttpResponse.json([
          mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE' }),
          mailServerFolder({ id: 5, displayName: '프로젝트' }),
          mailServerFolder({ id: 9, displayName: 'Trash', role: 'TRASH', totalCount: 132, permanentDeleteUnsupported: unsupported }),
        ]),
      ),
      http.post('/api/v1/mail/accounts/1/folders/9/sync', () =>
        HttpResponse.json({ running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null }),
      ),
    ],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  return { ...view, user, moves, deletes, empties }
}
const passUndoDelay = () => act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_DELAY_MS))

test('휴지통 상세 ⋯ 메뉴 — 보관·옮기기·삭제 없이 「되살리기」, 누르면 5초 뒤 RESTORE 로 보낸다', async () => {
  const { user, moves } = renderTrash('/mail/1?box=9&messageId=10')
  await user.click(await screen.findByRole('button', { name: '메일 메뉴' }))
  const restore = await screen.findByTestId('mail-restore')
  expect(restore).toHaveTextContent('되살리기')
  for (const id of ['mail-archive', 'mail-move', 'mail-trash']) expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  await user.click(restore)
  expect(await screen.findByText('되살렸습니다')).toBeInTheDocument()
  expect(moves.calls).toHaveLength(0)
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'RESTORE' } })
})

test('휴지통 길게 누르기 시트 — 「되살리기」만(보관·옮기기·삭제 없음), 누르면 RESTORE', async () => {
  const { user, moves } = renderTrash('/mail/1?box=9')
  // 길게 누르기와 같은 시트를 여는 contextmenu(안드로이드 길게 터치)로 연다.
  fireEvent.contextMenu(await screen.findByTestId('mail-row-10'))
  const restore = await screen.findByRole('button', { name: '되살리기' })
  for (const name of ['보관', '옮기기', '삭제']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  await user.click(restore)
  expect(await screen.findByText('되살렸습니다')).toBeInTheDocument()
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'RESTORE' } })
})

// ── 완전히 삭제·휴지통 비우기(WP-1682) ─────────────────────────────────────────────

test('휴지통 목록 위 비우기 줄과 단추가 보이고 확인 → 같은 POST', async () => {
  const { user, empties } = renderTrash('/mail/1?box=9')
  const row = await screen.findByTestId('mail-trash-empty-row')
  // 메일함 상태 줄 바로 위.
  expect(row.nextElementSibling).toBe(screen.getByTestId('mail-box-status'))
  await waitFor(() => expect(within(row).getByTestId('mail-trash-empty-text')).toHaveTextContent(/^메일 서버 휴지통 132통$/))
  const button = within(row).getByTestId('mail-trash-empty')
  await waitFor(() => expect(button).toBeEnabled())
  await user.click(button)
  const dialog = await screen.findByTestId('mail-trash-empty-confirm')
  expect(within(dialog).getByRole('heading')).toHaveTextContent('휴지통을 비울까요?')
  await user.click(within(dialog).getByTestId('mail-trash-empty-confirm-ok'))
  await waitFor(() => expect(empties.calls).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('mail-trash-empty')).toHaveTextContent(/^비우는 중…$/))
})

test('상세 ⋯ 메뉴 맨 아래 「완전히 삭제」(되살리기 다음) → 확인 → POST {messageIds:[10]}', async () => {
  const { user, deletes } = renderTrash('/mail/1?box=9&messageId=10')
  await user.click(await screen.findByRole('button', { name: '메일 메뉴' }))
  const item = await screen.findByTestId('mail-permanent-delete')
  expect(item).toHaveTextContent('완전히 삭제')
  expect(item).toBeEnabled()
  // 메뉴의 맨 아래 항목이고 바로 위가 되살리기다.
  const items = within(screen.getByTestId('mobile-header-more-menu')).getAllByRole('menuitem')
  expect(items.at(-1)).toBe(item)
  expect(items.at(-2)).toBe(screen.getByTestId('mail-restore'))
  await user.click(item)
  const dialog = await screen.findByTestId('mail-permanent-delete-confirm')
  expect(within(dialog).getByRole('heading')).toHaveTextContent('메일을 완전히 삭제할까요?')
  await user.click(within(dialog).getByTestId('mail-permanent-delete-confirm-ok'))
  await waitFor(() => expect(deletes.calls).toHaveLength(1))
  expect(deletes.last().body).toEqual({ messageIds: [10] })
  expect(await screen.findByText('완전히 삭제했습니다')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-detail')).not.toBeInTheDocument())
})

test('미지원 서버면 ⋯ 메뉴 「완전히 삭제」가 disabled + 아래 작은 글 「이 메일 서버는 지원하지 않아요」', async () => {
  const { user, deletes } = renderTrash('/mail/1?box=9&messageId=10', { unsupported: true })
  await user.click(await screen.findByRole('button', { name: '메일 메뉴' }))
  const item = await screen.findByTestId('mail-permanent-delete')
  await waitFor(() => expect(item).toBeDisabled())
  expect(screen.getByTestId('mail-permanent-delete-unsupported')).toHaveTextContent(/^이 메일 서버는 지원하지 않아요$/)
  // 화면 낭독기도 꺼진 항목과 이유를 함께 읽는다(aria-describedby).
  expect(item).toHaveAccessibleDescription('이 메일 서버는 지원하지 않아요')
  expect(deletes.calls).toHaveLength(0)
})

test('목록 길게 누르기 시트에는 「완전히 삭제」가 없고, 데스크톱 우클릭 메뉴(WP-1730)도 열리지 않는다', async () => {
  renderTrash('/mail/1?box=9')
  fireEvent.contextMenu(await screen.findByTestId('mail-row-10'))
  expect(await screen.findByRole('button', { name: '되살리기' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '완전히 삭제' })).not.toBeInTheDocument()
  // 터치 셸은 길게 누르기 시트가 맡는다 — 행 우클릭 메뉴는 그리지 않는다.
  expect(screen.queryByTestId('mail-row-menu-10')).not.toBeInTheDocument()
})
