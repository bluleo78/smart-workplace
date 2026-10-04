// 채팅 입력창 ＋ 한 줄 레이아웃·붙여넣기·드롭 (WP-235) — 데스크톱.
// [＋] [입력] [보내기] 가 한 행에 있고, 여러 줄이면 입력칸만 위로 늘며 ＋·보내기는 하단 정렬인지,
// ＋ 팝오버(파일·드라이브)·이미지 붙여넣기·파일 드롭이 사전 업로드 → 칩 → 전송 payload 까지 이어지는지 검증한다.
import { Buffer } from 'buffer'

import type { Locator, Page } from '@playwright/test'

import { createMessage } from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { json, stubChannelMessages } from '../../fixtures/mobile-chat'
import { trackRequests } from '../../fixtures/requests'

const UPLOAD = '/api/v1/messaging/channels/1/attachments'

/** 업로드 스텁 — 요청마다 올라온 파일명을 기록하고 fileId 를 9000번대부터 돌려준다. */
async function stubUpload(page: Page) {
  const uploaded: string[] = []
  await page.route((u) => u.pathname === UPLOAD, async (r) => {
    // multipart 본문에서 filename="..." 만 뽑는다(파서 없이 이름 단언용).
    const names = [...(r.request().postData() ?? '').matchAll(/filename="([^"]+)"/g)].map((m) => m[1])
    uploaded.push(...names)
    await r.fulfill(json(names.map((n, i) => ({ fileId: 9000 + uploaded.length - names.length + i, originalName: n, mimeType: 'image/png', sizeBytes: 3 }))))
  })
  return uploaded
}

/** 전송 스텁 — 201 확정 응답하고, 보낸 POST 를 기록하는 tracker 를 돌려준다. */
async function stubSend(page: Page) {
  const sends = trackRequests(page, 'POST', '/api/v1/messaging/channels/1/messages')
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    const p = r.request().postDataJSON() as { body: string; fileIds: number[] }
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createMessage({ id: 90, channelId: 1, authorId: 1, body: p.body })) })
  })
  return sends
}

/** 요소의 세로 중심·하단(px). */
async function box(l: Locator) {
  const b = (await l.boundingBox())!
  return { mid: b.y + b.height / 2, bottom: b.y + b.height, height: b.height }
}

