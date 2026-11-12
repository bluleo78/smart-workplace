// 메일 작성 「새 창으로 열기」(WP-1535) — 화면 테스트.
// 메인 창: 데스크톱 작성창 머리줄 ↗ → 강제 임시저장(손대지 않은 새 메일도 POST) → 클릭에서 바로 연 빈 창의 주소를 /mail/compose?draftId=N 으로,
//          작성창은 저장 알림 없이 닫힌다. 팝업 차단이면 작성창을 그대로 두고 알리고, 저장 실패면 빈 창을 닫는다. 첨부 업로드 중엔 단추가 꺼진다.
// 새 창: /mail/compose?draftId=N 이 앱 셸 없이 작성창만 그린다. 보내기·닫기·버리기는 서버 작업이 끝난 뒤 BroadcastChannel 로 알리고 창을 닫는다.
// 메인 창 셸은 그 알림을 받아 보낸편지함·임시보관함을 다시 받는다. 모바일 숨김은 mailComposeSignatureMobile.test.tsx(한 파일 한 뷰포트).
// window.open·window.close 는 jsdom 에 실제 창이 없어 가짜로 둔다 — 실제 팝업 창은 e2e/pages/mail/mail-compose-popout.spec.ts(@platform).
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  forgetMailComposePopout,
  liveMailComposePopout,
  MAIL_COMPOSE_CHANNEL,
  MAIL_COMPOSE_WINDOW_ID,
  type MailComposeWindowMessage,
  rememberMailComposePopout,
} from '@/lib/mailComposeChannel'
import MailComposeWindowPage from '@/pages/mail/MailComposeWindowPage'
import { mailBaseHandlers, record, renderMail } from '@/test/kits/mail/testkit-b4'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'
import type { MailDraftSaveRequest, MailDraftSummary } from '@/types/mailDraft'

import { draftDetail, mailAccount } from '../../../e2e/factories/mail.factory'

/** 가짜 새 창 — 주소 설정과 닫기만 본다. */
function fakeWindow() {
  return { location: { href: '' }, close: vi.fn(), closed: false, focus: vi.fn() }
}

/** 새 창이 보낸 알림 하나 — 테스트 새 창(/mail/compose?draftId=7)은 opener 가 없다. */
const msg = (type: MailComposeWindowMessage['type'], over: Partial<MailComposeWindowMessage> = {}): MailComposeWindowMessage => ({
  source: MAIL_COMPOSE_CHANNEL,
  type,
  accountId: 1,
  draftId: 7,
  opener: null,
  ...over,
})

/** 새 창이 보내는 알림을 모은다(같은 프로세스의 BroadcastChannel 은 서로 전달된다). */
let heard: MailComposeWindowMessage[] = []
let channel: BroadcastChannel | null = null
beforeEach(() => {
  heard = []
  channel = new BroadcastChannel(MAIL_COMPOSE_CHANNEL)
  channel.onmessage = (e) => heard.push(e.data)
})
afterEach(() => {
  channel?.close()
  vi.restoreAllMocks()
})

const created = () => HttpResponse.json({ id: 101, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 })

// ── 메인 창 ↗ ────────────────────────────────────────────────

