// 채팅 입력창 전송 후 포커스 유지(WP-224) — 전송 탭이 입력창을 blur 하면 iOS 키보드가 내려가고,
// 전송 뒤 비동기 focus 로는 다시 올라오지 않는다(사용자 제스처 밖). 팀 채팅·이슈 채팅·AI 채팅 세 컴포저 모두
// 전송 중 focusout 0회 + 전송 뒤에도 입력창이 activeElement 인지 단언한다(실기기 키보드는 수동 확인).
import type { Locator, Page } from '@playwright/test'

import { createChatMessage } from '../../factories/chat.factory'
import { createMessage } from '../../factories/messaging.factory'
import { mockHomeChatGeneration } from '../../fixtures/home-chat-mock'
import { json, KEY, stubChannelMessages, stubIssue } from '../../fixtures/mobile-chat'
import { trackRequests } from '../../fixtures/requests'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

type BlurWindow = Window & { __blurs: number }

/** 입력창의 focusout 횟수를 세기 시작한다(캡처 단계 — 내부 contenteditable 의 blur 도 센다). */
async function countBlurs(input: Locator) {
  await input.evaluate((el) => {
    (window as unknown as BlurWindow).__blurs = 0
    el.addEventListener('focusout', () => { (window as unknown as BlurWindow).__blurs++ }, true)
  })
}

/** 입력창이 여전히 포커스를 쥐고 있고, 전송 동안 한 번도 blur 되지 않았는지. */
async function expectFocusKept(page: Page, input: Locator) {
  await expect.poll(() => input.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))).toBe(true)
  expect(await page.evaluate(() => (window as unknown as BlurWindow).__blurs)).toBe(0)
}

test('팀 채팅: 보내기 탭 뒤에도 입력창 포커스 유지', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  const sends = trackRequests(page, 'POST', '/api/v1/messaging/channels/1/messages')
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    const body = (r.request().postDataJSON() as { body: string }).body
    return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(createMessage({ id: 90, channelId: 1, authorId: 1, body })) })
  })
  await page.goto('/chat/channels/1')
  const input = page.getByTestId('message-composer-input')
  await input.tap()
  await page.keyboard.type('안녕하세요')
  await countBlurs(input)
  await page.getByTestId('message-composer-submit').tap()
  await expect.poll(() => sends.bodies<{ body: string }>().map((b) => b.body)).toEqual(['안녕하세요'])
  // 성공 뒤 비동기 clear 까지 끝난 상태에서 판정한다.
  await expect(input).toHaveText('')
  await expectFocusKept(page, input)
})

test('이슈 채팅: 보내기 탭 뒤에도 입력창 포커스 유지', async ({ authenticatedPage: page }) => {
  await stubIssue(page)
  const posts = trackRequests(page, 'POST', '/api/v1/chat/threads/100/messages')
  await page.route('**/api/v1/chat/threads/100/messages', (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    const body = (r.request().postDataJSON() as { body: string }).body
    return r.fulfill(json(createChatMessage({ id: 600, threadId: 100, body })))
  })
  await page.goto(`/projects/${KEY}/issues/1?chat=1`)
  const input = page.getByTestId('chat-composer-input')
  await input.tap()
  await page.keyboard.type('확인 부탁드려요')
  await countBlurs(input)
  await page.getByTestId('chat-composer-submit').tap()
  await expect.poll(() => posts.bodies<{ body: string }>().map((b) => b.body)).toEqual(['확인 부탁드려요'])
  await expect(input).toHaveText('')
  await expectFocusKept(page, input)
})

test('AI 채팅: 보내기 탭 뒤에도 입력창 포커스 유지', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockHomeChatGeneration(page, { frames: [{ event: 'delta', data: { text: '네' } }, { event: 'done', data: { sessionId: 's-1' } }] })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').tap()
  const input = page.getByTestId('chat-input')
  await input.tap()
  await page.keyboard.type('요약해줘')
  await countBlurs(input)
  await page.getByTestId('chat-panel').getByRole('button', { name: '보내기' }).tap()
  await expect(page.getByTestId('chat-panel')).toContainText('네')
  await expect(input).toHaveValue('')
  await expectFocusKept(page, input)
})