/** 에디터에 합성 paste 이벤트를 보낸다 — 파일과 (선택) text/plain 을 담은 DataTransfer. */
async function paste(input: Locator, file: { name: string; type: string }, text?: string) {
  await input.evaluate((el, { file, text }) => {
    const dt = new DataTransfer()
    if (text) dt.setData('text/plain', text)
    dt.items.add(new File(['png'], file.name, { type: file.type }))
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, { file, text })
}

test.describe('채팅 입력창 한 줄 레이아웃 (WP-235)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChannelMessages(page)
    await page.goto('/chat/channels/1')
    await expect(page.getByTestId('message-composer')).toBeVisible()
  })

  test('＋·입력칸·보내기가 한 행이고, 여러 줄이면 입력칸만 늘고 버튼은 하단 정렬', async ({ authenticatedPage: page }) => {
    const plus = page.getByTestId('composer-attach-button')
    const input = page.getByTestId('message-composer-input')
    const send = page.getByTestId('message-composer-submit')
    // 데스크톱 보내기는 텍스트 버튼.
    await expect(send).toHaveText('보내기')

    // 1줄: 세 요소의 세로 중심이 같다(2px 오차).
    const [p1, i1, s1] = await Promise.all([box(plus), box(input), box(send)])
    expect(Math.abs(p1.mid - i1.mid)).toBeLessThanOrEqual(2)
    expect(Math.abs(s1.mid - i1.mid)).toBeLessThanOrEqual(2)

    // 3줄: 입력칸만 높아지고 ＋·보내기 하단이 입력칸 하단에 맞는다.
    await input.click()
    await page.keyboard.type('내일 회의 전에 로드맵 지연 항목 정리 부탁드립니다.')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('모바일 앱 출시 일정이 바뀐 이유와')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('영향받는 고객사 목록도 함께요.')
    const [p3, i3, s3] = await Promise.all([box(plus), box(input), box(send)])
    expect(i3.height).toBeGreaterThan(i1.height * 2)
    expect(Math.abs(p3.bottom - i3.bottom)).toBeLessThanOrEqual(2)
    expect(Math.abs(s3.bottom - i3.bottom)).toBeLessThanOrEqual(2)
    // 버튼 자체 높이는 그대로.
    expect(Math.abs(s3.height - s1.height)).toBeLessThanOrEqual(1)
  })

  test('＋ 팝오버에서 파일 첨부 → 사전 업로드 → 칩 → 전송 payload 에 fileIds', async ({ authenticatedPage: page }) => {
    const uploaded = await stubUpload(page)
    const sends = await stubSend(page)
    await page.getByTestId('composer-attach-button').click()
    await expect(page.getByTestId('composer-attach-menu')).toBeVisible()
    await expect(page.getByTestId('composer-drive-link-btn')).toBeVisible()
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('composer-attach-file').click()
    await (await chooser).setFiles({ name: '로드맵.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') })
    await expect(page.getByTestId('composer-attachments')).toContainText('로드맵.pdf')
    expect(uploaded).toEqual(['로드맵.pdf'])

    await page.getByTestId('message-composer-input').click()
    await page.keyboard.type('첨부 확인 부탁드려요')
    await page.getByTestId('message-composer-submit').click()
    await expect
      .poll(() => sends.bodies<{ body: string; fileIds: number[] }>().map(({ body, fileIds }) => ({ body, fileIds })))
      .toEqual([{ body: '첨부 확인 부탁드려요', fileIds: [9000] }])
  })

  test('스크린샷 붙여넣기 → 본문 대신 첨부 칩', async ({ authenticatedPage: page }) => {
    const uploaded = await stubUpload(page)
    const input = page.getByTestId('message-composer-input')
    await input.click()
    await paste(input, { name: 'image.png', type: 'image/png' })
    await expect(page.getByTestId('composer-attachments')).toContainText('image.png')
    expect(uploaded).toEqual(['image.png'])
    await expect(input).toHaveText('')
  })

  test('텍스트와 렌더링 이미지가 함께 오는 붙여넣기(워드·엑셀)는 텍스트로 들어가고 업로드하지 않는다', async ({ authenticatedPage: page }) => {
    const uploaded = await stubUpload(page)
    const input = page.getByTestId('message-composer-input')
    await input.click()
    await paste(input, { name: 'render.png', type: 'image/png' }, '표에서 복사한 글')
    await expect(input).toHaveText('표에서 복사한 글')
    await expect(page.getByTestId('composer-attachments')).toHaveCount(0)
    expect(uploaded).toEqual([])
  })

  test('업로드가 겹치면 먼저 끝난 쪽이 아니라 모두 끝나야 전송이 열린다', async ({ authenticatedPage: page }) => {
    // 첫 업로드(드롭한 큰 파일)는 테스트가 풀어 줄 때까지 붙잡고, 두 번째(붙여넣은 스크린샷)는 바로 응답한다.
    let releaseFirst!: () => void
    let calls = 0
    const uploads = trackRequests(page, 'ANY', UPLOAD)
    await page.route((u) => u.pathname === UPLOAD, async (r) => {
      // 순번은 지역으로 잡는다 — 첫 요청이 풀려날 땐 calls 가 이미 2다.
      const nth = ++calls
      if (nth === 1) await new Promise<void>((res) => { releaseFirst = res })
      const name = nth === 1 ? 'big.mov' : 'image.png'
      await r.fulfill(json([{ fileId: 9500 + nth, originalName: name, mimeType: 'application/octet-stream', sizeBytes: 3 }]))
    })
    const input = page.getByTestId('message-composer-input')
    const send = page.getByTestId('message-composer-submit')
    await input.click()
    await page.keyboard.type('같이 보내요')
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File(['mov'], 'big.mov', { type: 'video/quicktime' }))
      return d
    })
    await page.getByTestId('message-composer').dispatchEvent('drop', { dataTransfer: dt })
    await expect.poll(uploads.count).toBe(1)
    await paste(input, { name: 'image.png', type: 'image/png' })
    // 두 번째 업로드가 끝나 칩이 보여도 첫 업로드가 남아 있으니 전송은 막혀 있다.
    await expect(page.getByTestId('composer-attachments')).toContainText('image.png')
    await expect(send).toBeDisabled()
    await expect(send).toHaveText('업로드 중…')
    releaseFirst()
    await expect(page.getByTestId('composer-attachments')).toContainText('big.mov')
    await expect(send).toBeEnabled()
  })

  test('파일을 끌어오면 드롭 오버레이, 놓으면 업로드 → 칩', async ({ authenticatedPage: page }) => {
    const uploaded = await stubUpload(page)
    const composer = page.getByTestId('message-composer')
    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer()
      d.items.add(new File(['png'], '화면캡처.png', { type: 'image/png' }))
      return d
    })
    await composer.dispatchEvent('dragenter', { dataTransfer: dt })
    await expect(page.getByTestId('composer-drop-overlay')).toBeVisible()
    // 에디터 위에 놓아도 래퍼가 받는다(RichInput 이 ProseMirror 기본 드롭을 막고 버블링).
    await page.getByTestId('message-composer-input').dispatchEvent('drop', { dataTransfer: dt })
    await expect(page.getByTestId('composer-drop-overlay')).toHaveCount(0)
    await expect(page.getByTestId('composer-attachments')).toContainText('화면캡처.png')
    expect(uploaded).toEqual(['화면캡처.png'])
    await expect(page.getByTestId('message-composer-input')).toHaveText('')
  })
})
