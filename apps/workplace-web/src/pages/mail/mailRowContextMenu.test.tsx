// 메일 목록 행 우클릭 메뉴(WP-1730, 데스크톱) — 화면 테스트.
// 메일 동작(답장·전체답장·전달·읽음 전환·보관·옮기기 ▸·분류 바꾸기 ▸·삭제)과 링크 항목(WP-1236)이 메뉴 하나에 상세 머리와 같은 순서로 있고,
// 고르면 상세 단추·hover 단추와 같은 요청·작성 창으로 이어지는지 본다. 휴지통 보기는 되살리기·완전히 삭제(확인 창), 보낸편지함은 이동 항목 없음.
// 터치 셸에서 우클릭 메뉴가 열리지 않는 것은 한 파일 한 뷰포트라 mailTrashMobile.test.tsx 가 본다.
// 메일 모듈만 renderScreen 으로 띄운다(testkit-b4). Radix 하위 메뉴는 호버 대신 키보드(포커스 → →)로 연다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { UNDO_DELETE_DELAY_MS } from '@/lib/deleteWithUndo'
import { resetMailMoveQueueForTest } from '@/lib/mailMoveQueue'
import { closeSendToChat, sendToChatTarget } from '@/lib/sendToChat'
import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import type { MailMoveRequest, MailMoveResponse, MailServerFolder } from '@/types/mailFolder'
import type { EmailMessageDetail } from '@/types/mailMessage'

import { detail, mailServerFolder, summary } from '../../../e2e/factories/mail.factory'

afterEach(() => {
  vi.useRealTimers()
  // 옮기기 대기열은 모듈 상태 — 남은 숨김이 다음 테스트로 번지지 않게 비운다.
  resetMailMoveQueueForTest()
})

const LIST = '/api/v1/mail/accounts/1/messages'
const passUndoDelay = () => act(() => vi.advanceTimersByTimeAsync(UNDO_DELETE_DELAY_MS))
const chips = (field: 'to' | 'cc') => screen.queryAllByTestId(`mail-compose-${field}-chip`).map((el) => el.getAttribute('data-value'))

/** 보관(1) · 프로젝트(5) ⊃ 견적(6) · 휴지통(9). */
const FOLDERS: MailServerFolder[] = [
  mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE', unreadCount: 0 }),
  mailServerFolder({ id: 5, displayName: '프로젝트', unreadCount: 0 }),
  mailServerFolder({ id: 6, displayName: '견적', parentId: 5, unreadCount: 0 }),
  mailServerFolder({ id: 9, displayName: 'Trash', role: 'TRASH', unreadCount: 0 }),
]

/** 메일 10 상세 — 받는사람에 나·캐럴, 참조에 밥, 첨부 하나(안건.pdf). */
const DETAIL_10: Partial<EmailMessageDetail> = {
  id: 10,
  subject: '분기 보고서',
  fromAddress: 'alice@example.com',
  fromName: 'Alice',
  toAddresses: 'me@example.com, carol@example.com',
  ccAddresses: 'bob@example.com',
}

/**
 * 메일 화면 — 10(안 읽음, 업무)·11(읽음). 옮기기·읽음·분류 요청을 기록하고 목록은 옮겨진 메일을 뺀다.
 * 토스트 대기(5초)는 가상 시계로 넘긴다. detailReply 로 메일 10 상세 응답을 바꾼다.
 * trashUnsupported 면 휴지통이 완전히 삭제를 지원하지 않는 서버(UIDPLUS 없음)로 기록돼 있다.
 */
