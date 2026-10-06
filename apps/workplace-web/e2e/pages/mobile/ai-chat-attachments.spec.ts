// 메인 AI 채팅 첨부 (WP-234) — 모바일 AI 시트(390px).
// ＋ 바텀시트가 AI 시트(z-[60]) 위에 실제로 뜨는지(가림 없음)·드라이브 항목이 없는지,
// 사진 보관함 → 업로드 칩 → 첨부만 전송 → 말풍선 썸네일까지, 가로 넘침이 없는지 검증한다.
import { Buffer } from 'buffer'

import type { Page } from '@playwright/test'

import { createHomeAttachment } from '../../factories/homeAttachment.factory'
import { mockApi } from '../../fixtures/api-mock'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../../fixtures/home-chat-mock'
import { json } from '../../fixtures/mobile-chat'
import { expect, expectNoHorizontalOverflow, expectOnTop, stubChat, test } from '../../fixtures/mobile.fixture'
import { solidPng } from '../../fixtures/png'
import { trackRequests } from '../../fixtures/requests'
import type { HomeMessage, HomeSessionPage, HomeUploadedFile } from '../../../src/types/home'

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
  // 시안 7-2: 바텀시트의 딤도 AI 시트 위 — 시트 헤더를 덮어 흐린다(콘텐츠만 올라가면 시트가 밝은 채로 남는다).
  await expectOnTop(page, page.getByTestId('ai-sheet-new-session'), '[data-slot="sheet-overlay"]')

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

test('AI 시트: 복원한 대화의 썸네일이 스켈레톤보다 크게 늦게 커져도 맨 아래에 붙어 있다', async ({ authenticatedPage: page }) => {
  // 두 썸네일이 연달아 커지면(128px 스켈레톤 → 최대 256px) 브라우저 스크롤 앵커링이 보낸 scroll 이벤트를
  // 다음 성장까지 반영된 높이로 읽어 "사용자가 위로 올렸다"로 오판, 하단 고정이 풀리던 회귀(W15).
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/home/sessions', {
    items: [{ id: 's-t', title: '사진 대화', lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  } satisfies HomeSessionPage)
  const messages: HomeMessage[] = [
    {
      id: 1, role: 'USER', content: '현장 사진이에요', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:00Z',
      attachments: [createHomeAttachment({ fileId: 61, originalName: 'a.png', mimeType: 'image/png' })],
    },
    { id: 2, role: 'ASSISTANT', content: '확인했어요', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:01Z' },
    {
      id: 3, role: 'USER', content: '', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:02Z',
      attachments: [createHomeAttachment({ fileId: 62, messageId: 3, originalName: 'b.png', mimeType: 'image/png' })],
    },
    { id: 4, role: 'ASSISTANT', content: '두 번째도 확인했어요', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:03Z' },
  ]
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-t/messages', messages)
  const tall = solidPng(600, 900)
  await page.route((u) => /^\/api\/v1\/home\/sessions\/s-t\/attachments\/(61|62)\/content$/.test(u.pathname), (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: tall }))

  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await page.getByTestId('ai-sheet-session-switcher').click()
  await page.getByTestId('chat-session-select').first().click()
  // 썸네일이 실제로 스켈레톤(128px)보다 커졌는지 — 높이 증가 경로를 탔다는 전제.
  for (const id of [61, 62]) {
    await expect.poll(async () => (await page.getByTestId(`attachment-image-${id}`).boundingBox())?.height ?? 0).toBeGreaterThan(200)
  }
  await expect.poll(() => page.getByTestId('chat-scroll').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2)
})

/**
 * 이미지 하나를 올려 보내고, POST /ai/chat(수락) 응답을 붙잡아 둔 채 시트를 닫는다(입력창 언마운트). 테스트가 outcome 으로 응답을 풀게 한다.
 * 앱이 만들고 해제한 blob URL 을 기록한다(window.__blobs).
 */
async function sendImageThenCloseSheet(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __blobs: { created: string[]; revoked: string[] } }
    w.__blobs = { created: [], revoked: [] }
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const url = create(o)
      w.__blobs.created.push(url)
      return url
    }
    URL.revokeObjectURL = (url: string) => {
      w.__blobs.revoked.push(url)
      revoke(url)
    }
  })
  await stubChat(page)
  await page.route((u) => u.pathname === '/api/v1/home/attachments', (r) =>
    r.fulfill(json([{ fileId: 9310, originalName: 'site.png', mimeType: 'image/png', sizeBytes: 100 }] satisfies HomeUploadedFile[])))
  // POST /ai/chat(수락)을 테스트가 풀 때까지 붙잡아 둔다 — 그동안 전송은 아직 수락 전이다.
  let respond!: (outcome: 'accept' | 'reject') => void
  const outcome = new Promise<'accept' | 'reject'>((r) => (respond = r))
  const starts = trackRequests(page, 'POST', '/api/v1/ai/chat')
  await page.route((u) => u.pathname === '/api/v1/ai/chat', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    if ((await outcome) === 'accept') return r.fulfill(json({ correlationId: 'corr-close' }))
    return r.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ status: 400, error: 'Bad Request', message: '첨부 파일을 사용할 수 없어요. 파일을 다시 올려 주세요.' }),
    })
  })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await page.getByTestId('ai-composer-attach-button').tap()
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('mobile-action-photo').tap()
  await (await chooser).setFiles({ name: 'site.png', mimeType: 'image/png', buffer: solidPng(120, 80) })
  await expect(page.getByTestId('ai-composer-attachments')).toContainText('site.png')

  await page.getByTestId('chat-panel').getByTestId('chat-send').tap()
  await expect.poll(() => starts.count()).toBe(1)
  // 수락 전 — 낙관적 턴이 로컬 미리보기로 그려진다.
  const thumb = page.getByTestId('chat-turn').first().getByTestId('attachment-image-9310')
  const loaded = () => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
  await expect.poll(loaded).toBe(true)
  const previewUrl = (await thumb.getAttribute('src')) ?? ''

  // 수락 전에 시트를 닫는다 — 입력창(첨부 초안)이 언마운트된다.
  await page.getByTestId('ai-sheet-backdrop').click({ position: { x: 10, y: 10 } })
  await expect(page.getByTestId('ai-sheet')).toHaveCount(0)
  const revoked = () =>
    page.evaluate((url) => (window as unknown as { __blobs: { revoked: string[] } }).__blobs.revoked.includes(url), previewUrl)
  return { respond, starts, thumb, loaded, previewUrl, revoked }
}

