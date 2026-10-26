// 새 메일 AI 초안(WP-576) — 화면 테스트(WP-984, WP-995).
// 진입점 조건(새 메일·AI 켠 계정)·compose-draft payload·본문/제목 반영·생성 중 잠금·중지/버리기(요청 끊김)·일시/영구 실패 안내·
// 되돌리기·다시 쓰기·고친 뒤 ✕ 저장·크게 보기 Esc·최소화 뒤 본문 유지·보내기 잠금(AI+업로드)은 브라우저 없이 판정되므로
// e2e/pages/mail/mail-ai-compose.spec.ts 에서 옮겼다. 초점·IME·버튼 배경색은 그 E2E(@input·@layout)가 지킨다.
// 훅 단위(늦게 온 응답 버림)는 src/components/mail/useMailAiDraft.test.tsx 가 본다. 메일 모듈 + 작성 도크만 renderScreen 으로 띄운다(testkit-b4).
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import type { ComposeDraftResult } from '@/types/mailMessage'

import { detail, mailAccount, summary } from '../../../e2e/factories/mail.factory'
import { record, renderMail } from './testkit-b4'

const DRAFT_PATH = '/api/v1/mail/accounts/1/compose-draft'
const INSTRUCTION = '다음 주 회의를 목요일로 옮기자고 요청'
const RESULT: ComposeDraftResult = {
  subject: '회의 일정 변경 요청',
  body: '김지훈 님, 안녕하세요.\n\n다음 주 회의를 목요일 오후 3시로 옮길 수 있을까요?\n\n감사합니다.',
}
afterEach(() => {
  vi.restoreAllMocks()
})

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)))
type DraftReq = { instruction: string; to: string[]; cc: string[]; subject: string | null }

/**
 * compose-draft — 기본은 바로 RESULT. 끊긴 요청 수는 abortedDrafts() 로 본다.
 * jsdom 의 axios 는 XHR 로 보내고 MSW 의 XHR 가로채기는 요청 신호(abort)를 핸들러에 넘기지 않아,
 * XHR 의 open·abort 를 엿봐 compose-draft 요청이 실제로 끊겼는지 센다.
 */
function draftHandler(reply: (n: number) => Response | Promise<Response> = () => HttpResponse.json(RESULT)) {
  const rec = record<DraftReq>('post', DRAFT_PATH, (_c, n) => reply(n))
  return { ...rec, handlers: [rec.handler] }
}
function watchDraftAborts() {
  const urls = new WeakMap<XMLHttpRequest, string>()
  const open = XMLHttpRequest.prototype.open
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(function (this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, String(args[1]))
    return (open as (...a: unknown[]) => void).apply(this, args)
  })
  const abort = vi.spyOn(XMLHttpRequest.prototype, 'abort')
  return () => abort.mock.contexts.filter((x) => urls.get(x as XMLHttpRequest)?.endsWith(DRAFT_PATH.replace('/api/v1', ''))).length
}
function gate() {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  return { held, release }
}

/** AI 켠 계정(기본) + 7번 메일(회신·전달 경로). */
function renderAiCompose(handlers: NonNullable<Parameters<typeof renderMail>[1]>['handlers'] = [], { aiEnabled = true } = {}) {
  return renderMail('/mail/1', {
    accounts: [mailAccount({ aiEnabled })],
    handlers: [
      ...(handlers ?? []),
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 7 })])),
      http.get('/api/v1/mail/messages/7', () => HttpResponse.json(detail({ id: 7, fromAddress: 'alice@example.com' }))),
      http.get('/api/v1/mail/messages/7/summary', () => HttpResponse.json({ summary: '• 요약' })),
    ],
  })
}

/** 새 메일을 열고 지시 패널에 지시를 넣는다. */
async function openPanel(view: ReturnType<typeof renderMail>, instruction = INSTRUCTION) {
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await view.user.click(await screen.findByTestId('mail-ai-compose-open'))
  fireEvent.change(await screen.findByTestId('mail-ai-compose-instruction'), { target: { value: instruction } })
}
const bodyParagraphs = () => Array.from(screen.getByTestId('mail-composer-body').querySelectorAll('p')).map((p) => p.textContent)

