// 메일 작성창 서명(WP-1517) — 화면 테스트(데스크톱). 모바일 상단 바 펜은 mailComposeSignatureMobile.test.tsx(한 파일 한 뷰포트).
// 서명 블록 노드(격리 iframe·가짜 블록 차단·원문 서식 발송), 자동 넣기(새 메일·답장·임시저장)·펜 넣기/빼기·서명 없음 안내·
// 보낼 때 서명 이미지 사본(cid), AI 초안·코칭이 서명을 지키는지를 본다. 메일 모듈 + 작성 도크만 renderScreen 으로 띄운다(testkit-b4).
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import { plainTextToMailHtml } from '@/lib/mailQuote'
import { appendSignature } from '@/lib/mailSignature'
import { record, renderMail } from '@/test/kits/mail/testkit-b4'
import type { MailDraftDetail, MailDraftSummary } from '@/types/mailDraft'
import type { MailSignature } from '@/types/mailSignature'

import { detail, draftDetail, mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { createMailSignature } from '../../../e2e/factories/mailSignature.factory'

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as { __x?: unknown }).__x
})

const S = '<p style="color:#1F4E79">홍길동</p>'

type SendBody = {
  bodyHtml: string
  bodyText: string
  attachmentIds: number[]
  inlineUploads?: { attachmentId: number; contentId: string }[]
}
const sendHandler = () =>
  record<SendBody>('post', '/api/v1/mail/accounts/1/send', () => HttpResponse.json({ localMessageId: 10, messageId: 'x@test.local' }))

/** 임시보관함에 임시저장 하나(id 7)를 두는 조회 — 목록 행을 눌러 그 본문으로 작성창을 연다. */
function draftHandlers(d: MailDraftDetail) {
  const row: MailDraftSummary = {
    id: d.id,
    accountId: d.accountId,
    mode: d.mode,
    to: d.to,
    subject: d.subject,
    preview: '',
    attachmentCount: 0,
    updatedAt: d.updatedAt,
  }
  return [
    http.get('/api/v1/mail/drafts', () => HttpResponse.json([row])),
    http.get('/api/v1/mail/drafts/count', () => HttpResponse.json({ count: 1 })),
    http.get(`/api/v1/mail/drafts/${d.id}`, () => HttpResponse.json(d)),
    http.put(`/api/v1/mail/drafts/${d.id}`, () => HttpResponse.json({ id: d.id, version: d.version + 1, updatedAt: d.updatedAt })),
  ]
}

/** 임시저장 본문(bodyHtml)으로 작성창을 연다. */
async function openDraftBody(bodyHtml: string, extra: RequestHandler[] = []) {
  const d = draftDetail({ id: 7, bodyHtml, to: ['rcpt@test.local'], subject: '서명 메일' })
  const send = sendHandler()
  const view = renderMail('/mail/1?folder=drafts', { handlers: [...extra, send.handler, ...draftHandlers(d)] })
  await view.user.click(await screen.findByTestId('mail-draft-row-7'))
  await screen.findByTestId('mail-signature-block')
  return { ...view, send }
}

/** 앱 문서에 보이는 HTML — iframe srcdoc(격리 문서 원문)은 뺀다. */
function appDocumentHtml(): string {
  const clone = document.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('iframe').forEach((f) => f.removeAttribute('srcdoc'))
  return clone.innerHTML
}

// ── 서명 블록 노드 ─────────────────────────────────────────────

test('서명은_격리_프레임으로_그려지고_앱_문서에는_원문이_없다', async () => {
  await openDraftBody(appendSignature('<p>안녕</p>', S))
  const block = screen.getByTestId('mail-signature-block')
  const frame = block.querySelector('iframe')
  expect(frame).not.toBeNull()
  expect(frame!.hasAttribute('sandbox')).toBe(true)
  // 스크립트는 우리 높이 보고만 — same-origin 은 주지 않는다(불투명 출처).
  expect(frame!.getAttribute('sandbox')).not.toContain('allow-same-origin')
  expect(frame!.getAttribute('srcdoc')).toContain('홍길동')
  expect(appDocumentHtml()).not.toContain('홍길동')
})

test('가짜_서명_블록의_이벤트_속성이_앱에서_돌지_않는다', async () => {
  await openDraftBody('<p>안녕</p><div data-mail-signature=""><img src="x" onerror="window.__x=1"></div>')
  expect(document.querySelector('img[onerror]')).toBeNull()
  expect(appDocumentHtml()).not.toContain('onerror')
  expect((window as { __x?: unknown }).__x).toBeUndefined()
})

