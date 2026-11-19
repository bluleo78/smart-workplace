// 메일 작성 「새 창으로 열기」(WP-1535) — 화면 테스트.
// 메인 창: 데스크톱 작성창 머리줄 ↗ → 강제 임시저장(손대지 않은 새 메일도 POST) → 클릭에서 바로 연 빈 창의 주소를 /mail/compose?draftId=N 으로,
//          작성창은 저장 알림 없이 닫힌다. 팝업 차단이면 작성창을 그대로 두고 알리고, 저장 실패면 빈 창을 닫는다. 첨부 업로드 중엔 단추가 꺼진다.
// 새 창: /mail/compose?draftId=N 이 앱 셸 없이 작성창만 그린다. 보내기·닫기·버리기는 서버 작업이 끝난 뒤 BroadcastChannel 로 알리고 창을 닫는다.
// 메인 창 셸은 그 알림을 받아 보낸편지함·임시보관함을 다시 받는다. 모바일 숨김은 mailComposeSignatureMobile.test.tsx(한 파일 한 뷰포트).
// window.open·window.close 는 jsdom 에 실제 창이 없어 가짜로 둔다 — 실제 팝업 창은 e2e/pages/mail/mail-compose-popout.spec.ts(@platform).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  forgetMailComposePopout,
  isOpenerListening,
  listenMailComposeWindowEvents,
  liveMailComposePopout,
  MAIL_COMPOSE_CHANNEL,
  MAIL_COMPOSE_WINDOW_ID,
  type MailComposeWindowMessage,
  rememberMailComposePopout,
} from '@/lib/mailComposeChannel'
import MailComposeWindowPage from '@/pages/mail/MailComposeWindowPage'
import { fakeWindow } from '@/test/kits/mail/compose-default'
import { mailBaseHandlers, record, renderMail } from '@/test/kits/mail/testkit-b4'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { renderScreen } from '@/test/renderScreen'
import type { MailDraftSaveRequest, MailDraftSummary } from '@/types/mailDraft'

import { draftDetail, mailAccount } from '../../../e2e/factories/mail.factory'

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
  restoreOpener?.()
  restoreOpener = null
})

/**
 * 새 창의 window.opener 를 바꾼다(jsdom 의 새 창은 opener 가 없다). 'listening' 은 같은 문서를 opener 로 두고 메인 창처럼 알림을 듣는다(듣는 표식이
 * 이 문서 id 로 남는다). 그 밖은 주어진 가짜 창(닫힌 창·새로 고쳐진 창)을 쓴다. afterEach 가 되돌린다.
 */
let restoreOpener: (() => void) | null = null
function setOpener(opener: 'listening' | Record<string, unknown>) {
  const stop = opener === 'listening' ? listenMailComposeWindowEvents(() => {}) : () => {}
  Object.defineProperty(window, 'opener', { value: opener === 'listening' ? window : opener, configurable: true, writable: true })
  restoreOpener = () => {
    stop()
    Object.defineProperty(window, 'opener', { value: null, configurable: true, writable: true })
  }
}

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
  // 손대지 않은 작성으로 만든 빈 임시저장은 빈 창을 닫으면 지운다.
  const del = record('delete', '/api/v1/mail/drafts/101')
  const view = renderMail('/mail/1', { handlers: [post.handler, del.handler] })
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
  await waitFor(() => expect(del.calls).toHaveLength(1))
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

/** 메인 창이 연 새 창의 주소 — opener 가 있으면 보낸 결과·되돌리기는 메인 창이 맡는다. */
const WITH_OPENER = `/mail/compose?draftId=7&opener=${MAIL_COMPOSE_WINDOW_ID}`

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

test('새 창은 그 임시저장을 작성창으로 열고, 최소화·읽기 창으로·새 창 단추 없이 창 제목을 메일 제목으로 둔다', async () => {
  renderWindow()
  const subject = (await screen.findByTestId('mail-compose-subject')) as HTMLInputElement
  await waitFor(() => expect(subject).toHaveValue('새 창 메일'))
  expect(screen.getByTestId('mail-compose-to')).toBeInTheDocument()
  // 새 창에는 최소화·읽기 창 전환 단추가 없다 — 창 크기는 브라우저 창이 정하고, 앱 안 읽기 자리(슬롯)는 이 창에 없다.
  expect(screen.queryByTestId('mail-compose-minimize')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-to-pane')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-popout')).not.toBeInTheDocument()
  // 대화상자·배경이 아니라 창 전체를 채운다 — 새 창은 페이지와 겹칠 것이 없어 모달 처리가 없다.
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock').className).toContain('inset-0')
  await waitFor(() => expect(document.title).toContain('새 창 메일'))
})

