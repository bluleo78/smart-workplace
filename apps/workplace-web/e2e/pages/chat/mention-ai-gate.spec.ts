// aiAvailable 게이트 — @멘션 팝오버에서 AGENT 후보 노출 여부를 aiAvailable 로 제어한다.
// aiAvailable:true 이면 AGENT 옵션이 보이고, false 이면 보이지 않는다(채널 멤버로 있어도 제외).
import type { Page } from '@playwright/test'

import { createUser } from '../../factories/auth.factory'
import { createChannel, createChannelMember } from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'

const CHANNEL_ID = 720
const AGENT_ID = 88

// ── 스텁 헬퍼 ──────────────────────────────────────────────────────────

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
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )
}

async function stubStream(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body: `:\n\n`,
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

// 채널 멤버 = HUMAN 1 + AGENT 1 (AGENT 가 항상 멤버로 존재해야 필터 효과를 검증할 수 있다).
async function stubMembers(page: Page, channelId: number) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/members`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              createChannelMember({ userId: 10, name: 'bluleo78', kind: 'HUMAN' }),
              createChannelMember({ userId: AGENT_ID, name: 'TestAI', kind: 'AGENT' }),
            ]),
          })
        : route.fallback(),
  )
}

async function stubMessagesGet(page: Page, channelId: number) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          })
        : route.fallback(),
  )
}

async function stubMarkRead(page: Page, channelId: number) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/read`,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
        : route.fallback(),
  )
}

async function stubUsers(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }),
          })
        : route.fallback(),
  )
}

/** /api/v1/users/me 를 aiAvailable 값으로 오버라이드한다(LIFO — fixture 스텁 이후 등록해야 우선). */
async function overrideUserMe(page: Page, aiAvailable: boolean) {
  await page.route(
    (url) => url.pathname === '/api/v1/users/me',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...createUser({ aiAvailable }),
              roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }],
            }),
          })
        : route.fallback(),
  )
}

// ── 공통 셋업 ──────────────────────────────────────────────────────────

async function setupPage(page: Page) {
  const channel = createChannel({ id: CHANNEL_ID, name: '테스트채널', memberCount: 2 })
  await stubChannelsList(page, [channel])
  await stubDmsList(page)
  await stubStream(page)
  await stubChannelDetail(page, channel)
  await stubMembers(page, CHANNEL_ID)
  await stubMessagesGet(page, CHANNEL_ID)
  await stubMarkRead(page, CHANNEL_ID)
  await stubUsers(page)
}

// ── 테스트 ──────────────────────────────────────────────────────────────

test.describe('채팅 @멘션 — aiAvailable 게이트', () => {
  test('aiAvailable:true 이면 AGENT 멤버가 멘션 팝오버에 노출된다', async ({
    authenticatedPage: page,
  }) => {
    // authenticatedPage fixture 가 이미 aiAvailable:true 로 세팅 — 기본값 유지.
    await overrideUserMe(page, true)
    await setupPage(page)

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId('message-composer')).toBeVisible()

    const input = page.getByTestId('message-composer-input')
    await input.click()
    await page.keyboard.type('@')

    // AGENT 옵션(data-agent="true")이 팝오버에 보여야 한다.
    await expect(page.getByTestId(`chat-mention-option-${AGENT_ID}`)).toBeVisible()
  })

  test('aiAvailable:false 이면 AGENT 멤버가 멘션 팝오버에서 제외된다', async ({
    authenticatedPage: page,
  }) => {
    // aiAvailable:false 로 오버라이드 — AGENT 는 채널 멤버여도 후보에서 제거되어야 한다.
    await overrideUserMe(page, false)
    await setupPage(page)

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId('message-composer')).toBeVisible()

    const input = page.getByTestId('message-composer-input')
    await input.click()
    await page.keyboard.type('@')

    // AGENT 옵션이 팝오버에 없어야 한다(또는 팝오버 자체가 HUMAN 만 표시).
    await expect(page.getByTestId(`chat-mention-option-${AGENT_ID}`)).not.toBeVisible()
  })
})
