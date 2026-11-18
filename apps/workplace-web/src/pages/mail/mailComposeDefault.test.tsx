// WP-1744 작성 방식 기본값 — 설정(GET /mail/settings 의 composeMode)대로 새 작성이 열리는 자리를 판정하는 화면 테스트(데스크톱).
// 읽기 창(PANE)은 메일 화면·AI 전체 화면 아님일 때만 읽기 자리, 새 창(WINDOW)은 클릭에서 미리 연 빈 창으로 기존 ↗ 흐름(임시저장 → 그 창 주소),
// 그 밖(DOCK·설정 조회 실패·아직 못 받음)은 지금처럼 우측 하단. 모바일은 mailComposeDefaultMobile.test.tsx(한 파일 한 뷰포트).
// AI 답장 초안은 응답을 기다린 뒤 열려 새 창을 우측 하단으로 본다. 새 창으로 옮기기는 늦은 서명이 들어간 뒤에 한다.
// 쓰던 작성을 다시 여는 길(다시 열기·되돌리기·다시 불러오기)과 임시보관함 열기는 mailDrafts.test.tsx 가 본다.
// window.open 은 jsdom 에 실제 창이 없어 가짜로 둔다(mailComposePopout.test.tsx 와 같은 방식).
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { useAssistant } from '@/components/ai/AIAssistantContext'
import { MAIL_COMPOSE_PREOPEN_TIMEOUT_MS, useMailCompose } from '@/components/mail/MailComposeContext'
import { mailSettingsKey } from '@/hooks/queries/useMailSettings'
import { forgetMailComposePopout, MAIL_COMPOSE_WINDOW_ID } from '@/lib/mailComposeChannel'
import { composeSettingsHandler, fakeWindow } from '@/test/kits/mail/compose-default'
import { composeHostEl as hostEl, composeInPane as inPane, openReplyWithBody, paneDetailHandlers, paneMessages } from '@/test/kits/mail/compose-pane'
import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import type { MailDraftSaveRequest } from '@/types/mailDraft'
import type { MailComposeDefault } from '@/types/mailSettings'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { createMailSettings } from '../../../e2e/factories/mailSettings.factory'
import { createMailSignature } from '../../../e2e/factories/mailSignature.factory'

afterEach(() => {
  vi.restoreAllMocks()
})

/** 슬롯 밖에서도 새 작성을 여는 단추(placement: default — 새 메일과 같다)와 AI 전체 화면 단추 — 테스트킷 트리엔 홈·AI 패널이 없어 공급자 안에서 직접 부른다. */
function Triggers() {
  const { openCompose } = useMailCompose()
  const ai = useAssistant()
  return (
    <div>
      <button
        type="button"
        data-testid="open-compose"
        onClick={() =>
          openCompose(
            { mode: 'new', accountId: 1, to: [], cc: [], bcc: [], subject: '', initialHtml: '', quote: null, inReplyToMessageId: null },
            { placement: 'default' },
          )
        }
      >
        작성 열기
      </button>
      <button
        type="button"
        data-testid="open-compose-uploading"
        onClick={() =>
          openCompose(
            {
              mode: 'forward',
              accountId: 1,
              to: [],
              cc: [],
              bcc: [],
              subject: 'Fwd: 첨부',
              initialHtml: '',
              quote: null,
              inReplyToMessageId: null,
              // 올리는 중인 첨부 — 끝나지 않는 칩이라 새 창으로 옮기기가 막힌 채로 남는다.
              attachments: [{ key: 'upload-1', name: 'a.pdf', size: 10, mimeType: 'application/pdf', status: 'uploading', progress: 0, source: 'upload' }],
            },
            { placement: 'default' },
          )
        }
      >
        첨부 올리는 중 작성 열기
      </button>
      <button type="button" data-testid="ai-fullscreen-on" onClick={() => ai.open('fullscreen')}>
        AI 전체 화면으로
      </button>
    </div>
  )
}

/** 메일 화면(또는 path 의 다른 화면)을 기본값 mode 로 띄운다. */
function renderWith(mode: MailComposeDefault | null, { path = '/mail/1', extra = [] }: { path?: string; extra?: RequestHandler[] } = {}) {
  return renderMail(path, {
    messages: paneMessages,
    handlers: [...extra, ...(mode ? [composeSettingsHandler(mode)] : []), ...paneDetailHandlers()],
    extra: <Triggers />,
  })
}

