// 메일 휴지통 되살리기(WP-1681) — 휴대폰 화면 테스트.
// 휴지통 보기에서 상세 ⋯ 메뉴·목록 길게 누르기(contextmenu 로 연다) 시트가 보관·옮기기·삭제 대신 「되살리기」만 보이고,
// 되살리기가 실행 취소 토스트 뒤 RESTORE 로 나가는지 본다. 한 파일 한 뷰포트라 데스크톱 판정(mailReadMove)과 나눴다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { UNDO_DELETE_DELAY_MS } from '@/lib/deleteWithUndo'
import { resetMailMoveQueueForTest } from '@/lib/mailMoveQueue'
import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'
import type { MailMoveRequest, MailMoveResponse } from '@/types/mailFolder'

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

/** 휴지통(id 9, 서버 이름 Trash) 보기 — 옮기기 요청을 기록하고 목록은 옮겨진 메일을 뺀다. 토스트 대기(5초)는 가상 시계로 넘긴다. */
function renderTrash(path: string) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const moved = new Set<number>()
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', ({ body }) => {
    body.messageIds.forEach((id) => moved.add(id))
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const view = renderMail(path, {
    handlers: [
      BELL,
      moves.handler,
      http.get(LIST, () => HttpResponse.json([summary({ id: 10, seen: true, subject: '지운 메일' })].filter((m) => !moved.has(m.id)))),
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true }))),
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ classificationActive: false }))),
      http.get('/api/v1/mail/accounts/1/folders', () =>
        HttpResponse.json([
          mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE' }),
          mailServerFolder({ id: 5, displayName: '프로젝트' }),
          mailServerFolder({ id: 9, displayName: 'Trash', role: 'TRASH' }),
        ]),
      ),
      http.post('/api/v1/mail/accounts/1/folders/9/sync', () =>
        HttpResponse.json({ running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null }),
      ),
    ],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  return { ...view, user, moves }
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
