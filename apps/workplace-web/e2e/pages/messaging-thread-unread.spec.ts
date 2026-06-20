// #65 1단계 E2E — 스레드 미읽음 점 표시 · 패널 열기 시 읽음 처리(markThreadRead 호출).
// 백엔드 없이 page.route() 로 API 모킹. messaging-phase5.spec.ts 패턴 재사용.
import type { Page } from '@playwright/test'

import { createChannel, createChannelMember, createMessage } from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

const ME_ID = 1

async function stubChannelsList(page: Page, channels: ReturnType<typeof createChannel>[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channels) })
        : route.fallback(),
  )
}
async function stubDmsList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
}
async function stubStream(page: Page, body = `:\n\n`) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/stream',
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body }),
  )
}
async function stubChannelDetail(page: Page, channel: ReturnType<typeof createChannel>) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )
}
async function stubMembers(page: Page, channelId: number, members: ReturnType<typeof createChannelMember>[]) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
        : route.fallback(),
  )
}
async function stubMessages(page: Page, channelId: number, items: ReturnType<typeof createMessage>[]) {
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
async function stubReplies(page: Page, parentId: number, items: ReturnType<typeof createMessage>[]) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/messages/${parentId}/replies`,
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

test(
  '미읽음 스레드는 답글 링크에 점이 뜨고, 패널을 열면 읽음 처리된다',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const CHANNEL_ID = 700
    const PARENT_ID = 8001
    const channel = createChannel({ id: CHANNEL_ID, name: '스레드채널' })
    // 부모 메시지: 답글 1개, 미읽음 1개, 팔로우 중.
    const parent = createMessage({
      id: PARENT_ID,
      channelId: CHANNEL_ID,
      body: '부모글',
      replyCount: 1,
      unreadReplyCount: 1,
      followed: true,
    })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [parent])
    await stubReplies(page, PARENT_ID, [
      createMessage({ id: 8100, channelId: CHANNEL_ID, parentMessageId: PARENT_ID, body: '새 답글' }),
    ])

    // markThreadRead 호출 캡처.
    let threadReadCalled = false
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${PARENT_ID}/thread/read`,
      (route) => {
        threadReadCalled = true
        return route.fulfill({ status: 204, body: '' })
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    // 미읽음 점이 보인다.
    await expect(page.getByTestId(`message-unread-thread-${PARENT_ID}`)).toBeVisible()

    // 답글 링크 클릭 → 패널 열림 → markThreadRead 호출.
    await page.getByTestId(`message-thread-link-${PARENT_ID}`).click()
    await expect(page.getByTestId('thread-panel')).toBeVisible()
    await expect.poll(() => threadReadCalled).toBe(true)
  },
)

test('팔로우하지 않거나 미읽음이 0이면 점이 없다', async ({ authenticatedPage: page }) => {
  const CHANNEL_ID = 701
  const PARENT_ID = 8201
  const channel = createChannel({ id: CHANNEL_ID, name: '읽음채널' })
  const parent = createMessage({
    id: PARENT_ID,
    channelId: CHANNEL_ID,
    body: '부모글',
    replyCount: 2,
    unreadReplyCount: 0,
    followed: true,
  })

  await stubChannelsList(page, [channel])
  await stubDmsList(page)
  await stubStream(page)
  await stubChannelDetail(page, channel)
  await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
  await stubMessages(page, CHANNEL_ID, [parent])

  await page.goto(`/chat/channels/${CHANNEL_ID}`)

  await expect(page.getByTestId(`message-thread-link-${PARENT_ID}`)).toBeVisible()
  await expect(page.getByTestId(`message-unread-thread-${PARENT_ID}`)).toHaveCount(0)
})
