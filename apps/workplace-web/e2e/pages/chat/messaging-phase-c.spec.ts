// messaging Phase C E2E — 입력기에 실제로 글자를 쳐서 전송 버튼이 켜지는지(@input)만 남긴다.
// 빈 상태(채널·1:1·셀프 DM)·AGENT 배지(헤더·사이드바)·첫 화면 CTA 는 vitest 로 옮겼다(WP-984):
// src/pages/chat/channelPage.test.tsx · dmPage.test.tsx · channelSidebar.test.tsx.
// 백엔드 없이 page.route() 로 API 모킹.
import type { Page } from '@playwright/test'

import { createPageResponse } from '../../fixtures/api-mock'
import {
  createChannel,
  createChannelMember,
  createDm,
  createMessage,
} from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'

// auth.fixture createUser() 기본 id=1, name='테스트 사용자'.
const MY_ID = 1
const MY_NAME = '테스트 사용자'

// ── stub helpers ────────────────────────────────────────────────────────────────

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

async function stubDmsList(page: Page, dms: ReturnType<typeof createDm>[] = []) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dms),
      })
    },
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
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(channel),
          })
        : route.fallback(),
  )
}

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

async function stubMessages(
  page: Page,
  channelId: number,
  items: ReturnType<typeof createMessage>[] = [],
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
    (url) => url.pathname === '/api/v1/members',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createPageResponse([], { size: 100 })),
          })
        : route.fallback(),
  )
}

// ── 전송 버튼 빈 입력 비활성 ──────────────────────────────────────────────

test.describe('전송 버튼 비활성/활성 전환', () => {
  const CHANNEL_ID = 810

  test.beforeEach(async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: '컴포저테스트', memberCount: 1 })
    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: MY_ID, name: MY_NAME })])
    await stubMessages(page, CHANNEL_ID, [])
    await stubMarkRead(page, CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId('message-list')).toBeVisible()
  })

  test(
    '빈 입력 시 전송 버튼이 비활성, 텍스트 입력 시 활성화된다',
    { tag: ['@input', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      const submitBtn = page.getByTestId('message-composer-submit')
      // 초기 빈 상태 → 비활성
      await expect(submitBtn).toBeDisabled()

      // 텍스트 입력 후 → 활성
      await page.getByTestId('message-composer-input').click()
      await page.keyboard.type('안녕')
      await expect(submitBtn).toBeEnabled()
    },
  )
})
