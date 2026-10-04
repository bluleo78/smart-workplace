// #366 회귀 — 자동완성 드롭다운 없이 평문으로 @에이전트 를 타이핑해도 전송 시 <@id> 로 변환되어
// AI 트리거가 누락되지 않는지 검증한다(백엔드는 body 의 <@id> 에서 멘션을 파생하므로 트리거됨).
// 백엔드 없이 page.route() 로 API 모킹. 검증 핵심: 전송 POST payload.body 에 <@99> 가 포함된다.
import type { Page } from '@playwright/test'

import { createMember } from '../../factories/auth.factory'
import { createPageResponse } from '../../fixtures/api-mock'
import { createChannel, createChannelMember, createMessage } from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const CHANNEL_ID = 710
// "My AI" 에이전트 — 이름에 공백이 있어 평문 타이핑 시 suggestion 이 매칭하지 못하고 평문으로 남는다(#366 핵심).
const AGENT_ID = 99

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
              createChannelMember({ userId: AGENT_ID, name: 'My AI', kind: 'AGENT' }),
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

test.describe('#366 평문 @에이전트 멘션 → <@id> 변환', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: '테스트', memberCount: 2 })
    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID)
    await stubMessagesGet(page, CHANNEL_ID)
    await stubMarkRead(page, CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId('message-composer')).toBeVisible()
  })

  test('평문 "@My AI hello" 전송 시 payload.body 가 "<@99> hello" 로 변환된다', async ({
    authenticatedPage: page,
  }) => {
    // 전송 POST 응답(GET stub 보다 나중에 등록 → POST 우선 처리).
    const posts = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/messages`)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() === 'POST') {
          const sentBody = (route.request().postDataJSON() as { body: string }).body
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: 1,
                channelId: CHANNEL_ID,
                authorId: 1,
                authorName: 'bluleo78',
                authorKind: 'HUMAN',
                body: sentBody,
                createdAt: '2026-06-06T03:20:00',
              }),
            ),
          })
        }
        return route.fallback()
      },
    )

    const input = page.getByTestId('message-composer-input')
    await input.click()
    // 멘션 후보(채널 멤버 + 에이전트) 로드를 보장 — @ 입력 시 "My AI" 옵션이 떠야 변환 대상 members 가 준비된 것.
    await page.keyboard.type('@')
    await expect(page.getByTestId(`chat-mention-option-${AGENT_ID}`)).toBeVisible()
    await page.keyboard.press('Escape')
    // 입력창을 비우고 드롭다운 없이 평문으로 직접 타이핑한다("My AI" 는 공백이 있어 suggestion 이 매칭 못 함).
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('@My AI hello')
    // 혹시 열렸을 suggestion 팝업을 닫아 평문 상태를 확정(노드 생성 방지).
    await page.keyboard.press('Escape')
    await page.getByTestId('message-composer-submit').click()

    // payload.body 가 <@99> 로 변환되어 전송되어야 백엔드가 AI 를 트리거할 수 있다.
    await expect.poll(() => posts.lastBody<{ body: string }>()?.body).toBe('<@99> hello')
  })
})

// WP-183: 멘션 후보 에이전트는 한 페이지(100건)에서 끊지 않고 마지막 페이지까지 받는다 — 101번째 에이전트도 @멘션 가능.
test('워크스페이스 에이전트가 100명을 넘어도 마지막 페이지의 에이전트가 멘션 후보에 보인다', async ({
  authenticatedPage: page,
}) => {
  const channel = createChannel({ id: CHANNEL_ID, name: '테스트', memberCount: 2 })
  await stubChannelsList(page, [channel])
  await stubDmsList(page)
  await stubStream(page)
  await stubChannelDetail(page, channel)
  await stubMembers(page, CHANNEL_ID)
  await stubMessagesGet(page, CHANNEL_ID)
  await stubMarkRead(page, CHANNEL_ID)
  const LAST_AGENT_ID = 5000
  const agentPages = trackRequests(page, 'GET', (url) => url.pathname === '/api/v1/members' && url.searchParams.get('kind') === 'AGENT')
  await page.route(
    (url) => url.pathname === '/api/v1/members',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const params = new URL(route.request().url()).searchParams
      const n = Number(params.get('page') ?? 0)
      const agents =
        n === 0
          ? Array.from({ length: 100 }, (_, i) => createMember({ userId: 1000 + i, name: `봇${i}`, username: `bot${i}`, kind: 'AGENT' }))
          : [createMember({ userId: LAST_AGENT_ID, name: '막내봇', username: 'lastbot', kind: 'AGENT' })]
      const body = createPageResponse(agents, { page: n, size: 100, totalElements: 101, totalPages: 2 })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    },
  )

  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  await page.getByTestId('message-composer-input').click()
  await page.keyboard.type('@막내')
  await expect(page.getByTestId(`chat-mention-option-${LAST_AGENT_ID}`)).toBeVisible()
  expect(agentPages.urls().map((u) => String(Number(u.searchParams.get('page') ?? 0)))).toEqual(expect.arrayContaining(['0', '1']))
})
