// 메일 작성창 파일 첨부(WP-574) — 화면 테스트(WP-984, WP-995).
// 📎(파일 입력)로 붙인 파일의 multipart 업로드·진행/완료/실패 칩·보내기 잠금과 이유 문구·합계 줄·다시 시도·한도 초과·
// 전달 원본 첨부(forwardAttachmentIds)·본문 이미지 합계·올리는 중 ✕(요청 취소)·✕ 임시저장·발송 400·보낸 메일 첨부 목록은
// 브라우저 없이 판정되므로 e2e/pages/mail/mail-compose-attachments.spec.ts 에서 옮겼다.
// 화면 캡처 붙여넣기(WP-947)의 업로드 실패·발송 cid 치환도 e2e/pages/mail/mail-compose-paste-image.spec.ts 에서 옮겼다(파일 끝).
// 실제 파일 선택 창·끌어다 놓기(오버레이·최소화 창·같은 틱 두 번 놓기)·고정 줄 기하(+N개 접기·sticky)는 그 E2E(@input·@layout)가 지킨다.
// 메일 모듈 + 작성 도크만 renderScreen 으로 띄운다(testkit-b4).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test, vi } from 'vitest'

import type { ComposeAttachmentUpload } from '@/types/mailMessage'

import { detail, summary } from '../../../e2e/factories/mail.factory'
import { record, renderMail } from './testkit-b4'

const UPLOAD_PATH = '/api/v1/mail/compose-attachments'
const MB = 1024 * 1024

afterEach(() => {
  vi.restoreAllMocks()
})

type Handlers = NonNullable<NonNullable<Parameters<typeof renderMail>[1]>['handlers']>
type SendBody = { attachmentIds: number[]; forwardAttachmentIds: number[] }

/** 업로드 응답 본문 — 계약(201 + expiresAt)대로. */
function uploaded(id: number, name: string, size: number, mimeType = 'application/pdf'): ComposeAttachmentUpload {
  return { id, name, size, mimeType, expiresAt: '2026-10-21T10:00:00Z' }
}

/**
 * 업로드를 붙잡아 두는 핸들러 — 요청마다(multipart 의 file 필드 이름·내용을 기록) 응답을 미루고, 테스트가 respond 로 하나씩 푼다.
 * 올리는 중 칩·보내기 잠금을 보려면 응답 전 상태가 필요하다.
 */
function holdUploads() {
  const held: { contentType: string; resolve: (r: Response) => void }[] = []
  // jsdom XHR 은 FormData 안 파일을 이름 'blob'·빈 내용으로 내보내(MSW 가 본 본문에 파일이 없다),
  // 앱이 FormData 의 file 필드에 넣는 파일을 엿봐 이름·내용을 본다.
  const files: File[] = []
  const append = FormData.prototype.append
  vi.spyOn(FormData.prototype, 'append').mockImplementation(function (this: FormData, ...args: unknown[]) {
    if (args[0] === 'file') files.push(args[1] as File)
    return (append as (...a: unknown[]) => void).apply(this, args)
  })
  const handler = http.post(UPLOAD_PATH, ({ request }) => {
    const contentType = request.headers.get('content-type') ?? ''
    return new Promise<Response>((resolve) => held.push({ contentType, resolve }))
  })
  return {
    handler,
    held,
    /** i 번째 업로드의 multipart file 필드(이름·내용). */
    async file(i: number) {
      const file = files[i]
      return { name: file.name, content: await file.text() }
    },
    /** i 번째(0부터) 업로드가 도착할 때까지 기다렸다가 응답한다. */
    async respond(i: number, status: number, body: unknown) {
      await waitFor(() => expect(held.length).toBeGreaterThan(i))
      held[i].resolve(HttpResponse.json(body as object, { status }))
    },
  }
}

const sendHandler = (reply?: () => Response) =>
  record<SendBody>('post', '/api/v1/mail/accounts/1/send', () => reply?.() ?? HttpResponse.json({ localMessageId: 10, messageId: 'x@test.local' }))

