// 메일 임시저장(WP-577) — 화면 테스트(WP-984, WP-995).
// 작성창 자동 저장(1.5초 디바운스, POST → PUT+version)·저장 상태 줄·닫기/버리기/되돌리기·충돌(409)·없어짐(404)·임시보관함 목록(개수·행·열기·삭제)·
// 보내기(draftId·잠금·실패 뒤 저장)·새로고침 경고·400 검증·실패/다시 시도는 브라우저 없이 판정되므로 e2e/pages/mail/mail-drafts.spec.ts 에서 옮겼다.
// 그 E2E 에는 라우트 → 작성창 → 저장 API 가 실제로 이어지는 @wiring 1건과 목록 행 키보드 초점 테두리(@layout)만 남는다.
// e2e/fixtures/mail-drafts-mock.ts 의 상태 있는 임시저장 모킹을 MSW 로 옮긴 draftServer 로 계약(201·409 DRAFT_CONFLICT·404·204)대로 응답한다.
// 디바운스·토스트 타이머는 가짜 시계(setTimeout 만)로 넘긴다. 메일 모듈 + 작성 도크만 renderScreen 으로 띄운다(testkit-b4).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { renderMail } from '@/test/kits/mail/testkit-b4'
import type { MailDraftDetail, MailDraftSaveRequest, MailDraftSummary } from '@/types/mailDraft'

import { detail, draftDetail, summary } from '../../../e2e/factories/mail.factory'

const DEBOUNCE = 1500
const SEND_PATH = '/api/v1/mail/accounts/1/send'

beforeEach(() => {
  // 디바운스·토스트는 setTimeout 이다 — 그것만 가짜로 두고 실제 시간도 흐르게 해(userEvent·MSW 지연) 필요할 때만 앞당긴다.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** 앱 타이머를 ms 만큼 앞당긴다(디바운스 경과). */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

type Call = { url: URL; body: MailDraftSaveRequest & { draftId?: number } }
/** 요청 하나를 가로채 바꿀 때 — 응답을 돌려주면 그것을 쓰고, undefined 면 평소대로 처리한다. */
type Override = (call: Call, n: number) => Response | undefined | Promise<Response | undefined>

/** 목록 미리보기 — 서버와 같은 규칙(공백 정리 → 앞 120자). */
const preview = (text: string) => Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, 120).join('')

/**
 * 임시저장 서버 — e2e/fixtures/mail-drafts-mock.ts 와 같은 계약(목록 최신순·POST 201·PUT version 불일치 409·없으면 404·DELETE 204,
 * 저장에 실린 업로드가 다른 임시저장에 묶여 있으면 옮겨 온다, 발송 draftId 는 그 임시저장을 지운다)으로 응답하는 MSW 핸들러 묶음.
 * override.{post,put,del,get,send} 로 특정 요청만 실패·지연시킨다.
 */
function draftServer(initial: MailDraftDetail[] = [], previews: Record<number, string> = {}) {
  const drafts = new Map<number, { detail: MailDraftDetail; preview: string }>()
  for (const d of initial) drafts.set(d.id, { detail: d, preview: previews[d.id] ?? '' })
  let seq = 100
  let t = 0
  const stamp = () => new Date(Date.UTC(2026, 9, 21, 2, 0, t++)).toISOString()
  const log = { posts: [] as Call[], puts: [] as Call[], deletes: [] as Call[], details: [] as Call[], lists: [] as Call[], counts: [] as Call[], sends: [] as Call[] }
  const override: Partial<Record<'post' | 'put' | 'del' | 'get' | 'send', Override>> = {}

  const summaries = (): MailDraftSummary[] =>
    [...drafts.values()]
      .sort((a, b) => b.detail.updatedAt.localeCompare(a.detail.updatedAt))
      .map(({ detail: d, preview: p }) => ({
        id: d.id,
        accountId: d.accountId,
        mode: d.mode,
        to: d.to,
        subject: d.subject,
        preview: p,
        attachmentCount: d.attachments.length,
        updatedAt: d.updatedAt,
      }))
  const apply = (id: number, version: number, req: MailDraftSaveRequest, prev?: MailDraftDetail): MailDraftDetail => {
    const known = new Map((prev?.attachments ?? []).map((a) => [`${a.source}-${a.id}`, a]))
    for (const [otherId, other] of drafts) {
      if (otherId === id) continue
      const moved = other.detail.attachments.filter((a) => a.source === 'upload' && req.attachmentIds.includes(a.id))
      if (moved.length === 0) continue
      moved.forEach((a) => known.set(`upload-${a.id}`, a))
      drafts.set(otherId, { ...other, detail: { ...other.detail, attachments: other.detail.attachments.filter((a) => !moved.includes(a)) } })
    }
    const att = (source: 'upload' | 'forward', ids: number[]) =>
      ids.map((aid) => known.get(`${source}-${aid}`) ?? { id: aid, name: `${source}-${aid}.pdf`, size: 10, mimeType: 'application/pdf', source })
    return {
      id,
      accountId: req.accountId,
      mode: req.mode,
      to: req.to,
      cc: req.cc,
      bcc: req.bcc,
      subject: req.subject,
      bodyHtml: req.bodyHtml,
      sourceMessageId: req.sourceMessageId,
      quoteRemoved: req.quoteRemoved,
      attachments: [...att('forward', req.forwardAttachmentIds), ...att('upload', req.attachmentIds)],
      version,
      updatedAt: stamp(),
    }
  }
  const call = async (request: Request): Promise<Call> => {
    const text = await request.clone().text()
    return { url: new URL(request.url), body: text ? JSON.parse(text) : null }
  }
  const notFound = () => HttpResponse.json({ status: 404, message: '임시저장을 찾을 수 없어요', errors: { code: 'DRAFT_NOT_FOUND' } }, { status: 404 })

  const handlers = [
    http.get('/api/v1/mail/drafts/count', async ({ request }) => {
      log.counts.push(await call(request))
      return HttpResponse.json({ count: drafts.size })
    }),
    http.get('/api/v1/mail/drafts', async ({ request }) => {
      log.lists.push(await call(request))
      return HttpResponse.json(summaries())
    }),
    http.post('/api/v1/mail/drafts', async ({ request }) => {
      const c = await call(request)
      log.posts.push(c)
      const over = await override.post?.(c, log.posts.length)
      if (over) return over
      const id = ++seq
      drafts.set(id, { detail: apply(id, 1, c.body), preview: preview(c.body.bodyText) })
      return HttpResponse.json({ id, version: 1, updatedAt: drafts.get(id)!.detail.updatedAt }, { status: 201 })
    }),
    http.get('/api/v1/mail/drafts/:id', async ({ request, params }) => {
      const c = await call(request)
      log.details.push(c)
      const over = await override.get?.(c, log.details.length)
      if (over) return over
      const cur = drafts.get(Number(params.id))
      return cur ? HttpResponse.json(cur.detail) : notFound()
    }),
    http.delete('/api/v1/mail/drafts/:id', async ({ request, params }) => {
      const c = await call(request)
      log.deletes.push(c)
      const over = await override.del?.(c, log.deletes.length)
      if (over) return over
      if (!drafts.delete(Number(params.id))) return notFound()
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('/api/v1/mail/drafts/:id', async ({ request, params }) => {
      const c = await call(request)
      log.puts.push(c)
      const over = await override.put?.(c, log.puts.length)
      if (over) return over
      const id = Number(params.id)
      const cur = drafts.get(id)
      if (!cur) return notFound()
      if (c.body.version !== cur.detail.version) {
        return HttpResponse.json({ status: 409, message: '다른 창에서 이 임시저장을 먼저 고쳤어요', errors: { code: 'DRAFT_CONFLICT' } }, { status: 409 })
      }
      const next = apply(id, cur.detail.version + 1, c.body, cur.detail)
      drafts.set(id, { detail: next, preview: preview(c.body.bodyText) })
      return HttpResponse.json({ version: next.version, updatedAt: next.updatedAt, attachmentCount: next.attachments.length })
    }),
    http.post(SEND_PATH, async ({ request }) => {
      const c = await call(request)
      log.sends.push(c)
      const over = await override.send?.(c, log.sends.length)
      if (over) return over
      if (c.body.draftId != null) drafts.delete(c.body.draftId)
      return HttpResponse.json({ localMessageId: 10, messageId: 'x@test.local' })
    }),
  ]
  return {
    drafts,
    ...log,
    override,
    handlers,
    /** 다른 탭·기기가 먼저 저장한 상황 — 서버 버전을 올리고 내용을 바꾼다. */
    bumpVersion(id: number, change: Partial<MailDraftDetail> = {}) {
      const cur = drafts.get(id)!
      drafts.set(id, { ...cur, detail: { ...cur.detail, ...change, version: cur.detail.version + 1, updatedAt: stamp() } })
    },
  }
}
type Server = ReturnType<typeof draftServer>

/** 받은편지함(원본 메일 5 — 답장 임시저장의 인용문 원본) + 임시저장 서버로 메일 모듈을 띄운다. sourceGets 는 원본 상세 조회 수. */
function renderDrafts(server: Server, path = '/mail/1?folder=drafts') {
  const sourceGets: string[] = []
  const view = renderMail(path, {
    handlers: [
      ...server.handlers,
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 5, subject: '원문 회의', fromAddress: 'alice@example.com' })])),
      http.get('/api/v1/mail/messages/5', ({ request }) => {
        sourceGets.push(request.url)
        return HttpResponse.json(detail({ id: 5, subject: '원문 회의', fromAddress: 'alice@example.com', bodyText: '원본 메일 본문입니다', bodyHtml: null, attachments: [] }))
      }),
    ],
  })
  return { ...view, sourceGets }
}

