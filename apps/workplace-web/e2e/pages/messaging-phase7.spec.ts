// messaging Phase 7 E2E — 채널 @멘션 자동완성에 워크스페이스 AGENT 노출 + 멘션 전송.
// 백엔드 없이 page.route() 로 API 모킹. 컴포저는 contenteditable(RichInput/TipTap).
// 검증 범위: useMentionAgents(GET /users) 결과가 채널 멤버 목록과 합쳐져 비멤버 AGENT 도
// @멘션 팝업에 노출되고, 선택 후 전송 시 POST body 에 <@agentId> 가 포함되는지.
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
} from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

// auth.fixture 의 createUser() 기본 id = 1 → "본인" 메시지 판정 기준.
const ME_ID = 1
// 채널에는 속하지 않은 워크스페이스 AGENT.
const AGENT_ID = 77

// 채널/DM 사이드바 목록 stub.
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

async function stubDmsList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )
}

// SSE 스트림 stub — keep-alive 로 즉시 닫는다.
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

test.describe('@smoke messaging phase7 AI 멤버', () => {
  // 채널 @멘션 자동완성에 비멤버 AGENT 노출 + 멘션 전송 검증.
  // useMentionAgents 가 GET /api/v1/users 로 AGENT 를 조회하고,
  // ChannelPage 에서 채널 멤버 ∪ AGENT 를 합쳐 MentionList 에 전달하는 흐름을 e2e 검증.
  test(
    '채널 멘션 자동완성에 비멤버 AGENT 노출 + 멘션 전송',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 5
      const channel = createChannel({ id: CHANNEL_ID, name: '개발', memberCount: 1 })

      // 사이드바/레이아웃 stubs.
      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)

      // 채널 멤버: 나(HUMAN)만 포함. AGENT 는 비멤버.
      await stubMembers(page, CHANNEL_ID, [
        createChannelMember({ userId: ME_ID, name: '나', kind: 'HUMAN' }),
      ])

      // 메시지 히스토리: 비어있음.
      await stubMessages(page, CHANNEL_ID, [])

      // useMentionAgents 가 호출하는 GET /api/v1/users — PageResponse<UserResponse> 형태.
      // AGENT(id=77) 가 포함돼야 멘션 팝업에 노출된다.
      await page.route(
        (url) => url.pathname === '/api/v1/users',
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                  content: [
                    { id: ME_ID, username: 'me', name: '나', kind: 'HUMAN' },
                    { id: AGENT_ID, username: 'aibot', name: 'AI Bot', kind: 'AGENT' },
                  ],
                  page: 0,
                  size: 100,
                  totalElements: 2,
                  totalPages: 1,
                }),
              })
            : route.fallback(),
      )

      // POST messages — <@AGENT_ID> 토큰이 body 에 포함돼야 한다.
      let postedBody: string | undefined
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          const payload = route.request().postDataJSON() as { body: string }
          postedBody = payload.body
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: 900,
                channelId: CHANNEL_ID,
                authorId: ME_ID,
                authorName: '나',
                body: payload.body,
                mentions: [{ id: AGENT_ID, username: 'aibot', name: 'AI Bot', kind: 'AGENT' }],
              }),
            ),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      const input = page.getByTestId('message-composer-input')
      await input.click()
      // TipTap suggestion: pressSequentially 로 한 글자씩 입력해야 @ 트리거가 발동.
      await input.pressSequentially('@AI')

      // 비멤버 AGENT 옵션이 팝업에 나타나야 한다.
      const agentOption = page.getByTestId(`chat-mention-option-${AGENT_ID}`)
      await expect(agentOption).toBeVisible()
      // AGENT 임을 나타내는 data-agent 속성 검증.
      await expect(agentOption).toHaveAttribute('data-agent', 'true')

      // 옵션 클릭 → 멘션 칩 삽입 → 팝업 닫힘.
      await agentOption.click()
      await expect(agentOption).toHaveCount(0)

      // 전송 버튼 클릭.
      await page.getByTestId('message-composer-submit').click()

      // POST body 에 <@AGENT_ID> 가 포함됐는지 검증.
      await expect.poll(() => postedBody).toContain(`<@${AGENT_ID}>`)
    },
  )
})