test('AI 초안 진입(칩·툴바)은 새 메일에만 있고 회신·전달엔 없다', async () => {
  const view = renderAiCompose()
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  expect(await screen.findByTestId('mail-ai-compose-chip')).toBeInTheDocument()
  expect(screen.getByTestId('mail-ai-compose-open')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())

  await user.click(screen.getByTestId('mail-row-7'))
  await user.click(await screen.findByTestId('mail-reply'))
  await screen.findByTestId('mail-compose-dock')
  expect(screen.queryByTestId('mail-ai-compose-open')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-compose-chip')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())

  await user.click(screen.getByTestId('mail-forward'))
  await screen.findByTestId('mail-compose-dock')
  expect(screen.queryByTestId('mail-ai-compose-open')).not.toBeInTheDocument()
})

test('AI 꺼진 계정의 새 메일엔 AI 초안 진입이 없다', async () => {
  const view = renderAiCompose([], { aiEnabled: false })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-compose-dock')
  expect(screen.queryByTestId('mail-ai-compose-open')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-compose-chip')).not.toBeInTheDocument()
})

test('칩 → 지시 → 초안 만들기: payload(지시·받는사람·참조·빈 제목), 본문은 줄마다 문단·제목 채움, 칩 대신 「AI 초안이에요」', async () => {
  const drafts = draftHandler()
  const view = renderAiCompose(drafts.handlers)
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(await screen.findByTestId('mail-compose-to'))
  await user.paste('jihoon@example.com, mina@example.com')
  await user.click(screen.getByRole('button', { name: '참조/숨은참조' }))
  await user.click(await screen.findByTestId('mail-compose-cc'))
  await user.paste('lead@example.com')
  await user.click(screen.getByTestId('mail-ai-compose-chip'))
  fireEvent.change(await screen.findByTestId('mail-ai-compose-instruction'), { target: { value: INSTRUCTION } })
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  await waitFor(() => expect(drafts.calls).toHaveLength(1))
  expect(drafts.last().body).toEqual({ instruction: INSTRUCTION, to: ['jihoon@example.com', 'mina@example.com'], cc: ['lead@example.com'], subject: null })
  await waitFor(() =>
    expect(bodyParagraphs()).toEqual(['김지훈 님, 안녕하세요.', '', '다음 주 회의를 목요일 오후 3시로 옮길 수 있을까요?', '', '감사합니다.']),
  )
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('회의 일정 변경 요청')
  expect(screen.getByTestId('mail-ai-compose-bar')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-compose-panel')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-compose-chip')).not.toBeInTheDocument()
})

test('사용자가 쓴 제목은 요청에 실어 보내고 응답 뒤에도 그대로 둔다', async () => {
  const drafts = draftHandler(() => HttpResponse.json({ subject: null, body: '본문' }))
  const view = renderAiCompose(drafts.handlers)
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  fireEvent.change(await screen.findByTestId('mail-compose-subject'), { target: { value: '내가 쓴 제목' } })
  await user.click(screen.getByTestId('mail-ai-compose-open'))
  fireEvent.change(await screen.findByTestId('mail-ai-compose-instruction'), { target: { value: INSTRUCTION } })
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  await waitFor(() => expect(drafts.calls).toHaveLength(1))
  expect(drafts.last().body.subject).toBe('내가 쓴 제목')
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('본문'))
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('내가 쓴 제목')
})