const status = () => screen.getByTestId('mail-compose-save-status')
const subject = () => screen.getByTestId('mail-compose-subject') as HTMLInputElement
const setSubject = (value: string) => fireEvent.change(subject(), { target: { value } })
const saves = (s: Server) => s.posts.length + s.puts.length
/** beforeunload 를 막는가(저장하지 않은 변경 경고). */
const unloadBlocked = () => {
  const e = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}
async function openRow(view: ReturnType<typeof renderDrafts>, id: number) {
  await view.user.click(await screen.findByTestId(`mail-draft-row-${id}`))
  await screen.findByTestId('mail-compose-dock')
}
async function openNew(view: ReturnType<typeof renderDrafts>) {
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-compose-dock')
}

// 자동 저장 — 1.5초 전엔 저장하지 않고, POST(version 없음) 뒤 다음 변경은 받은 version 으로 같은 id 에 PUT, 상태 줄·사이드바 개수.
test('쓰면 1.5초 뒤 POST 로 만들고, 다음 변경은 받은 version 으로 PUT — 상태가 저장 중… → 저장됨', async () => {
  const server = draftServer()
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  await view.user.click(screen.getByTestId('mail-compose-to'))
  await view.user.paste('rcpt@test.local')
  setSubject('주간 보고')
  expect(status()).toHaveTextContent('저장 중…')
  await tick(DEBOUNCE - 100)
  expect(server.posts).toHaveLength(0)
  await tick(100)
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0].body).toMatchObject({
    accountId: 1,
    mode: 'new',
    to: ['rcpt@test.local'],
    subject: '주간 보고',
    sourceMessageId: null,
    quoteRemoved: false,
    attachmentIds: [],
    forwardAttachmentIds: [],
  })
  expect(server.posts[0].body).not.toHaveProperty('version')
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
  await waitFor(() => expect(screen.getByTestId('mail-count-drafts')).toHaveTextContent('1'))

  setSubject('주간 보고 (수정)')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  const id = [...server.drafts.keys()][0]
  expect(server.puts[0].url.pathname).toBe(`/api/v1/mail/drafts/${id}`)
  expect(server.puts[0].body).toMatchObject({ subject: '주간 보고 (수정)', version: 1 })
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
  expect(server.posts).toHaveLength(1)
})