test('↗ 는 손대지 않은 새 메일도 임시저장으로 만들고, 클릭에서 연 빈 창의 주소를 그 id 로 정한 뒤 작성창을 알림 없이 닫는다', async () => {
  const win = fakeWindow()
  const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', created)
  const view = renderMail('/mail/1', { handlers: [post.handler] })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  const popout = await screen.findByTestId('mail-compose-popout')
  expect(popout).toHaveAccessibleName('새 창으로 열기')

  await view.user.click(popout)
  // 저장을 기다리기 전, 클릭에서 바로 빈 창을 연다(팝업 차단 회피) — 이름은 창마다 달라 다른 작성 창을 덮지 않는다.
  expect(open).toHaveBeenCalledTimes(1)
  const [url, name, features] = open.mock.calls[0]
  expect(url).toBe('')
  expect(name).toMatch(/^mail-compose-/)
  expect(features).toContain('width=900')
  expect(features).toContain('height=760')

  // 연 창의 id(결과 토스트를 띄울 창)와, 손대지 않은 작성을 옮기려 만든 임시저장(fresh)을 함께 싣는다.
  await waitFor(() => expect(win.location.href).toBe(`/mail/compose?draftId=101&opener=${MAIL_COMPOSE_WINDOW_ID}&fresh=1`))
  // 같은 임시저장을 다시 열면 이 창을 앞으로 가져오게 기억한다.
  expect(liveMailComposePopout(101)).toBe(win)
  forgetMailComposePopout(101)
  expect(post.calls).toHaveLength(1)
  expect(post.calls[0].body).toMatchObject({ accountId: 1, mode: 'new', subject: '' })
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  expect(win.close).not.toHaveBeenCalled()
  expect(screen.queryByText('임시보관함에 저장했어요')).not.toBeInTheDocument()
})

test('팝업이 막히면 저장하지 않고 작성창을 그대로 둔 채 알린다', async () => {
  vi.spyOn(window, 'open').mockReturnValue(null)
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', created)
  const view = renderMail('/mail/1', { handlers: [post.handler] })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await view.user.click(await screen.findByTestId('mail-compose-popout'))
  expect(await screen.findByText('팝업이 막혀 새 창으로 열지 못했어요')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  expect(post.calls).toHaveLength(0)
})

test('임시저장에 실패하면 빈 창을 닫고 작성창을 그대로 둔다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  const post = record('post', '/api/v1/mail/drafts', () => HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }))
  const view = renderMail('/mail/1', { handlers: [post.handler] })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await view.user.click(await screen.findByTestId('mail-compose-popout'))
  await waitFor(() => expect(win.close).toHaveBeenCalled())
  expect(await screen.findByText('새 창으로 열지 못했어요')).toBeInTheDocument()
  expect(win.location.href).toBe('')
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
})

test('첨부가 올라가는 중이면 ↗ 가 꺼져 있고 이유를 툴팁으로 보인다', async () => {
  const view = renderMail('/mail/1', {
    // 업로드가 끝나지 않는다 — 올리는 중 상태로 둔다.
    handlers: [http.post('/api/v1/mail/compose-attachments', () => new Promise<Response>(() => {}))],
  })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  expect(await screen.findByTestId('mail-compose-popout')).toBeEnabled()
  await view.user.upload(screen.getByTestId('mail-compose-file-input') as HTMLInputElement, new File(['A'], 'a.pdf', { type: 'application/pdf' }))
  await waitFor(() => expect(screen.getByTestId('mail-compose-popout')).toBeDisabled())
  expect(screen.getByTestId('mail-compose-popout').getAttribute('title')).not.toBe('새 창으로 열기')
})

test('빈 창을 저장 중에 닫으면 작성창을 그대로 두고 죽은 창은 건드리지 않는다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  let release!: (r: Response) => void
  const post = record('post', '/api/v1/mail/drafts', () => new Promise<Response>((r) => (release = r)))
  const view = renderMail('/mail/1', { handlers: [post.handler] })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await view.user.click(await screen.findByTestId('mail-compose-popout'))
  await waitFor(() => expect(post.calls).toHaveLength(1))
  win.closed = true
  release(HttpResponse.json({ id: 101, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }))
  // 저장 뒤 잠금이 풀리고 작성창이 남는다(주소는 정하지 않는다).
  await waitFor(() => expect(screen.getByTestId('mail-compose-popout')).toBeEnabled())
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  expect(win.location.href).toBe('')
  expect(win.close).not.toHaveBeenCalled()
  expect(liveMailComposePopout(101)).toBeNull()
})

test('검증 오류(400)로 저장하지 못하면 그 사유를 알린다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  const post = record('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ status: 400, message: '받는사람 주소가 올바르지 않아요. 다시 확인해 주세요.' }, { status: 400 }),
  )
  const view = renderMail('/mail/1', { handlers: [post.handler] })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await view.user.click(await screen.findByTestId('mail-compose-popout'))
  await waitFor(() => expect(win.close).toHaveBeenCalled())
  expect(await screen.findByText('새 창으로 열지 못했어요')).toBeInTheDocument()
  expect(screen.getByText('받는사람 주소가 올바르지 않아요')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
})