test('생성 중엔 보내기 비활성·본문 inert, 중지하면 요청이 끊기고 지시가 남으며 토스트가 없다', async () => {
  const g = gate()
  const drafts = draftHandler(async () => {
    await g.held
    return HttpResponse.json(RESULT)
  })
  const abortedDrafts = watchDraftAborts()
  const view = renderAiCompose(drafts.handlers)
  await openPanel(view)
  await view.user.click(screen.getByTestId('mail-ai-compose-generate'))
  expect(await screen.findByTestId('mail-ai-compose-generating')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-send')).toBeDisabled()
  expect(screen.getByTestId('mail-composer-body').closest('[inert]')).not.toBeNull()
  expect(abortedDrafts()).toBe(0)
  await view.user.click(screen.getByTestId('mail-ai-compose-stop'))
  await waitFor(() => expect(abortedDrafts()).toBe(1))
  expect(screen.getByTestId('mail-ai-compose-instruction')).toHaveValue(INSTRUCTION)
  await waitFor(() => expect(screen.getByTestId('mail-compose-send')).toBeEnabled())
  expect(document.querySelector('[data-sonner-toast]')).toBeNull()
  g.release()
})

test.each([
  { status: 503, message: 'AI 비서를 사용할 수 없어요. 잠시 후 다시 시도해주세요.' },
  { status: 502, message: 'AI 요청에 실패했어요. 잠시 후 다시 시도해주세요.' },
])('일시 실패($status, 코드 없음) — 서버 문구가 패널에 뜨고 [닫기]·토스트 없이, 다시 시도하면 같은 지시로 다시 요청해 채운다', async ({ status, message }) => {
  const drafts = draftHandler((n) => (n === 1 ? HttpResponse.json({ status, message, errors: null }, { status }) : HttpResponse.json(RESULT)))
  const view = renderAiCompose(drafts.handlers)
  await openPanel(view)
  await view.user.click(screen.getByTestId('mail-ai-compose-generate'))
  expect(await screen.findByTestId('mail-ai-compose-error')).toHaveTextContent(message)
  expect(screen.queryByTestId('mail-ai-compose-dismiss')).not.toBeInTheDocument()
  expect(document.querySelector('[data-sonner-toast]')).toBeNull()
  await view.user.click(screen.getByTestId('mail-ai-compose-retry'))
  await waitFor(() => expect(drafts.calls).toHaveLength(2))
  expect(drafts.calls.map((c) => c.body.instruction)).toEqual([INSTRUCTION, INSTRUCTION])
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('목요일 오후 3시'))
})