function renderList(path = '/mail/1', opts: { detailReply?: () => Response; trashUnsupported?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  const moved = new Set<number>()
  const moves = record<MailMoveRequest>('post', '/api/v1/mail/accounts/1/messages/move', ({ body }) => {
    body.messageIds.forEach((id) => moved.add(id))
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const deletes = record<{ messageIds: number[] }>('post', '/api/v1/mail/accounts/1/messages/permanent-delete', ({ body }) =>
    HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse),
  )
  const reads = record('post', '/api/v1/mail/messages/10/read')
  const unreads = record('post', '/api/v1/mail/messages/11/unread')
  const categories = record<{ category: string | null }>('put', '/api/v1/mail/messages/10/category', ({ body }) =>
    HttpResponse.json({ aiCategory: body.category ?? '업무', categoryByMe: body.category != null, learnable: false }),
  )
  const details = record('get', '/api/v1/mail/messages/10', () => opts.detailReply?.() ?? HttpResponse.json(detail(DETAIL_10)))
  const rows = [summary({ id: 10, seen: false, subject: '분기 보고서', aiCategory: '업무' }), summary({ id: 11, seen: true, subject: '회의록' })]
  const view = renderMail(path, {
    handlers: [
      moves.handler,
      deletes.handler,
      reads.handler,
      unreads.handler,
      categories.handler,
      details.handler,
      http.get(LIST, () => HttpResponse.json(rows.filter((m) => !moved.has(m.id)))),
      http.get('/api/v1/mail/messages/11', () => HttpResponse.json(detail({ id: 11, seen: true, subject: '회의록' }))),
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts())),
      http.get('/api/v1/mail/accounts/1/folders', () =>
        HttpResponse.json(opts.trashUnsupported ? FOLDERS.map((f) => (f.role === 'TRASH' ? { ...f, permanentDeleteUnsupported: true } : f)) : FOLDERS),
      ),
      // 서버 메일함 보기(휴지통 9·프로젝트 5)는 들어갈 때 그 메일함을 동기화한다.
      http.post('/api/v1/mail/accounts/1/folders/:folderId/sync', () =>
        HttpResponse.json({ running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null }),
      ),
    ],
  })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  return { ...view, user, moves, deletes, reads, unreads, categories, details }
}

/** 행을 우클릭해 메뉴를 연다. */
async function openMenu(id: number) {
  fireEvent.contextMenu(await screen.findByTestId(`mail-row-${id}`), { clientX: 0, clientY: 0 })
  return screen.findByTestId(`mail-row-menu-${id}`)
}
const itemNames = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((m) => m.textContent?.trim())

/** 하위 메뉴를 키보드로 연다(jsdom 은 레이아웃이 없어 호버로 연 하위 메뉴가 바로 닫힌다). */
async function openSub(user: ReturnType<typeof renderList>['user'], triggerId: string, contentId: string) {
  act(() => screen.getByTestId(triggerId).focus())
  await user.keyboard('{ArrowRight}')
  return screen.findByTestId(contentId)
}

test('받은편지함 행 우클릭 — 메일 동작이 상세 머리 순서로, 그 아래 링크 항목. 메뉴를 열어도 메일은 열리지 않는다', async () => {
  const { user, location } = renderList()
  const menu = await openMenu(10)
  expect(itemNames(menu)).toEqual([
    '답장',
    '전체답장',
    '전달',
    '읽음으로 표시',
    '보관',
    '옮기기',
    '분류 바꾸기',
    '삭제',
    '링크 복사',
    '채팅·이슈로 보내기…',
  ])
  // 구분선 둘 — 답장류 | 메일 동작 | 링크.
  expect(within(menu).getAllByRole('separator')).toHaveLength(2)
  expect(screen.getByTestId('mail-row-menu-trash')).toHaveAttribute('data-variant', 'destructive')
  expect(location()).toBe('/mail/1')
  // 읽은 행은 「안 읽음으로 표시」.
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('mail-row-menu-10')).not.toBeInTheDocument())
  expect(itemNames(await openMenu(11))).toContain('안 읽음으로 표시')
})

test('답장 → 상세를 받아 작성 창(받는사람 보낸 사람·제목 Re:), 안 읽은 메일은 읽음 요청, 메일은 열지 않는다', async () => {
  const { user, reads, details, location } = renderList()
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-reply'))
  await waitFor(() => expect(chips('to')).toEqual(['alice@example.com']))
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('Re: 분기 보고서')
  expect(details.calls.length).toBeGreaterThan(0)
  await waitFor(() => expect(reads.calls).toHaveLength(1))
  expect(screen.queryByTestId('mail-row-menu-10')).not.toBeInTheDocument()
  expect(location()).toBe('/mail/1')
})

test('전체답장 → 참조에 원본 받는사람·참조(나 제외)', async () => {
  const { user } = renderList()
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-reply-all'))
  await waitFor(() => expect(chips('to')).toEqual(['alice@example.com']))
  expect(chips('cc')).toEqual(['carol@example.com', 'bob@example.com'])
})

test('전달 → 제목 Fwd:, 받는사람 비고 원본 첨부가 칩으로 들어 있다', async () => {
  const { user } = renderList()
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-forward'))
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('Fwd: 분기 보고서'))
  expect(chips('to')).toEqual([])
  expect(screen.getByTestId('mail-compose-attachments')).toHaveTextContent('안건.pdf')
})