// 빈 새 메일은 저장할 것이 없다 — 상태 줄 없음, ✕ 는 저장·토스트 없이 닫는다.
test('빈 새 메일은 저장하지 않고 ✕ 로 조용히 닫힌다', async () => {
  const server = draftServer()
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  await tick(DEBOUNCE * 2)
  expect(screen.queryByTestId('mail-compose-save-status')).not.toBeInTheDocument()
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await tick(DEBOUNCE)
  expect(server.posts).toHaveLength(0)
  expect(screen.queryByText('임시보관함에 저장했어요')).not.toBeInTheDocument()
})

// 올리는 중 첨부는 id 가 없어 싣지 않고, 올라가면 그 id 로 다시 저장한다.
test('올리는 중인 첨부는 저장에 싣지 않고, 다 올라가면 그 id 로 다시 저장한다', async () => {
  const server = draftServer()
  let release!: (r: Response) => void
  server.handlers.unshift(http.post('/api/v1/mail/compose-attachments', () => new Promise<Response>((r) => (release = r))))
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  await view.user.upload(screen.getByTestId('mail-compose-file-input') as HTMLInputElement, new File(['A'], 'a.pdf', { type: 'application/pdf' }))
  setSubject('첨부 메일')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0].body).toMatchObject({ subject: '첨부 메일', attachmentIds: [] })

  await waitFor(() => expect(release).toBeTypeOf('function'))
  release(HttpResponse.json({ id: 901, name: 'a.pdf', size: 1, mimeType: 'application/pdf', expiresAt: '2026-10-22T00:00:00Z' }, { status: 201 }))
  await waitFor(() => expect(document.querySelector('[data-status="done"]')).not.toBeNull())
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(server.puts[0].body).toMatchObject({ attachmentIds: [901], version: 1 })
})

// ✕ 는 디바운스를 기다리지 않고 바로 저장 → 닫기 → 토스트·개수, 닫은 뒤엔 더 저장하지 않는다.
test('✕ 는 디바운스를 기다리지 않고 바로 저장한 뒤 닫고 「임시보관함에 저장했어요」', async () => {
  const server = draftServer()
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  setSubject('바로 닫기')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0].body).toMatchObject({ subject: '바로 닫기' })
  expect(await screen.findByText('임시보관함에 저장했어요')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('mail-count-drafts')).toHaveTextContent('1'))
  await tick(DEBOUNCE * 2)
  expect(saves(server)).toBe(1)
})

// 🗑 버리기 → DELETE·목록/개수 갱신, 「되돌리기」는 같은 내용으로 새 임시저장(POST)을 만들어 다시 열고 그 id 로 이어 저장한다.
test('🗑 버리기 → DELETE 후 목록·개수에서 빠지고, 「되돌리기」로 같은 내용을 새 임시저장으로 만들어 다시 연다', async () => {
  const server = draftServer()
  const view = renderDrafts(server)
  await openNew(view)
  setSubject('버릴 메일')
  await view.user.click(screen.getByTestId('mail-composer-body'))
  await view.user.keyboard('버릴 본문')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.posts).toHaveLength(1))
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
  const id = [...server.drafts.keys()][0]
  await screen.findByTestId(`mail-draft-row-${id}`)

  await view.user.click(screen.getByTestId('mail-compose-discard'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(server.deletes).toHaveLength(1))
  expect(server.deletes[0].url.pathname).toBe(`/api/v1/mail/drafts/${id}`)
  expect(server.drafts.size).toBe(0)
  await waitFor(() => expect(screen.queryByTestId(`mail-draft-row-${id}`)).not.toBeInTheDocument())
  expect(await screen.findByTestId('mail-drafts-empty')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-count-drafts')).not.toBeInTheDocument())

  await view.user.click(await screen.findByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(server.posts).toHaveLength(2))
  expect(server.posts[1].body).toMatchObject({ subject: '버릴 메일' })
  expect(server.posts[1].body.bodyText).toContain('버릴 본문')
  await screen.findByTestId('mail-compose-dock')
  await waitFor(() => expect(subject()).toHaveValue('버릴 메일'))
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('버릴 본문')
  const restored = [...server.drafts.keys()][0]
  setSubject('버릴 메일 (살림)')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts.length).toBeGreaterThan(0))
  expect(server.puts[server.puts.length - 1].url.pathname).toBe(`/api/v1/mail/drafts/${restored}`)
  expect(server.posts).toHaveLength(2)
})

// 409 — 충돌 안내, 충돌 중엔 더 써도 PUT 하지 않고, 「다시 불러오기」로 서버 내용·버전을 받아 이어 저장한다.
test('다른 곳에서 먼저 고쳤으면(409) 안내하고, 「다시 불러오기」로 서버 내용을 연다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '처음 제목', version: 1 })], { 7: '쓰다 만 본문' })
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('처음 제목'))

  server.bumpVersion(7, { subject: '다른 탭에서 고친 제목' })
  setSubject('여기서 고친 제목')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(server.puts[0].body).toMatchObject({ version: 1 })
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'conflict'))
  expect(status()).toHaveTextContent('다른 곳에서 고친 내용이 있어요')
  setSubject('여기서 또 고친 제목')
  await tick(DEBOUNCE)
  expect(server.puts).toHaveLength(1)

  await view.user.click(screen.getByTestId('mail-compose-save-reload'))
  await waitFor(() => expect(subject()).toHaveValue('다른 탭에서 고친 제목'))
  expect(status()).toHaveTextContent('저장됨')
  setSubject('합친 제목')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(2))
  expect(server.puts[1].body).toMatchObject({ subject: '합친 제목', version: 2 })
})

// 충돌 중 ✕ — 서버 글은 그대로 두고 내 내용을 새 임시저장(POST)으로, 첨부도 옮겨 가 다시 열면 그대로 있다.
test('충돌 중 ✕ 는 서버 글을 덮지 않고 내 내용을 새 임시저장으로 남긴다 — 첨부도 함께 옮겨 간다', async () => {
  const server = draftServer([
    draftDetail({ id: 7, subject: '처음 제목', version: 1, attachments: [{ id: 501, name: '안건.pdf', size: 10, mimeType: 'application/pdf', source: 'upload' }] }),
  ])
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(screen.getByTestId('mail-compose-attachments')).toHaveTextContent('안건.pdf'))
  server.bumpVersion(7, { subject: '다른 탭 제목' })
  setSubject('내 제목')
  await tick(DEBOUNCE)
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'conflict'))

  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0].body).toMatchObject({ subject: '내 제목', attachmentIds: [501] })
  expect(server.drafts.get(7)!.detail.subject).toBe('다른 탭 제목')
  expect(screen.getByTestId('mail-draft-row-7')).toBeInTheDocument()
  expect(await within(screen.getByTestId('mail-drafts-list')).findByText('내 제목')).toBeInTheDocument()

  const copy = [...server.drafts.keys()].find((k) => k !== 7)!
  await openRow(view, copy)
  await waitFor(() => expect(subject()).toHaveValue('내 제목'))
  await waitFor(() => expect(screen.getByTestId('mail-compose-attachments')).toHaveTextContent('안건.pdf'))
})