test('새 창에서 보내면 draftId 를 실어 보내고, 메인 창에 sent 를 알린 뒤 창을 닫는다', async () => {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const send = record<{ draftId?: number }>('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ draftId: 900, sendAt: '2026-11-19T00:00:10Z' }))
  // 메인 창이 연 새 창(opener) — 그 창이 열려 듣고 있으면 결과·되돌리기는 메인 창이 맡아 이 창은 곧 닫힌다.
  setOpener('listening')
  const view = renderWindow([send.handler], WITH_OPENER)
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.calls[0].body.draftId).toBe(7)
  // 대기열에 올린 행 id(보내기 응답)를 함께 싣는다 — 메인 창 「되돌리기」가 그 행을 되돌린다(WP-1786).
  await waitFor(() => expect(heard).toContainEqual(msg('sent', { sentDraftId: 900, opener: MAIL_COMPOSE_WINDOW_ID })))
  expect(close).toHaveBeenCalled()
  expect(screen.queryByText('메일 보냄')).not.toBeInTheDocument()
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
  const send = record('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ draftId: 900, sendAt: '2026-11-19T00:00:10Z' }))
  const put = record('put', '/api/v1/mail/drafts/7', () => HttpResponse.json({ version: 2, updatedAt: '2026-11-12T00:00:01Z', attachmentCount: 0 }))
  setOpener('listening')
  const view = renderWindow([send.handler, put.handler], WITH_OPENER)
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

test('메인 창은 새 창의 sent 알림에 임시보관함 개수를 다시 받고, 그 새 창을 연 창일 때만 「메일 보냄 · 되돌리기」를 띄운다', async () => {
  const counts = record('get', '/api/v1/mail/drafts/count', () => HttpResponse.json({ count: 0 }))
  const lists = record('get', '/api/v1/mail/accounts/1/messages', () => HttpResponse.json([]))
  renderPage('/mail/1?folder=sent', { handlers: [counts.handler, lists.handler, ...mailBaseHandlers({ accounts: [mailAccount()] })] })
  await screen.findByTestId('mail-compose-new', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(0))
  await waitFor(() => expect(lists.calls.some((c) => c.url.searchParams.get('folder') === 'SENT')).toBe(true))
  const countsBefore = counts.calls.length

  const other = new BroadcastChannel(MAIL_COMPOSE_CHANNEL)
  // 다른 탭이 연 새 창의 알림 — 임시보관함만 조용히 다시 받는다(WP-1786: 메일은 아직 대기 중이라 보낸편지함은 대기열이 보낸 뒤
  // mailChanged 이벤트·20초 뒤 다시 받기가 맡는다 — useSendMail.test 가 20초 뒤 다시 받기를 본다).
  other.postMessage(msg('sent', { opener: 'another-tab' }))
  await waitFor(() => expect(counts.calls.length).toBeGreaterThan(countsBefore))
  expect(screen.queryByText('메일 보냄')).not.toBeInTheDocument()

  // 이 창이 연 새 창의 알림 — 결과를 알리고, 「새 창에서 쓰는 중」 기억도 지운다.
  rememberMailComposePopout(7, fakeWindow() as unknown as Window)
  other.postMessage(msg('sent', { opener: MAIL_COMPOSE_WINDOW_ID }))
  other.close()
  expect(await screen.findByText('메일 보냄')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '되돌리기' })).toBeInTheDocument()
  expect(liveMailComposePopout(7)).toBeNull()
})

// WP-1786 — 새 창은 보내자마자 닫히므로 되돌리기는 메인 창 토스트가 맡는다. 되돌리면 메인 창에 쓰기 창이 다시 열린다.
test('새 창에서 보낸 메일도 메인 창 토스트의 「되돌리기」로 cancel-send 해 메인 창 쓰기 창으로 다시 연다', async () => {
  const cancel = record('post', '/api/v1/mail/drafts/91/cancel-send', () =>
    HttpResponse.json(draftDetail({ id: 91, to: ['rcpt@test.local'], subject: '새 창에서 보낸 메일', version: 3 })),
  )
  // 되돌린 작성은 저장 안 된 작성으로 열려 곧 쓰기 형태로 다시 저장한다(PUT).
  const put = http.put('/api/v1/mail/drafts/91', () => HttpResponse.json({ version: 9, updatedAt: '2026-11-19T00:00:20Z', attachmentCount: 0 }))
  renderPage('/mail/1', { handlers: [cancel.handler, put, ...mailBaseHandlers({ accounts: [mailAccount()] })] })
  await screen.findByTestId('mail-compose-new', {}, { timeout: PAGE_LOAD_TIMEOUT })
  const other = new BroadcastChannel(MAIL_COMPOSE_CHANNEL)
  // 새 창이 쓰던 임시저장(7)이 없어져 새 행(91)으로 대기열에 올랐다 — 되돌리기는 대기 행 id 로 한다.
  other.postMessage(msg('sent', { opener: MAIL_COMPOSE_WINDOW_ID, sentDraftId: 91 }))
  other.close()
  fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(cancel.calls).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창에서 보낸 메일'))
})

// ── 연 창이 없는 새 창(WP-1786 코드 리뷰) ───────────────────────────
// 보내기 실패 푸시 알림처럼 /mail/compose?draftId=N 을 바로 연 창은 결과를 알릴 메인 창이 없다 — 보내자마자 닫히면 「되돌리기」가 어디에도 없었다.

test('연 창이 없는 새 창은 보낸 뒤 그 창에 「메일 보냄 · 되돌리기」를 띄우고 10초 동안 열어 둔 뒤 닫는다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  try {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const send = record('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ draftId: 900, sendAt: '2026-11-19T00:00:10Z' }))
    const view = renderWindow([send.handler])
    await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
    await view.user.click(screen.getByTestId('mail-compose-send'))
    await waitFor(() => expect(send.calls).toHaveLength(1))
    expect(await screen.findByText('메일 보냄')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeInTheDocument()
    expect(screen.getByTestId('mail-compose-window-sent')).toBeInTheDocument()
    // 다른 탭은 목록만 다시 받게 sent 는 그대로 알린다(opener 없음).
    await waitFor(() => expect(heard).toContainEqual(msg('sent', { sentDraftId: 900 })))
    expect(close).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTimeAsync(9_000))
    expect(close).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1_100))
    await waitFor(() => expect(close).toHaveBeenCalled())
  } finally {
    vi.useRealTimers()
  }
})

