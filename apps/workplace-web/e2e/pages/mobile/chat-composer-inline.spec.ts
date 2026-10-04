// 채팅 입력창 ＋ 한 줄 레이아웃 (WP-235) — 모바일(390px).
// 팀 채팅·이슈 채팅 입력창이 [＋] [입력] [↑] 한 행(44px)인지, ＋ 가 바텀시트(카메라·사진·파일·드라이브)를 열고
// 사진 보관함 선택이 사전 업로드 → 칩으로 이어지는지, 카메라·사진 input 이 맞는 accept/capture 를 갖는지 검증한다.
import { Buffer } from 'buffer'

import type { Locator } from '@playwright/test'

import { expectNoHorizontalOverflow, expect, test } from '../../fixtures/mobile.fixture'
import { json, KEY, stubChannelMessages, stubIssue } from '../../fixtures/mobile-chat'
import { trackRequests } from '../../fixtures/requests'

/** 세 요소가 한 행(세로 중심 2px 오차)이고 모두 44px 높이인지. */
async function expectOneRow(plus: Locator, input: Locator, send: Locator) {
  const [p, i, s] = await Promise.all([plus.boundingBox(), input.boundingBox(), send.boundingBox()])
  const mid = (b: typeof p) => b!.y + b!.height / 2
  expect(Math.abs(mid(p) - mid(i))).toBeLessThanOrEqual(2)
  expect(Math.abs(mid(s) - mid(i))).toBeLessThanOrEqual(2)
  for (const b of [p, i, s]) expect(Math.round(b!.height)).toBe(44)
}

test('팀 채팅: 한 줄 입력창 + ＋ 바텀시트 → 사진 보관함 → 업로드 칩', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  const uploads = trackRequests(page, 'ANY', '/api/v1/messaging/channels/1/attachments')
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/attachments', (r) =>
    r.fulfill(json([{ fileId: 9100, originalName: 'IMG_0412.jpg', mimeType: 'image/jpeg', sizeBytes: 3 }])),
  )
  await page.goto('/chat/channels/1')
  const plus = page.getByTestId('composer-attach-button')
  const send = page.getByTestId('message-composer-submit')
  await expectOneRow(plus, page.getByTestId('message-composer-input'), send)
  // 모바일 보내기는 아이콘 — 접근 이름은 '보내기'.
  await expect(send).toHaveAccessibleName('보내기')
  await expectNoHorizontalOverflow(page)

  // 카메라는 후면 촬영, 사진은 이미지 전용.
  await expect(page.getByTestId('composer-camera-input')).toHaveAttribute('capture', 'environment')
  await expect(page.getByTestId('composer-camera-input')).toHaveAttribute('accept', 'image/*')
  await expect(page.getByTestId('composer-photo-input')).toHaveAttribute('accept', 'image/*')

  await plus.tap()
  const sheet = page.getByTestId('composer-attach-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button')).toHaveText(['카메라로 찍기', '사진 보관함', '파일', '드라이브에서 링크'])
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('mobile-action-photo').tap()
  await (await chooser).setFiles({ name: 'IMG_0412.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpg') })
  await expect(sheet).toBeHidden()
  await expect(page.getByTestId('composer-attachments')).toContainText('IMG_0412.jpg')
  expect(uploads.count()).toBe(1)
})

test('이슈 채팅: 한 줄 입력창 + ＋ 바텀시트', async ({ authenticatedPage: page }) => {
  await stubIssue(page)
  await page.goto(`/projects/${KEY}/issues/1?chat=1`)
  const plus = page.getByTestId('chat-composer-attach-button')
  await expectOneRow(plus, page.getByTestId('chat-composer-input'), page.getByTestId('chat-composer-submit'))
  await plus.tap()
  await expect(page.getByTestId('chat-composer-attach-sheet')).toBeVisible()
  await expect(page.getByTestId('mobile-action-camera')).toBeVisible()
})