/** 설정을 받아 캐시에 들어올 때까지 기다린다 — 받기 전에 열면 늘 우측 하단이라, 기본값 판정이 헛통과하지 않게. */
async function settingsLoaded(view: ReturnType<typeof renderMail>, mode: MailComposeDefault) {
  await waitFor(() => expect(view.queryClient.getQueryData(mailSettingsKey)).toEqual({ composeMode: mode }))
}

/** 작성창이 우측 하단(주차 칸)에 펼쳐져 있다 — 읽기 자리도, 최소화도 아니다. */
async function expectDocked() {
  const dock = await screen.findByTestId('mail-compose-dock')
  expect(inPane()).toBe(false)
  expect(hostEl()!.parentElement).toHaveAttribute('data-compose-parking')
  expect(dock).toHaveClass('fixed')
  expect(dock).not.toHaveClass('invisible')
  // 펼친 작은 창 — 최소화면 본문 편집기가 보이지 않는다.
  expect(screen.getByTestId('mail-composer-body')).toBeVisible()
}

test('기본값_PANE_이면_답장이_읽기_자리에_열린다', async () => {
  const view = renderWith('PANE')
  await settingsLoaded(view, 'PANE')
  await openReplyWithBody(view, '읽기 자리에서 쓰는 답장')
  await waitFor(() => expect(inPane()).toBe(true))
  expect(screen.getByTestId('mail-compose-dock')).toHaveClass('relative')
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('읽기 자리에서 쓰는 답장')
})

test('기본값_PANE_이면_편지쓰기도_읽기_자리에_열린다', async () => {
  const view = renderWith('PANE')
  await settingsLoaded(view, 'PANE')
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-compose-dock')
  await waitFor(() => expect(inPane()).toBe(true))
})

test('기본값_PANE_이어도_메일_화면_밖에서는_우측_하단', async () => {
  const view = renderWith('PANE', { path: '/home' })
  await screen.findByTestId('outside-mail')
  await settingsLoaded(view, 'PANE')
  await view.user.click(screen.getByTestId('open-compose'))
  await expectDocked()
})

test('기본값_PANE_이어도_AI_전체_화면이면_우측_하단', async () => {
  const view = renderWith('PANE')
  await settingsLoaded(view, 'PANE')
  await view.user.click(screen.getByTestId('ai-fullscreen-on'))
  await view.user.click(screen.getByTestId('open-compose'))
  await expectDocked()
})

test('기본값_WINDOW_이면_새_메일이_새_창으로_옮겨_간다', async () => {
  const win = fakeWindow()
  const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  // 저장 응답을 붙잡아 두고, 옮기는 동안 우측 하단 창이 감춰져 있는지 본다.
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', async () => {
    await gate
    return HttpResponse.json({ id: 101, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 })
  })
  const view = renderWith('WINDOW', { extra: [post.handler] })
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  // 클릭 처리 중에 빈 창을 미리 연다(팝업 차단 회피) — 이름은 창마다 다르다.
  expect(open).toHaveBeenCalledTimes(1)
  const [url, name, features] = open.mock.calls[0]
  expect(url).toBe('')
  expect(name).toMatch(/^mail-compose-/)
  expect(features).toContain('width=900')

  // 작성기가 준비되면 손대지 않은 새 메일도 강제 임시저장한다 — 그동안 우측 하단 창은 감춰 둔다(깜빡임 방지).
  await waitFor(() => expect(post.calls).toHaveLength(1))
  expect(post.calls[0].body).toMatchObject({ accountId: 1, mode: 'new', subject: '' })
  expect(screen.getByTestId('mail-compose-dock')).toHaveClass('invisible')
  release()

  await waitFor(() => expect(win.location.href).toBe(`/mail/compose?draftId=101&opener=${MAIL_COMPOSE_WINDOW_ID}&fresh=1`))
  forgetMailComposePopout(101)
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  expect(win.close).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('임시보관함에 저장했어요')).not.toBeInTheDocument()
})

test('기본값_WINDOW_이면_메일_화면_밖에서도_새_창으로_연다', async () => {
  const win = fakeWindow()
  const open = vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 102, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = renderWith('WINDOW', { path: '/home', extra: [post.handler] })
  await screen.findByTestId('outside-mail')
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(screen.getByTestId('open-compose'))
  expect(open).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(win.location.href).toMatch(/^\/mail\/compose\?draftId=102&/))
  forgetMailComposePopout(102)
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
})