test('다른 곳에서 보냈거나 버린 임시저장(gone)이면 ↗ 가 꺼지고 이유를 툴팁으로 보인다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  try {
    const post = record('post', '/api/v1/mail/drafts', created)
    const put = record('put', '/api/v1/mail/drafts/101', () =>
      HttpResponse.json({ status: 404, message: '없음', errors: { code: 'DRAFT_NOT_FOUND' } }, { status: 404 }),
    )
    const view = renderMail('/mail/1', { handlers: [post.handler, put.handler] })
    await view.user.click(await screen.findByTestId('mail-compose-new'))
    const subject = () => screen.getByTestId('mail-compose-subject')
    fireEvent.change(subject(), { target: { value: '첫 저장' } })
    await act(() => vi.advanceTimersByTimeAsync(1500))
    await waitFor(() => expect(post.calls).toHaveLength(1))
    fireEvent.change(subject(), { target: { value: '두 번째 저장' } })
    await act(() => vi.advanceTimersByTimeAsync(1500))
    await waitFor(() => expect(put.calls).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('mail-compose-popout')).toBeDisabled())
    expect(screen.getByTestId('mail-compose-popout')).toHaveAttribute('title', '다른 곳에서 보냈거나 버린 메일이라 새 창으로 열 수 없어요')
  } finally {
    vi.useRealTimers()
  }
})

test('새 창에서 쓰는 임시저장을 임시보관함에서 다시 열면 두 번째 편집기 대신 그 창을 앞으로 가져온다', async () => {
  const row: MailDraftSummary = { id: 7, accountId: 1, mode: 'new', to: ['rcpt@test.local'], subject: '새 창 메일', preview: '', attachmentCount: 0, updatedAt: '2026-11-12T00:00:00Z' }
  const detailGet = record('get', '/api/v1/mail/drafts/7', () => HttpResponse.json(draftDetail({ id: 7, subject: '새 창 메일' })))
  const view = renderMail('/mail/1?folder=drafts', {
    handlers: [http.get('/api/v1/mail/drafts', () => HttpResponse.json([row])), detailGet.handler],
  })
  const win = fakeWindow()
  rememberMailComposePopout(7, win as unknown as Window)
  await view.user.click(await screen.findByTestId('mail-draft-row-7'))
  expect(win.focus).toHaveBeenCalled()
  expect(await screen.findByText('이 메일은 새 창에서 쓰는 중이에요')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument()
  expect(detailGet.calls).toHaveLength(0)

  // 그 창이 닫혔으면 잊고 이 창에서 연다.
  win.closed = true
  await view.user.click(screen.getByTestId('mail-draft-row-7'))
  await screen.findByTestId('mail-compose-dock')
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
  expect(liveMailComposePopout(7)).toBeNull()
})

// ── 새 창 ────────────────────────────────────────────────────

/** 새 창 페이지를 /mail/compose?draftId=7 로 띄운다 — 임시저장 7(받는사람·제목·본문 있음). */
function renderWindow(extra: RequestHandler[] = [], path = '/mail/compose?draftId=7') {
  return renderScreen(
    <Routes>
      <Route path="/mail/compose" element={<MailComposeWindowPage />} />
    </Routes>,
    {
      path,
      handlers: [...extra, http.get('/api/v1/mail/drafts/7', () => HttpResponse.json(draftDetail({ id: 7, subject: '새 창 메일' }))), ...mailBaseHandlers()],
    },
  )
}

test('새 창은 그 임시저장을 작성창으로 열고, 최소화·크게 보기·새 창 단추 없이 창 제목을 메일 제목으로 둔다', async () => {
  renderWindow()
  const subject = (await screen.findByTestId('mail-compose-subject')) as HTMLInputElement
  await waitFor(() => expect(subject).toHaveValue('새 창 메일'))
  expect(screen.getByTestId('mail-compose-to')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-minimize')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-expand')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-popout')).not.toBeInTheDocument()
  // 크게 보기 배경·대화상자가 아니라 창 전체를 채운다.
  expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock').className).toContain('inset-0')
  await waitFor(() => expect(document.title).toContain('새 창 메일'))
})

test('새 창에서 보내면 draftId 를 실어 보내고, 메인 창에 sent 를 알린 뒤 창을 닫는다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const send = record<{ draftId?: number }>('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ localMessageId: 10, messageId: 'x@test.local' }))
  const view = renderWindow([send.handler])
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.calls[0].body.draftId).toBe(7)
  await waitFor(() => expect(heard).toContainEqual(msg('sent')))
  expect(close).toHaveBeenCalled()
  // 창이 스스로 닫히지 못하는 경우(직접 연 탭)엔 끝남 안내가 남는다.
  expect(screen.getByTestId('mail-compose-window-done')).toBeInTheDocument()
})

