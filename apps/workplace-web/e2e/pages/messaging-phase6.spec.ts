// messaging Phase 6 E2E — 메시지 파일 첨부(이미지 인라인 썸네일 · 비이미지 파일 카드 · 첨부만 전송).
// 백엔드 없이 page.route() 로 모든 API 모킹(레포 전체 E2E 정책 — playwright.config.ts 참조).
// 첨부 흐름: 파일 input.setInputFiles → 사전 업로드(POST .../attachments) → 전송(POST .../messages, fileIds 동봉)
//            → 응답 attachments 렌더(이미지는 .../content blob fetch 후 <img>, 비이미지는 카드).
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
} from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

// auth.fixture 의 createUser() 기본 id = 1.
const ME_ID = 1

// 실제 1x1 PNG — content 스텁이 이 바이트를 돌려줘야 <img> 가 1x1 로 렌더되어 toBeVisible() 통과.
// (0바이트/깨진 이미지는 0x0 로 잡혀 testid 가 DOM 에 있어도 보이지 않음.)
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BUFFER = Buffer.from(PNG_BASE64, 'base64')

// 채널 목록 GET stub.
async function stubChannelsList(page: Page, channels: ReturnType<typeof createChannel>[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(channels),
          })
        : route.fallback(),
  )
}

// DM 목록 GET stub.
async function stubDmsList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )
}

// SSE 스트림 stub — keep-alive 만 흘린다(첨부 렌더는 POST 응답으로 충분).
async function stubStream(page: Page, body = `:\n\n`) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body,
      }),
  )
}

// 채널 상세(헤더) GET stub.
async function stubChannelDetail(page: Page, channel: ReturnType<typeof createChannel>) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )
}

// 채널 멤버 GET stub.
async function stubMembers(
  page: Page,
  channelId: number,
  members: ReturnType<typeof createChannelMember>[],
) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
        : route.fallback(),
  )
}

// 메시지 히스토리 GET stub.
async function stubMessages(
  page: Page,
  channelId: number,
  items: ReturnType<typeof createMessage>[],
) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )
}

// 첨부 사전 업로드 POST stub — uploadAttachments 응답 메타 배열.
async function stubAttachmentUpload(
  page: Page,
  channelId: number,
  meta: { fileId: number; originalName: string; mimeType: string; sizeBytes: number },
) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/attachments`,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([meta]),
          })
        : route.fallback(),
  )
}

// 첨부 이미지 content GET stub — 실제 1x1 PNG blob 반환.
async function stubAttachmentContent(
  page: Page,
  channelId: number,
  messageId: number,
  fileId: number,
) {
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/messaging/channels/${channelId}/messages/${messageId}/attachments/${fileId}/content`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: PNG_BUFFER,
      }),
  )
}