test('기본값_WINDOW_인데_팝업이_막히면_우측_하단에_남고_안내', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 103, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = renderWith('WINDOW', { extra: [post.handler] })
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  expect(await screen.findByText('팝업이 막혀 새 창으로 열지 못했어요')).toBeInTheDocument()
  await expectDocked()
  // 차단된 창을 다시 열려 하지 않고, 옮기려는 임시저장도 만들지 않는다.
  expect(open).toHaveBeenCalledTimes(1)
  expect(post.calls).toHaveLength(0)
})

test('기본값_WINDOW_로_미리_연_창은_쓰이기_전에_다른_작성으로_바뀌면_닫는다', async () => {
  const first = fakeWindow()
  const second = fakeWindow()
  const open = vi
    .spyOn(window, 'open')
    .mockReturnValueOnce(first as unknown as Window)
    .mockReturnValueOnce(second as unknown as Window)
  // 저장이 끝나지 않는다 — 옮기는 중인 창이 닫히지 않는지만 본다.
  const post = record('post', '/api/v1/mail/drafts', () => new Promise<Response>(() => {}))
  const view = renderWith('WINDOW', { extra: [post.handler] })
  await settingsLoaded(view, 'WINDOW')
  // 같은 틱에 두 번 연다 — 첫 작성의 작성기가 준비되기 전에 바뀌어 첫 창은 쓰이지 않는다.
  const btn = screen.getByTestId('open-compose')
  act(() => {
    btn.click()
    btn.click()
  })
  expect(open).toHaveBeenCalledTimes(2)
  // 쓰이지 않은 첫 창은 닫고, 지금 작성의 창은 옮기는 데 쓴다(저장 중이라 닫지 않는다).
  expect(first.close).toHaveBeenCalled()
  await waitFor(() => expect(post.calls).toHaveLength(1))
  expect(second.close).not.toHaveBeenCalled()
})

test('설정_조회가_실패해도_우측_하단으로_열린다', async () => {
  const open = vi.spyOn(window, 'open')
  const fail = http.get('/api/v1/mail/settings', () => HttpResponse.json({ message: 'server error' }, { status: 500 }))
  const view = renderWith(null, { extra: [fail] })
  await waitFor(() => expect(view.queryClient.getQueryState(mailSettingsKey)?.status).toBe('error'))
  await openReplyWithBody(view, '실패해도 쓰는 답장')
  await expectDocked()
  expect(open).not.toHaveBeenCalled()
})

test('설정을_아직_못_받았어도_기다리지_않고_우측_하단으로_열린다', async () => {
  const open = vi.spyOn(window, 'open')
  // 설정 응답이 오지 않는다 — 열기가 설정 조회에 묶이지 않아야 한다.
  const pending = http.get('/api/v1/mail/settings', () => new Promise<Response>(() => {}))
  const view = renderWith(null, { extra: [pending] })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await expectDocked()
  expect(open).not.toHaveBeenCalled()
})

test('기본값_DOCK_이면_지금처럼_우측_하단', async () => {
  const open = vi.spyOn(window, 'open')
  const view = renderWith('DOCK')
  await settingsLoaded(view, 'DOCK')
  await openReplyWithBody(view, '우측 하단 답장')
  await expectDocked()
  expect(open).not.toHaveBeenCalled()
})

// ── AI 답장 초안 — 응답을 기다린 뒤 열려 클릭과 멀어 팝업이 늘 막히므로 새 창은 우측 하단으로 본다(읽기 창은 그대로) ──

/** AI 켠 계정 + 7번 메일 + AI 답장 초안 응답으로 메일 화면을 기본값 mode 로 띄운다. */
function renderAiReply(mode: MailComposeDefault) {
  return renderMail('/mail/1', {
    accounts: [mailAccount({ aiEnabled: true })],
    messages: [summary({ id: 7, fromAddress: 'alice@example.com' })],
    handlers: [
      composeSettingsHandler(mode),
      http.get('/api/v1/mail/messages/7', () => HttpResponse.json(detail({ id: 7, fromAddress: 'alice@example.com', bodyText: '원문', attachments: [] }))),
      http.post('/api/v1/mail/messages/7/reply-draft', () => HttpResponse.json({ draftBody: 'AI 가 쓴 답장' })),
    ],
  })
}