test('새 창 ✕ 는 남은 변경을 저장한 뒤에야 saved 를 알리고 창을 닫는다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  let release!: (r: Response) => void
  const put = record('put', '/api/v1/mail/drafts/7', () => new Promise<Response>((r) => (release = r)))
  const view = renderWindow([put.handler])
  const subject = screen.getByTestId.bind(screen, 'mail-compose-subject')
  await waitFor(() => expect(subject()).toHaveValue('새 창 메일'))
  await view.user.type(subject(), '!')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(put.calls).toHaveLength(1))
  // 저장 응답 전엔 닫지 않는다 — 창을 먼저 닫으면 나가던 저장이 끊긴다.
  expect(close).not.toHaveBeenCalled()
  expect(heard).toHaveLength(0)
  release(HttpResponse.json({ version: 2, updatedAt: '2026-11-12T00:00:01Z', attachmentCount: 0 }))
  await waitFor(() => expect(heard).toContainEqual(msg('saved')))
  expect(close).toHaveBeenCalled()
})

test('새 창 ✕ 저장이 실패하면 창을 닫지 않고 알린다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const put = record('put', '/api/v1/mail/drafts/7', () => HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }))
  const view = renderWindow([put.handler])
  const subject = () => screen.getByTestId('mail-compose-subject')
  await waitFor(() => expect(subject()).toHaveValue('새 창 메일'))
  await view.user.type(subject(), '!')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  expect(await screen.findByText('임시저장하지 못했어요')).toBeInTheDocument()
  expect(close).not.toHaveBeenCalled()
  expect(heard).toHaveLength(0)
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
})

test('새 창에서 버리면 지우기가 끝난 뒤 discarded 를 알리고 창을 닫는다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const del = record('delete', '/api/v1/mail/drafts/7')
  const view = renderWindow([del.handler])
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
  await view.user.click(screen.getByTestId('mail-compose-discard'))
  await waitFor(() => expect(heard).toContainEqual(msg('discarded')))
  expect(del.calls).toHaveLength(1)
  expect(close).toHaveBeenCalled()
})

test('없는 임시저장이면 빈 창 대신 안내를 보인다', async () => {
  renderWindow([
    http.get('/api/v1/mail/drafts/7', () => HttpResponse.json({ status: 404, message: '없음', errors: { code: 'DRAFT_NOT_FOUND' } }, { status: 404 })),
  ])
  expect(await screen.findByTestId('mail-compose-window-error')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument()
})

test('새 창에서 버리기가 실패하면 창을 남기고, 이어 쓴 내용은 ✕ 로 저장된 뒤 saved 로 닫힌다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const del = record('delete', '/api/v1/mail/drafts/7', () => HttpResponse.json({ status: 500, message: '서버 오류' }, { status: 500 }))
  const put = record<MailDraftSaveRequest & { version?: number }>('put', '/api/v1/mail/drafts/7', () =>
    HttpResponse.json({ version: 2, updatedAt: '2026-11-12T00:00:01Z', attachmentCount: 0 }),
  )
  const view = renderWindow([del.handler, put.handler])
  const subject = () => screen.getByTestId('mail-compose-subject')
  await waitFor(() => expect(subject()).toHaveValue('새 창 메일'))
  await view.user.click(screen.getByTestId('mail-compose-discard'))
  expect(await screen.findByText('임시저장을 버리지 못했어요')).toBeInTheDocument()
  expect(close).not.toHaveBeenCalled()
  expect(heard).toHaveLength(0)

  await view.user.type(subject(), '!')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(put.calls).toHaveLength(1))
  expect(put.calls[0].body).toMatchObject({ subject: '새 창 메일!', version: 1 })
  await waitFor(() => expect(heard).toContainEqual(msg('saved')))
  expect(close).toHaveBeenCalled()
})

