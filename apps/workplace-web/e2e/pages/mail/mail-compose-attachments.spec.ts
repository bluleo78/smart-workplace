// 메일 작성창 파일 첨부(WP-574) E2E — 📎 선택·끌어다 놓기 → 바로 업로드(칩) → 발송 payload 의 attachmentIds/forwardAttachmentIds.
// 백엔드 없이 page.route 모킹. 업로드 응답을 붙잡아 두었다가 풀어 진행 칩 → 완료를 확인한다.
import type { Page, Route } from '@playwright/test'

import type { ComposeAttachmentUpload, MailSendRequest } from '../../../src/types/mailMessage'
import { detail, mailAccount, summary } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectOnTop } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'

const UPLOAD_PATH = '/api/v1/mail/compose-attachments'
const SEND_PATH = '/api/v1/mail/accounts/1/send'
const MB = 1024 * 1024

/** 업로드 응답 본문 — 계약(201 + expiresAt)대로. */
function uploaded(id: number, name: string, size: number, mimeType = 'application/pdf'): ComposeAttachmentUpload {
  return { id, name, size, mimeType, expiresAt: '2026-10-21T10:00:00Z' }
}

/** 업로드를 붙잡아 두는 모킹 — 요청마다 route 를 쌓고, 테스트가 respond 로 하나씩 응답한다. */
async function holdUploads(page: Page) {
  const held: Route[] = []
  await page.route((u) => u.pathname === UPLOAD_PATH, (route) => {
    held.push(route)
  })
  return {
    held,
    /** i 번째(0부터) 업로드가 도착할 때까지 기다렸다가 응답한다. */
    async respond(i: number, status: number, body: unknown) {
      await expect.poll(() => held.length).toBeGreaterThan(i)
      await held[i].fulfill({ status, json: body })
    },
  }
}

/** 발송 성공 모킹 + 요청 기록. */
async function mockSend(page: Page) {
  const sends = trackRequests(page, 'POST', SEND_PATH)
  await page.route(
    (u) => u.pathname === SEND_PATH,
    (route) => route.fulfill({ status: 200, json: { localMessageId: 10, messageId: 'x@test.local' } }),
  )
  return sends
}

/** 숨은 파일 입력에 큰 파일을 넣는다 — 수십 MB 를 CDP 로 보내지 않게 페이지 안에서 만든다. */
async function addLargeFile(page: Page, name: string, size: number, type = 'video/mp4') {
  await page.getByTestId('mail-compose-file-input').evaluate(
    (input, f) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(f.size)], f.name, { type: f.type }))
      ;(input as HTMLInputElement).files = dt.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    },
    { name, size, type },
  )
}

/** 칩 상태 목록(화면 순서). */
function chipStatuses(page: Page) {
  return page
    .locator('[data-testid^="mail-compose-attachment-"][data-status]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-status')))
}

/** 파일을 끌어 와 놓는다 — target 에 dragenter → drop 을 DataTransfer 와 함께 보낸다(실제 끌어다 놓기와 같은 이벤트 순서). */
async function dropFile(page: Page, testId: string, name: string, content: string) {
  const dataTransfer = await page.evaluateHandle(
    ([n, c]) => {
      const dt = new DataTransfer()
      dt.items.add(new File([c], n, { type: 'application/pdf' }))
      return dt
    },
    [name, content] as const,
  )
  const target = page.getByTestId(testId)
  await target.dispatchEvent('dragenter', { dataTransfer })
  await target.dispatchEvent('dragover', { dataTransfer })
  return {
    drop: () => target.dispatchEvent('drop', { dataTransfer }),
  }
}