test('보낸_본문에_서명이_원문_서식으로_실린다', async () => {
  const { user, send } = await openDraftBody(appendSignature('<p>안녕</p>', S))
  await user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.bodyHtml).toBe('<p>안녕</p><p></p><div data-mail-signature=""><p style="color:#1F4E79">홍길동</p></div>')
  expect(send.last().body.bodyText).toContain('홍길동')
})

// ── 자동 넣기·펜·서명 없음 안내·보낼 때 이미지 ─────────────────────────────────

/** 내 서명 조회 — 기본 스텁(서명 없음)보다 앞에 둔다. */
const signatureHandler = (over: Partial<MailSignature>) =>
  http.get('/api/v1/mail/signature', () => HttpResponse.json(createMailSignature(over)))
/** 1×1 PNG — 노드뷰가 서명 이미지를 data URI 로 받아 그린다. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))
const signatureImage = http.get('/api/v1/mail/signature/images/:id', () =>
  HttpResponse.arrayBuffer(PNG.buffer, { headers: { 'Content-Type': 'image/png' } }),
)
const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
const pen = () => screen.getByTestId('mail-compose-signature')

/** 서명 설정과 함께 메일함(원문 5 — 답장 경로)을 띄운다. */
function renderWithSignature(over: Partial<MailSignature>, extra: RequestHandler[] = []) {
  const send = sendHandler()
  const view = renderMail('/mail/1', {
    handlers: [
      ...extra,
      send.handler,
      signatureHandler(over),
      signatureImage,
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 5, fromAddress: 'alice@example.com', subject: '원문' })])),
      http.get('/api/v1/mail/messages/5', () =>
        HttpResponse.json(detail({ id: 5, threadId: 't1', messageId: 'orig@x', fromAddress: 'alice@example.com', subject: '원문', bodyText: '원문 본문', bodyHtml: null, attachments: [] })),
      ),
    ],
  })
  return { ...view, send }
}

/** 새 메일을 열고 받는사람·제목을 채운다. */
async function openNew(view: ReturnType<typeof renderWithSignature>) {
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-composer-body')
  await view.user.click(screen.getByTestId('mail-compose-to'))
  await view.user.paste('rcpt@test.local')
  await view.user.click(screen.getByTestId('mail-compose-subject'))
  await view.user.paste('안부')
}

async function sendNow(view: ReturnType<typeof renderWithSignature>) {
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(view.send.calls).toHaveLength(1))
  return view.send.last().body
}

test('새_메일은_빈_줄과_서명으로_끝난다', async () => {
  const view = renderWithSignature({ html: '<p>홍길동</p>', autoNew: true })
  await openNew(view)
  expect(await screen.findByTestId('mail-signature-block')).toBeInTheDocument()
  const body = await sendNow(view)
  expect(body.bodyHtml).toBe('<p></p><p></p><div data-mail-signature=""><p>홍길동</p></div>')
  expect(body.bodyHtml).not.toContain('--')
})

test('새_메일_스위치가_꺼져_있으면_넣지_않는다', async () => {
  const view = renderWithSignature({ html: '<p>홍길동</p>', autoNew: false })
  await openNew(view)
  expect(pen()).toHaveAttribute('aria-label', '서명 넣기')
  const body = await sendNow(view)
  expect(body.bodyHtml).not.toContain('data-mail-signature')
})

test('답장은_기본으로_넣지_않고_켜면_인용문_위에_넣는다', async () => {
  const off = renderWithSignature({ html: '<p>홍길동</p>', autoReply: false })
  await off.user.click(await screen.findByTestId('mail-row-5'))
  await off.user.click(await screen.findByTestId('mail-reply'))
  await screen.findByTestId('mail-composer-body')
  expect(screen.queryByTestId('mail-signature-block')).not.toBeInTheDocument()
  expect((await sendNow(off)).bodyHtml).not.toContain('data-mail-signature')
  off.unmount()

  const on = renderWithSignature({ html: '<p>홍길동</p>', autoReply: true })
  await on.user.click(await screen.findByTestId('mail-row-5'))
  await on.user.click(await screen.findByTestId('mail-reply'))
  await screen.findByTestId('mail-signature-block')
  const html = (await sendNow(on)).bodyHtml
  expect(html.indexOf('data-mail-signature')).toBeGreaterThanOrEqual(0)
  expect(html.indexOf('data-mail-signature')).toBeLessThan(html.indexOf('원문 본문'))
})