// PUT 404 — 없어진 임시저장은 되살리지 않는다: 안내·목록/개수에서 걷어냄·저장 멈춤·경고 없음, 보내기는 draftId 없이.
test('다른 곳에서 보냈거나 버린 임시저장(PUT 404)은 되살리지 않는다 — 안내를 보이고 저장을 멈추며, 보내기는 draftId 없이 나간다', async () => {
  const server = draftServer([
    draftDetail({ id: 7, subject: '사라질 메일', to: ['rcpt@test.local'], attachments: [{ id: 501, name: '안건.pdf', size: 10, mimeType: 'application/pdf', source: 'upload' }] }),
  ])
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('사라질 메일'))

  server.drafts.delete(7)
  setSubject('사라질 메일 (고침)')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'gone'))
  expect(status()).toHaveTextContent('다른 곳에서 보냈거나 버린 메일이에요')
  await waitFor(() => expect(screen.queryByTestId('mail-draft-row-7')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.queryByTestId('mail-count-drafts')).not.toBeInTheDocument())
  setSubject('사라질 메일 (또 고침)')
  await tick(DEBOUNCE * 2)
  expect([server.posts.length, server.puts.length]).toEqual([0, 1])
  expect(unloadBlocked()).toBe(false)

  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(server.sends).toHaveLength(1))
  expect(server.sends[0].body).toMatchObject({ subject: '사라질 메일 (또 고침)', attachmentIds: [501] })
  expect(server.sends[0].body).not.toHaveProperty('draftId')
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
})

// 없어진 상태의 ✕ — 저장하지 않고 토스트 없이 닫는다.
test('없어진 임시저장(404) 상태에서 ✕ 는 저장하지 않고 토스트 없이 닫는다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '사라질 메일' })])
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('사라질 메일'))
  server.drafts.delete(7)
  setSubject('고침')
  await tick(DEBOUNCE)
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'gone'))
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await tick(DEBOUNCE)
  expect([server.posts.length, server.puts.length]).toEqual([0, 1])
  expect(screen.queryByText('임시보관함에 저장했어요')).not.toBeInTheDocument()
  expect(screen.queryByText('임시저장하지 못했어요')).not.toBeInTheDocument()
})

// 임시보관함 — 사이드바 개수·링크(주소·aria-current)·목록 조회 accountId·행(표식·받는 사람·제목·미리보기·첨부 수),
// 답장 임시저장을 열면 받는 사람 칩·제목·본문·원본으로 다시 만든 인용문 머리·첨부, 저장됨 상태, 원본 조회 1회.
test('임시보관함 — 사이드바 개수·행 표시, 답장 임시저장을 누르면 작성창이 열리고 인용문을 원본으로 다시 만든다', async () => {
  const server = draftServer(
    [
      draftDetail({
        id: 7,
        mode: 'reply',
        to: ['앨리스 <alice@example.com>'],
        subject: 'Re: 원문 회의',
        bodyHtml: '<p>참석합니다</p>',
        sourceMessageId: 5,
        attachments: [{ id: 501, name: '안건.pdf', size: 1024, mimeType: 'application/pdf', source: 'upload' }],
        updatedAt: '2026-10-21T01:00:00Z',
      }),
    ],
    { 7: '참석합니다' },
  )
  const view = renderDrafts(server, '/mail/1')
  const link = await screen.findByTestId('mail-folder-drafts')
  await waitFor(() => expect(screen.getByTestId('mail-count-drafts')).toHaveTextContent('1'))
  await view.user.click(link)
  await waitFor(() => expect(view.location()).toContain('folder=drafts'))
  expect(screen.getByTestId('mail-folder-drafts')).toHaveAttribute('aria-current', 'page')
  expect(await screen.findByTestId('mail-drafts-detail-empty')).toBeInTheDocument()
  await waitFor(() => expect(server.lists.length).toBeGreaterThan(0))
  expect(server.lists[server.lists.length - 1].url.searchParams.get('accountId')).toBe('1')

  const row = await screen.findByTestId('mail-draft-row-7')
  expect(row).toHaveTextContent('임시저장')
  expect(row).toHaveTextContent('앨리스')
  expect(row).toHaveTextContent('Re: 원문 회의')
  expect(row).toHaveTextContent('참석합니다')
  expect(screen.getByTestId('mail-draft-attachment-7')).toHaveAttribute('aria-label', '첨부 1개')

  await view.user.click(row)
  const dock = await screen.findByTestId('mail-compose-dock')
  await waitFor(() =>
    expect(screen.queryAllByTestId('mail-compose-to-chip').map((el) => el.getAttribute('data-value'))).toEqual(['앨리스 <alice@example.com>']),
  )
  expect(subject()).toHaveValue('Re: 원문 회의')
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('참석합니다')
  await waitFor(() => expect(screen.getByTestId('mail-compose-quote')).toHaveTextContent('앨리스 · 6월 3일'))
  expect(within(dock).getByTestId('mail-compose-attachments')).toHaveTextContent('안건.pdf')
  expect(status()).toHaveTextContent('저장됨')
  expect(view.sourceGets).toHaveLength(1)
})