test('상세 받기 실패 → 오류 토스트, 작성 창은 열리지 않고 읽음 요청도 없다', async () => {
  const { user, reads } = renderList('/mail/1', {
    detailReply: () => HttpResponse.json({ message: '서버 오류' }, { status: 500 }),
  })
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-reply'))
  expect(await screen.findByText(/메일을 불러오지 못했어요|서버 오류/)).toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument()
  expect(reads.calls).toHaveLength(0)
})

test('다른 메일이 열려 있어도 우클릭한 행의 메일로 답장한다(열린 상세는 그대로)', async () => {
  const { user, location } = renderList('/mail/1?messageId=11')
  expect(await screen.findByTestId('mail-detail')).toHaveTextContent('회의록')
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-reply'))
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('Re: 분기 보고서'))
  expect(chips('to')).toEqual(['alice@example.com'])
  expect(location()).toBe('/mail/1?messageId=11')
})

test('읽음 전환 — 안 읽은 행은 읽음 요청, 읽은 행은 안 읽음 요청. 메일은 열리지 않는다', async () => {
  const { user, reads, unreads } = renderList()
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-toggle-read'))
  await waitFor(() => expect(reads.calls).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-unread-bar-10')).not.toBeInTheDocument())
  await openMenu(11)
  await user.click(screen.getByTestId('mail-row-menu-toggle-read'))
  await waitFor(() => expect(unreads.calls).toHaveLength(1))
  expect(await screen.findByTestId('mail-unread-bar-11')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-detail')).not.toBeInTheDocument()
})

test('보관 → 행이 빠지고 「보관했습니다」, 5초 뒤 ARCHIVE', async () => {
  const { user, moves } = renderList()
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-archive'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(await screen.findByText('보관했습니다')).toBeInTheDocument()
  expect(moves.calls).toHaveLength(0)
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'ARCHIVE' } })
})

test('삭제 → 「삭제했습니다」 실행 취소 토스트, 5초 뒤 TRASH', async () => {
  const { user, moves } = renderList()
  await openMenu(11)
  await user.click(screen.getByTestId('mail-row-menu-trash'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-11')).not.toBeInTheDocument())
  expect(await screen.findByText('삭제했습니다')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '실행 취소' })).toBeInTheDocument()
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [11], target: { kind: 'TRASH' } })
})

test('옮기기 ▸ 하위 메뉴 — 옮기기 드롭다운과 같은 목록, 고르면 그 메일함으로 옮긴다', async () => {
  const { user, moves } = renderList()
  await openMenu(10)
  const sub = await openSub(user, 'mail-row-menu-move', 'mail-row-menu-move-sub')
  expect(within(sub).getByText('옮길 메일함')).toBeInTheDocument()
  expect(within(sub).getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual(['보관', '프로젝트', '견적'])
  await user.click(within(sub).getByTestId('mail-row-menu-move-target-folder-6'))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'FOLDER', folderId: 6 } })
})

test('분류 바꾸기 ▸ 하위 메뉴 — 지금 분류 ✓, 고르면 PUT 과 「분류를 … 바꿨어요」', async () => {
  const { user, categories } = renderList()
  await openMenu(10)
  const sub = await openSub(user, 'mail-row-menu-category', 'mail-row-menu-category-sub')
  expect(within(sub).getByRole('menuitemcheckbox', { name: '업무' })).toHaveAttribute('aria-checked', 'true')
  // 직접 바꾼 분류가 아니면 되돌리기가 없다.
  expect(within(sub).queryByTestId('mail-row-menu-category-revert')).not.toBeInTheDocument()
  await user.click(within(sub).getByRole('menuitemcheckbox', { name: '프로모션' }))
  await waitFor(() => expect(categories.calls).toHaveLength(1))
  expect(categories.last().body).toEqual({ category: '프로모션' })
  expect(await screen.findByText('분류를 프로모션으로 바꿨어요')).toBeInTheDocument()
})

test('채팅·이슈로 보내기 — 그 메일 링크로 열고 메일은 열지 않는다(WP-1236 항목 유지)', async () => {
  const { user, location } = renderList()
  await openMenu(10)
  await user.click(screen.getByTestId('menu-send-to-chat'))
  await waitFor(() => expect(sendToChatTarget()).toMatchObject({ kind: 'mail', url: `${window.location.origin}/mail/1?messageId=10` }))
  expect(location()).toBe('/mail/1')
  act(() => closeSendToChat())
})