test.each([
  { code: 'AI_DISABLED', message: '이 계정은 AI 비서가 꺼져 있어요. 계정 설정에서 켜주세요.' },
  { code: 'ASSISTANT_NOT_CONFIGURED', message: 'AI 비서가 아직 설정되지 않았어요. 관리자에게 문의해주세요.' },
])('영구 실패(503 $code) — 문구와 [닫기]만, 코드 문자열·토스트 없음, 계정 목록을 다시 받는다', async ({ code, message }) => {
  let aiEnabled = true
  const accounts = record('get', '/api/v1/mail/accounts', () => HttpResponse.json([mailAccount({ aiEnabled })]))
  const drafts = draftHandler(() => HttpResponse.json({ status: 503, message, errors: { code } }, { status: 503 }))
  const view = renderAiCompose([accounts.handler, ...drafts.handlers])
  await openPanel(view)
  const before = accounts.calls.length
  if (code === 'AI_DISABLED') aiEnabled = false
  await view.user.click(screen.getByTestId('mail-ai-compose-generate'))
  const errorBox = await screen.findByTestId('mail-ai-compose-error')
  expect(errorBox).toHaveTextContent(message)
  expect(errorBox).not.toHaveTextContent(code)
  expect(screen.queryByTestId('mail-ai-compose-retry')).not.toBeInTheDocument()
  expect(document.querySelector('[data-sonner-toast]')).toBeNull()
  await waitFor(() => expect(accounts.calls.length).toBeGreaterThan(before))
  // 계정이 꺼졌다고 다시 받아도 실패 문구는 닫을 때까지 남는다.
  await wait(50)
  expect(screen.getByTestId('mail-ai-compose-error')).toBeInTheDocument()
  await view.user.click(screen.getByTestId('mail-ai-compose-dismiss'))
  await waitFor(() => expect(screen.queryByTestId('mail-ai-compose-error')).not.toBeInTheDocument())
  if (code === 'AI_DISABLED') {
    expect(screen.queryByTestId('mail-ai-compose-open')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mail-ai-compose-chip')).not.toBeInTheDocument()
  }
})

test('되돌리기 — 본문에 글이 있으면 교체 경고, 생성 뒤 되돌리면 생성 직전 본문·제목으로 돌아가고 줄이 걷힌다', async () => {
  const drafts = draftHandler()
  const view = renderAiCompose(drafts.handlers)
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(await screen.findByTestId('mail-composer-body'))
  await user.keyboard('내가 먼저 쓴 글')
  await user.click(screen.getByTestId('mail-ai-compose-open'))
  expect(await screen.findByTestId('mail-ai-compose-replace-warning')).toBeInTheDocument()
  fireEvent.change(screen.getByTestId('mail-ai-compose-instruction'), { target: { value: INSTRUCTION } })
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('목요일 오후 3시'))
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('회의 일정 변경 요청')
  await user.click(screen.getByTestId('mail-ai-compose-undo'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent(/^내가 먼저 쓴 글$/))
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('')
  expect(screen.queryByTestId('mail-ai-compose-bar')).not.toBeInTheDocument()
})

test('다시 쓰기 — 지시가 채워진 패널과 교체 경고, 손대지 않은 AI 제목은 null 로 보내 새 제목을 받고, 되돌리면 AI 이전 빈 상태', async () => {
  const drafts = draftHandler((n) => HttpResponse.json({ subject: `제목 ${n}`, body: `초안 ${n}` }))
  const view = renderAiCompose(drafts.handlers)
  const { user } = view
  await openPanel(view)
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent(/^초안 1$/))
  await user.click(screen.getByTestId('mail-ai-compose-rewrite'))
  expect(await screen.findByTestId('mail-ai-compose-instruction')).toHaveValue(INSTRUCTION)
  expect(screen.getByTestId('mail-ai-compose-replace-warning')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  await waitFor(() => expect(drafts.calls).toHaveLength(2))
  expect(drafts.last().body.subject).toBeNull()
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent(/^초안 2$/))
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('제목 2')
  await user.click(screen.getByTestId('mail-ai-compose-undo'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent(/^$/))
  expect(screen.getByTestId('mail-compose-subject')).toHaveValue('')
  expect(screen.getByTestId('mail-ai-compose-chip')).toBeInTheDocument()
})

test('되돌리기 — AI 제목을 사용자가 고쳤으면 제목은 그대로 두고 본문만 되돌린다', async () => {
  const drafts = draftHandler()
  const view = renderAiCompose(drafts.handlers)
  await openPanel(view)
  await view.user.click(screen.getByTestId('mail-ai-compose-generate'))
  const subject = screen.getByTestId('mail-compose-subject')
  await waitFor(() => expect(subject).toHaveValue('회의 일정 변경 요청'))
  fireEvent.change(subject, { target: { value: '회의 일정 변경 요청 (수정)' } })
  await view.user.click(screen.getByTestId('mail-ai-compose-undo'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent(/^$/))
  expect(subject).toHaveValue('회의 일정 변경 요청 (수정)')
})

test('본문을 고치면 「AI 초안이에요」 줄이 사라지고, ✕ 는 AI 초안과 고친 내용을 임시저장한다(WP-577)', async () => {
  const drafts = draftHandler()
  const posts = record<{ mode: string; subject: string; bodyText: string }>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }),
  )
  const view = renderAiCompose([posts.handler, ...drafts.handlers])
  const { user } = view
  await openPanel(view)
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  expect(await screen.findByTestId('mail-ai-compose-bar')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-composer-body'))
  await user.keyboard('!')
  await waitFor(() => expect(screen.queryByTestId('mail-ai-compose-bar')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(posts.calls).toHaveLength(1))
  expect(posts.last().body).toMatchObject({ mode: 'new', subject: '회의 일정 변경 요청' })
  expect(posts.last().body.bodyText).toContain('!')
})

test('크게 보기에서 지시 칸 Esc 는 패널만 닫고 크게 보기는 그대로, 한 번 더 Esc 는 작은 창으로', async () => {
  const view = renderAiCompose()
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(await screen.findByTestId('mail-compose-expand'))
  expect(screen.getByTestId('mail-compose-backdrop')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-ai-compose-open'))
  const input = await screen.findByTestId('mail-ai-compose-instruction')
  fireEvent.change(input, { target: { value: INSTRUCTION } })
  await user.click(input)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('mail-ai-compose-panel')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-compose-backdrop')).toBeInTheDocument()
  fireEvent.keyDown(screen.getByTestId('mail-compose-dock'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByTestId('mail-compose-backdrop')).not.toBeInTheDocument())
})

test('생성 중 작성창을 버리면(🗑) 요청이 끊기고, 다시 연 새 메일은 빈 상태(칩)다', async () => {
  const g = gate()
  const drafts = draftHandler(async () => {
    await g.held
    return HttpResponse.json(RESULT)
  })
  const abortedDrafts = watchDraftAborts()
  const view = renderAiCompose(drafts.handlers)
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  await user.click(await screen.findByTestId('mail-compose-to'))
  await user.paste('a@example.com')
  await user.click(screen.getByTestId('mail-ai-compose-open'))
  fireEvent.change(await screen.findByTestId('mail-ai-compose-instruction'), { target: { value: INSTRUCTION } })
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  expect(await screen.findByTestId('mail-ai-compose-generating')).toBeInTheDocument()
  // 헤더의 🗑(작은 창) — 같은 testid 가 하단 줄에도 있어 첫 것을 누른다.
  await user.click(screen.getAllByTestId('mail-compose-discard')[0])
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(abortedDrafts()).toBe(1))
  await user.click(screen.getByTestId('mail-compose-new'))
  expect(await screen.findByTestId('mail-ai-compose-chip')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-ai-compose-generating')).not.toBeInTheDocument()
  g.release()
})

test('최소화했다 복원해도 쓰던 본문이 남고(에디터를 다시 만들지 않음), ✕ 는 그 내용을 임시저장한다', async () => {
  const posts = record<{ bodyText: string }>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }),
  )
  const view = renderAiCompose([posts.handler])
  const { user } = view
  await user.click(await screen.findByTestId('mail-compose-new'))
  const body = await screen.findByTestId('mail-composer-body')
  await user.click(body)
  await user.keyboard('최소화 전에 쓴 글')
  await user.click(screen.getByTestId('mail-compose-minimize'))
  expect(body.closest('.hidden')).not.toBeNull()
  await user.click(screen.getByTestId('mail-compose-minimize'))
  await waitFor(() => expect(body.closest('.hidden')).toBeNull())
  // 같은 에디터 노드 — 다시 만들지 않았다.
  expect(screen.getByTestId('mail-composer-body')).toBe(body)
  expect(body).toHaveTextContent('최소화 전에 쓴 글')
  await user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(posts.calls).toHaveLength(1))
  expect(posts.last().body.bodyText).toContain('최소화 전에 쓴 글')
})