test('손대지 않은 작성을 옮기려 만든 임시저장(fresh)은 손대지 않고 닫으면 지우고 결과 알림 없이 닫힌다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const del = record('delete', '/api/v1/mail/drafts/7')
  const view = renderWindow([del.handler], '/mail/compose?draftId=7&opener=main-1&fresh=1')
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(heard).toContainEqual(msg('closed', { opener: 'main-1' })))
  expect(del.calls).toHaveLength(1)
  expect(close).toHaveBeenCalled()
})

test('원래 있던 임시저장(fresh 아님)은 손대지 않고 닫아도 지우지 않고 saved 로 닫힌다', async () => {
  vi.spyOn(window, 'close').mockImplementation(() => {})
  const del = record('delete', '/api/v1/mail/drafts/7')
  const view = renderWindow([del.handler], '/mail/compose?draftId=7&opener=main-1')
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(heard).toContainEqual(msg('saved', { opener: 'main-1' })))
  expect(del.calls).toHaveLength(0)
})

test('fresh 라도 새 창에서 고쳤으면 지우지 않고 저장한 뒤 saved 로 닫힌다', async () => {
  vi.spyOn(window, 'close').mockImplementation(() => {})
  const del = record('delete', '/api/v1/mail/drafts/7')
  const put = record('put', '/api/v1/mail/drafts/7', () => HttpResponse.json({ version: 2, updatedAt: '2026-11-12T00:00:01Z', attachmentCount: 0 }))
  const view = renderWindow([del.handler, put.handler], '/mail/compose?draftId=7&fresh=1')
  const subject = () => screen.getByTestId('mail-compose-subject')
  await waitFor(() => expect(subject()).toHaveValue('새 창 메일'))
  await view.user.type(subject(), '!')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(heard).toContainEqual(msg('saved')))
  expect(put.calls).toHaveLength(1)
  expect(del.calls).toHaveLength(0)
})

test('새 창 ✕ 가 검증 오류(400)로 저장하지 못하면 그 사유를 알리고 창을 남긴다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const put = record('put', '/api/v1/mail/drafts/7', () => HttpResponse.json({ status: 400, message: '제목이 너무 길어요. 줄여 주세요.' }, { status: 400 }))
  const view = renderWindow([put.handler])
  const subject = () => screen.getByTestId('mail-compose-subject')
  await waitFor(() => expect(subject()).toHaveValue('새 창 메일'))
  await view.user.type(subject(), '!')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  expect(await screen.findByText('제목이 너무 길어요')).toBeInTheDocument()
  expect(close).not.toHaveBeenCalled()
})