test('연 창이 없는 새 창에서 보낸 뒤 「되돌리기」를 누르면 cancel-send 해 그 창에 다시 열고, 10초가 지나도 닫지 않는다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  try {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const send = record('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ draftId: 900, sendAt: '2026-11-19T00:00:10Z' }))
    const cancel = record('post', '/api/v1/mail/drafts/900/cancel-send', () =>
      HttpResponse.json(draftDetail({ id: 900, subject: '되돌린 메일', to: ['rcpt@test.local'], version: 3 })),
    )
    const put = http.put('/api/v1/mail/drafts/900', () => HttpResponse.json({ version: 4, updatedAt: '2026-11-19T00:00:20Z', attachmentCount: 0 }))
    const view = renderWindow([send.handler, cancel.handler, put])
    await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
    await view.user.click(screen.getByTestId('mail-compose-send'))
    fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(cancel.calls).toHaveLength(1))
    await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('되돌린 메일'))
    expect(screen.queryByTestId('mail-compose-window-sent')).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(11_000))
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

test('새 창 주소로 이미 보내는 중(QUEUED)인 메일을 열면 쓰기 창 대신 「보내는 중」 안내와 「되돌리기」를 보인다', async () => {
  const cancel = record('post', '/api/v1/mail/drafts/7/cancel-send', () =>
    HttpResponse.json(draftDetail({ id: 7, subject: '대기 중 메일', to: ['rcpt@test.local'], version: 3 })),
  )
  const put = http.put('/api/v1/mail/drafts/7', () => HttpResponse.json({ version: 4, updatedAt: '2026-11-19T00:00:20Z', attachmentCount: 0 }))
  const view = renderWindow([
    cancel.handler,
    put,
    http.get('/api/v1/mail/drafts/7', () => HttpResponse.json(draftDetail({ id: 7, subject: '대기 중 메일', sendState: 'QUEUED' }))),
  ])
  expect(await screen.findByTestId('mail-compose-window-sending')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-window-error')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument()
  await view.user.click(await screen.findByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(cancel.calls).toHaveLength(1))
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('대기 중 메일'))
  expect(screen.queryByTestId('mail-compose-window-sending')).not.toBeInTheDocument()
})

// ── 되돌리기와 닫기 시계, 보낸 순간에 정하는 「되돌리기」 자리(WP-1786 코드 리뷰) ───────────────────────