test('임시저장을_다시_열면_서명을_다시_넣지_않는다', async () => {
  const d = draftDetail({ id: 7, bodyHtml: '<p>쓰다 만 본문</p>', to: ['rcpt@test.local'] })
  const view = renderMail('/mail/1?folder=drafts', { handlers: [signatureHandler({ html: '<p>홍길동</p>', autoNew: true }), ...draftHandlers(d)] })
  await view.user.click(await screen.findByTestId('mail-draft-row-7'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('쓰다 만 본문'))
  expect(screen.queryByTestId('mail-signature-block')).not.toBeInTheDocument()
  expect(pen()).toHaveAttribute('aria-label', '서명 넣기')
})

test('서명만_있는_새_메일은_닫아도_임시저장하지_않는다', async () => {
  const drafts = record('post', '/api/v1/mail/drafts', () => HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }))
  const view = renderWithSignature({ html: '<p>홍길동</p>', autoNew: true }, [drafts.handler])
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-signature-block')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  // 「저장하지 않음」을 보려면 저장이 일어났을 시간을 기다려야 한다(자동 저장 디바운스 1.5초보다 길게).
  await wait(1800)
  expect(drafts.calls).toHaveLength(0)
})

test('펜으로_빼고_다시_넣는다', async () => {
  const view = renderWithSignature({ html: '<p>홍길동</p>', autoNew: true })
  await openNew(view)
  await screen.findByTestId('mail-signature-block')
  expect(pen()).toHaveAttribute('aria-label', '서명 빼기')
  expect(pen()).toHaveAttribute('title', '서명 빼기')
  expect(pen().className).toMatch(/(?<![:\w-])text-primary/)

  await view.user.click(pen())
  await waitFor(() => expect(screen.queryByTestId('mail-signature-block')).not.toBeInTheDocument())
  expect(pen()).toHaveAttribute('aria-label', '서명 넣기')
  expect(pen().className).toMatch(/(?<![:\w-])text-muted-foreground/)

  await view.user.click(pen())
  expect(await screen.findByTestId('mail-signature-block')).toBeInTheDocument()
  expect(pen()).toHaveAttribute('aria-label', '서명 빼기')
  const body = await sendNow(view)
  expect(body.bodyHtml).toBe('<p></p><p></p><div data-mail-signature=""><p>홍길동</p></div>')
})

test('서명이_없으면_펜은_설정으로_안내한다', async () => {
  const view = renderWithSignature({ html: '' })
  await openNew(view)
  expect(pen()).toHaveAttribute('aria-label', '서명 넣기')
  await view.user.click(pen())
  expect(await screen.findByText('서명이 아직 없어요')).toBeInTheDocument()
  expect(screen.getByText('설정 › 메일 계정에서 서명을 만들 수 있어요')).toBeInTheDocument()
  await view.user.click(screen.getByRole('button', { name: '서명 설정' }))
  await waitFor(() => expect(view.location()).toBe('/settings/mail'))
  // 데스크톱은 작성창을 그대로 둔다.
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
})

const IMG_SIG = '<p><img src="/api/v1/mail/signature/images/7"></p>'

test('서명_이미지는_보낼_때_사본으로_바꿔_cid로_보낸다', async () => {
  const stage = record<{ imageIds: number[] }>('post', '/api/v1/mail/signature/images/stage', () => HttpResponse.json([{ imageId: 7, uploadId: 40 }]))
  const view = renderWithSignature({ html: IMG_SIG, autoNew: true }, [stage.handler])
  await openNew(view)
  await screen.findByTestId('mail-signature-block')
  const body = await sendNow(view)
  expect(stage.calls).toHaveLength(1)
  expect(stage.last().body).toEqual({ imageIds: [7] })
  expect(body.bodyHtml).toContain('<img src="cid:pasted-40@genia-works"')
  expect(body.bodyHtml).not.toContain('/api/v1/mail/signature/images/7')
  expect(body.inlineUploads).toEqual([{ attachmentId: 40, contentId: 'pasted-40@genia-works' }])
  expect(body.attachmentIds).toContain(40)
})

test('서명_이미지_사본_실패면_보내지_않는다', async () => {
  const stage = record('post', '/api/v1/mail/signature/images/stage', () => HttpResponse.json({ message: 'x' }, { status: 500 }))
  const view = renderWithSignature({ html: IMG_SIG, autoNew: true }, [stage.handler])
  await openNew(view)
  await screen.findByTestId('mail-signature-block')
  await view.user.click(screen.getByTestId('mail-compose-send'))
  expect(await screen.findByText('서명 이미지를 준비하지 못했어요')).toBeInTheDocument()
  expect(stage.calls).toHaveLength(1)
  expect(view.send.calls).toHaveLength(0)
  await waitFor(() => expect(screen.getByTestId('mail-compose-send')).not.toBeDisabled())
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
})

