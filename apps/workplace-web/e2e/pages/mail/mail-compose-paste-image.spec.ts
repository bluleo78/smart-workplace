// 메일 작성창 화면 캡처 붙여넣기(WP-947) E2E — 실제 Ctrl/Cmd+V(클립보드 이벤트)와 실행 취소·다시 실행 단축키(@input)만 남긴다:
// 붙인 이미지가 본문 그 자리에 실제로 그려지고(blob 디코드), 보낼 때 cid: 로 바뀌어 attachmentIds·inlineUploads 로 실리는지.
// 붙여넣기 뒤 업로드 실패 처리·올리는 중 발송 막기·발송 payload 는 src/pages/mail/mailComposeAttachments.test.tsx 도 지킨다(WP-984).
// 백엔드 없이 page.route 모킹.
import type { Page, Route } from '@playwright/test'

import type { ComposeAttachmentUpload, MailSendRequest } from '../../../src/types/mailMessage'
import { mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const UPLOAD_PATH = '/api/v1/mail/compose-attachments'
const SEND_PATH = '/api/v1/mail/accounts/1/send'
// 1×1 투명 PNG — 브라우저가 실제로 디코드할 수 있어야 노드뷰가 그림으로 그린다.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function uploaded(id: number): ComposeAttachmentUpload {
  return { id, name: 'image.png', size: 68, mimeType: 'image/png', expiresAt: '2026-10-26T10:00:00Z' }
}

/** 본문 에디터에 클립보드 이미지를 붙여 넣는다 — 실제 Ctrl+V 와 같은 paste 이벤트(clipboardData 에 파일만). */
async function pasteImage(page: Page) {
  await page.getByTestId('mail-composer-body').click()
  await page.getByTestId('mail-composer-body').evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, PNG_BASE64)
}

test.describe('메일 작성창 화면 캡처 붙여넣기 (WP-947)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
    await page.route(
      (u) => u.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => route.fulfill({ json: [] }),
    )
    // 붙여 넣은 이미지는 작성창 업로드의 내용 경로로 다시 받아 그린다(인증 요청 → blob).
    await page.route(
      (u) => u.pathname === '/api/v1/files/701/content',
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_BASE64, 'base64') }),
    )
  })

  async function openNew(page: Page) {
    await page.goto('/mail/1')
    await page.getByTestId('mail-compose-new').click()
    await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  }

  test('붙여 넣은 캡처가 본문에 보이고, 보낼 때 cid 인라인 이미지로 실린다(칩은 생기지 않는다)', { tag: ['@input', '@smoke'] }, async ({ authenticatedPage: page }) => {
    // 업로드를 붙잡아 두어 자리표시(올리는 중)와 그동안 보내기 막힘을 본다.
    const held: Route[] = []
    await page.route((u) => u.pathname === UPLOAD_PATH, (route) => {
      held.push(route)
    })
    const uploads = trackRequests(page, 'POST', UPLOAD_PATH)
    const sends = trackRequests(page, 'POST', SEND_PATH)
    await page.route(
      (u) => u.pathname === SEND_PATH,
      (route) => route.fulfill({ status: 200, json: { localMessageId: 10, messageId: 'x@test.local' } }),
    )
    await openNew(page)
    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await page.getByTestId('mail-compose-subject').fill('화면 공유')

    await pasteImage(page)
    const image = page.getByTestId('mail-body-image')
    await expect(image).toHaveAttribute('data-pending', 'true')
    await expect(image).toHaveText('이미지 올리는 중…')
    // 올리는 중에 보내면 막고 알린다 — 빈 그림이 나가지 않게.
    await page.getByTestId('mail-compose-send').click()
    await expect(page.getByText('이미지를 올리는 중이에요. 다 올라간 뒤 보내 주세요')).toBeVisible()
    expect(sends.count()).toBe(0)

    // 작성창 업로드(multipart)로 올라간다.
    await expect.poll(() => held.length).toBe(1)
    expect(uploads.requests()[0].headers()['content-type']).toContain('multipart/form-data')
    await held[0].fulfill({ status: 201, json: uploaded(701) })
    await expect(image).not.toHaveAttribute('data-pending')
    await expect(image.locator('img')).toHaveAttribute('src', /^blob:/)
    // 본문 이미지는 첨부 칩이 아니다.
    await expect(page.locator('[data-testid^="mail-compose-attachment-"][data-status]')).toHaveCount(0)

    await page.getByTestId('mail-composer-body').pressSequentially('위 화면 확인 부탁드립니다')
    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor(1)
    const body = sends.lastBody<MailSendRequest>() as MailSendRequest
    expect(body.bodyHtml).toContain('<img src="cid:pasted-701@genia-works"')
    expect(body.bodyHtml).not.toContain('/api/v1/files/701/content')
    expect(body.bodyHtml).toContain('위 화면 확인 부탁드립니다')
    expect(body.attachmentIds).toEqual([701])
    expect(body.inlineUploads).toEqual([{ attachmentId: 701, contentId: 'pasted-701@genia-works' }])
  })

  test('올린 뒤 실행 취소·다시 실행해도 그림으로 돌아오고 「올리는 중」에 갇히지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await page.route(
      (u) => u.pathname === UPLOAD_PATH,
      (route) => route.fulfill({ status: 201, json: uploaded(701) }),
    )
    const sends = trackRequests(page, 'POST', SEND_PATH)
    await page.route(
      (u) => u.pathname === SEND_PATH,
      (route) => route.fulfill({ status: 200, json: { localMessageId: 10, messageId: 'x@test.local' } }),
    )
    await openNew(page)
    await page.getByTestId('mail-compose-to').fill('rcpt@test.local')
    await pasteImage(page)
    const image = page.getByTestId('mail-body-image')
    await expect(image.locator('img')).toHaveAttribute('src', /^blob:/)

    // 실행 취소 → 붙여넣기가 통째로 빠지고, 다시 실행 → 자리표시가 아니라 올라간 그림으로 돌아온다.
    await page.keyboard.press('ControlOrMeta+z')
    await expect(image).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await expect(image).toHaveCount(1)
    await expect(image).not.toHaveAttribute('data-pending')
    await expect(image.locator('img')).toHaveAttribute('src', /^blob:/)

    await page.getByTestId('mail-compose-send').click()
    await sends.waitFor(1)
    expect((sends.lastBody<MailSendRequest>() as MailSendRequest).inlineUploads).toEqual([
      { attachmentId: 701, contentId: 'pasted-701@genia-works' },
    ])
  })

})