test.describe('messaging Phase 6 — 메시지 파일 첨부', () => {
  // 1) 이미지 첨부 → pending 칩 → 전송 → 인라인 썸네일(attachment-image-{fileId}) 렌더.
  test(
    '이미지를 첨부해 전송하면 인라인 썸네일이 보인다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 600
      const MSG_ID = 9700
      const FILE_ID = 8800
      const channel = createChannel({ id: CHANNEL_ID, name: '이미지채널' })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [])
      await stubAttachmentUpload(page, CHANNEL_ID, {
        fileId: FILE_ID,
        originalName: 'pixel.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BUFFER.length,
      })
      // 응답 메시지가 받을 양수 messageId 기준으로 content 스텁 경로를 맞춘다.
      await stubAttachmentContent(page, CHANNEL_ID, MSG_ID, FILE_ID)

      // POST 메시지 → fileIds 캡처 + attachments 동봉 응답(양수 messageId).
      let sentFileIds: number[] | undefined
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          sentFileIds = (route.request().postDataJSON() as { fileIds?: number[] }).fileIds
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: MSG_ID,
                channelId: CHANNEL_ID,
                authorId: ME_ID,
                authorName: '나',
                body: '사진이요',
                attachments: [
                  {
                    fileId: FILE_ID,
                    messageId: MSG_ID,
                    originalName: 'pixel.png',
                    mimeType: 'image/png',
                    sizeBytes: PNG_BUFFER.length,
                    attachedById: ME_ID,
                    attachedByName: '나',
                    attachedAt: new Date('2026-06-03T00:00:00Z').toISOString(),
                  },
                ],
              }),
            ),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      // 파일 input 에 PNG 주입 → 사전 업로드 → pending 칩 표시.
      await page.getByTestId('composer-file-input').setInputFiles({
        name: 'pixel.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER,
      })
      await expect(page.getByTestId('composer-attachments')).toBeVisible()
      await expect(page.getByTestId('composer-attachments')).toContainText('pixel.png')

      // 본문 입력 후 전송 버튼.
      const composer = page.getByTestId('message-composer-input')
      await composer.click()
      await composer.fill('사진이요')
      await page.getByTestId('message-composer-submit').click()

      // 전송 payload 에 fileIds 가 실렸는지(스테일 클로저 방어용 부가 검증).
      await expect.poll(() => sentFileIds).toEqual([FILE_ID])
      // content blob fetch 후 <img> 가 1x1 로 렌더되어 보인다.
      await expect(page.getByTestId(`attachment-image-${FILE_ID}`)).toBeVisible()
    },
  )

  // 2) 본문 없이 비이미지(PDF) 첨부만 전송 → 파일 카드(attachment-card-{fileId}) 렌더.
  test(
    '본문 없이 파일만 첨부해도 전송되고 파일 카드가 보인다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 601
      const MSG_ID = 9710
      const FILE_ID = 8810
      const channel = createChannel({ id: CHANNEL_ID, name: '파일채널' })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [])
      await stubAttachmentUpload(page, CHANNEL_ID, {
        fileId: FILE_ID,
        originalName: 'spec.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
      })

      // POST 메시지 → 본문 빈 문자열 + fileIds 캡처, 카드 렌더용 attachments 응답.
      let sentBody: string | undefined
      let sentFileIds: number[] | undefined
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          const payload = route.request().postDataJSON() as { body: string; fileIds?: number[] }
          sentBody = payload.body
          sentFileIds = payload.fileIds
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: MSG_ID,
                channelId: CHANNEL_ID,
                authorId: ME_ID,
                authorName: '나',
                body: '',
                attachments: [
                  {
                    fileId: FILE_ID,
                    messageId: MSG_ID,
                    originalName: 'spec.pdf',
                    mimeType: 'application/pdf',
                    sizeBytes: 2048,
                    attachedById: ME_ID,
                    attachedByName: '나',
                    attachedAt: new Date('2026-06-03T00:00:00Z').toISOString(),
                  },
                ],
              }),
            ),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      // PDF 주입 → pending 칩 → 본문 입력 없이 보내기.
      await page.getByTestId('composer-file-input').setInputFiles({
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 hello'),
      })
      await expect(page.getByTestId('composer-attachments')).toContainText('spec.pdf')
      await page.getByTestId('message-composer-submit').click()

      // 본문이 비어도 첨부만으로 전송됐고, 비이미지는 카드로 렌더된다.
      await expect.poll(() => sentBody).toBe('')
      await expect.poll(() => sentFileIds).toEqual([FILE_ID])
      const card = page.getByTestId(`attachment-card-${FILE_ID}`)
      await expect(card).toBeVisible()
      await expect(card).toContainText('spec.pdf')
    },
  )

  // 3) 회귀: 본문 입력 + 이미지 첨부 후 Enter 전송 시 fileIds 가 누락되지 않는다(스테일 클로저 #63 5ba65a6).
  test(
    'Enter 전송 시 본문과 첨부가 함께 실린다(스테일 클로저 회귀)',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 602
      const MSG_ID = 9720
      const FILE_ID = 8820
      const channel = createChannel({ id: CHANNEL_ID, name: 'Enter채널' })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [])
      await stubAttachmentUpload(page, CHANNEL_ID, {
        fileId: FILE_ID,
        originalName: 'pixel.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BUFFER.length,
      })
      await stubAttachmentContent(page, CHANNEL_ID, MSG_ID, FILE_ID)

      let sentBody: string | undefined
      let sentFileIds: number[] | undefined
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          const payload = route.request().postDataJSON() as { body: string; fileIds?: number[] }
          sentBody = payload.body
          sentFileIds = payload.fileIds
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: MSG_ID,
                channelId: CHANNEL_ID,
                authorId: ME_ID,
                authorName: '나',
                body: '엔터전송',
                attachments: [
                  {
                    fileId: FILE_ID,
                    messageId: MSG_ID,
                    originalName: 'pixel.png',
                    mimeType: 'image/png',
                    sizeBytes: PNG_BUFFER.length,
                    attachedById: ME_ID,
                    attachedByName: '나',
                    attachedAt: new Date('2026-06-03T00:00:00Z').toISOString(),
                  },
                ],
              }),
            ),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      // 이미지 첨부 → pending 칩.
      await page.getByTestId('composer-file-input').setInputFiles({
        name: 'pixel.png',
        mimeType: 'image/png',
        buffer: PNG_BUFFER,
      })
      await expect(page.getByTestId('composer-attachments')).toContainText('pixel.png')

      // 본문 입력 후 Enter 전송(컴포저 contenteditable 에서 키 입력).
      const composer = page.getByTestId('message-composer-input')
      await composer.click()
      await composer.fill('엔터전송')
      await composer.press('Enter')

      // 스테일 클로저면 fileIds 가 비어 전송됨 → 이 단언이 회귀를 잡는다.
      await expect.poll(() => sentBody).toBe('엔터전송')
      await expect.poll(() => sentFileIds).toEqual([FILE_ID])
      // 본문 텍스트 + 인라인 썸네일이 함께 렌더된다.
      await expect(page.getByTestId(`message-${MSG_ID}`)).toContainText('엔터전송')
      await expect(page.getByTestId(`attachment-image-${FILE_ID}`)).toBeVisible()
    },
  )
})