test('서명_조회_실패해도_작성창은_열린다', async () => {
  const view = renderMail('/mail/1', { handlers: [http.get('/api/v1/mail/signature', () => HttpResponse.json({ message: 'x' }, { status: 500 }))] })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  expect(await screen.findByTestId('mail-composer-body')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-signature-block')).not.toBeInTheDocument()
  expect(pen()).toHaveAttribute('aria-label', '서명 넣기')
})

// ── 서명 조회가 늦거나 실패할 때 ─────────────────────────────────────────

/** 풀어 줄 때까지 응답하지 않는 서명 조회 — 메일 화면의 미리 받기와 작성창이 같은 조회를 기다린다. */
function gatedSignature(over: Partial<MailSignature>) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const handler = http.get('/api/v1/mail/signature', async () => {
    await gate
    return HttpResponse.json(createMailSignature(over))
  })
  return { handler, release: () => act(() => release()) }
}

test('메일_화면에_들어오면_작성창을_열기_전에_서명을_미리_받는다', async () => {
  const get = record('get', '/api/v1/mail/signature', () => HttpResponse.json(createMailSignature({ html: '<p>홍길동</p>' })))
  renderWithSignature({}, [get.handler])
  await screen.findByTestId('mail-compose-new')
  await waitFor(() => expect(get.calls.length).toBeGreaterThanOrEqual(1))
  expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument()
})

test('서명_조회가_끝나지_않아도_본문은_바로_쓸_수_있고_늦게_오면_넣는다', async () => {
  const sigGate = gatedSignature({ html: '<p>홍길동</p>', autoNew: true })
  const drafts = record('post', '/api/v1/mail/drafts', () => HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }))
  const view = renderWithSignature({}, [sigGate.handler, drafts.handler])
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  // 조회가 걸려 있어도 본문 에디터가 그려진다(스켈레톤에 묶이지 않는다).
  expect(await screen.findByTestId('mail-composer-body')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-signature-block')).not.toBeInTheDocument()
  await sigGate.release()
  expect(await screen.findByTestId('mail-signature-block')).toBeInTheDocument()
  expect(pen()).toHaveAttribute('aria-label', '서명 빼기')
  // 늦게 넣은 서명도 처음 본문이다 — 서명만 있는 새 메일은 닫아도 임시저장하지 않는다.
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await wait(1800)
  expect(drafts.calls).toHaveLength(0)
})

test('늦게_온_서명은_이미_쓰기_시작한_본문을_덮지_않는다', async () => {
  const sigGate = gatedSignature({ html: '<p>홍길동</p>', autoNew: true })
  const view = renderWithSignature({}, [sigGate.handler])
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await view.user.click(screen.getByTestId('mail-compose-to'))
  await view.user.paste('rcpt@test.local')
  await view.user.click(screen.getByTestId('mail-composer-body').querySelector('p')!)
  await view.user.keyboard('먼저 쓴 글')
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('먼저 쓴 글'))
  await sigGate.release()
  // 서명이 왔지만 쓴 본문에는 끼어들지 않는다 — 펜은 「서명 넣기」로 남아 원하면 넣을 수 있다.
  await waitFor(() => expect(pen()).not.toBeDisabled())
  expect(screen.queryByTestId('mail-signature-block')).not.toBeInTheDocument()
  expect(pen()).toHaveAttribute('aria-label', '서명 넣기')
  const body = await sendNow(view)
  expect(body.bodyHtml).toBe('<p>먼저 쓴 글</p>')
})

test('서명_조회_실패면_펜은_다시_시도를_안내하고_되면_넣는다', async () => {
  let fail = true
  const view = renderWithSignature({}, [
    http.get('/api/v1/mail/signature', () =>
      fail ? HttpResponse.json({ message: 'x' }, { status: 500 }) : HttpResponse.json(createMailSignature({ html: '<p>홍길동</p>' })),
    ),
  ])
  await openNew(view)
  await waitFor(() => expect(pen()).not.toBeDisabled())
  await view.user.click(pen())
  // 실패를 「서명이 아직 없어요」로 보이지 않는다.
  expect(await screen.findByText('서명을 불러오지 못했어요')).toBeInTheDocument()
  expect(screen.queryByText('서명이 아직 없어요')).not.toBeInTheDocument()
  fail = false
  await view.user.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByTestId('mail-signature-block')).toBeInTheDocument()
  expect(pen()).toHaveAttribute('aria-label', '서명 빼기')
})

