// 메인 AI 채팅 첨부 (WP-234) — 모바일 AI 시트(390px).
// ＋ 바텀시트가 AI 시트(z-[60]) 위에 실제로 뜨는지(가림 없음)·드라이브 항목이 없는지,
// 사진 보관함 → 업로드 칩 → 첨부만 전송 → 말풍선 썸네일까지, 가로 넘침이 없는지 검증한다.
import { Buffer } from 'buffer'

import type { Locator, Page } from '@playwright/test'

import { type HomeChatStartBody, mockHomeChatGeneration } from '../../fixtures/home-chat-mock'
import { json } from '../../fixtures/mobile-chat'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
import type { HomeUploadedFile } from '../../../src/types/home'

/**
 * 대상이 실제로 맨 위에 있는지 — toBeVisible 은 가림을 보지 않는다(ai-sheet.spec 과 같은 판정, 스펙 간 import 금지라 둔다).
 * Radix 모달은 body 에 pointer-events:none 을 걸므로 판정하는 순간만 되돌려 elementFromPoint 를 읽는다.
 */
async function expectOnTop(page: Page, target: Locator, containerSelector: string) {
  const b = (await target.boundingBox())!
  const onTop = await page.evaluate(
    ([x, y, sel]) => {
      const prev = document.body.style.pointerEvents
      document.body.style.pointerEvents = 'auto'
      try {
        return document.elementFromPoint(x, y)?.closest(sel) != null
      } finally {
        document.body.style.pointerEvents = prev
      }
    },
    [b.x + b.width / 2, b.y + b.height / 2, containerSelector] as const,
  )
  expect(onTop).toBe(true)
}

test('AI 시트: ＋ 바텀시트가 시트 위에 뜨고(드라이브 없음) 사진 → 칩 → 첨부만 전송 → 썸네일', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const uploads = trackRequests(page, 'POST', '/api/v1/home/attachments')
  await page.route((u) => u.pathname === '/api/v1/home/attachments', (r) =>
    r.fulfill(json([{ fileId: 9300, originalName: 'IMG_0412.jpg', mimeType: 'image/jpeg', sizeBytes: 3 }] satisfies HomeUploadedFile[])))
  const starts = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-m' } }] })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()

  // 사진·카메라 input 은 이미지 전용·후면 촬영.
  await expect(page.getByTestId('ai-composer-photo-input')).toHaveAttribute('accept', 'image/*')
  await expect(page.getByTestId('ai-composer-camera-input')).toHaveAttribute('capture', 'environment')

  await page.getByTestId('ai-composer-attach-button').tap()
  const sheet = page.getByTestId('ai-composer-attach-sheet')
  await expect(sheet.getByRole('button')).toHaveText(['카메라로 찍기', '사진 보관함', '파일'])
  await expectOnTop(page, page.getByTestId('mobile-action-photo'), '[data-testid="ai-composer-attach-sheet"]')

  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('mobile-action-photo').tap()
  await (await chooser).setFiles({ name: 'IMG_0412.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') })
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('ai-composer-attachments')).toContainText('IMG_0412.jpg')
  expect(uploads.count()).toBe(1)
  await expectNoHorizontalOverflow(page)

  const send = page.getByTestId('chat-panel').getByTestId('chat-send')
  await expect(send).toHaveAccessibleName('보내기')
  await send.tap()
  await expect.poll(() => starts.lastBody<HomeChatStartBody>()).toMatchObject({ query: '', fileIds: [9300] })
  await expect(page.getByTestId('chat-turn').first().getByTestId('attachment-image-9300')).toHaveAttribute('src', /^blob:/)
  await expectNoHorizontalOverflow(page)
})

test('AI 시트: 새 대화로 옮기면 첨부 초안이 빈다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.route((u) => u.pathname === '/api/v1/home/attachments', (r) =>
    r.fulfill(json([{ fileId: 9301, originalName: 'memo.txt', mimeType: 'text/plain', sizeBytes: 3 }] satisfies HomeUploadedFile[])))
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await page.getByTestId('ai-composer-attach-button').tap()
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('mobile-action-file').tap()
  await (await chooser).setFiles({ name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('memo') })
  await expect(page.getByTestId('ai-composer-attachments')).toContainText('memo.txt')
  await page.getByTestId('ai-sheet-new-session').tap()
  await expect(page.getByTestId('ai-composer-attachments')).toHaveCount(0)
})