test('AI 시트: 이미지를 보내고 서버가 받기 전에 시트를 닫았다 열어도 보낸 턴의 썸네일이 깨지지 않는다', async ({ authenticatedPage: page }) => {
  // 회귀: 시트를 닫아 입력창(첨부 초안)이 언마운트되면, 방금 전송 스냅숏으로 턴에 넘긴(아직 수락 전) 미리보기 blob URL 까지 해제해
  // 다시 연 시트의 낙관적 턴 썸네일이 깨졌다. 전송에 넘긴 미리보기는 턴 소유라 초안이 해제하지 않아야 한다.
  const { respond, thumb, loaded, previewUrl, revoked } = await sendImageThenCloseSheet(page)
  expect(await revoked()).toBe(false)
  respond('accept')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect(thumb).toHaveAttribute('src', previewUrl)
  await expect.poll(loaded).toBe(true)
  expect(await revoked()).toBe(false)
})

test('AI 시트: 시트를 닫은 사이 전송이 거절되면 턴에서 첨부가 빠지고 넘겼던 미리보기 URL 도 해제된다', async ({ authenticatedPage: page }) => {
  // 초안이 언마운트돼 미리보기를 돌려받을 곳이 없으므로, 거절이 정해질 때 해제해야 새로고침 전까지 blob 이 남지 않는다.
  const { respond, revoked } = await sendImageThenCloseSheet(page)
  respond('reject')
  await expect.poll(revoked).toBe(true)
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect(page.getByTestId('chat-turn').first().getByTestId('message-attachments')).toHaveCount(0)
})