// 인용문을 지운 답장 임시저장 — 인용문 없이 열고 원본을 받지 않으며, 다시 저장해도 quoteRemoved 가 이어진다.
test('인용문을 지운 답장 임시저장은 인용문 없이 열리고 원본을 받지 않는다 — 고쳐 저장해도 지움 상태가 이어진다', async () => {
  const server = draftServer([draftDetail({ id: 8, mode: 'reply', subject: 'Re: 원문 회의', sourceMessageId: 5, quoteRemoved: true })])
  const view = renderDrafts(server)
  await openRow(view, 8)
  await waitFor(() => expect(subject()).toHaveValue('Re: 원문 회의'))
  expect(screen.queryByTestId('mail-compose-quote')).not.toBeInTheDocument()
  expect(view.sourceGets).toHaveLength(0)

  setSubject('Re: 원문 회의 (고침)')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(server.puts[0].body).toMatchObject({ mode: 'reply', sourceMessageId: 5, quoteRemoved: true, version: 1 })
})

// 다시 연 임시저장은 고치기 전엔 저장할 것이 없다 — 다른 작성이 열린 채 열어도.
test('다시 연 임시저장은 고치기 전에는 저장하지 않는다 — 다른 작성이 열린 채 열어도 마찬가지', async () => {
  const server = draftServer([
    draftDetail({ id: 7, subject: '첫째', bodyHtml: '<p>첫째 본문</p>' }),
    draftDetail({
      id: 9,
      mode: 'reply',
      subject: 'Re: 원문 회의',
      bodyHtml: '<p>둘째 본문</p>',
      sourceMessageId: 5,
      attachments: [{ id: 501, name: '안건.pdf', size: 1, mimeType: 'application/pdf', source: 'upload' }],
    }),
  ])
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('첫째 본문'))
  await tick(DEBOUNCE * 3)
  expect(saves(server)).toBe(0)

  await view.user.click(screen.getByTestId('mail-draft-row-9'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('둘째 본문'))
  expect(await screen.findByTestId('mail-compose-quote')).toBeInTheDocument()
  await tick(DEBOUNCE * 3)
  expect(saves(server)).toBe(0)
  expect(screen.queryByText('임시보관함에 저장했어요')).not.toBeInTheDocument()
})

// 쓰던 작성이 열린 채 다른 임시저장을 열면 쓰던 것을 먼저 저장하고 알린다.
test('열린 작성을 두고 다른 임시저장을 열면 쓰던 것을 먼저 저장한다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '보관된 메일' })])
  const view = renderDrafts(server)
  await openNew(view)
  setSubject('쓰던 새 메일')
  await view.user.click(screen.getByTestId('mail-draft-row-7'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0].body).toMatchObject({ subject: '쓰던 새 메일' })
  await waitFor(() => expect(subject()).toHaveValue('보관된 메일'))
  expect(await screen.findByText('임시보관함에 저장했어요')).toBeInTheDocument()
})

// 이미 열린 임시저장을 다시 누르면 서버에서 다시 받지 않고 최소화만 풀어 쓰던 내용을 그대로 둔다.
test('이미 열린 임시저장을 다시 누르면 새로 열지 않고 최소화를 풀어 앞으로 가져온다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '열린 메일' })])
  const view = renderDrafts(server)
  await openRow(view, 7)
  const body = screen.getByTestId('mail-composer-body')
  await waitFor(() => expect(body).toHaveTextContent('쓰다 만 본문'))
  await view.user.click(body)
  await view.user.keyboard('이어서')
  await view.user.click(screen.getByTestId('mail-compose-minimize'))
  expect(body.closest('.hidden')).not.toBeNull()

  await view.user.click(screen.getByTestId('mail-draft-row-7'))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body').closest('.hidden')).toBeNull())
  // 쓰던 내용 그대로(서버 내용으로 다시 열지 않았다)
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent(/이어서/)
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent(/쓰다 만 본문/)
  expect(server.details).toHaveLength(1)
})

// 보내기는 draftId 를 싣고, 보낸 뒤 임시보관함 목록·개수를 다시 받으며 더 저장하지 않는다.
test('보내기는 draftId 를 싣고, 보낸 뒤 임시보관함 목록·개수를 다시 받는다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
  const view = renderDrafts(server)
  await waitFor(() => expect(screen.getByTestId('mail-count-drafts')).toHaveTextContent('1'))
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('보낼 메일'))
  const lists = server.lists.length
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(server.sends).toHaveLength(1))
  expect(server.sends[0].body).toMatchObject({ to: ['rcpt@test.local'], subject: '보낼 메일', draftId: 7 })
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  expect(await screen.findByTestId('mail-drafts-empty')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-count-drafts')).not.toBeInTheDocument())
  expect(server.lists.length).toBeGreaterThan(lists)
  await tick(DEBOUNCE * 2)
  expect(saves(server)).toBe(0)
})

// 새로고침·탭 닫기 경고는 저장하지 않은 변경이 있는 동안만.
test('저장하지 않은 변경이 있는 동안만 새로고침·탭 닫기를 경고한다', async () => {
  const server = draftServer()
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  expect(unloadBlocked()).toBe(false)
  setSubject('아직 저장 전')
  expect(status()).toHaveTextContent('저장 중…')
  await waitFor(() => expect(unloadBlocked()).toBe(true))
  await tick(DEBOUNCE)
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
  await waitFor(() => expect(unloadBlocked()).toBe(false))
})

// 빈 임시보관함 — 빈 상태 문구, 개수 없음, 메시지 검색 칸 없음.
test('임시저장이 없으면 빈 상태를 보여 주고 사이드바 개수도 없다', async () => {
  renderDrafts(draftServer())
  expect(await screen.findByTestId('mail-drafts-empty')).toHaveTextContent('임시저장한 메일이 없어요')
  expect(screen.queryByTestId('mail-count-drafts')).not.toBeInTheDocument()
  expect(screen.queryByTestId('mail-search')).not.toBeInTheDocument()
})