test('휴지통 보기 — 보관·옮기기·분류·삭제 대신 되살리기·완전히 삭제, 되살리기는 5초 뒤 RESTORE', async () => {
  const { user, moves } = renderList('/mail/1?box=9')
  const menu = await openMenu(10)
  expect(itemNames(menu)).toEqual(['답장', '전체답장', '전달', '읽음으로 표시', '되살리기', '완전히 삭제', '링크 복사', '채팅·이슈로 보내기…'])
  expect(screen.getByTestId('mail-row-menu-permanent-delete')).toHaveAttribute('data-variant', 'destructive')
  await user.click(screen.getByTestId('mail-row-menu-restore'))
  expect(await screen.findByText('되살렸습니다')).toBeInTheDocument()
  await passUndoDelay()
  await waitFor(() => expect(moves.calls).toHaveLength(1))
  expect(moves.last().body).toEqual({ messageIds: [10], target: { kind: 'RESTORE' } })
})

test('휴지통 보기 완전히 삭제 → 확인 창(그 메일 제목) → 「삭제」 → POST {messageIds:[10]}', async () => {
  const { user, deletes } = renderList('/mail/1?box=9')
  await openMenu(10)
  await user.click(screen.getByTestId('mail-row-menu-permanent-delete'))
  const dialog = await screen.findByTestId('mail-permanent-delete-confirm')
  expect(dialog).toHaveTextContent('"분기 보고서" 메일을 메일 서버에서도 지웁니다. 되돌릴 수 없습니다.')
  await user.click(within(dialog).getByTestId('mail-permanent-delete-confirm-ok'))
  await waitFor(() => expect(deletes.calls).toHaveLength(1))
  expect(deletes.last().body).toEqual({ messageIds: [10] })
})

test('미지원 서버면 완전히 삭제가 꺼지고 항목 안에 짧은 이유 글 — 이름은 그대로, 이유는 설명으로 읽힌다', async () => {
  const { user, deletes } = renderList('/mail/1?box=9', { trashUnsupported: true })
  const menu = await openMenu(10)
  const item = await within(menu).findByRole('menuitem', { name: '완전히 삭제' })
  await waitFor(() => expect(item).toHaveAttribute('aria-disabled', 'true'))
  expect(item).toBe(screen.getByTestId('mail-row-menu-permanent-delete'))
  // 이유 글은 항목 안에 보인다 — 메뉴(role=menu)에 메뉴 항목이 아닌 자식을 두지 않는다(aria-required-children).
  const reason = within(item).getByTestId('mail-row-menu-permanent-delete-unsupported')
  expect(reason).toHaveTextContent(/^이 메일 서버는 지원하지 않아요$/)
  expect(item).toHaveAccessibleDescription('이 메일 서버는 지원하지 않아요')
  // 이유 글은 흐리지 않는다 — 항목 전체 흐림을 풀고(opacity-100) 이름만 흐린다(WP-1730 대비).
  expect(item.className).toContain('data-[disabled]:opacity-100')
  expect(screen.getByTestId('mail-row-menu-permanent-delete-label')).toHaveClass('opacity-50')
  expect(reason.closest('.opacity-50')).toBeNull()
  expect(Array.from(menu.children).every((el) => ['menuitem', 'separator'].includes(el.getAttribute('role') ?? ''))).toBe(true)
  // 꺼진 항목은 골라도 확인 창을 열지 않는다.
  await user.click(item)
  expect(screen.queryByTestId('mail-permanent-delete-confirm')).not.toBeInTheDocument()
  expect(deletes.calls).toHaveLength(0)
})

test('보낸편지함 — 이동·분류 항목 없이 답장류·읽음 전환·링크만', async () => {
  renderList('/mail/1?folder=sent')
  const menu = await openMenu(11)
  expect(itemNames(menu)).toEqual(['답장', '전체답장', '전달', '안 읽음으로 표시', '링크 복사', '채팅·이슈로 보내기…'])
})

test('서버 메일함 보기 — 보관·옮기기·삭제는 있고 분류 바꾸기는 없다(AI 분류를 끄는 보기)', async () => {
  renderList('/mail/1?box=5')
  const menu = await openMenu(10)
  expect(itemNames(menu)).toEqual(['답장', '전체답장', '전달', '읽음으로 표시', '보관', '옮기기', '삭제', '링크 복사', '채팅·이슈로 보내기…'])
})