test.describe('메일 작성창 파일 첨부 (WP-574)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ json: [] }),
    )
  })

  async function openNew(page: Page) {
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  }

  test('📎 로 고른 파일을 multipart 로 올리고, 올리는 동안 보내기가 잠겼다가 완료 칩이 되면 attachmentIds 로 발송한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    const uploadReqs = trackRequests(page, 'POST', UPLOAD_PATH)
    const sends = await mockSend(page)
    await openNew(page)
    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    // 보내기 잠금 이유 live 영역은 첨부가 없을 때부터 비어 있는 채로 있다 — 첫 안내도 바뀐 글로 읽히게.
    const status = page.getByTestId('mail-compose-attachments-status')
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toHaveText('')

    // 📎 → 파일 선택 창 → 파일 고르기.
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: '파일 첨부' }).click()
    await (await chooser).setFiles({ name: '보고서.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PDF-CONTENT-123') })

    // 요청: multipart(경계 포함) + 필드 file + 파일 이름·내용.
    await uploadReqs.waitFor()
    const req = uploadReqs.requests()[0]
    expect(req.headers()['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    const raw = req.postDataBuffer()!.toString('utf8')
    expect(raw).toContain('name="file"; filename="보고서.pdf"')
    expect(raw).toContain('PDF-CONTENT-123')

    // 올리는 중 — 진행 막대·보내기 잠김·이유 한 줄.
    const chip = page.locator('[data-testid^="mail-compose-attachment-"][data-status]').first()
    await expect(chip).toHaveAttribute('data-status', 'uploading')
    await expect(chip.getByRole('progressbar')).toBeVisible()
    await expect(page.getByTestId('mail-compose-send')).toBeDisabled()
    await expect(page.getByTestId('mail-compose-send-blocked')).toHaveText(/올리는 중/)
    await expect(status).toHaveText(/올리는 중/)

    // 응답 → 완료 칩(크기 표시)·합계·보내기 열림.
    await uploads.respond(0, 201, uploaded(501, '보고서.pdf', 15))
    await expect(chip).toHaveAttribute('data-status', 'done')
    await expect(chip).toContainText('보고서.pdf')
    await expect(chip).toContainText('15 B')
    await expect(page.getByTestId('mail-compose-attachments-total')).toHaveText('첨부 1개 · 15 B / 25 MB')
    await expect(page.getByTestId('mail-compose-send')).toBeEnabled()
    await expect(status).toHaveText('')

    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    const body = sends.lastBody<MailSendRequest>()!
    expect(body.attachmentIds).toEqual([501])
    expect(body.forwardAttachmentIds).toEqual([])
    await expect(page.getByTestId('mail-compose-dock')).toBeHidden()
  })

  test('본문 에디터 위로 파일을 끌어 오면 창 전체에 안내가 뜨고, 놓으면 에디터에 들어가지 않고 첨부로 올라간다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    const uploadReqs = trackRequests(page, 'POST', UPLOAD_PATH)
    await openNew(page)
    await page.getByTestId('mail-composer-body').click()
    await page.keyboard.type('본문')

    // 끌기 안내 live 영역은 끌기 전부터 비어 있는 채로 있다.
    const dropStatus = page.getByTestId('mail-compose-drop-status')
    await expect(dropStatus).toHaveText('')
    const { drop } = await dropFile(page, 'mail-composer-body', '계약서.pdf', 'CONTRACT')
    await expect(page.getByTestId('mail-compose-drop-overlay')).toBeVisible()
    await expect(page.getByTestId('mail-compose-drop-overlay')).toHaveText(/여기에 놓으면 첨부돼요/)
    await expect(dropStatus).toHaveText('여기에 놓으면 첨부돼요')
    await drop()
    await expect(page.getByTestId('mail-compose-drop-overlay')).toHaveCount(0)
    await expect(dropStatus).toHaveText('')

    await uploadReqs.waitFor()
    expect(uploadReqs.requests()[0].postDataBuffer()!.toString('utf8')).toContain('filename="계약서.pdf"')
    await uploads.respond(0, 201, uploaded(601, '계약서.pdf', 8))
    expect(await chipStatuses(page)).toEqual(['done'])
    // 에디터 본문은 그대로다(파일 이름·링크가 끼어들지 않음).
    await expect(page.getByTestId('mail-composer-body')).toHaveText('본문')
  })

  test('최소화한 창에 파일을 놓으면 작은 창으로 펼쳐 칩을 보여 준다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    await openNew(page)
    await page.getByTestId('mail-compose-minimize').click()
    // 최소화는 본문 영역을 숨기기만 한다(WP-576 — 언마운트하면 쓰던 본문을 잃는다).
    await expect(page.getByTestId('mail-compose-to')).toBeHidden()

    const { drop } = await dropFile(page, 'mail-compose-dock', '도면.pdf', 'DWG')
    await drop()
    await expect(page.getByTestId('mail-compose-to')).toBeVisible()
    await uploads.respond(0, 201, uploaded(701, '도면.pdf', 3))
    expect(await chipStatuses(page)).toEqual(['done'])
  })

  test('전달은 원본 첨부가 칩으로 들어 있고, 하나를 빼면 forwardAttachmentIds 에서도 빠진다', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ json: [summary({ id: 5, subject: '자료 공유' })] }),
    )
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/5',
      detail({
        id: 5,
        subject: '자료 공유',
        bodyText: '자료 첨부합니다',
        bodyHtml: null,
        attachments: [
          { id: 31, filename: '사업계획.pptx', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sizeBytes: 3 * MB, contentId: null },
          { id: 32, filename: '예산안.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 512 * 1024, contentId: null },
          { id: 33, filename: '회의록.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 96 * 1024, contentId: null },
        ],
      }),
    )
    const sends = await mockSend(page)
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-5').click()
    await page.getByTestId('mail-forward').click()

    const chips = page.getByTestId('mail-compose-attachments')
    // 작은 창 고정 줄은 칩을 한 줄로 접으므로(넘친 칩은 보조기술에서도 숨김) 칩 요소로 센다.
    await expect(chips.locator('li')).toHaveText([/사업계획\.pptx/, /예산안\.xlsx/, /회의록\.docx/])
    await expect(page.getByTestId('mail-compose-attachments-total')).toHaveText('첨부 3개 · 3.6 MB / 25 MB')

    await page.getByRole('button', { name: '예산안.xlsx 첨부 빼기' }).click()
    await expect(chips.locator('li')).toHaveCount(2)

    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor()
    const body = sends.lastBody<MailSendRequest>()!
    expect(body.forwardAttachmentIds).toEqual([31, 33])
    expect(body.attachmentIds).toEqual([])
  })

  test('25MB 를 넘는 파일은 올리지 않고 실패 칩으로 보내기를 잠그며, 빼면 풀린다', async ({ authenticatedPage: page }) => {
    const uploadReqs = trackRequests(page, 'POST', UPLOAD_PATH)
    await openNew(page)
    await addLargeFile(page, '현장영상.mp4', 26 * MB)

    const chip = page.locator('[data-testid^="mail-compose-attachment-"][data-status]').first()
    await expect(chip).toHaveAttribute('data-status', 'error')
    await expect(chip).toContainText('25MB를 넘어요')
    // 다시 올려도 같은 결과라 다시 시도는 없다.
    await expect(chip.getByTestId('mail-compose-attachment-retry')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-send')).toBeDisabled()
    await expect(page.getByTestId('mail-compose-send-blocked')).toHaveText(/빼거나 다시 시도/)
    expect(uploadReqs.count()).toBe(0)

    await chip.getByTestId('mail-compose-attachment-remove').click()
    await expect(page.getByTestId('mail-compose-attachments')).toHaveCount(0)
    await expect(page.getByTestId('mail-compose-send')).toBeEnabled()
  })

  test('서버가 실패하면 실패 칩에 다시 시도가 붙고, 다시 시도가 성공하면 보낼 수 있다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    await openNew(page)
    await page.getByTestId('mail-compose-file-input').setInputFiles({ name: '도면.dwg', mimeType: 'application/octet-stream', buffer: Buffer.from('DWG') })
    await uploads.respond(0, 500, { message: 'storage error' })

    const chip = page.locator('[data-testid^="mail-compose-attachment-"][data-status]').first()
    await expect(chip).toHaveAttribute('data-status', 'error')
    await expect(chip).toContainText('올리지 못했어요')
    await expect(page.getByTestId('mail-compose-send')).toBeDisabled()

    await chip.getByTestId('mail-compose-attachment-retry').click()
    await expect(chip).toHaveAttribute('data-status', 'uploading')
    await uploads.respond(1, 201, uploaded(801, '도면.dwg', 3, 'application/octet-stream'))
    await expect(chip).toHaveAttribute('data-status', 'done')
    await expect(page.getByTestId('mail-compose-send')).toBeEnabled()
  })

  test('실패한 동안 다른 파일이 붙어 합계 여유가 줄었으면, 다시 시도는 올리지 않고 한도 초과 칩이 된다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    const uploadReqs = trackRequests(page, 'POST', UPLOAD_PATH)
    await openNew(page)
    // 10MB 실패(합계에서 빠짐) → 20MB 완료 → 실패 칩을 다시 올리면 30MB 라 한도(25MB)를 넘는다.
    await addLargeFile(page, '영상1.mp4', 10 * MB)
    await uploads.respond(0, 500, { message: 'storage error' })
    const first = page.locator('[data-testid^="mail-compose-attachment-"][data-status]').first()
    await expect(first).toHaveAttribute('data-status', 'error')
    await addLargeFile(page, '영상2.mp4', 20 * MB)
    await uploads.respond(1, 201, uploaded(811, '영상2.mp4', 20 * MB, 'video/mp4'))
    await expect.poll(() => chipStatuses(page)).toEqual(['error', 'done'])

    await first.getByTestId('mail-compose-attachment-retry').click()
    await expect(first).toContainText('25MB를 넘어요')
    await expect(first).toHaveAttribute('data-status', 'error')
    await expect(first.getByTestId('mail-compose-attachment-retry')).toHaveCount(0)
    // 다시 올리지 않았다 — 업로드 요청은 처음 두 번뿐.
    expect(uploadReqs.count()).toBe(2)
    // 실패 칩은 개수·합계에서 빠지고 따로 센다.
    await expect(page.getByTestId('mail-compose-attachments-total')).toHaveText('첨부 1개 · 실패 1 · 20.0 MB / 25 MB')
  })

  test('리렌더 전에 파일을 연달아 두 번 놓아도 합계 상한을 넘겨 붙이지 않는다', async ({ authenticatedPage: page }) => {
    await holdUploads(page)
    const uploadReqs = trackRequests(page, 'POST', UPLOAD_PATH)
    await openNew(page)
    // 같은 스크립트 안에서 dragenter→drop 을 두 번 — 사이에 React 가 다시 그리지 못한다. 20MB + 20MB 는 25MB 를 넘는다.
    await page.getByTestId('mail-compose-dock').evaluate((dock, size) => {
      for (const name of ['영상A.mp4', '영상B.mp4']) {
        const dt = new DataTransfer()
        dt.items.add(new File([new Uint8Array(size)], name, { type: 'video/mp4' }))
        dock.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
        dock.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      }
    }, 20 * MB)

    // 작은 창 고정 줄은 실패 칩을 앞에 둔다 — 순서와 무관하게 하나는 올라가고 하나는 한도 초과다.
    await expect.poll(async () => (await chipStatuses(page)).sort()).toEqual(['error', 'uploading'])
    await expect(page.locator('[data-testid^="mail-compose-attachment-"][data-status="error"]')).toContainText('25MB를 넘어요')
    await expect.poll(() => uploadReqs.count()).toBe(1)
  })

  test('전달 인용문의 본문 이미지도 합계에 들어가고, 인용문을 지우면 빠진다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ json: [summary({ id: 5, subject: '로고 시안' })] }),
    )
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/5',
      detail({
        id: 5,
        subject: '로고 시안',
        bodyText: null,
        bodyHtml: '<p>시안입니다.</p><img src="cid:logo.png">',
        attachments: [
          // 본문에 박힌 이미지(3MB) — 칩이 아니라 인용문이 cid 로 다시 붙인다.
          { id: 21, filename: 'logo.png', contentType: 'image/png', sizeBytes: 3 * MB, contentId: null },
          { id: 22, filename: '설명.pdf', contentType: 'application/pdf', sizeBytes: 100, contentId: null },
        ],
      }),
    )
    await page.route(
      (u) => u.pathname === '/api/v1/mail/attachments/21/content',
      (route) => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.from('PNG') }),
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-5').click()
    await page.getByTestId('mail-forward').click()

    // 칩은 설명.pdf 하나지만 합계는 본문 이미지 3MB 까지 — 칩에 없는 크기임을 알린다.
    const total = page.getByTestId('mail-compose-attachments-total')
    await expect(page.getByTestId('mail-compose-attachments').getByRole('listitem')).toHaveCount(1)
    await expect(total).toHaveText('첨부 1개 · 3.0 MB / 25 MB · 본문 이미지 3.0 MB 포함')

    // 칩만 세면 들어갈 23MB 가 본문 이미지까지 더하면 넘는다 — 올리지 않고 한도 초과 칩.
    await addLargeFile(page, '영상.mp4', 23 * MB)
    const over = page.locator('[data-testid^="mail-compose-attachment-upload-"]')
    await expect(over).toHaveAttribute('data-status', 'error')
    await expect(over).toContainText('25MB를 넘어요')
    await over.getByTestId('mail-compose-attachment-remove').click()

    // 인용문을 지우면 본문 이미지도 안 나가므로 합계에서 빠지고, 같은 파일이 들어간다.
    await page.getByTestId('mail-compose-quote-remove').click()
    await expect(total).toHaveText('첨부 1개 · 100 B / 25 MB')
    await addLargeFile(page, '영상.mp4', 23 * MB)
    await expect(page.locator('[data-testid^="mail-compose-attachment-upload-"]')).toHaveAttribute('data-status', 'uploading')
    await expect.poll(() => uploads.held.length).toBe(1)
  })

  test('서버가 4xx 로 거절한 업로드는 서버 문구를 보이고 다시 시도를 달지 않는다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    await openNew(page)
    await page.getByTestId('mail-compose-file-input').setInputFiles({ name: '큰파일.zip', mimeType: 'application/zip', buffer: Buffer.from('ZIP') })
    await uploads.respond(0, 400, { status: 400, message: '파일 하나는 25MB까지 올릴 수 있어요' })

    const chip = page.locator('[data-testid^="mail-compose-attachment-"][data-status]').first()
    await expect(chip).toHaveAttribute('data-status', 'error')
    await expect(chip).toContainText('파일 하나는 25MB까지 올릴 수 있어요')
    await expect(chip.getByTestId('mail-compose-attachment-retry')).toHaveCount(0)
  })

  test('올리는 중에 ✕ 를 누르면 업로드 요청을 취소하고 칩이 사라진다', async ({ authenticatedPage: page }) => {
    await holdUploads(page) // 응답하지 않는다 — 계속 올리는 중.
    const failed: string[] = []
    page.on('requestfailed', (r) => {
      if (new URL(r.url()).pathname === UPLOAD_PATH) failed.push(r.failure()?.errorText ?? '')
    })
    await openNew(page)
    await page.getByTestId('mail-compose-file-input').setInputFiles({ name: '사진.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('JPG') })
    const chip = page.locator('[data-testid^="mail-compose-attachment-"][data-status]').first()
    await expect(chip).toHaveAttribute('data-status', 'uploading')

    await page.getByRole('button', { name: '사진.jpg 첨부 빼기' }).click()
    await expect(page.getByTestId('mail-compose-attachments')).toHaveCount(0)
    await expect.poll(() => failed).toEqual([expect.stringContaining('ABORTED')])
    await expect(page.getByTestId('mail-compose-send')).toBeEnabled()
  })

  test('첨부만 붙인 상태에서 ✕ 를 누르면 버릴지 묻는다(문구에 첨부 포함)', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    await openNew(page)
    await page.getByTestId('mail-compose-file-input').setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('A') })
    await uploads.respond(0, 201, uploaded(901, 'a.pdf', 1))
    expect(await chipStatuses(page)).toEqual(['done'])

    await page.getByTestId('mail-compose-close').click()
    const dialog = page.getByTestId('mail-compose-discard-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('입력한 받는사람·제목·본문·첨부가 사라집니다.')
    await page.getByTestId('mail-compose-discard-confirm').click()
    await expect(page.getByTestId('mail-compose-dock')).toHaveCount(0)
  })

  test('발송을 서버가 400 으로 거절하면 그 문구를 보여 주고 작성창과 첨부를 그대로 둔다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    await page.route(
      (u) => u.pathname === SEND_PATH,
      (route) => route.fulfill({ status: 400, json: { status: 400, message: '첨부 파일이 만료됐어요. 다시 올려 주세요.' } }),
    )
    await openNew(page)
    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-file-input').setInputFiles({ name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('B') })
    await uploads.respond(0, 201, uploaded(902, 'b.pdf', 1))
    await page.getByTestId('mail-compose-send').click()

    await expect(page.getByText('첨부 파일이 만료됐어요. 다시 올려 주세요.')).toBeVisible()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
    expect(await chipStatuses(page)).toEqual(['done'])
  })

  test('작은 창에서 긴 전달 인용으로 본문이 스크롤돼도 첨부 칩과 보내기 줄은 창 아래에 고정돼 보인다', async ({ authenticatedPage: page }) => {
    const longText = Array.from({ length: 80 }, (_, i) => `원문 ${i + 1}번째 줄`).join('\n')
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ json: [summary({ id: 5, subject: '긴 메일' })] }),
    )
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/5',
      detail({
        id: 5,
        subject: '긴 메일',
        bodyText: longText,
        bodyHtml: null,
        attachments: [{ id: 41, filename: '첨부.pdf', contentType: 'application/pdf', sizeBytes: 2048, contentId: null }],
      }),
    )
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/mail/1')
    await page.getByTestId('mail-row-5').click()
    await page.getByTestId('mail-forward').click()
    // 인용 블록을 전체 높이로 펼쳐 본문 영역이 확실히 스크롤되게 한다.
    const expandQuote = page.getByRole('button', { name: '전체 높이' })
    if (await expandQuote.count()) await expandQuote.click()

    const dock = (await page.getByTestId('mail-compose-dock').boundingBox())!
    const footer = page.getByTestId('mail-compose-footer')
    // 본문 영역이 실제로 넘친다(스크롤 대상) — 넘치지 않으면 고정 여부를 볼 수 없다.
    expect(await footer.evaluate((el) => el.parentElement!.scrollHeight > el.parentElement!.clientHeight)).toBe(true)

    const within = async (testId: string) => {
      const b = (await page.getByTestId(testId).boundingBox())!
      return b.y >= dock.y - 1 && b.y + b.height <= dock.y + dock.height + 1
    }
    // 처음(맨 위)에도, 끝까지 내린 뒤에도 칩·보내기가 창 안 아래에 있다.
    // 고정 줄 아래끝은 창 아래끝과 같다(±1) — 스크롤 영역 padding 만큼 떠서 본문과 겹치고 아래 틈으로 뒤 글이 비치던 회귀를 막는다.
    for (const scroll of [0, 99999]) {
      await footer.evaluate((el, top) => el.parentElement!.scrollTo({ top }), scroll)
      await expect
        .poll(async () => {
          const f = (await footer.boundingBox())!
          return Math.abs(f.y + f.height - (dock.y + dock.height))
        })
        .toBeLessThanOrEqual(1)
      await expect.poll(() => within('mail-compose-attachments')).toBe(true)
      await expect.poll(() => within('mail-compose-send')).toBe(true)
      await expectOnTop(page, page.getByTestId('mail-compose-send'), '[data-testid="mail-compose-send"]')
      await expectOnTop(page, page.getByTestId('mail-compose-attachments').getByRole('listitem').first(), '[data-testid="mail-compose-attachments"]')
    }
  })

  test('작은 창 고정 줄은 칩을 한 줄만 보이고, 「+N개」로 펼치고 「접기」로 다시 접는다', async ({ authenticatedPage: page }) => {
    const uploads = await holdUploads(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await openNew(page)
    const names = Array.from({ length: 6 }, (_, i) => `첨부파일_${i + 1}_긴이름_테스트문서.pdf`)
    await page
      .getByTestId('mail-compose-file-input')
      .setInputFiles(names.map((name) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('PDF') })))
    for (let i = 0; i < names.length; i++) await uploads.respond(i, 201, uploaded(950 + i, names[i], 3))
    await expect.poll(() => chipStatuses(page)).toEqual(Array(6).fill('done'))

    const chips = page.locator('[data-testid^="mail-compose-attachment-upload-"]')
    /** 보이는 칩(visibility)의 위끝 목록 — 접혀 있으면 한 가지 값(한 줄)이다. */
    const visibleTops = () =>
      chips.evaluateAll((els) =>
        els.filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => Math.round(e.getBoundingClientRect().top)),
      )
    const more = page.getByTestId('mail-compose-attachments-more')

    // 접힘 — 보이는 칩은 한 줄, 나머지 수가 「+N개」.
    await expect.poll(async () => new Set(await visibleTops()).size).toBe(1)
    const shown = (await visibleTops()).length
    expect(shown).toBeLessThan(6)
    await expect(more).toHaveText(`+${6 - shown}개`)
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    // 고정 줄이 본문을 덮지 않을 만큼 낮다(칩 한 줄 + 합계 줄 + 보내기 줄).
    expect((await page.getByTestId('mail-compose-footer').boundingBox())!.height).toBeLessThan(130)
    // 목록 안 스크롤은 없다(넘친 줄은 잘라 숨길 뿐 스크롤 영역이 아니다).
    const list = page.getByTestId('mail-compose-attachments').locator('ul')
    expect(await list.evaluate((ul) => getComputedStyle(ul).overflowY)).not.toMatch(/auto|scroll/)

    // 펼침 — 모든 칩이 보이고 여러 줄, 버튼은 「접기」.
    await more.click()
    await expect.poll(async () => (await visibleTops()).length).toBe(6)
    expect(new Set(await visibleTops()).size).toBeGreaterThan(1)
    await expect(more).toHaveText('접기')
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(await list.evaluate((ul) => getComputedStyle(ul).overflowY)).not.toMatch(/auto|scroll/)

    // 접기 — 다시 한 줄.
    await more.click()
    await expect.poll(async () => new Set(await visibleTops()).size).toBe(1)
    await expect(more).toHaveText(`+${6 - shown}개`)
  })

  test('보낸편지함 상세도 보낸 메일의 첨부 목록을 보여 준다', async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) =>
        route.fulfill({
          json:
            new URL(route.request().url()).searchParams.get('folder') === 'SENT'
              ? [summary({ id: 8, subject: '보낸 자료', seen: true })]
              : [],
        }),
    )
    await mockApi(
      page,
      'GET',
      '/api/v1/mail/messages/8',
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
    )
    await page.goto('/mail/1')
    await page.getByTestId('mail-folder-sent').click()
    await page.getByTestId('mail-row-8').click()

    const list = page.getByTestId('mail-attachments')
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(page.getByTestId('mail-attachment-name-51')).toHaveText('견적서.xlsx')
    await expect(page.getByTestId('mail-attachment-open-52')).toContainText('2.0 MB')
  })
})