// ⋯ 삭제 — 작성창을 열지 않고 지우고, 「되돌리기」는 미리보기 본문·첨부(출처별 id)로 다시 만든다.
test('⋯ 삭제 → DELETE 후 행이 사라지고, 「되돌리기」로 같은 내용·첨부로 다시 만든다', async () => {
  const server = draftServer(
    [
      draftDetail({
        id: 7,
        subject: '지울 메일',
        attachments: [
          { id: 31, name: '원본.pdf', size: 10, mimeType: 'application/pdf', source: 'forward' },
          { id: 501, name: '내 파일.pdf', size: 10, mimeType: 'application/pdf', source: 'upload' },
        ],
      }),
    ],
    { 7: '지울 본문 미리보기' },
  )
  const view = renderDrafts(server)
  await view.user.click(await screen.findByTestId('mail-draft-menu-7'))
  await view.user.click(await screen.findByTestId('mail-draft-delete-7'))
  await waitFor(() => expect(server.deletes).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-draft-row-7')).not.toBeInTheDocument())
  expect(await screen.findByTestId('mail-drafts-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument()

  await view.user.click(await screen.findByRole('button', { name: '되돌리기' }))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0].body).toMatchObject({ subject: '지울 메일', bodyText: '지울 본문 미리보기', attachmentIds: [501], forwardAttachmentIds: [31] })
  expect(server.posts[0].body).not.toHaveProperty('attachments')
  expect(await within(screen.getByTestId('mail-drafts-list')).findByText('지울 메일')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByTestId('mail-count-drafts')).toHaveTextContent('1'))
})

// 작성창에 열린 임시저장을 목록에서 지우면 DELETE 성공 뒤 저장 없이 닫는다(지운 것을 다시 만들지 않게).
test('작성창에 열린 임시저장을 목록에서 지우면 DELETE 가 성공한 뒤 저장 없이 작성창을 닫는다(지운 것을 다시 저장하지 않게)', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '열어 둔 메일' })])
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('열어 둔 메일'))
  setSubject('고치던 중')
  expect(status()).toHaveTextContent('저장 중…')

  await view.user.click(screen.getByTestId('mail-draft-menu-7'))
  await view.user.click(await screen.findByTestId('mail-draft-delete-7'))
  await waitFor(() => expect(server.deletes).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await tick(DEBOUNCE * 2)
  expect(saves(server)).toBe(0)
  expect(server.drafts.size).toBe(0)
})

// 목록 지우기 실패 — 작성창과 고친 내용을 두고 이어서 저장한다.
test('목록에서 지우기가 실패하면 작성창과 아직 저장하지 않은 고친 내용을 그대로 두고, 이어서 저장한다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '열어 둔 메일' })])
  server.override.del = () => HttpResponse.json({ status: 500 }, { status: 500 })
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('열어 둔 메일'))
  setSubject('고치던 중')

  await view.user.click(screen.getByTestId('mail-draft-menu-7'))
  await view.user.click(await screen.findByTestId('mail-draft-delete-7'))
  await waitFor(() => expect(server.deletes).toHaveLength(1))
  expect(await screen.findByText('임시저장을 지우지 못했어요')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  expect(subject()).toHaveValue('고치던 중')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(server.puts[0].body).toMatchObject({ subject: '고치던 중', version: 1 })
  expect(server.drafts.has(7)).toBe(true)
})

// 닫은 뒤 저장 실패 → 「임시저장하지 못했어요 · 다시 열기」, 다시 연 작성창은 저장 안 된 상태라 같은 id·같은 version 으로 다시 저장한다.
test('닫은 뒤 저장이 실패하면 「임시저장하지 못했어요 · 다시 열기」 — 다시 연 작성창은 고치지 않아도 같은 임시저장에 받은 version 으로 다시 저장한다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '이어 쓸 메일', version: 1 })])
  server.override.put = (_c, n) => (n === 1 ? HttpResponse.json({ status: 500, message: 'boom' }, { status: 500 }) : undefined)
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('이어 쓸 메일'))
  setSubject('이어 쓸 메일 (닫기 전)')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(await screen.findByText('임시저장하지 못했어요')).toBeInTheDocument()

  await view.user.click(screen.getByRole('button', { name: '다시 열기' }))
  await waitFor(() => expect(subject()).toHaveValue('이어 쓸 메일 (닫기 전)'))
  expect(status()).toHaveTextContent('저장 중…')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(2))
  expect(server.puts[1].url.pathname).toBe('/api/v1/mail/drafts/7')
  expect(server.puts[1].body).toMatchObject({ subject: '이어 쓸 메일 (닫기 전)', version: 1 })
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
  expect(server.posts).toHaveLength(0)
})

// 새 메일 저장이 닫을 때 실패 → 다시 열기 → 고치지 않고 닫아도 POST 로 저장한다(처음 값과 같아도 저장 안 된 내용).
test('새 메일 저장이 닫을 때 실패해 「다시 열기」로 열면 그냥 닫아도 POST 로 저장한다', async () => {
  const server = draftServer()
  server.override.post = (_c, n) => (n === 1 ? HttpResponse.json({ status: 500, message: 'boom' }, { status: 500 }) : undefined)
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  setSubject('새로 쓴 메일')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  await view.user.click(await screen.findByRole('button', { name: '다시 열기' }))
  await waitFor(() => expect(subject()).toHaveValue('새로 쓴 메일'))
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(server.posts).toHaveLength(2))
  expect(server.posts[1].body).toMatchObject({ subject: '새로 쓴 메일' })
  expect(await screen.findByText('임시보관함에 저장했어요')).toBeInTheDocument()
  expect(server.drafts.size).toBe(1)
})

// 작성창 🗑 의 DELETE 실패 — 「버리지 못했어요」, 되돌리기 없음, 행은 남는다.
test('작성창 🗑 의 DELETE 가 실패하면 「되돌리기」 대신 「버리지 못했어요」를 알리고 임시저장을 그대로 둔다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '못 버릴 메일' })])
  server.override.del = () => HttpResponse.json({ status: 500, message: 'boom' }, { status: 500 })
  const view = renderDrafts(server)
  await openRow(view, 7)
  await view.user.click(screen.getByTestId('mail-compose-discard'))
  await waitFor(() => expect(server.deletes).toHaveLength(1))
  expect(await screen.findByText('임시저장을 버리지 못했어요')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '되돌리기' })).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-draft-row-7')).toBeInTheDocument()
  expect(server.posts).toHaveLength(0)
})

/** 붙잡아 두는 문 — release 전까지 핸들러가 기다린다. */
function gate() {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  return { held, release }
}

