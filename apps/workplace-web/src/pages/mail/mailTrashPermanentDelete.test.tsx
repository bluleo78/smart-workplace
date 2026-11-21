// 메일 휴지통 「완전히 삭제」(WP-1682) — 데스크톱 화면 테스트.
// 휴지통 보기 상세의 「완전히 삭제」 → 확인 창(제목·본문·사본 안내) → 「삭제」 → POST, 결과별 토스트·상세 닫힘·목록 다시 받기,
// UIDPLUS 없음으로 기록된 서버의 비활성 + 이유 툴팁, 처리 중 연타 막기, 받은편지함 보기엔 없음을 본다.
// 휴대폰 화면(⋯ 메뉴)은 mailTrashMobile.test.tsx 가 본다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PERMANENT_DELETE_UNSUPPORTED_REASON, TRASH_COPY_NOTE } from '@/lib/mailTrashActions'
import { record, renderMail, unreadCounts } from '@/test/kits/mail/testkit-b4'
import type { MailMoveResponse, MailServerFolder, MailTrashEmptyStatus } from '@/types/mailFolder'

import { detail, mailServerFolder, summary } from '../../../e2e/factories/mail.factory'

const LIST = '/api/v1/mail/accounts/1/messages'
const DELETE = '/api/v1/mail/accounts/1/messages/permanent-delete'
const IDLE: MailTrashEmptyStatus = { state: 'IDLE', total: null, deleted: 0, failed: 0, startedAt: null, finishedAt: null, errorCode: null, error: null }
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))

const trashFolder = (over: Partial<MailServerFolder> = {}) => mailServerFolder({ id: 9, displayName: 'Trash', role: 'TRASH', totalCount: 132, ...over })

/**
 * 휴지통(id 9) 보기 — 메일함 목록·목록·상세·완전 삭제 요청을 기록한다. 완전히 지운 메일은 목록에서 뺀다.
 * deleteReply 로 완전 삭제 응답을 바꾼다(기본: 모두 ok). folders 는 부를 때마다 새로 계산해 「다시 받으면 바뀐다」를 흉내 낸다.
 */