test('기본값_WINDOW_여도_AI_답장_초안은_새_창을_열지_않고_우측_하단', async () => {
  const open = vi.spyOn(window, 'open')
  const view = renderAiReply('WINDOW')
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(await screen.findByTestId('mail-row-7'))
  await view.user.click(await screen.findByTestId('mail-ai-reply-draft'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('AI 가 쓴 답장'))
  await expectDocked()
  expect(open).not.toHaveBeenCalled()
  expect(screen.queryByText('팝업이 막혀 새 창으로 열지 못했어요')).not.toBeInTheDocument()
})

test('기본값_PANE_이면_AI_답장_초안은_읽기_자리에_열린다', async () => {
  const view = renderAiReply('PANE')
  await settingsLoaded(view, 'PANE')
  await view.user.click(await screen.findByTestId('mail-row-7'))
  await view.user.click(await screen.findByTestId('mail-ai-reply-draft'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('AI 가 쓴 답장'))
  await waitFor(() => expect(inPane()).toBe(true))
})

// ── 새 창으로 옮기기는 늦은 서명을 기다린다 — 먼저 옮기면 서명 없는 본문이 임시저장돼 새 창에서 서명이 빠진다 ──

test('기본값_WINDOW_로_새_메일을_열면_늦은_서명이_들어간_뒤에_새_창으로_옮긴다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  // 서명 응답을 붙잡아 둔다 — 작성기는 서명 없이 먼저 준비된다.
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const signature = http.get('/api/v1/mail/signature', async () => {
    await gate
    return HttpResponse.json(createMailSignature({ html: '<p>홍길동 드림</p>' }))
  })
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 104, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = renderWith('WINDOW', { extra: [signature, post.handler] })
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-composer-body')
  // 작성기가 준비돼도 서명 조회가 끝나기 전엔 옮기지(저장하지) 않는다.
  await act(() => new Promise((r) => setTimeout(r, 100)))
  expect(post.calls).toHaveLength(0)

  release()
  await waitFor(() => expect(post.calls).toHaveLength(1))
  expect(post.calls[0].body.bodyHtml).toContain('홍길동 드림')
  await waitFor(() => expect(win.location.href).toMatch(/^\/mail\/compose\?draftId=104&/))
  forgetMailComposePopout(104)
})

// ── 새 창 옮기기 해제는 회차별로 — 앞 회차의 늦은 실패가 다음 회차의 감춤을 풀지 않는다 ──

test('앞_회차_새_창_옮기기_실패가_다음_회차의_감춤을_풀지_않는다', async () => {
  const first = fakeWindow()
  const second = fakeWindow()
  vi.spyOn(window, 'open')
    .mockReturnValueOnce(first as unknown as Window)
    .mockReturnValueOnce(second as unknown as Window)
  // 첫 저장(회차 A)은 붙잡아 두었다가 실패로 돌려주고, 둘째 저장(회차 B)은 끝나지 않는다.
  let failFirst!: () => void
  const gate = new Promise<void>((r) => (failFirst = r))
  let calls = 0
  const post = record('post', '/api/v1/mail/drafts', async () => {
    calls += 1
    if (calls === 1) {
      await gate
      return HttpResponse.json({ message: 'server error' }, { status: 500 })
    }
    return new Promise<Response>(() => {})
  })
  const view = renderWith('WINDOW', { extra: [post.handler] })
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(screen.getByTestId('open-compose'))
  await waitFor(() => expect(post.calls).toHaveLength(1))
  // A 의 저장이 끝나기 전에 B 를 연다.
  await view.user.click(screen.getByTestId('open-compose'))
  await waitFor(() => expect(post.calls).toHaveLength(2))
  expect(screen.getByTestId('mail-compose-dock')).toHaveClass('invisible')

  // A 의 저장 실패가 늦게 도착한다 — A 의 알림은 뜨지만 B 의 우측 하단 창은 여전히 감춰져 있다.
  failFirst()
  expect(await screen.findByText('새 창으로 열지 못했어요')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toHaveClass('invisible')
  expect(second.close).not.toHaveBeenCalled()
})

// ── 미리 연 빈 창 시한 — 작성기가 준비되지 않아 못 꺼내면 닫고 우측 하단에 보인다 ──

test('미리_연_창을_10초_안에_꺼내지_않으면_닫고_우측_하단에_보인다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  // 서명 응답이 오지 않는다 — 작성기는 준비돼도 옮기기(꺼내기)가 서명 조회를 기다려 시한까지 못 꺼낸다.
  const signature = http.get('/api/v1/mail/signature', () => new Promise<Response>(() => {}))
  const view = renderWith('WINDOW', { extra: [signature] })
  await settingsLoaded(view, 'WINDOW')
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    await view.user.click(screen.getByTestId('open-compose'))
    expect(win.close).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(MAIL_COMPOSE_PREOPEN_TIMEOUT_MS))
    expect(win.close).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('새 창을 준비하지 못해 우측 하단에 열었어요')).toBeInTheDocument()
    await expectDocked()
  } finally {
    vi.useRealTimers()
  }
})