// 보내기 두 번 — 진행 중인 임시저장을 기다리는 동안에도 잠겨 한 번만 나가고, 그 draftId 를 싣는다.
test('보내기를 두 번 눌러도 한 번만 나간다 — 진행 중인 임시저장을 기다리는 동안에도 잠긴다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
  const put = gate()
  server.override.put = async () => {
    await put.held
    return undefined
  }
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('보낼 메일'))
  setSubject('보낼 메일 (고침)')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  const send = screen.getByTestId('mail-compose-send')
  await view.user.click(send)
  await waitFor(() => expect(send).toBeDisabled())
  fireEvent.click(send)
  put.release()
  await waitFor(() => expect(server.sends).toHaveLength(1))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await tick(500)
  expect(server.sends).toHaveLength(1)
  expect(server.sends[0].body).toMatchObject({ subject: '보낼 메일 (고침)', draftId: 7 })
})

const sendFail = () => HttpResponse.json({ status: 502, message: '메일 서버에 보내지 못했어요' }, { status: 502 })

// 보내는 동안엔 자동 저장을 멈추고, 실패하면 다시 켜 같은 임시저장에 PUT 한다.
test('보내는 동안 고친 내용은 저장하지 않다가, 보내기가 실패하면 자동 저장을 다시 켜 같은 임시저장에 저장한다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
  const sending = gate()
  server.override.send = async () => {
    await sending.held
    return sendFail()
  }
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('보낼 메일'))
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(server.sends).toHaveLength(1))
  setSubject('보내는 중 고침')
  await tick(DEBOUNCE * 2)
  expect(saves(server)).toBe(0)

  sending.release()
  expect(await screen.findByText('메일 서버에 보내지 못했어요')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(server.puts[0].body).toMatchObject({ subject: '보내는 중 고침', version: 1 })
  expect(server.posts).toHaveLength(0)
})

// 보내는 동안 ✕ 로 닫은 뒤 실패 — 그 작성의 내용으로 같은 임시저장에 저장하고 「다시 열기」로 연다.
test('보내는 동안 ✕ 로 닫은 뒤 보내기가 실패하면 그 작성의 내용으로 임시저장하고 「보내지 못해 임시보관함에 저장했어요 · 다시 열기」', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '보낼 메일', to: ['rcpt@test.local'] })])
  const sending = gate()
  server.override.send = async () => {
    await sending.held
    return sendFail()
  }
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('보낼 메일'))
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(server.sends).toHaveLength(1))
  setSubject('보낼 메일 (고침)')
  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await tick(DEBOUNCE)
  expect(saves(server)).toBe(0)

  sending.release()
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(server.puts[0].url.pathname).toBe('/api/v1/mail/drafts/7')
  expect(server.puts[0].body).toMatchObject({ accountId: 1, subject: '보낼 메일 (고침)', version: 1 })
  expect(await screen.findByText('보내지 못해 임시보관함에 저장했어요')).toBeInTheDocument()
  expect(screen.getByText('메일 서버에 보내지 못했어요')).toBeInTheDocument()
  expect(server.posts).toHaveLength(0)

  await view.user.click(screen.getByRole('button', { name: '다시 열기' }))
  await waitFor(() => expect(subject()).toHaveValue('보낼 메일 (고침)'))
})

// 보내는 동안 다른 작성으로 바꾼 뒤 실패 — 앞 작성 내용만 앞 임시저장에, 지금 작성은 그대로.
test('보내는 동안 다른 작성으로 바꾼 뒤 실패하면 앞 작성의 내용만 앞 임시저장에 저장한다 — 지금 작성은 그대로', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '앞 메일', to: ['rcpt@test.local'] })])
  const sending = gate()
  server.override.send = async () => {
    await sending.held
    return sendFail()
  }
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('앞 메일'))
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(server.sends).toHaveLength(1))
  await view.user.click(screen.getByTestId('mail-compose-new'))
  await waitFor(() => expect(subject()).toHaveValue(''))
  setSubject('새로 쓰는 메일')

  sending.release()
  await waitFor(() => expect(server.puts).toHaveLength(1))
  expect(server.puts[0].url.pathname).toBe('/api/v1/mail/drafts/7')
  expect(server.puts[0].body).toMatchObject({ subject: '앞 메일', version: 1 })
  expect(server.posts).toHaveLength(0)
  expect(await screen.findByText('보내지 못해 임시보관함에 저장했어요')).toBeInTheDocument()
  expect(subject()).toHaveValue('새로 쓰는 메일')
})

// 충돌 중 보내기 — draftId 없이 나가 다른 곳의 더 새 임시저장을 지우지 않는다.
test('충돌 중 보내기는 draftId 없이 나가 다른 곳의 더 새 임시저장을 지우지 않는다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '처음 제목', to: ['rcpt@test.local'], version: 1 })])
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('처음 제목'))
  server.bumpVersion(7, { subject: '다른 탭 제목' })
  setSubject('여기서 고친 제목')
  await tick(DEBOUNCE)
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'conflict'))

  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(server.sends).toHaveLength(1))
  expect(server.sends[0].body).toMatchObject({ subject: '여기서 고친 제목' })
  expect(server.sends[0].body).not.toHaveProperty('draftId')
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  expect(server.drafts.get(7)!.detail.subject).toBe('다른 탭 제목')
})

// 「다시 불러오기」 실패 — 충돌 상태·내 내용 유지, ✕ 는 내 내용을 새 임시저장으로.
test('충돌 「다시 불러오기」가 실패하면 충돌 상태를 두고, ✕ 는 내 내용을 새 임시저장으로 남긴다', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '처음 제목', version: 1 })])
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('처음 제목'))
  server.bumpVersion(7, { subject: '다른 탭 제목' })
  setSubject('여기서 고친 제목')
  await tick(DEBOUNCE)
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'conflict'))

  server.override.get = () => HttpResponse.json({ status: 500, message: 'boom' }, { status: 500 })
  await view.user.click(screen.getByTestId('mail-compose-save-reload'))
  expect(await screen.findByText('boom')).toBeInTheDocument()
  expect(status()).toHaveAttribute('data-status', 'conflict')
  expect(subject()).toHaveValue('여기서 고친 제목')

  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(server.posts).toHaveLength(1))
  expect(server.posts[0].body).toMatchObject({ subject: '여기서 고친 제목' })
  expect(server.drafts.get(7)!.detail.subject).toBe('다른 탭 제목')
  expect(await screen.findByText('임시보관함에 저장했어요')).toBeInTheDocument()
})