// ── AI 초안·코칭이 서명을 지킨다 ─────────────────────────────────────────

const AI_SIG = '<p>홍길동</p>'
/** AI 켠 계정 + 서명 자동 넣기(새 메일·답장) + AI 초안·코칭 응답. */
function renderAi(extra: RequestHandler[] = []) {
  const send = sendHandler()
  const draft = record('post', '/api/v1/mail/accounts/1/compose-draft', () => HttpResponse.json({ subject: '인사', body: '안녕하세요' }))
  const coach = record<{ bodyHtml: string; bodyText: string }>('post', '/api/v1/mail/draft-coaching', () =>
    HttpResponse.json({ notes: [], improvedBodyHtml: '<p>다듬은 글</p>' }),
  )
  const view = renderMail('/mail/1', {
    accounts: [mailAccount({ aiEnabled: true })],
    handlers: [...extra, send.handler, draft.handler, coach.handler, signatureHandler({ html: AI_SIG, autoNew: true })],
  })
  return { ...view, send, draft, coach }
}
async function openAiNew(view: ReturnType<typeof renderAi>) {
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-signature-block')
  await view.user.click(screen.getByTestId('mail-compose-to'))
  await view.user.paste('rcpt@test.local')
}
async function generateAi(view: ReturnType<typeof renderAi>) {
  await view.user.click(screen.getByTestId('mail-ai-compose-chip'))
  fireEvent.change(await screen.findByTestId('mail-ai-compose-instruction'), { target: { value: '인사 메일' } })
  await view.user.click(screen.getByTestId('mail-ai-compose-generate'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('안녕하세요'))
}
/** 본문 첫 줄(서명 위 쓸 줄)을 눌러 글을 쓴다 — 서명 블록을 고른 채 치면 서명이 글로 바뀐다. */
async function typeFirstLine(view: ReturnType<typeof renderAi>, text: string) {
  await view.user.click(screen.getByTestId('mail-composer-body').querySelector('p')!)
  await view.user.keyboard(text)
}
async function sendAi(view: ReturnType<typeof renderAi>) {
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(view.send.calls).toHaveLength(1))
  return view.send.last().body.bodyHtml
}

test('서명만_있는_새_메일에도_AI_초안_칩이_보이고_검토_탭은_꺼져_있다', async () => {
  const view = renderAi()
  await openAiNew(view)
  expect(screen.getByTestId('mail-ai-compose-chip')).toBeInTheDocument()
  expect(screen.getByTestId('mail-review-tab')).toBeDisabled()
})

test('AI_초안을_넣어도_서명은_끝에_남는다', async () => {
  const view = renderAi()
  await openAiNew(view)
  await generateAi(view)
  expect(await sendAi(view)).toBe(appendSignature(plainTextToMailHtml('안녕하세요'), AI_SIG))
})

test('AI_초안_되돌리기는_서명이_있던_본문으로', async () => {
  const view = renderAi()
  await openAiNew(view)
  await generateAi(view)
  await view.user.click(screen.getByTestId('mail-ai-compose-undo'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).not.toHaveTextContent('안녕하세요'))
  expect(await sendAi(view)).toBe(appendSignature('', AI_SIG))
})

test('코칭_요청에는_서명이_실리지_않는다', async () => {
  const view = renderAi()
  await openAiNew(view)
  await typeFirstLine(view, '자료 부탁해요')
  await waitFor(() => expect(screen.getByTestId('mail-review-tab')).not.toBeDisabled())
  await view.user.click(screen.getByTestId('mail-review-tab'))
  await waitFor(() => expect(view.coach.calls).toHaveLength(1))
  const req = view.coach.last().body
  expect(req.bodyHtml).toContain('자료 부탁해요')
  expect(req.bodyHtml).not.toContain('data-mail-signature')
  expect(req.bodyText).toContain('자료 부탁해요')
  expect(req.bodyText).not.toContain('홍길동')
})

test('개선본으로_교체해도_서명은_끝에_남는다', async () => {
  const view = renderAi()
  await openAiNew(view)
  await typeFirstLine(view, '자료 부탁해요')
  await waitFor(() => expect(screen.getByTestId('mail-review-tab')).not.toBeDisabled())
  await view.user.click(screen.getByTestId('mail-review-tab'))
  await view.user.click(await screen.findByTestId('mail-coaching-apply'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('다듬은 글'))
  expect(screen.getByTestId('mail-signature-block')).toBeInTheDocument()
  expect(await sendAi(view)).toBe(appendSignature('<p>다듬은 글</p>', AI_SIG))
})
