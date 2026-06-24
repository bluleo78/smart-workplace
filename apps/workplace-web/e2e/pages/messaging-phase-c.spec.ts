// messaging Phase C E2E — 빈 상태(ChatEmptyState), AGENT 배지, 전송 버튼 비활성 검증.
// 백엔드 없이 page.route() 로 API 모킹.
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createDm,
  createDmParticipant,
  createMessage,
} from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

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
    (url) => url.pathname === '/api/v1/messaging/stream',
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
    (url) => url.pathname === '/api/v1/users',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              content: [],
              page: 0,
              size: 100,
              totalElements: 0,
              totalPages: 0,
            }),
          })
        : route.fallback(),
  )
}

// ── 채널 빈 상태 ──────────────────────────────────────────────────────────────

test.describe('채널 빈 상태', () => {
  const CHANNEL_ID = 800
  const CHANNEL_NAME = '테스트채널'

  test.beforeEach(async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: CHANNEL_NAME, memberCount: 1 })
    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: MY_ID, name: MY_NAME })])
    await stubMessages(page, CHANNEL_ID, []) // 빈 메시지
    await stubMarkRead(page, CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId('message-list')).toBeVisible()
  })

  test(
    '메시지 0건 채널에 ChatEmptyState가 노출되고 채널명을 포함한다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const emptyState = page.getByTestId('chat-empty-state')
      await expect(emptyState).toBeVisible()
      await expect(emptyState).toContainText(`이것은 #${CHANNEL_NAME} 채널의 시작입니다.`)
    },
  )
})

// ── 1:1 DM 빈 상태 ──────────────────────────────────────────────────────────

test.describe('1:1 DM 빈 상태', () => {
  const DM_ID = 900
  const OTHER_ID = 2
  const OTHER_NAME = '홍길동'

  test.beforeEach(async ({ authenticatedPage: page }) => {
    const dm = createDm({
      id: DM_ID,
      participants: [
        createDmParticipant({ userId: MY_ID, name: MY_NAME }),
        createDmParticipant({ userId: OTHER_ID, name: OTHER_NAME }),
      ],
    })
    await stubChannelsList(page, [])
    await stubDmsList(page, [dm])
    await stubStream(page)
    await stubMessages(page, DM_ID, [])
    await stubMarkRead(page, DM_ID)

    await page.goto(`/chat/dms/${DM_ID}`)
    await expect(page.getByTestId('dm-header')).toBeVisible()
  })

  test(
    '1:1 DM 빈 상태에 상대방 이름이 포함된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const emptyState = page.getByTestId('chat-empty-state')
      await expect(emptyState).toBeVisible()
      await expect(emptyState).toContainText(`${OTHER_NAME} 님과의 메시지 시작입니다.`)
    },
  )
})

// ── self-DM 빈 상태 ─────────────────────────────────────────────────────────

test.describe('self-DM 빈 상태', () => {
  const SELF_DM_ID = 901

  test.beforeEach(async ({ authenticatedPage: page }) => {
    const selfDm = createDm({
      id: SELF_DM_ID,
      participants: [createDmParticipant({ userId: MY_ID, name: MY_NAME })],
    })
    await stubChannelsList(page, [])
    await stubDmsList(page, [selfDm])
    await stubStream(page)
    await stubMessages(page, SELF_DM_ID, [])
    await stubMarkRead(page, SELF_DM_ID)

    await page.goto(`/chat/dms/${SELF_DM_ID}`)
    await expect(page.getByTestId('dm-header')).toBeVisible()
  })

  test(
    'self-DM 빈 상태에 "나에게만 보이는 공간" 문구가 노출된다',
    async ({ authenticatedPage: page }) => {
      const emptyState = page.getByTestId('chat-empty-state')
      await expect(emptyState).toBeVisible()
      await expect(emptyState).toContainText('나에게만 보이는 공간입니다.')
    },
  )
})

// ── AGENT 배지 ───────────────────────────────────────────────────────────────

test.describe('AGENT DM 배지', () => {
  const AGENT_DM_ID = 902
  const AGENT_ID = 50
  const AGENT_NAME = 'AI 어시스턴트'

  test.beforeEach(async ({ authenticatedPage: page }) => {
    const agentDm = createDm({
      id: AGENT_DM_ID,
      participants: [
        createDmParticipant({ userId: MY_ID, name: MY_NAME, kind: 'HUMAN' }),
        createDmParticipant({ userId: AGENT_ID, name: AGENT_NAME, kind: 'AGENT' }),
      ],
    })
    await stubChannelsList(page, [])
    await stubDmsList(page, [agentDm])
    await stubStream(page)
    await stubMessages(page, AGENT_DM_ID, [])
    await stubMarkRead(page, AGENT_DM_ID)

    await page.goto(`/chat/dms/${AGENT_DM_ID}`)
    await expect(page.getByTestId('dm-header')).toBeVisible()
  })

  test(
    'DM 헤더에 AGENT 배지가 노출된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const header = page.getByTestId('dm-header')
      await expect(header.getByTestId('agent-badge')).toBeVisible()
    },
  )

  test(
    '사이드바 DM 목록에서 AGENT DM 항목에 배지가 노출된다',
    async ({ authenticatedPage: page }) => {
      const dmLink = page.getByTestId(`dm-link-${AGENT_DM_ID}`)
      await expect(dmLink).toBeVisible()
      await expect(dmLink.getByTestId('agent-badge')).toBeVisible()
    },
  )
})

// ── /chat 첫 진입 CTA ────────────────────────────────────────────────────────

test.describe('/chat 빈 첫 진입 CTA', () => {
  test(
    '"새 메시지" 버튼이 보이고 /chat/new 링크를 가진다',
    async ({ authenticatedPage: page }) => {
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/channels',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
            : route.fallback(),
      )
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/dms',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
            : route.fallback(),
      )
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/stream',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            headers: { 'cache-control': 'no-cache' },
            body: `:\n\n`,
          }),
      )

      await page.goto('/chat')
      const cta = page.getByTestId('channel-empty-new-message')
      await expect(cta).toBeVisible()
      await expect(cta).toHaveAttribute('href', '/chat/new')
    },
  )
})

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
    { tag: '@smoke' },
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
