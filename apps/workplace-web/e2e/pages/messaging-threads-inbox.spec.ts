// #65 2단계 E2E — 사이드바 스레드 뱃지 · 인박스 카드 목록 · 카드 클릭 → 채널+스레드 패널.
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
  createThreadInboxItem,
} from '../factories/messaging.factory'
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
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body }),
  )
}
async function stubInboxCount(page: Page, count: number) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/threads/inbox/unread-count',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count }) }),
  )
}
// 동적 인박스 스텁: 가변 ref 로 현재 items 를 반환 → 읽음 처리 후 refetch 가 빈 목록을 받도록.
function stubInboxDynamic(page: Page, ref: { items: ReturnType<typeof createThreadInboxItem>[] }) {
  return page.route(
    (url) => url.pathname === '/api/v1/messaging/threads/inbox',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: ref.items, nextCursor: null, hasMore: false }),
      }),
  )
}
async function stubInbox(page: Page, items: ReturnType<typeof createThreadInboxItem>[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/threads/inbox',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
      }),
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
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, nextCursor: null, hasMore: false }) })
        : route.fallback(),
  )
}
async function stubReplies(page: Page, parentId: number, items: ReturnType<typeof createMessage>[]) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/messages/${parentId}/replies`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items, nextCursor: null, hasMore: false }) })
        : route.fallback(),
  )
}

test(
  '사이드바 스레드 뱃지 + 인박스 카드 → 채널 스레드 패널 오픈',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const CHANNEL_ID = 900
    const ROOT_ID = 9500
    const channel = createChannel({ id: CHANNEL_ID, name: '스레드채널' })
    const inboxItem = createThreadInboxItem({
      channelName: '스레드채널',
      rootMessage: { id: ROOT_ID, channelId: CHANNEL_ID, body: '부모글', unreadReplyCount: 2, followed: true },
    })

    const inboxRef = { items: [inboxItem] }
    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    let inboxCount = 1
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/threads/inbox/unread-count',
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: inboxCount }) }),
    )
    await stubInboxDynamic(page, inboxRef)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, []) // 채널 첫 페이지엔 루트 없음 → navigate state 로 패널 오픈
    await stubReplies(page, ROOT_ID, [
      createMessage({ id: 9600, channelId: CHANNEL_ID, parentMessageId: ROOT_ID, body: '새 답글' }),
    ])
    let threadReadCalled = false
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${ROOT_ID}/thread/read`,
      (route) => {
        threadReadCalled = true
        // 읽음 후 인박스는 비고 카운트 0 → 이후 refetch 가 빈 목록/0 을 받는다.
        inboxRef.items = []
        inboxCount = 0
        return route.fulfill({ status: 204, body: '' })
      },
    )

    // 채널 진입 → 사이드바 스레드 뱃지 노출.
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId('sidebar-threads-badge')).toHaveText('1')

    // 인박스로 이동 → 카드 노출.
    await page.getByTestId('sidebar-threads-link').click()
    await expect(page.getByTestId('threads-inbox-page')).toBeVisible()
    const card = page.getByTestId(`thread-inbox-card-${ROOT_ID}`)
    await expect(card).toBeVisible()
    await expect(card).toContainText('스레드채널')

    // 카드 클릭 → 채널 + 스레드 패널 오픈(캐시에 루트 없어도 state 로 오픈) → mark-thread-read.
    await card.click()
    await expect(page.getByTestId('thread-panel')).toBeVisible()
    await expect(page.getByTestId('message-9600')).toBeVisible()
    await expect.poll(() => threadReadCalled).toBe(true)

    // 읽음 처리 → invalidation 으로 인박스 카드 제거 + 뱃지 사라짐(핵심 UX).
    await page.getByTestId('sidebar-threads-link').click()
    await expect(page.getByTestId(`thread-inbox-card-${ROOT_ID}`)).toHaveCount(0)
    await expect(page.getByTestId('sidebar-threads-badge')).toHaveCount(0)
  },
)

test('미읽음 스레드가 없으면 빈 상태가 보인다', async ({ authenticatedPage: page }) => {
  const channel = createChannel({ id: 901, name: '빈채널' })
  await stubChannelsList(page, [channel])
  await stubDmsList(page)
  await stubStream(page)
  await stubInboxCount(page, 0)
  await stubInbox(page, [])

  await page.goto('/chat/threads/inbox')
  await expect(page.getByTestId('threads-inbox-page')).toBeVisible()
  await expect(page.getByTestId('sidebar-threads-badge')).toHaveCount(0)
  await expect(page.getByText('새 스레드 답글이 없어요')).toBeVisible()
})