// 제목 500자 상한, 400 검증 오류 — 원인을 짧게(title 에 전체) 보이고 다시 시도 없이, 같은 내용은 다시 보내지 않고 고치면 저장한다.
test('제목은 500자까지만 들어가고, 저장이 400 검증 오류면 원인을 짧게 보이며 같은 내용으로 다시 보내지 않는다', async () => {
  const server = draftServer()
  let reject = true
  // 서버 상한 검사(MailComposeLimits)와 같은 모양 — 문구는 message 에, errors 는 없다
  server.override.post = () => (reject ? HttpResponse.json({ status: 400, message: '받는사람이 너무 많아요' }, { status: 400 }) : undefined)
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  await view.user.click(subject())
  await view.user.paste('가'.repeat(600))
  expect(subject()).toHaveValue('가'.repeat(500))

  await tick(DEBOUNCE)
  await waitFor(() => expect(server.posts).toHaveLength(1))
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'invalid'))
  expect(status()).toHaveTextContent('저장하지 못했어요 · 받는사람이 너무 많아요')
  expect(status()).toHaveAttribute('title', '저장하지 못했어요 · 받는사람이 너무 많아요')
  expect(screen.queryByTestId('mail-compose-save-retry')).not.toBeInTheDocument()
  await tick(DEBOUNCE * 2)
  expect(server.posts).toHaveLength(1)

  reject = false
  await view.user.click(screen.getByTestId('mail-compose-to'))
  await view.user.paste('a@x.com')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.posts).toHaveLength(2))
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
})

// PUT 은 목록 캐시의 그 행만 고쳐(제목·미리보기) 맨 위로 — 목록·개수를 다시 받지 않는다.
test('PUT 은 목록의 그 행만 그 자리에서 고쳐 맨 위로 올린다 — 목록·개수를 다시 받지 않는다', async () => {
  const server = draftServer(
    [draftDetail({ id: 7, subject: '고칠 메일', updatedAt: '2026-10-21T01:00:00Z' }), draftDetail({ id: 8, subject: '다른 메일', updatedAt: '2026-10-21T01:30:00Z' })],
    { 7: '옛 미리보기' },
  )
  const view = renderDrafts(server)
  const rowIds = () => Array.from(screen.getByTestId('mail-drafts-list').querySelectorAll('[data-testid^="mail-draft-row-"]')).map((r) => r.getAttribute('data-testid'))
  await waitFor(() => expect(rowIds()).toEqual(['mail-draft-row-8', 'mail-draft-row-7']))
  await openRow(view, 7)
  await waitFor(() => expect(screen.getByTestId('mail-count-drafts')).toHaveTextContent('2'))
  await waitFor(() => expect(subject()).toHaveValue('고칠 메일'))
  const before = server.lists.length + server.counts.length
  setSubject('고친 메일')
  await tick(DEBOUNCE)
  await waitFor(() => expect(server.puts).toHaveLength(1))
  await waitFor(() => expect(rowIds()[0]).toBe('mail-draft-row-7'))
  const first = screen.getByTestId('mail-draft-row-7')
  expect(first).toHaveTextContent('고친 메일')
  expect(first).toHaveTextContent('쓰다 만 본문')
  await tick(DEBOUNCE)
  expect(server.lists.length + server.counts.length).toBe(before)
})

// 임시저장이 아닌 404(계정 비활성 등)는 「없어짐」이 아니라 일반 실패 — 다시 시도로 저장된다.
test('임시저장이 아닌 404(계정 비활성 등)는 없어진 것으로 보지 않고 「저장하지 못했어요 · 다시 시도」', async () => {
  const server = draftServer([draftDetail({ id: 7, subject: '계정 문제' })])
  server.override.put = (_c, n) => (n === 1 ? HttpResponse.json({ status: 404, message: '메일 계정을 찾을 수 없습니다' }, { status: 404 }) : undefined)
  const view = renderDrafts(server)
  await openRow(view, 7)
  await waitFor(() => expect(subject()).toHaveValue('계정 문제'))
  setSubject('계정 문제 (고침)')
  await tick(DEBOUNCE)
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'error'))
  await view.user.click(screen.getByTestId('mail-compose-save-retry'))
  await waitFor(() => expect(server.puts).toHaveLength(2))
  expect(server.puts[1].body).toMatchObject({ subject: '계정 문제 (고침)', version: 1 })
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
})

// 저장 실패 → 「저장하지 못했어요 · 다시 시도」, 다시 시도 → 저장됨.
test('저장이 실패하면 「저장하지 못했어요 · 다시 시도」, 다시 시도하면 저장된다', async () => {
  const server = draftServer()
  server.override.post = (_c, n) => (n === 1 ? HttpResponse.json({ status: 500, message: 'boom' }, { status: 500 }) : undefined)
  const view = renderDrafts(server, '/mail/1')
  await openNew(view)
  setSubject('실패할 메일')
  await tick(DEBOUNCE)
  await waitFor(() => expect(status()).toHaveAttribute('data-status', 'error'))
  expect(status()).toHaveTextContent('저장하지 못했어요')
  await view.user.click(screen.getByTestId('mail-compose-save-retry'))
  await waitFor(() => expect(server.posts).toHaveLength(2))
  await waitFor(() => expect(status()).toHaveTextContent('저장됨'))
})

test('임시보관함 — 제목이 제로폭 공백뿐인 임시저장은 행·행 이름에 「(제목 없음)」(WP-1110)', async () => {
  const server = draftServer([draftDetail({ id: 8, to: ['kim@example.com'], subject: '\u200B\u200B', updatedAt: '2026-10-21T01:00:00Z' })])
  renderDrafts(server, '/mail/1?folder=drafts')
  const row = await screen.findByTestId('mail-draft-row-8')
  expect(row).toHaveTextContent('(제목 없음)')
  expect(row.getAttribute('aria-label')).toMatch(/\(제목 없음\)$/)
})