test('보낸 순간 연 메인 창이 닫혔으면 이 창이 「메일 보냄 · 되돌리기」를 띄우고 열려 있으며, sent 알림엔 연 창 id 를 싣지 않는다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  try {
    const close = vi.spyOn(window, 'close').mockImplementation(() => {})
    const send = record('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ draftId: 900, sendAt: '2026-11-19T00:00:10Z' }))
    // 주소에는 연 창 id 가 있지만 그 메인 창은 이미 닫혔다 — 열 때 정해 두면 보내자마자 닫혀 어디서도 되돌릴 수 없었다.
    setOpener({ closed: true, __wpMailComposeListener: MAIL_COMPOSE_WINDOW_ID })
    const view = renderWindow([send.handler], WITH_OPENER)
    await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
    await view.user.click(screen.getByTestId('mail-compose-send'))
    expect(await screen.findByText('메일 보냄')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '되돌리기' })).toBeInTheDocument()
    expect(screen.getByTestId('mail-compose-window-sent')).toBeInTheDocument()
    await waitFor(() => expect(heard).toContainEqual(msg('sent', { sentDraftId: 900, opener: null })))
    await act(() => vi.advanceTimersByTimeAsync(9_000))
    expect(close).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1_100))
    await waitFor(() => expect(close).toHaveBeenCalled())
  } finally {
    vi.useRealTimers()
  }
})

test('연 메인 창이 듣고 있는지는 opener 가 있고·닫히지 않았고·그 창의 id 가 주소와 같을 때만이다(새로 고친 창은 id 가 바뀐다)', () => {
  expect(isOpenerListening(MAIL_COMPOSE_WINDOW_ID)).toBe(false)
  setOpener({ closed: false, __wpMailComposeListener: 'reloaded-main' })
  expect(isOpenerListening(MAIL_COMPOSE_WINDOW_ID)).toBe(false)
  restoreOpener?.()
  setOpener({ closed: true, __wpMailComposeListener: MAIL_COMPOSE_WINDOW_ID })
  expect(isOpenerListening(MAIL_COMPOSE_WINDOW_ID)).toBe(false)
  restoreOpener?.()
  setOpener('listening')
  expect(isOpenerListening(MAIL_COMPOSE_WINDOW_ID)).toBe(true)
  expect(isOpenerListening(null)).toBe(false)
})

/** 연 창이 없는 새 창에서 보내고 「되돌리기」 토스트가 뜰 때까지 — cancel-send 응답은 cancelGate 가 풀릴 때까지 붙잡는다. */
async function sendAndHoldUndo(cancelResponse: () => Response) {
  const close = vi.spyOn(window, 'close').mockImplementation(() => {})
  const send = record('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ draftId: 900, sendAt: '2026-11-19T00:00:10Z' }))
  let releaseCancel!: () => void
  const held = new Promise<void>((r) => (releaseCancel = r))
  const cancel = record('post', '/api/v1/mail/drafts/900/cancel-send', async () => {
    await held
    return cancelResponse()
  })
  const put = http.put('/api/v1/mail/drafts/900', () => HttpResponse.json({ version: 4, updatedAt: '2026-11-19T00:00:20Z', attachmentCount: 0 }))
  const view = renderWindow([send.handler, cancel.handler, put])
  await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('새 창 메일'))
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await screen.findByRole('button', { name: '되돌리기' })
  return { close, cancel, releaseCancel }
}

test('10초가 다 되어(9.8초) 「되돌리기」를 눌러도 되돌리는 동안 창을 닫지 않고, 되돌리면 그 창에 다시 연다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  try {
    const { close, cancel, releaseCancel } = await sendAndHoldUndo(() =>
      HttpResponse.json(draftDetail({ id: 900, subject: '늦게 되돌린 메일', to: ['rcpt@test.local'], version: 3 })),
    )
    await act(() => vi.advanceTimersByTimeAsync(9_800))
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(cancel.calls).toHaveLength(1))
    // cancel-send 가 아직 끝나지 않았다 — 10초가 지나도 창을 닫지 않는다
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByTestId('mail-compose-window-sent')).toHaveTextContent('되돌리는 중…')
    releaseCancel()
    await waitFor(() => expect(screen.getByTestId('mail-compose-subject')).toHaveValue('늦게 되돌린 메일'))
    await act(() => vi.advanceTimersByTimeAsync(11_000))
    expect(close).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

test('되돌리기가 늦어 이미 보냈으면(409) 「이미 보냄」을 알리고 창을 남겨 닫기 단추를 보인다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  try {
    const { close, releaseCancel } = await sendAndHoldUndo(() =>
      HttpResponse.json({ status: 409, message: '이미 보내는 중이에요', errors: { code: 'ALREADY_SENDING' } }, { status: 409 }),
    )
    await act(() => vi.advanceTimersByTimeAsync(9_800))
    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    releaseCancel()
    expect(await screen.findByText('이미 보냄')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('mail-compose-window-sent')).toHaveTextContent('메일을 되돌리지 못했어요'))
    await act(() => vi.advanceTimersByTimeAsync(11_000))
    expect(close).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByTestId('mail-compose-window-sent')).getByRole('button', { name: '창 닫기' }))
    expect(close).toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})