function renderTrash(
  path = '/mail/1?box=9',
  opts: { deleteReply?: (ids: number[]) => Response | Promise<Response>; folders?: () => MailServerFolder[] } = {},
) {
  const deleted = new Set<number>()
  const deletes = record<{ messageIds: number[] }>('post', DELETE, ({ body }) => {
    if (opts.deleteReply) return opts.deleteReply(body.messageIds)
    body.messageIds.forEach((id) => deleted.add(id))
    return HttpResponse.json({ results: body.messageIds.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
  })
  const rows = [summary({ id: 10, seen: true, subject: '지운 메일' }), summary({ id: 11, seen: true, subject: '다른 메일' })]
  const lists = record('get', LIST, () => HttpResponse.json(rows.filter((m) => !deleted.has(m.id))))
  const details = record('get', '/api/v1/mail/messages/10', () =>
    deleted.has(10) ? HttpResponse.json({ message: '메일을 찾을 수 없습니다' }, { status: 404 }) : HttpResponse.json(detail({ id: 10, seen: true, subject: '지운 메일' })),
  )
  const folders = record('get', '/api/v1/mail/accounts/1/folders', () =>
    HttpResponse.json(opts.folders ? opts.folders() : [mailServerFolder({ id: 1, displayName: 'Archive', role: 'ARCHIVE' }), trashFolder()]),
  )
  const view = renderMail(path, {
    handlers: [
      deletes.handler,
      lists.handler,
      details.handler,
      http.get('/api/v1/mail/messages/11', () => HttpResponse.json(detail({ id: 11, seen: true, subject: '다른 메일' }))),
      folders.handler,
      http.get('/api/v1/mail/accounts/1/unread-counts', () => HttpResponse.json(unreadCounts({ classificationActive: false }))),
      http.get('/api/v1/mail/accounts/1/trash/empty', () => HttpResponse.json(IDLE)),
      http.post('/api/v1/mail/accounts/1/folders/9/sync', () =>
        HttpResponse.json({ running: false, fetched: 0, saved: 0, seenChanged: 0, removed: 0, syncedSince: null, folderSyncedAt: null }),
      ),
    ],
  })
  return { ...view, deletes, lists, details, folders }
}

/** 휴지통 목록에서 메일 10 을 열고 상세의 「완전히 삭제」를 돌려준다. */
async function openDetail(user: ReturnType<typeof renderTrash>['user']) {
  await user.click(await screen.findByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  return screen.getByTestId('mail-permanent-delete')
}

test('상세 「완전히 삭제」 → 확인 창 제목·본문·사본 안내 → 「삭제」 → POST {messageIds:[10]} → 상세 닫힘·목록 다시 받음·토스트 「완전히 삭제했습니다」', async () => {
  const { user, deletes, lists, details } = renderTrash()
  const button = await openDetail(user)
  expect(button).toHaveTextContent('완전히 삭제')
  // 「되살리기」 바로 뒤에 둔다.
  // 늘 감싸개 안에 있으므로(WP-1856) 되살리기의 다음 형제는 감싸개다.
  expect(screen.getByTestId('mail-restore').nextElementSibling).toBe(screen.getByTestId('mail-permanent-delete-reason'))
  await user.click(button)
  const dialog = await screen.findByTestId('mail-permanent-delete-confirm')
  expect(within(dialog).getByRole('heading')).toHaveTextContent('메일을 완전히 삭제할까요?')
  expect(dialog).toHaveTextContent('"지운 메일" 메일을 메일 서버에서도 지웁니다. 되돌릴 수 없습니다.')
  expect(within(dialog).getByTestId('delete-impact')).toHaveTextContent(TRASH_COPY_NOTE)
  const ok = within(dialog).getByTestId('mail-permanent-delete-confirm-ok')
  expect(ok).toHaveTextContent(/^삭제$/)
  expect(deletes.calls).toHaveLength(0)
  const listsBefore = lists.calls.length
  const detailsBefore = details.calls.length
  await user.click(ok)
  await waitFor(() => expect(deletes.calls).toHaveLength(1))
  expect(deletes.last().body).toEqual({ messageIds: [10] })
  expect(await screen.findByText('완전히 삭제했습니다')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-detail')).not.toBeInTheDocument())
  expect(screen.queryByTestId('mail-permanent-delete-confirm')).not.toBeInTheDocument()
  await waitFor(() => expect(lists.calls.length).toBeGreaterThan(listsBefore))
  await waitFor(() => expect(screen.queryByTestId('mail-row-10')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-row-11')).toBeInTheDocument()
  // 지운 메일의 상세를 다시 받지 않는다 — 다시 받으면 404 로 「메일을 불러오지 못했습니다」가 잠깐 보인다.
  await wait(100)
  expect(details.calls).toHaveLength(detailsBefore)
  expect(screen.queryByText('메일을 불러오지 못했습니다')).not.toBeInTheDocument()
})

test('ok=false 면 상세 그대로 + 「완전히 삭제하지 못했습니다 — 메일 서버에서 지우지 못했습니다」, 502 면 서버 message 를 붙인 토스트', async () => {
  let mode: 'perMail' | 'gateway' = 'perMail'
  const { user, deletes } = renderTrash('/mail/1?box=9', {
    deleteReply: (ids) =>
      mode === 'perMail'
        ? HttpResponse.json({ results: ids.map((id) => ({ messageId: id, ok: false, error: '메일 서버에서 지우지 못했습니다' })) } satisfies MailMoveResponse)
        : HttpResponse.json({ message: '메일 서버에 연결하지 못했습니다' }, { status: 502 }),
  })
  await user.click(await openDetail(user))
  await user.click(within(await screen.findByTestId('mail-permanent-delete-confirm')).getByTestId('mail-permanent-delete-confirm-ok'))
  expect(await screen.findByText('완전히 삭제하지 못했습니다 — 메일 서버에서 지우지 못했습니다')).toBeInTheDocument()
  expect(screen.getByTestId('mail-detail')).toBeInTheDocument()
  expect(screen.getByTestId('mail-row-10')).toBeInTheDocument()
  // 끝나면 확인 창이 닫히고 단추가 다시 켜진다.
  await waitFor(() => expect(screen.queryByTestId('mail-permanent-delete-confirm')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('mail-permanent-delete')).toBeEnabled())

  mode = 'gateway'
  await user.click(screen.getByTestId('mail-permanent-delete'))
  await user.click(within(await screen.findByTestId('mail-permanent-delete-confirm')).getByTestId('mail-permanent-delete-confirm-ok'))
  expect(await screen.findByText('완전히 삭제하지 못했습니다 — 메일 서버에 연결하지 못했습니다')).toBeInTheDocument()
  expect(deletes.calls).toHaveLength(2)
  expect(screen.getByTestId('mail-detail')).toBeInTheDocument()
})

test('permanentDeleteUnsupported 면 「완전히 삭제」·「휴지통 비우기」 둘 다 disabled, 포커스하면 이유 툴팁 글자 그대로', async () => {
  const { user, deletes } = renderTrash('/mail/1?box=9', {
    folders: () => [trashFolder({ permanentDeleteUnsupported: true })],
  })
  const empty = await screen.findByTestId('mail-trash-empty')
  await waitFor(() => expect(empty).toBeDisabled())
  expect(screen.getByTestId('mail-trash-empty-text')).toHaveTextContent('이 메일 서버는 완전히 삭제를 지원하지 않아요')
  const button = await openDetail(user)
  expect(button).toBeDisabled()
  fireEvent.focus(screen.getByTestId('mail-permanent-delete-reason'))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(PERMANENT_DELETE_UNSUPPORTED_REASON)
  fireEvent.blur(screen.getByTestId('mail-permanent-delete-reason'))
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  fireEvent.focus(screen.getByTestId('mail-trash-empty-reason'))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(PERMANENT_DELETE_UNSUPPORTED_REASON)
  expect(deletes.calls).toHaveLength(0)
})

test('모름 상태에서 400 PERMANENT_DELETE_UNSUPPORTED → 메일함 목록을 다시 받고 단추가 비활성으로 바뀐다', async () => {
  // 서버가 막은 뒤에는 메일함 목록이 미지원으로 기록된다.
  let blocked = false
  const { user, folders } = renderTrash('/mail/1?box=9', {
    deleteReply: () => {
      blocked = true
      return HttpResponse.json(
        { message: '이 메일 서버는 완전히 삭제를 지원하지 않습니다', errors: { code: 'PERMANENT_DELETE_UNSUPPORTED' } },
        { status: 400 },
      )
    },
    folders: () => [trashFolder({ permanentDeleteUnsupported: blocked })],
  })
  const button = await openDetail(user)
  expect(button).toBeEnabled()
  const foldersBefore = folders.calls.length
  await user.click(button)
  await user.click(within(await screen.findByTestId('mail-permanent-delete-confirm')).getByTestId('mail-permanent-delete-confirm-ok'))
  expect(await screen.findByText('완전히 삭제하지 못했습니다 — 이 메일 서버는 완전히 삭제를 지원하지 않습니다')).toBeInTheDocument()
  await waitFor(() => expect(folders.calls.length).toBeGreaterThan(foldersBefore))
  await waitFor(() => expect(screen.getByTestId('mail-permanent-delete')).toBeDisabled())
  expect(screen.getByTestId('mail-trash-empty')).toBeDisabled()
})

test('처리 중에는 「완전히 삭제」가 비활성이고 확인을 두 번 눌러도 요청은 1회', async () => {
  // 응답을 붙잡아 처리 중 상태를 본다.
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  const { user, deletes } = renderTrash('/mail/1?box=9', {
    deleteReply: async (ids) => {
      await held
      return HttpResponse.json({ results: ids.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
    },
  })
  await user.click(await openDetail(user))
  const dialog = await screen.findByTestId('mail-permanent-delete-confirm')
  const ok = within(dialog).getByTestId('mail-permanent-delete-confirm-ok')
  // 같은 틱에 두 번 — 다시 그리기 전이라 disabled 가 아직 없다. 처리기의 막기가 없으면 요청이 두 번 나간다.
  act(() => {
    ok.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    ok.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  // 처리 중 — 확인 창은 열린 채 확인 단추가 꺼지고, 상세 단추도 꺼진다.
  await waitFor(() => expect(ok).toBeDisabled())
  expect(screen.getByTestId('mail-permanent-delete-confirm')).toBeInTheDocument()
  expect(screen.getByTestId('mail-permanent-delete')).toBeDisabled()
  await waitFor(() => expect(deletes.calls).toHaveLength(1))
  await wait(50)
  expect(deletes.calls).toHaveLength(1)
  release()
  expect(await screen.findByText('완전히 삭제했습니다')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-permanent-delete-confirm')).not.toBeInTheDocument())
  expect(deletes.calls).toHaveLength(1)
})

test('처리 중 「완전히 삭제」 감싸개 이름은 삭제 중 이유이고 처리 전·중·후 단추는 같은 노드다 (WP-1856)', async () => {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  // 실패(ok=false)로 끝나 상세가 남게 한다 — 처리 후에도 같은 노드인지 보려는 것.
  const { user, deletes } = renderTrash('/mail/1?box=9', {
    deleteReply: async (ids) => {
      await held
      return HttpResponse.json({ results: ids.map((id) => ({ messageId: id, ok: false, error: '실패' })) } satisfies MailMoveResponse)
    },
  })
  const before = await openDetail(user)
  const wrapper = screen.getByTestId('mail-permanent-delete-reason')
  expect(wrapper).not.toHaveAttribute('aria-label')
  await user.click(before)
  await user.click(within(await screen.findByTestId('mail-permanent-delete-confirm')).getByTestId('mail-permanent-delete-confirm-ok'))
  await waitFor(() => expect(deletes.calls).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('mail-permanent-delete-reason')).toHaveAccessibleName('완전히 삭제 — 삭제하는 중이에요'))
  fireEvent.focus(screen.getByTestId('mail-permanent-delete-reason'))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('삭제하는 중이에요')
  expect(screen.getByTestId('mail-permanent-delete')).toBe(before)
  release()
  await waitFor(() => expect(screen.getByTestId('mail-permanent-delete-reason')).not.toHaveAttribute('aria-label'))
  expect(screen.getByTestId('mail-permanent-delete')).toBe(before)
  expect(screen.getByTestId('mail-permanent-delete-reason')).toBe(wrapper)
})

test('처리 중 확인 창을 닫고 다른 메일을 열었으면, 지워진 뒤에도 지금 연 메일의 상세는 닫지 않는다', async () => {
  let release: () => void = () => {}
  const held = new Promise<void>((r) => (release = r))
  const { user } = renderTrash('/mail/1?box=9', {
    deleteReply: async (ids) => {
      await held
      return HttpResponse.json({ results: ids.map((id) => ({ messageId: id, ok: true, error: null })) } satisfies MailMoveResponse)
    },
  })
  await user.click(await openDetail(user))
  await user.click(within(await screen.findByTestId('mail-permanent-delete-confirm')).getByTestId('mail-permanent-delete-confirm-ok'))
  await waitFor(() => expect(screen.getByTestId('mail-permanent-delete-confirm-ok')).toBeDisabled())
  // 응답을 기다리는 동안 확인 창을 닫고 다른 메일(11)을 연다.
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('mail-permanent-delete-confirm')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mail-row-11'))
  await waitFor(() => expect(within(screen.getByTestId('mail-detail')).getByText('다른 메일')).toBeInTheDocument())

  release()
  expect(await screen.findByText('완전히 삭제했습니다')).toBeInTheDocument()
  await wait(50)
  // 지운 메일(10)이 아니라 지금 연 메일(11)이라 상세는 그대로 열려 있다.
  expect(screen.getByTestId('mail-detail')).toBeInTheDocument()
  expect(within(screen.getByTestId('mail-detail')).getByText('다른 메일')).toBeInTheDocument()
  expect(window.location.search).toContain('messageId=11')
})

test('받은편지함 보기에는 「완전히 삭제」·비우기 줄이 없다', async () => {
  const { user } = renderMail('/mail/1', {
    messages: [summary({ id: 10, seen: true })],
    handlers: [
      http.get('/api/v1/mail/messages/10', () => HttpResponse.json(detail({ id: 10, seen: true }))),
      http.get('/api/v1/mail/accounts/1/folders', () => HttpResponse.json([trashFolder()])),
    ],
  })
  await user.click(await screen.findByTestId('mail-row-10'))
  await screen.findByTestId('mail-detail')
  expect(screen.getByTestId('mail-trash')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-permanent-delete')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-trash-empty-row')).not.toBeInTheDocument()
})