/** 크기만 큰 파일 — 앱은 한도·합계를 file.size 로만 판정하므로 내용은 몇 바이트로 둔다. */
function bigFile(name: string, size: number, type = 'video/mp4') {
  const file = new File([name], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

/** 칩 요소 목록(화면 순서) — data-status 가 있는 칩만. */
const chipEls = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="mail-compose-attachment-"][data-status]'))
const chipStatuses = () => chipEls().map((e) => e.getAttribute('data-status'))

/** 새 메일 작성창을 연다. */
async function openNew(handlers: Handlers = []) {
  const view = renderMail('/mail/1', { handlers })
  await view.user.click(await screen.findByTestId('mail-compose-new'))
  await screen.findByTestId('mail-compose-dock')
  return view
}
async function attach(view: ReturnType<typeof renderMail>, ...files: File[]) {
  await view.user.upload(screen.getByTestId('mail-compose-file-input') as HTMLInputElement, files)
}
async function fillTo(view: ReturnType<typeof renderMail>) {
  await view.user.click(screen.getByTestId('mail-compose-to'))
  await view.user.paste('rcpt@test.local')
}

/** 전달 원문(id 5)을 연 메일함 — 첨부·본문은 테스트가 준다. */
async function openForward(over: Parameters<typeof detail>[0], handlers: Handlers = []) {
  const view = renderMail('/mail/1', {
    handlers: [
      ...handlers,
      http.get('/api/v1/mail/accounts/1/messages', () => HttpResponse.json([summary({ id: 5, subject: '자료 공유' })])),
      http.get('/api/v1/mail/messages/5', () => HttpResponse.json(detail({ id: 5, subject: '자료 공유', ...over }))),
    ],
  })
  await view.user.click(await screen.findByTestId('mail-row-5'))
  await view.user.click(await screen.findByTestId('mail-forward'))
  await screen.findByTestId('mail-compose-dock')
  return view
}

// 업로드 요청(multipart file 필드) → 올리는 중 칩(진행 막대)·보내기 잠금과 이유(보이는 줄 + live 영역) → 완료 칩·합계 → attachmentIds 발송.
test('붙인 파일을 multipart 로 올리고, 올리는 동안 보내기가 잠겼다가 완료 칩이 되면 attachmentIds 로 발송한다', async () => {
  const uploads = holdUploads()
  const send = sendHandler()
  const view = await openNew([uploads.handler, send.handler])
  await fillTo(view)
  // 보내기 잠금 이유 live 영역은 첨부가 없을 때부터 비어 있는 채로 있다 — 첫 안내도 바뀐 글로 읽히게.
  const status = screen.getByTestId('mail-compose-attachments-status')
  expect(status).toHaveAttribute('role', 'status')
  expect(status).toHaveTextContent(/^$/)

  await attach(view, new File(['PDF-CONTENT-123'], '보고서.pdf', { type: 'application/pdf' }))
  await waitFor(() => expect(uploads.held).toHaveLength(1))
  expect(uploads.held[0].contentType).toMatch(/^multipart\/form-data; boundary=/)
  expect(await uploads.file(0)).toEqual({ name: '보고서.pdf', content: 'PDF-CONTENT-123' })

  const chip = chipEls()[0]
  expect(chip).toHaveAttribute('data-status', 'uploading')
  expect(within(chip).getByRole('progressbar')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-send')).toBeDisabled()
  expect(screen.getByTestId('mail-compose-send-blocked')).toHaveTextContent(/올리는 중/)
  expect(status).toHaveTextContent(/올리는 중/)

  await uploads.respond(0, 201, uploaded(501, '보고서.pdf', 15))
  await waitFor(() => expect(chipEls()[0]).toHaveAttribute('data-status', 'done'))
  expect(chipEls()[0]).toHaveTextContent('보고서.pdf')
  expect(chipEls()[0]).toHaveTextContent('15 B')
  expect(screen.getByTestId('mail-compose-attachments-total')).toHaveTextContent('첨부 1개 · 15 B / 25 MB')
  expect(screen.getByTestId('mail-compose-send')).toBeEnabled()
  expect(status).toHaveTextContent(/^$/)

  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.attachmentIds).toEqual([501])
  expect(send.last().body.forwardAttachmentIds).toEqual([])
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
})

// 전달 — 원본 첨부가 칩·합계로 들어오고, 뺀 것은 forwardAttachmentIds 에서도 빠진다.
test('전달은 원본 첨부가 칩으로 들어 있고, 하나를 빼면 forwardAttachmentIds 에서도 빠진다', async () => {
  const send = sendHandler()
  const view = await openForward(
    {
      bodyText: '자료 첨부합니다',
      bodyHtml: null,
      attachments: [
        { id: 31, filename: '사업계획.pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sizeBytes: 3 * MB, contentId: null },
        { id: 32, filename: '예산안.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 512 * 1024, contentId: null },
        { id: 33, filename: '회의록.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 96 * 1024, contentId: null },
      ],
    },
    [send.handler],
  )
  const list = screen.getByTestId('mail-compose-attachments')
  expect(Array.from(list.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
    expect.stringMatching(/사업계획\.pptx/),
    expect.stringMatching(/예산안\.xlsx/),
    expect.stringMatching(/회의록\.docx/),
  ])
  expect(screen.getByTestId('mail-compose-attachments-total')).toHaveTextContent('첨부 3개 · 3.6 MB / 25 MB')

  await view.user.click(screen.getByRole('button', { name: '예산안.xlsx 첨부 빼기' }))
  expect(screen.getByTestId('mail-compose-attachments').querySelectorAll('li')).toHaveLength(2)

  await fillTo(view)
  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  expect(send.last().body.forwardAttachmentIds).toEqual([31, 33])
  expect(send.last().body.attachmentIds).toEqual([])
})

// 한도(25MB) 초과 — 요청 없이 실패 칩(다시 시도 없음)·보내기 잠금·이유 문구, 빼면 풀린다.
test('25MB 를 넘는 파일은 올리지 않고 실패 칩으로 보내기를 잠그며, 빼면 풀린다', async () => {
  const uploads = holdUploads()
  const view = await openNew([uploads.handler])
  await attach(view, bigFile('현장영상.mp4', 26 * MB))

  const chip = chipEls()[0]
  expect(chip).toHaveAttribute('data-status', 'error')
  expect(chip).toHaveTextContent('25MB를 넘어요')
  expect(within(chip).queryByTestId('mail-compose-attachment-retry')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-send')).toBeDisabled()
  expect(screen.getByTestId('mail-compose-send-blocked')).toHaveTextContent(/빼거나 다시 시도/)
  expect(uploads.held).toHaveLength(0)

  await view.user.click(within(chip).getByTestId('mail-compose-attachment-remove'))
  expect(screen.queryByTestId('mail-compose-attachments')).not.toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-send')).toBeEnabled()
})

// 서버 5xx — 실패 칩 + 다시 시도, 다시 시도 성공 → 완료·보내기 열림.
test('서버가 실패하면 실패 칩에 다시 시도가 붙고, 다시 시도가 성공하면 보낼 수 있다', async () => {
  const uploads = holdUploads()
  const view = await openNew([uploads.handler])
  await attach(view, new File(['DWG'], '도면.dwg', { type: 'application/octet-stream' }))
  await uploads.respond(0, 500, { message: 'storage error' })

  await waitFor(() => expect(chipEls()[0]).toHaveAttribute('data-status', 'error'))
  expect(chipEls()[0]).toHaveTextContent('올리지 못했어요')
  expect(screen.getByTestId('mail-compose-send')).toBeDisabled()

  await view.user.click(within(chipEls()[0]).getByTestId('mail-compose-attachment-retry'))
  await waitFor(() => expect(chipEls()[0]).toHaveAttribute('data-status', 'uploading'))
  await uploads.respond(1, 201, uploaded(801, '도면.dwg', 3, 'application/octet-stream'))
  await waitFor(() => expect(chipEls()[0]).toHaveAttribute('data-status', 'done'))
  expect(screen.getByTestId('mail-compose-send')).toBeEnabled()
})

// 다시 시도도 합계 한도를 다시 잰다 — 실패한 동안 여유가 줄었으면 올리지 않고 한도 초과 칩, 실패는 합계 줄에서 따로 센다.
test('실패한 동안 다른 파일이 붙어 합계 여유가 줄었으면, 다시 시도는 올리지 않고 한도 초과 칩이 된다', async () => {
  const uploads = holdUploads()
  const view = await openNew([uploads.handler])
  await attach(view, bigFile('영상1.mp4', 10 * MB))
  await uploads.respond(0, 500, { message: 'storage error' })
  await waitFor(() => expect(chipStatuses()).toEqual(['error']))
  await attach(view, bigFile('영상2.mp4', 20 * MB))
  await uploads.respond(1, 201, uploaded(811, '영상2.mp4', 20 * MB, 'video/mp4'))
  await waitFor(() => expect(chipStatuses()).toEqual(['error', 'done']))

  const first = chipEls()[0]
  await view.user.click(within(first).getByTestId('mail-compose-attachment-retry'))
  await waitFor(() => expect(chipEls()[0]).toHaveTextContent('25MB를 넘어요'))
  expect(chipEls()[0]).toHaveAttribute('data-status', 'error')
  expect(within(chipEls()[0]).queryByTestId('mail-compose-attachment-retry')).not.toBeInTheDocument()
  // 다시 올리지 않았다 — 업로드 요청은 처음 두 번뿐.
  expect(uploads.held).toHaveLength(2)
  expect(screen.getByTestId('mail-compose-attachments-total')).toHaveTextContent('첨부 1개 · 실패 1 · 20.0 MB / 25 MB')
})

// 전달 인용문의 본문(cid) 이미지도 나가는 크기라 합계·한도에 든다 — 인용문을 지우면 빠진다.
test('전달 인용문의 본문 이미지도 합계에 들어가고, 인용문을 지우면 빠진다', async () => {
  const uploads = holdUploads()
  const view = await openForward(
    {
      subject: '로고 시안',
      bodyText: null,
      bodyHtml: '<p>시안입니다.</p><img src="cid:logo.png">',
      attachments: [
        { id: 21, filename: 'logo.png', contentType: 'image/png', sizeBytes: 3 * MB, contentId: null },
        { id: 22, filename: '설명.pdf', contentType: 'application/pdf', sizeBytes: 100, contentId: null },
      ],
    },
    [uploads.handler, http.get('/api/v1/mail/attachments/21/content', () => new HttpResponse('PNG', { headers: { 'content-type': 'image/png' } }))],
  )
  const total = screen.getByTestId('mail-compose-attachments-total')
  expect(screen.getByTestId('mail-compose-attachments').querySelectorAll('li')).toHaveLength(1)
  await waitFor(() => expect(total).toHaveTextContent('첨부 1개 · 3.0 MB / 25 MB · 본문 이미지 3.0 MB 포함'))

  // 칩만 세면 들어갈 23MB 가 본문 이미지까지 더하면 넘는다 — 올리지 않고 한도 초과 칩.
  await attach(view, bigFile('영상.mp4', 23 * MB))
  const over = () => document.querySelector<HTMLElement>('[data-testid^="mail-compose-attachment-upload-"]')!
  expect(over()).toHaveAttribute('data-status', 'error')
  expect(over()).toHaveTextContent('25MB를 넘어요')
  await view.user.click(within(over()).getByTestId('mail-compose-attachment-remove'))

  await view.user.click(screen.getByTestId('mail-compose-quote-remove'))
  await waitFor(() => expect(total).toHaveTextContent(/^첨부 1개 · 100 B \/ 25 MB$/))
  await attach(view, bigFile('영상.mp4', 23 * MB))
  expect(over()).toHaveAttribute('data-status', 'uploading')
  await waitFor(() => expect(uploads.held).toHaveLength(1))
})

// 서버 4xx 는 다시 올려도 같다 — 서버 문구를 칩에 보이고 다시 시도를 달지 않는다.
test('서버가 4xx 로 거절한 업로드는 서버 문구를 보이고 다시 시도를 달지 않는다', async () => {
  const uploads = holdUploads()
  const view = await openNew([uploads.handler])
  await attach(view, new File(['ZIP'], '큰파일.zip', { type: 'application/zip' }))
  await uploads.respond(0, 400, { status: 400, message: '파일 하나는 25MB까지 올릴 수 있어요' })

  await waitFor(() => expect(chipEls()[0]).toHaveAttribute('data-status', 'error'))
  expect(chipEls()[0]).toHaveTextContent('파일 하나는 25MB까지 올릴 수 있어요')
  expect(within(chipEls()[0]).queryByTestId('mail-compose-attachment-retry')).not.toBeInTheDocument()
})

// 올리는 중 ✕ — 업로드 요청을 실제로 끊고(XHR abort) 칩을 지우며 보내기를 푼다.
test('올리는 중에 ✕ 를 누르면 업로드 요청을 취소하고 칩이 사라진다', async () => {
  // jsdom 의 axios 는 XHR 로 보내고 MSW 는 끊김을 핸들러에 넘기지 않아, XHR 의 open·abort 를 엿봐 업로드 요청이 끊겼는지 센다.
  const urls = new WeakMap<XMLHttpRequest, string>()
  const open = XMLHttpRequest.prototype.open
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(function (this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, String(args[1]))
    return (open as (...a: unknown[]) => void).apply(this, args)
  })
  const abort = vi.spyOn(XMLHttpRequest.prototype, 'abort')
  const uploadAborts = () => abort.mock.contexts.filter((x) => urls.get(x as XMLHttpRequest)?.endsWith('/mail/compose-attachments')).length

  const uploads = holdUploads()
  const view = await openNew([uploads.handler])
  await attach(view, new File(['JPG'], '사진.jpg', { type: 'image/jpeg' }))
  await waitFor(() => expect(uploads.held).toHaveLength(1))
  expect(chipEls()[0]).toHaveAttribute('data-status', 'uploading')

  await view.user.click(screen.getByRole('button', { name: '사진.jpg 첨부 빼기' }))
  expect(screen.queryByTestId('mail-compose-attachments')).not.toBeInTheDocument()
  await waitFor(() => expect(uploadAborts()).toBe(1))
  expect(screen.getByTestId('mail-compose-send')).toBeEnabled()
})

// 첨부만 붙인 작성창도 쓴 내용이다 — ✕ 는 묻지 않고 그 첨부와 함께 임시저장한다(WP-577).
test('첨부만 붙인 상태에서 ✕ 를 누르면 묻지 않고 그 첨부와 함께 임시저장한다(WP-577)', async () => {
  const uploads = holdUploads()
  const drafts = record<{ attachmentIds: number[]; forwardAttachmentIds: number[] }>('post', '/api/v1/mail/drafts', () =>
    HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-10-21T01:00:00Z' }),
  )
  const view = await openNew([uploads.handler, drafts.handler])
  await attach(view, new File(['A'], 'a.pdf', { type: 'application/pdf' }))
  await uploads.respond(0, 201, uploaded(901, 'a.pdf', 1))
  await waitFor(() => expect(chipStatuses()).toEqual(['done']))

  await view.user.click(screen.getByTestId('mail-compose-close'))
  await waitFor(() => expect(screen.queryByTestId('mail-compose-dock')).not.toBeInTheDocument())
  await waitFor(() => expect(drafts.calls).toHaveLength(1))
  expect(drafts.last().body).toMatchObject({ attachmentIds: [901], forwardAttachmentIds: [] })
  expect(await screen.findByText('임시보관함에 저장했어요')).toBeInTheDocument()
})

// 발송 400 — 서버 문구를 알리고 작성창·완료 칩을 그대로 둔다(첨부를 잃지 않게).
test('발송을 서버가 400 으로 거절하면 그 문구를 보여 주고 작성창과 첨부를 그대로 둔다', async () => {
  const uploads = holdUploads()
  const send = sendHandler(() => HttpResponse.json({ status: 400, message: '첨부 파일이 만료됐어요. 다시 올려 주세요.' }, { status: 400 }))
  const view = await openNew([uploads.handler, send.handler])
  await fillTo(view)
  await attach(view, new File(['B'], 'b.pdf', { type: 'application/pdf' }))
  await uploads.respond(0, 201, uploaded(902, 'b.pdf', 1))
  await waitFor(() => expect(screen.getByTestId('mail-compose-send')).toBeEnabled())
  await view.user.click(screen.getByTestId('mail-compose-send'))

  expect(await screen.findByText('첨부 파일이 만료됐어요. 다시 올려 주세요.')).toBeInTheDocument()
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  expect(chipStatuses()).toEqual(['done'])
})

// 보낸편지함 상세도 첨부 목록(이름·크기)을 보인다.
test('보낸편지함 상세도 보낸 메일의 첨부 목록을 보여 준다', async () => {
  const { user } = renderMail('/mail/1', {
    handlers: [
      http.get('/api/v1/mail/accounts/1/messages', ({ request }) =>
        HttpResponse.json(new URL(request.url).searchParams.get('folder') === 'SENT' ? [summary({ id: 8, subject: '보낸 자료', seen: true })] : []),
      ),
      http.get('/api/v1/mail/messages/8', () =>
        HttpResponse.json(
          detail({
            id: 8,
            subject: '보낸 자료',
            bodyText: '첨부 보냅니다',
            bodyHtml: null,
            attachments: [
              { id: 51, filename: '견적서.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 820 * 1024, contentId: null },
              { id: 52, filename: '현장사진.jpg', contentType: 'image/jpeg', sizeBytes: 2 * MB, contentId: null },
            ],
          }),
        ),
      ),
    ],
  })
  await user.click(await screen.findByTestId('mail-folder-sent'))
  await user.click(await screen.findByTestId('mail-row-8'))
  const list = await screen.findByTestId('mail-attachments')
  expect(within(list).getAllByRole('listitem')).toHaveLength(2)
  expect(screen.getByTestId('mail-attachment-name-51')).toHaveTextContent('견적서.xlsx')
  expect(screen.getByTestId('mail-attachment-open-52')).toHaveTextContent('2.0 MB')
})

// ── 화면 캡처 붙여넣기(WP-947) — 붙여넣기 뒤의 업로드·보내기 처리 ──
// 실제 Ctrl+V(클립보드 이벤트)·실행 취소/다시 실행은 e2e/pages/mail/mail-compose-paste-image.spec.ts(@input)가 지킨다.
// 여기서는 클립보드 데이터(파일만)를 실은 paste 이벤트를 에디터에 보내, 그 뒤 업로드 실패 처리·발송 payload(cid 치환)를 본다.

/** 파일만 든 클립보드 데이터로 본문 에디터에 paste 를 보낸다(jsdom 엔 DataTransfer 가 없어 필요한 면만 갖춘 객체). */
function pasteImage() {
  const file = new File(['PNG'], 'image.png', { type: 'image/png' })
  const clipboardData = { files: [file], types: ['Files'], items: [], getData: () => '' }
  fireEvent.paste(screen.getByTestId('mail-composer-body'), { clipboardData })
}

// 붙여 넣은 캡처의 업로드가 실패하면 본문 자리표시를 지우고 서버 문구를 알린다(빈 그림이 남지 않게).
test('붙여 넣은 캡처의 업로드가 실패하면 자리표시를 지우고 서버 문구를 알린다', async () => {
  const view = await openNew([http.post(UPLOAD_PATH, () => HttpResponse.json({ status: 413, message: '파일이 너무 커요' }, { status: 413 }))])
  await view.user.click(screen.getByTestId('mail-composer-body'))
  pasteImage()
  expect(await screen.findByText('파일이 너무 커요')).toBeInTheDocument()
  await waitFor(() => expect(screen.queryByTestId('mail-body-image')).not.toBeInTheDocument())
})

// 올리는 중엔 발송을 막고 알린다 → 올라가면 그림(blob)으로 바뀌고 칩은 생기지 않는다 →
// 발송 본문의 그림 src 는 cid: 로 바뀌고 그 업로드가 attachmentIds·inlineUploads 로 실린다.
test('붙여 넣은 캡처는 올리는 동안 발송을 막고, 보낼 때 cid 인라인 이미지로 실린다(칩은 생기지 않는다)', async () => {
  const uploads = holdUploads()
  const send = record<{ bodyHtml: string; attachmentIds: number[]; inlineUploads: unknown[] }>('post', '/api/v1/mail/accounts/1/send', () =>
    HttpResponse.json({ localMessageId: 10, messageId: 'x@test.local' }),
  )
  const view = await openNew([
    uploads.handler,
    send.handler,
    http.get('/api/v1/files/701/content', () => new HttpResponse('PNG', { headers: { 'content-type': 'image/png' } })),
  ])
  await fillTo(view)
  await view.user.click(screen.getByTestId('mail-composer-body'))
  pasteImage()
  const image = await screen.findByTestId('mail-body-image')
  expect(image).toHaveAttribute('data-pending', 'true')
  expect(image).toHaveTextContent('이미지 올리는 중…')
  await view.user.click(screen.getByTestId('mail-compose-send'))
  expect(await screen.findByText('이미지를 올리는 중이에요. 다 올라간 뒤 보내 주세요')).toBeInTheDocument()
  expect(send.calls).toHaveLength(0)

  await uploads.respond(0, 201, { id: 701, name: 'image.png', size: 68, mimeType: 'image/png', expiresAt: '2026-10-26T10:00:00Z' })
  await waitFor(() => expect(screen.getByTestId('mail-body-image')).not.toHaveAttribute('data-pending'))
  expect(chipEls()).toHaveLength(0)

  await view.user.click(screen.getByTestId('mail-compose-send'))
  await waitFor(() => expect(send.calls).toHaveLength(1))
  const body = send.last().body
  expect(body.bodyHtml).toContain('<img src="cid:pasted-701@genia-works"')
  expect(body.bodyHtml).not.toContain('/api/v1/files/701/content')
  expect(body.attachmentIds).toEqual([701])
  expect(body.inlineUploads).toEqual([{ attachmentId: 701, contentId: 'pasted-701@genia-works' }])
})