test('보내기 잠금은 AI 생성 중과 첨부 업로드 중을 함께 본다 — 둘 다 끝나야 열린다', async () => {
  const g = gate()
  const drafts = draftHandler(async () => {
    await g.held
    return HttpResponse.json(RESULT)
  })
  const up = gate()
  const upload = http.post('/api/v1/mail/compose-attachments', async () => {
    await up.held
    return HttpResponse.json({ id: 801, name: '안건.pdf', size: 3, mimeType: 'application/pdf', expiresAt: '2026-10-21T10:00:00Z' }, { status: 201 })
  })
  const view = renderAiCompose([upload, ...drafts.handlers])
  const { user } = view
  await openPanel(view)
  const send = screen.getByTestId('mail-compose-send')
  await user.upload(screen.getByTestId('mail-compose-file-input'), new File(['PDF'], '안건.pdf', { type: 'application/pdf' }))
  await user.click(screen.getByTestId('mail-ai-compose-generate'))
  expect(await screen.findByTestId('mail-ai-compose-generating')).toBeInTheDocument()
  expect(send).toBeDisabled()
  g.release()
  expect(await screen.findByTestId('mail-ai-compose-bar')).toBeInTheDocument()
  expect(send).toBeDisabled()
  up.release()
  await waitFor(() => expect(send).toBeEnabled())
})