/** beforeunload 를 막는가(저장 안 한 변경 경고) — 창이 스스로 닫힐 때 「사이트에서 나가시겠어요?」가 뜨면 안 된다. */
const unloadBlocked = () => {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

test('새 창에서 고친 뒤 보내도, 창을 닫는 순간엔 나가기 경고(beforeunload)가 걸려 있지 않다', async () => {
  const blockedAtClose: boolean[] = []
  vi.spyOn(window, 'close').mockImplementation(() => void blockedAtClose.push(unloadBlocked()))
  const send = record('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ localMessageId: 10, messageId: 'x@test.local' }))
  const put = record('put', '/api/v1/mail/drafts/7', () => HttpResponse.json({ version: 2, updatedAt: '2026-11-12T00:00:01Z', attachmentCount: 0 }))
  const view = renderWindow([send.handler, put.handler])
  const subject = () => screen.getByTestId('mail-compose-subject')
  await waitFor(() => expect(subject()).toHaveValue('새 창 메일'))
  await view.user.type(subject(), '!')
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(blockedAtClose).toHaveLength(1))
  expect(blockedAtClose[0]).toBe(false)
})

test('새 창에서 고친 뒤 ✕ 로 닫아도, 창을 닫는 순간엔 나가기 경고가 걸려 있지 않다', async () => {
  const blockedAtClose: boolean[] = []
  vi.spyOn(window, 'close').mockImplementation(() => void blockedAtClose.push(unloadBlocked()))
  const put = record('put', '/api/v1/mail/drafts/7', () => HttpResponse.json({ version: 2, updatedAt: '2026-11-12T00:00:01Z', attachmentCount: 0 }))
  const view = renderWindow([put.handler])
  const subject = () => screen.getByTestId('mail-compose-subject')
  await waitFor(() => expect(subject()).toHaveValue('새 창 메일'))
  await view.user.type(subject(), '!')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(blockedAtClose).toHaveLength(1))
  expect(blockedAtClose[0]).toBe(false)
})

// ── 실제 라우트(앱 셸) ───────────────────────────────────────

test('/mail/compose 는 앱 셸(레일) 없이 작성창만 그린다', async () => {
  renderPage('/mail/compose?draftId=7', {
    handlers: [http.get('/api/v1/mail/drafts/7', () => HttpResponse.json(draftDetail({ id: 7, subject: '셸 없는 창' }))), ...mailBaseHandlers()],
  })
  const subject = await screen.findByTestId('mail-compose-subject', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await waitFor(() => expect(subject).toHaveValue('셸 없는 창'))
  expect(screen.getByTestId('mail-compose-window')).toBeInTheDocument()
  expect(document.querySelector('[data-testid^="rail-link-"]')).toBeNull()
  expect(document.querySelector('[data-ai-page-root]')).toBeNull()
})

test('메인 창은 새 창의 sent 알림에 보낸편지함·임시보관함 개수를 다시 받고, 그 새 창을 연 창일 때만 「메일을 보냈습니다」를 띄운다', async () => {
  const counts = record('get', '/api/v1/mail/drafts/count', () => HttpResponse.json({ count: 0 }))
  const lists = record('get', '/api/v1/mail/accounts/1/messages', () => HttpResponse.json([]))
  renderPage('/mail/1?folder=sent', { handlers: [counts.handler, lists.handler, ...mailBaseHandlers({ accounts: [mailAccount()] })] })
  await screen.findByTestId('mail-compose-new', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(0))
  await waitFor(() => expect(lists.calls.some((c) => c.url.searchParams.get('folder') === 'SENT')).toBe(true))
  const countsBefore = counts.calls.length
  const sentBefore = lists.calls.filter((c) => c.url.searchParams.get('folder') === 'SENT').length

  const other = new BroadcastChannel(MAIL_COMPOSE_CHANNEL)
  // 다른 탭이 연 새 창의 알림 — 목록만 조용히 다시 받는다.
  other.postMessage(msg('sent', { opener: 'another-tab' }))
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(countsBefore))
  await waitFor(() => expect(lists.calls.filter((c) => c.url.searchParams.get('folder') === 'SENT').length).toBeGreaterThan(sentBefore))
  expect(screen.queryByText('메일을 보냈습니다')).not.toBeInTheDocument()

  // 이 창이 연 새 창의 알림 — 결과를 알리고, 「새 창에서 쓰는 중」 기억도 지운다.
  rememberMailComposePopout(7, fakeWindow() as unknown as Window)
  other.postMessage(msg('sent', { opener: MAIL_COMPOSE_WINDOW_ID }))
  other.close()
  expect(await screen.findByText('메일을 보냈습니다')).toBeInTheDocument()
  expect(liveMailComposePopout(7)).toBeNull()
})
