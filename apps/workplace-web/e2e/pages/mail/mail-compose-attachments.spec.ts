// 메일 작성창 파일 첨부(WP-574) E2E — 실제 브라우저가 필요한 것만 남긴다: 파일 선택 창 → multipart 업로드 → 발송(@input·@smoke),
// 끌어다 놓기(창 전체 안내·최소화 창·같은 틱 두 번 놓기, @input), 작은 창 고정 줄 기하(sticky·「+N개」 한 줄 접기, @layout).
// 칩 상태·보내기 잠금·합계·한도·다시 시도·전달 첨부·업로드 취소·✕ 임시저장·발송 400·보낸 메일 첨부 목록은
// src/pages/mail/mailComposeAttachments.test.tsx(화면 테스트)가 지킨다(WP-984). 백엔드 없이 page.route 모킹.
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

  test('📎 로 고른 파일을 multipart 로 올리고, 올리는 동안 보내기가 잠겼다가 완료 칩이 되면 attachmentIds 로 발송한다', { tag: ['@input', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

  test('본문 에디터 위로 파일을 끌어 오면 창 전체에 안내가 뜨고, 놓으면 에디터에 들어가지 않고 첨부로 올라간다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('최소화한 창에 파일을 놓으면 작은 창으로 펼쳐 칩을 보여 준다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('리렌더 전에 파일을 연달아 두 번 놓아도 합계 상한을 넘겨 붙이지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await holdUploads(page)
    const uploadReqs = trackRequests(page, 'POST', UPLOAD_PATH)
    await openNew(page)
    // 같은 스크립트 안에서 dragenter→drop 을 두 번 — 사이에 React 가 다시 그리지 못한다. 20MB + 20MB 는 25MB 를 넘는다.
    // 크기만 큰 파일 — 앱은 한도·합계를 file.size 로만 판정하므로 내용은 몇 바이트로 두고 size 만 덮어쓴다.
    await page.getByTestId('mail-compose-dock').evaluate((dock, size) => {
      for (const name of ['영상A.mp4', '영상B.mp4']) {
        const file = new File([name], name, { type: 'video/mp4' })
        Object.defineProperty(file, 'size', { value: size })
        const dt = new DataTransfer()
        dt.items.add(file)
        dock.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }))
        dock.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      }
    }, 20 * MB)

    // 작은 창 고정 줄은 실패 칩을 앞에 둔다 — 순서와 무관하게 하나는 올라가고 하나는 한도 초과다.
    await expect.poll(async () => (await chipStatuses(page)).sort()).toEqual(['error', 'uploading'])
    await expect(page.locator('[data-testid^="mail-compose-attachment-"][data-status="error"]')).toContainText('25MB를 넘어요')
    await expect.poll(() => uploadReqs.count()).toBe(1)
  })

  test('작은 창에서 긴 전달 인용으로 본문이 스크롤돼도 첨부 칩과 보내기 줄은 창 아래에 고정돼 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

  test('작은 창 고정 줄은 칩을 한 줄만 보이고, 「+N개」로 펼치고 「접기」로 다시 접는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

})