test('미리_연_창을_꺼낸_뒤에는_시한이_창을_닫지_않는다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  // 저장이 끝나지 않는다 — 창은 이미 꺼내 도크가 쓰는 중이다.
  const post = record('post', '/api/v1/mail/drafts', () => new Promise<Response>(() => {}))
  const view = renderWith('WINDOW', { extra: [post.handler] })
  await settingsLoaded(view, 'WINDOW')
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    await view.user.click(screen.getByTestId('open-compose'))
    await waitFor(() => expect(post.calls).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(MAIL_COMPOSE_PREOPEN_TIMEOUT_MS))
    expect(win.close).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

// ── 자동 옮기기도 새 창 열기 막힘(↗ 와 같은 규칙)을 따른다 — 첨부를 올리는 중이면 옮기지 않고 우측 하단에 둔다 ──

test('기본값_새_창이어도_첨부를_올리는_중이면_옮기지_않고_우측_하단에_이유를_알린다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 105, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = renderWith('WINDOW', { extra: [post.handler] })
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(screen.getByTestId('open-compose-uploading'))

  expect(await screen.findByText('새 창으로 열지 못해 우측 하단에 열었어요')).toBeInTheDocument()
  // 이유는 알림 설명과 칩 목록 위 안내에 각각 보인다.
  expect(screen.getAllByText('첨부를 올리는 중이에요. 다 올라가면 보낼 수 있어요.').length).toBeGreaterThanOrEqual(1)
  expect(win.close).toHaveBeenCalledTimes(1)
  // 임시저장하지도 주소를 옮기지도 않고, 우측 하단 창이 그대로 보인다.
  expect(post.calls).toHaveLength(0)
  expect(win.location.href).toBe('')
  expect(screen.getByTestId('mail-compose-dock')).not.toHaveClass('invisible')
})

// ── 새 창 옮기기 경계 — 앞 회차의 보내는 중·미리 연 창을 닫은 경우 ──

test('앞_회차가_보내는_중이어도_새_회차는_새_창으로_옮긴다', async () => {
  const win = fakeWindow()
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  // 앞 회차 A(우측 하단 답장)의 보내기 요청이 끝나지 않는다 — 도크 본체는 회차 사이에 다시 마운트되지 않아 보내는 중 상태가 남는다.
  const send = record('post', '/api/v1/mail/accounts/1/send', () => new Promise<Response>(() => {}))
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 105, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = renderWith('DOCK', { extra: [send.handler, post.handler] })
  await settingsLoaded(view, 'DOCK')
  await openReplyWithBody(view, 'A 답장')
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  // 기본값을 새 창으로 바꾸고 새 회차 B 를 연다.
  act(() => view.queryClient.setQueryData(mailSettingsKey, createMailSettings({ composeMode: 'WINDOW' })))
  await view.user.click(screen.getByTestId('open-compose'))

  await waitFor(() => expect(win.location.href).toContain('draftId=105'))
  expect(screen.queryByText('보내는 중이에요')).not.toBeInTheDocument()
  expect(win.close).not.toHaveBeenCalled()
  forgetMailComposePopout(105)
})

test('미리_연_창을_닫았으면_저장하지_않고_우측_하단에_둔다', async () => {
  // 작성기가 준비되기 전에 사용자가 빈 창을 이미 닫았다.
  const win = { ...fakeWindow(), closed: true }
  vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window)
  const post = record<MailDraftSaveRequest>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 105, version: 1, updatedAt: '2026-11-12T00:00:00Z' }, { status: 201 }),
  )
  const view = renderWith('WINDOW', { extra: [post.handler] })
  await settingsLoaded(view, 'WINDOW')
  await view.user.click(screen.getByTestId('open-compose'))
  await expectDocked()
  // 손대지 않은 작성으로 서버 임시저장을 만들지 않는다.
  await act(() => new Promise((r) => setTimeout(r, 300)))
  expect(post.calls).toHaveLength(0)
  expect(win.location.href).toBe('')
})
