// messaging 메시지 본문 기본기 E2E — 연속 그룹핑·아바타·타임스탬프·하단 고정 검증.
// 백엔드 없이 page.route() 로 API 모킹.
// 검증 범위:
//   - 같은 작성자 연속 메시지 → 하나의 그룹(첫 줄만 헤더+아바타 노출, 후속 줄 숨김)
//   - 다른 작성자/간격 초과 메시지 → 새 그룹 시작
//   - 페이지 진입 시 최신 메시지가 viewport 안에 보임(stick-to-bottom)
//   - @멘션 칩 시맨틱 토큰 적용 확인 (#258 회귀 방지)
import type { Page } from '@playwright/test'

import { createPageResponse } from '../../fixtures/api-mock'
import {
  createChannel,
  createChannelMember,
  createMessage,
} from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'

// auth.fixture 의 createUser() 기본 id = 1 → "본인" 메시지 판정.
const CHANNEL_ID = 700

// 테스트용 메시지 — API 는 DESC(최신순)로 반환하므로 id 3 → 2 → 1 순으로 items 배열에 담는다.
// MessageList 는 .reverse() 로 ASC 정렬 후 렌더한다.
const messages = [
  createMessage({
    id: 1,
    channelId: CHANNEL_ID,
    authorId: 10,
    authorName: 'bluleo78',
    authorKind: 'HUMAN',
    body: '첫째',
    createdAt: '2026-06-06T03:00:00',
  }),
  createMessage({
    id: 2,
    channelId: CHANNEL_ID,
    authorId: 10,
    authorName: 'bluleo78',
    authorKind: 'HUMAN',
    body: '둘째(연속)',
    createdAt: '2026-06-06T03:02:00',
  }),
  createMessage({
    id: 3,
    channelId: CHANNEL_ID,
    authorId: 99,
    authorName: 'My AI',
    authorKind: 'AGENT',
    body: '에이전트 응답',
    createdAt: '2026-06-06T03:10:00',
  }),
]

// ── stub helpers (messaging-phase7.spec.ts 패턴 동일) ──────────────────────────

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
  items: ReturnType<typeof createMessage>[],
) {
  // API 는 DESC(최신순) 반환 — items 는 호출처에서 이미 DESC 순으로 전달한다.
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

/** 읽음 처리(mark-read) POST — 응답만 stub, 검증 불필요. */
async function stubMarkRead(page: Page, channelId: number) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channelId}/read`,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
        : route.fallback(),
  )
}

/** useMentionAgents 가 호출하는 GET /api/v1/members?kind=AGENT stub (#833). */
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

// ── test suite ─────────────────────────────────────────────────────────────────

test.describe('messaging 메시지 본문 기본기', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: '테스트', memberCount: 2 })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [
      createChannelMember({ userId: 10, name: 'bluleo78', kind: 'HUMAN' }),
      createChannelMember({ userId: 99, name: 'My AI', kind: 'AGENT' }),
    ])
    // DESC(최신→오래된) 순으로 전달: id 3 → 2 → 1
    await stubMessages(page, CHANNEL_ID, [...messages].reverse())
    await stubMarkRead(page, CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    // 메시지 목록이 렌더될 때까지 대기
    await expect(page.getByTestId('message-list')).toBeVisible()
  })

  test(
    '연속 그룹핑 — 첫 메시지에 헤더·아바타, 후속 메시지에 헤더 없음',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // message-1: 그룹 시작 → data-group-start="true", 타임스탬프 보임, 아바타 렌더.
      await expect(page.getByTestId('message-1')).toHaveAttribute('data-group-start', 'true')
      await expect(page.getByTestId('message-time-1')).toBeVisible()

      // chat-avatar-10 은 그룹 헤더가 한 번만 생기므로 정확히 1개.
      await expect(page.getByTestId('chat-avatar-10')).toHaveCount(1)

      // message-2: 연속(같은 작성자) → data-group-start="false", 타임스탬프 없음.
      await expect(page.getByTestId('message-2')).toHaveAttribute('data-group-start', 'false')
      await expect(page.getByTestId('message-time-2')).toHaveCount(0)
    },
  )

  test(
    'AGENT 메시지는 새 그룹 시작 + 봇 배지 노출',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // message-3: 작성자 변경 → 새 그룹.
      await expect(page.getByTestId('message-3')).toHaveAttribute('data-group-start', 'true')

      // AGENT 아바타 봇 배지(chat-avatar-agent-99) 노출.
      const agentBadge = page.getByTestId('chat-avatar-agent-99')
      await expect(agentBadge).toBeVisible()

      // #301 회귀: ChatAvatar AGENT 배지가 ai-accent 시맨틱 토큰 클래스를 사용해야 한다 (raw 팔레트 금지).
      await expect(agentBadge).toHaveClass(/bg-ai-accent/)
      await expect(agentBadge).not.toHaveClass(/bg-purple-600/)
    },
  )

  test(
    '페이지 진입 시 최신 메시지(message-3)가 viewport 안에 보임 — stick-to-bottom',
    async ({ authenticatedPage: page }) => {
      await expect(page.getByTestId('message-3')).toBeInViewport()
    },
  )
})

// ── @멘션 칩 시맨틱 토큰 회귀 (#258) ─────────────────────────────────────────────
// raw 팔레트(bg-blue-100, text-blue-700 등)가 다시 사용되면 이 테스트가 실패한다.

const MENTION_CHANNEL_ID = 701

test.describe('@멘션 칩 시맨틱 토큰', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: MENTION_CHANNEL_ID, name: '멘션테스트', memberCount: 2 })

    // HUMAN(id=10) 과 AGENT(id=99) 를 동시에 @멘션하는 메시지
    const mentionMsg = createMessage({
      id: 10,
      channelId: MENTION_CHANNEL_ID,
      // 타인 메시지 — 본인 말풍선 안 칩은 별도 스타일(bg-background)이라 기존 칩 토큰은 타인 행에서 검증한다(#884).
      authorId: 5,
      authorName: '다른사람',
      authorKind: 'HUMAN',
      body: '안녕 <@10> <@99>',
      mentions: [
        { id: 10, username: 'bluleo78', name: '양동희', kind: 'HUMAN' },
        { id: 99, username: 'myai', name: 'My AI', kind: 'AGENT' },
      ],
      createdAt: '2026-06-16T00:00:00',
    })

    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/events',
      (route) =>
        route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${MENTION_CHANNEL_ID}`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${MENTION_CHANNEL_ID}/members`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([
                createChannelMember({ userId: 1, name: 'me', kind: 'HUMAN' }),
                createChannelMember({ userId: 10, name: '양동희', kind: 'HUMAN' }),
                createChannelMember({ userId: 99, name: 'My AI', kind: 'AGENT' }),
              ]),
            })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${MENTION_CHANNEL_ID}/messages`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [mentionMsg], nextCursor: null, hasMore: false }),
            })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${MENTION_CHANNEL_ID}/read`,
      (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 204, contentType: 'application/json', body: '' })
          : route.fallback(),
    )
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

    await page.goto(`/chat/channels/${MENTION_CHANNEL_ID}`)
    await expect(page.getByTestId('message-list')).toBeVisible()
  })

  test(
    'HUMAN @멘션 칩은 시맨틱 토큰(bg-accent text-accent-foreground)을 사용한다 — raw 팔레트 금지 (#258)',
    async ({ authenticatedPage: page }) => {
      const chip = page.getByTestId('mention-chip-10')
      await expect(chip).toBeVisible()
      // 시맨틱 토큰 클래스 존재 확인
      await expect(chip).toHaveClass(/bg-accent/)
      await expect(chip).toHaveClass(/text-accent-foreground/)
      // raw 팔레트 클래스 사용 금지
      const className = await chip.getAttribute('class') ?? ''
      expect(className).not.toContain('bg-blue-')
      expect(className).not.toContain('text-blue-')
    },
  )

  test(
    'AGENT @멘션 칩은 시맨틱 토큰(bg-primary/15 text-primary)을 사용한다 — raw 팔레트 금지 (#258)',
    async ({ authenticatedPage: page }) => {
      const chip = page.getByTestId('mention-chip-99')
      await expect(chip).toBeVisible()
      // 시맨틱 토큰 클래스 존재 확인
      await expect(chip).toHaveClass(/text-primary/)
      // raw 팔레트 클래스 사용 금지
      const className = await chip.getAttribute('class') ?? ''
      expect(className).not.toContain('bg-purple-')
      expect(className).not.toContain('text-purple-')
    },
  )
})

// ── 좌/우 분리 (#884) ───────────────────────────────────────────────────────
// 본인 메시지는 우측 말풍선(아바타·이름 없음), 타인·AGENT 는 좌측 평문(아바타 거터 + 이름 헤더).
// a78a39b7 이 고쳤던 세 가지(호버 시 행 점프, 툴바와 말풍선 겹침, 본인 시각 미표시)를 회귀 단언으로 유지한다.

const OWN_CHANNEL_ID = 702
// 공백 없는 긴 문자열 — 말풍선이 75% 안에서 줄바꿈되는지 확인용.
const LONG_URL = `https://example.com/${'very-long-path-segment-'.repeat(12)}end`

async function setupSplitChannel(page: Page) {
  const channel = createChannel({ id: OWN_CHANNEL_ID, name: '정렬테스트', memberCount: 3 })

  // 30·33·34·35: 본인(authorId=1) 연속 4건 — 30 이 묶음 첫 줄이자 목록 맨 위.
  const ownFirst = createMessage({
    id: 30, channelId: OWN_CHANNEL_ID, authorId: 1, authorName: 'me', authorKind: 'HUMAN',
    body: '내 메시지', createdAt: '2026-06-06T03:00:00',
  })
  const ownFollow = createMessage({
    id: 33, channelId: OWN_CHANNEL_ID, authorId: 1, authorName: 'me', authorKind: 'HUMAN',
    body: LONG_URL, createdAt: '2026-06-06T03:00:20', editedAt: '2026-06-06T03:00:25',
    reactions: [{ emoji: '👍', count: 2, reacted: true }],
  })
  const ownDeleted = createMessage({
    id: 34, channelId: OWN_CHANNEL_ID, authorId: 1, authorName: 'me', authorKind: 'HUMAN',
    body: '', deleted: true, createdAt: '2026-06-06T03:00:30',
  })
  // 본문 없이 첨부만 있는 본인 메시지.
  const ownAttachmentOnly = createMessage({
    id: 35, channelId: OWN_CHANNEL_ID, authorId: 1, authorName: 'me', authorKind: 'HUMAN',
    body: '', createdAt: '2026-06-06T03:00:40',
    attachments: [
      { fileId: 900, messageId: 35, originalName: `2026-10-01_운영배포_체크리스트_최종_v3_${'아주긴파일명_'.repeat(14)}.xlsx`, mimeType: 'application/vnd.ms-excel', sizeBytes: 49152, attachedById: 1, attachedByName: 'me', attachedAt: '2026-06-06T03:00:40' },
    ],
  })
  const peerMsg = createMessage({
    id: 31, channelId: OWN_CHANNEL_ID, authorId: 20, authorName: '동료', authorKind: 'HUMAN',
    body: '동료 메시지', createdAt: '2026-06-06T03:01:00',
    reactions: [{ emoji: '👍', count: 1, reacted: false }],
  })
  const agentMsg = createMessage({
    id: 32, channelId: OWN_CHANNEL_ID, authorId: 99, authorName: 'My AI', authorKind: 'AGENT',
    body: '에이전트 메시지', createdAt: '2026-06-06T03:02:00',
  })

  // 36·37: 사람·에이전트를 함께 멘션한 본인/타인 메시지 — 칩 대비(#884) 검증용.
  const mentions = [
    { id: 20, username: 'peer', name: '동료', kind: 'HUMAN' as const },
    { id: 99, username: 'myai', name: 'My AI', kind: 'AGENT' as const },
  ]
  const ownMention = createMessage({
    id: 36, channelId: OWN_CHANNEL_ID, authorId: 1, authorName: 'me', authorKind: 'HUMAN',
    body: '<@99> 요약해줘 <@20>', mentions, createdAt: '2026-06-06T03:03:00',
  })
  const peerMention = createMessage({
    id: 37, channelId: OWN_CHANNEL_ID, authorId: 20, authorName: '동료', authorKind: 'HUMAN',
    body: '<@99> 확인 부탁', mentions, createdAt: '2026-06-06T03:04:00',
  })

  await stubChannelsList(page, [channel])
  await stubDmsList(page)
  await stubStream(page)
  await stubChannelDetail(page, channel)
  await stubMembers(page, OWN_CHANNEL_ID, [
    createChannelMember({ userId: 1, name: 'me', kind: 'HUMAN' }),
    createChannelMember({ userId: 20, name: '동료', kind: 'HUMAN' }),
    createChannelMember({ userId: 99, name: 'My AI', kind: 'AGENT' }),
  ])
  // API 는 DESC(최신순).
  await stubMessages(page, OWN_CHANNEL_ID, [peerMention, ownMention, agentMsg, peerMsg, ownAttachmentOnly, ownDeleted, ownFollow, ownFirst])
  await stubMarkRead(page, OWN_CHANNEL_ID)
  await stubUsers(page)

  await page.goto(`/chat/channels/${OWN_CHANNEL_ID}`)
  await expect(page.getByTestId('message-list')).toBeVisible()
}

/**
 * testId 요소와 그 조상 중 가로로 넘치는(scrollWidth > clientWidth) 것이 있는지.
 * message-list 자체가 아니라 실제 스크롤 컨테이너(MessageScrollArea 등)가 넓어지는 경우까지 잡는다.
 */
async function hasHorizontalOverflow(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((el) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1) return true
    }
    return false
  })
}

/** testId 요소의 가장 가까운 세로 스크롤 조상의 화면상 top. 툴바가 이 위로 나가면 잘린다. */
async function scrollViewportTop(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((el) => {
    for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY
      if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') return n.getBoundingClientRect().top
    }
    return 0
  })
}

/** 요소의 boundingBox 를 non-null 로 돌려준다(없으면 테스트 실패). */
async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).boundingBox()
  expect(b, `${testId} boundingBox`).not.toBeNull()
  return b!
}

test.describe('메시지 좌/우 분리', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await setupSplitChannel(page)
  })

  test(
    '본인 메시지는 우측 말풍선 — 아바타·이름 없음',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const ownRow = page.getByTestId('message-30')
      await expect(ownRow).toHaveAttribute('data-own', 'true')
      await expect(ownRow).toHaveClass(/justify-end/)
      await expect(page.getByTestId('message-body-30')).toHaveClass(/rounded-2xl/)
      await expect(page.getByTestId('message-body-30')).toHaveClass(/bg-primary\/10/)
      // 본인 행에는 아바타·이름을 그리지 않는다.
      await expect(ownRow.getByTestId('chat-avatar-1')).toHaveCount(0)
      // 이름은 화면에 보이지 않는다(스크린리더용 sr-only 텍스트만 존재).
      await expect(ownRow.getByText('me', { exact: true })).toHaveClass(/sr-only/)
      // 말풍선이 실제로 목록 오른쪽 절반에 있다(클래스만이 아니라 좌표로 확인).
      const list = await box(page, 'message-list')
      const body = await box(page, 'message-body-30')
      expect(body.x).toBeGreaterThan(list.x + list.width / 2)
    },
  )

  test('타인·AGENT 메시지는 좌측 평문 — 아바타·이름 표시, 말풍선 없음', async ({ authenticatedPage: page }) => {
    const peerRow = page.getByTestId('message-31')
    await expect(peerRow).toHaveAttribute('data-own', 'false')
    await expect(peerRow).not.toHaveClass(/justify-end/)
    await expect(peerRow.getByTestId('chat-avatar-20')).toBeVisible()
    await expect(peerRow.getByText('동료', { exact: true })).toBeVisible()
    await expect(page.getByTestId('message-body-31')).not.toHaveClass(/rounded-2xl/)
    await expect(page.getByTestId('message-body-31')).not.toHaveClass(/bg-primary\/10/)

    await expect(page.getByTestId('message-32')).toHaveAttribute('data-own', 'false')
    await expect(page.getByTestId('chat-avatar-agent-99')).toBeVisible()

    // 본문이 목록 왼쪽에서 시작한다(거터 40px + 여백 안쪽).
    const list = await box(page, 'message-list')
    const body = await box(page, 'message-body-31')
    expect(body.x).toBeLessThan(list.x + 100)
  })

  test('내 묶음 첫 말풍선 — 시각 항상 표시, 툴바는 시각 왼쪽이고 말풍선과 겹치지 않는다', async ({ authenticatedPage: page }) => {
    // 회귀 3: 본인 메시지에도 시각이 보인다(호버 없이).
    await expect(page.getByTestId('message-time-30')).toBeVisible()
    await expect(page.getByTestId('message-time-30')).toHaveCSS('opacity', '1')

    await page.getByTestId('message-30').hover()
    await expect(page.getByTestId('message-toolbar-30')).toHaveCSS('opacity', '1')

    const toolbar = await box(page, 'message-toolbar-30')
    const time = await box(page, 'message-time-30')
    const body = await box(page, 'message-body-30')
    // 툴바는 시각의 왼쪽에 나란히.
    expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(time.x + 0.5)
    // 회귀 2: 툴바가 말풍선과 겹치지 않는다(툴바 아래 끝이 말풍선 위 끝보다 위).
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(body.y + 0.5)
  })

  test('내 후속 말풍선 — 호버 시각은 왼쪽 옆, 툴바는 말풍선 위, 호버 전후 말풍선 위치 불변', async ({ authenticatedPage: page }) => {
    const hoverTime = page.getByTestId('message-hovertime-33')
    const before = await box(page, 'message-body-33')
    await expect(hoverTime).toHaveCSS('opacity', '0')

    await page.getByTestId('message-33').hover()
    await expect(hoverTime).toHaveCSS('opacity', '1')
    await expect(page.getByTestId('message-toolbar-33')).toHaveCSS('opacity', '1')

    // 회귀 1: 호버로 행이 흔들리지 않는다.
    const after = await box(page, 'message-body-33')
    expect(after).toEqual(before)

    const toolbar = await box(page, 'message-toolbar-33')
    const time = await box(page, 'message-hovertime-33')
    // 회귀 2: 툴바는 말풍선 위에 있고 겹치지 않는다.
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(after.y + 0.5)
    // 호버 시각은 말풍선 왼쪽 옆, 한 줄(줄 높이 16px + 위 패딩 8px = 24px. 두 줄이면 40px).
    expect(time.x + time.width).toBeLessThanOrEqual(after.x + 0.5)
    expect(time.height).toBeLessThan(30)
  })

  test('공백 없는 긴 문자열도 말풍선 안에서 줄바꿈 — 가로 스크롤 없음', async ({ authenticatedPage: page }) => {
    const list = await box(page, 'message-list')
    const body = await box(page, 'message-body-33')
    // 말풍선은 목록 폭의 75% 를 넘지 않는다.
    expect(body.width).toBeLessThanOrEqual(list.width * 0.75 + 1)
    expect(await hasHorizontalOverflow(page, 'message-list')).toBe(false)
  })

  test('첨부만 있는 본인 메시지 — 빈 말풍선을 그리지 않고 첨부는 오른쪽, 긴 파일명은 카드 안에서 잘린다', async ({ authenticatedPage: page }) => {
    await expect(page.getByTestId('message-body-35')).toHaveCount(0)
    // 카드가 본인 컬럼(목록 폭의 75%)을 넘거나 목록 왼쪽 밖으로 잘리지 않고 오른쪽 끝에 붙는다.
    const assertCardInside = async () => {
      const list = await box(page, 'message-list')
      const card = await box(page, 'attachment-card-900')
      expect(card.width).toBeLessThanOrEqual(list.width * 0.75 + 1)
      expect(card.x).toBeGreaterThanOrEqual(list.x)
      expect(card.x + card.width).toBeGreaterThan(list.x + list.width - 40)
      expect(await hasHorizontalOverflow(page, 'message-list')).toBe(false)
    }
    await assertCardInside()
    // 좁은 채팅 컬럼에서도 동일.
    await page.setViewportSize({ width: 700, height: 800 })
    await assertCardInside()
    // 카드가 좁아져도 크기 라벨("48 KB")은 줄바꿈되지 않고 한 줄로 남는다(파일명만 줄어든다).
    const size = page.getByTestId('attachment-card-900').getByText('48 KB')
    await expect(size).toHaveCSS('white-space', 'nowrap')
    expect((await size.boundingBox())!.height).toBeLessThan(24)
  })

  test('목록 맨 위 메시지의 툴바가 목록 영역 밖으로 잘리지 않는다', async ({ authenticatedPage: page }) => {
    // 목록을 맨 위로 올린 상태에서, 툴바 위 끝이 스크롤 영역의 위 끝보다 아래에 있어야 한다.
    // (scrollIntoViewIfNeeded 는 행 top 을 스크롤 영역 top 에 딱 붙여 상단 패딩이 사라지므로 scrollTop=0 으로 직접 올린다.)
    await page.getByTestId('message-scroll-area').evaluate((el) => { el.scrollTop = 0 })
    await page.getByTestId('message-30').hover()
    // 툴바가 숨겨진 채로 통과하지 못하게 실제로 보이는지 먼저 확인한다.
    await expect(page.getByTestId('message-toolbar-30')).toHaveCSS('opacity', '1')
    const toolbar = await box(page, 'message-toolbar-30')
    expect(toolbar.y).toBeGreaterThanOrEqual(await scrollViewportTop(page, 'message-list'))
  })

  test('상대 메시지 툴바 — 반응만 있고 수정·삭제는 없다', async ({ authenticatedPage: page }) => {
    await page.getByTestId('message-31').hover()
    await expect(page.getByTestId('message-toolbar-31')).toHaveCSS('opacity', '1')
    await expect(page.getByTestId('message-31-react')).toBeVisible()
    await expect(page.getByTestId('message-edit-31')).toHaveCount(0)
    await expect(page.getByTestId('message-delete-31')).toHaveCount(0)
    // 본인 메시지에는 수정·삭제가 있다.
    await page.getByTestId('message-30').hover()
    await expect(page.getByTestId('message-edit-30')).toBeVisible()
    await expect(page.getByTestId('message-delete-30')).toBeVisible()
  })

  test('반응 칩은 메시지와 같은 쪽으로 정렬된다', async ({ authenticatedPage: page }) => {
    await expect(page.getByTestId('reaction-bar-33')).toHaveClass(/justify-end/)
    await expect(page.getByTestId('reaction-bar-31')).not.toHaveClass(/justify-end/)
    // 본인: 칩의 오른쪽 끝이 말풍선 오른쪽 끝과 맞는다.
    const body = await box(page, 'message-body-33')
    const pill = await box(page, 'reaction-pill-33-👍')
    expect(Math.abs(pill.x + pill.width - (body.x + body.width))).toBeLessThan(1)
    // 상대: 칩의 왼쪽 끝이 본문 왼쪽 끝과 맞는다.
    const peerBody = await box(page, 'message-body-31')
    const peerPill = await box(page, 'reaction-pill-31-👍')
    expect(Math.abs(peerPill.x - peerBody.x)).toBeLessThan(1)
  })

  test('본인 말풍선 안 멘션 칩은 배경과 구분되고, 타인 메시지 칩은 기존 스타일 유지', async ({ authenticatedPage: page }) => {
    const ownBody = page.getByTestId('message-body-36')
    await expect(ownBody.getByTestId('mention-chip-99')).toHaveClass(/bg-background/)
    await expect(ownBody.getByTestId('mention-chip-20')).toHaveClass(/bg-background/)
    // 본인 말풍선의 wrap-anywhere 로 칩이 '@' 와 이름 사이에서 끊기지 않게 한다.
    await expect(ownBody.getByTestId('mention-chip-99')).toHaveClass(/whitespace-nowrap/)
    await expect(ownBody.getByTestId('mention-chip-20')).toHaveClass(/whitespace-nowrap/)
    const peerBody = page.getByTestId('message-body-37')
    await expect(peerBody.getByTestId('mention-chip-99')).toHaveClass(/bg-primary\/15/)
    await expect(peerBody.getByTestId('mention-chip-99')).not.toHaveClass(/bg-background/)
  })

  test('수정됨 표시는 말풍선 안, 삭제된 본인 메시지는 우측 점선 말풍선', async ({ authenticatedPage: page }) => {
    await expect(page.getByTestId('message-body-33').getByTestId('message-edited-33')).toHaveText('(수정됨)')
    // wrap-anywhere 말풍선에서도 '(수정됨)' 이 낱말 중간에서 끊기지 않는다.
    // 불변식은 white-space:nowrap 이고, 실제 한 줄 높이는 대표 폭 두 곳에서만 확인한다.
    await expect(page.getByTestId('message-edited-33')).toHaveCSS('white-space', 'nowrap')
    for (const width of [900, 1200]) {
      await page.setViewportSize({ width, height: 800 })
      expect((await box(page, 'message-edited-33')).height, `width ${width}`).toBeLessThan(24)
    }

    await expect(page.getByTestId('message-34')).toHaveClass(/justify-end/)
    const deletedBody = page.getByTestId('message-body-34')
    await expect(deletedBody).toHaveText('(삭제됨)')
    await expect(deletedBody).toHaveClass(/border-dashed/)
    await expect(deletedBody).not.toHaveClass(/bg-primary\/10/)
    await expect(page.getByTestId('message-edit-34')).toHaveCount(0)
    await expect(page.getByTestId('message-delete-34')).toHaveCount(0)
  })

  test('본인 메시지 수정 중에는 전폭 에디터로 바뀐다', async ({ authenticatedPage: page }) => {
    await page.getByTestId('message-30').hover()
    await page.getByTestId('message-edit-30').click()
    const list = await box(page, 'message-list')
    const editor = await box(page, 'message-editor-30')
    // 말풍선 폭(75%)에 눌리지 않는다.
    expect(editor.width).toBeGreaterThan(list.width * 0.8)
    await expect(page.getByTestId('message-toolbar-30')).toHaveCount(0)
  })

  // #809 — hover 없이 키보드 포커스만으로 버튼에 도달할 수 있어야 한다.
  test('본인 메시지 툴바 — hover 없이 키보드 포커스만으로 접근 가능하다 (#809)', async ({ authenticatedPage: page }) => {
    const toolbar = page.getByTestId('message-toolbar-33')
    const editButton = toolbar.getByRole('button', { name: '수정' })
    await expect(toolbar).toHaveCSS('opacity', '0')
    await editButton.focus()
    await expect(toolbar).toHaveCSS('opacity', '1')
    await expect(editButton).toBeFocused()
  })
})

// ── 384px 스레드 패널 — 본인 부모 메시지 + 긴 본문·반응 6종·긴 파일명 답글 ──────────
// 완료 기준에 명시된 좁은 표면. 과거 스크린샷에서 페이지 전체가 ~32px 밀린 적이 있어
// 가로 넘침·툴바 잘림·조상 스크롤 오프셋을 함께 회귀 고정한다.
const THREAD_CHANNEL_ID = 704
const THREAD_PARENT_ID = 8800

test.describe('메시지 좌/우 분리 — 스레드 패널(384px)', () => {
  test('본인 부모·답글이 패널 안에 갇히고, 툴바가 잘리거나 페이지가 밀리지 않는다', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: THREAD_CHANNEL_ID, name: '스레드정렬', memberCount: 2 })
    const parent = createMessage({
      id: THREAD_PARENT_ID, channelId: THREAD_CHANNEL_ID, authorId: 1, authorName: 'me', authorKind: 'HUMAN',
      body: '내 부모 메시지', createdAt: '2026-06-06T03:00:00', replyCount: 3,
    })
    const longParagraph = '스레드 패널 폭에서 줄바꿈되어야 하는 아주 긴 문단입니다. '.repeat(8) + LONG_URL
    const emojis = ['👍', '❤️', '😂', '🎉', '🙏', '👀']
    const ownReply = createMessage({
      id: THREAD_PARENT_ID + 1, channelId: THREAD_CHANNEL_ID, parentMessageId: THREAD_PARENT_ID,
      authorId: 1, authorName: 'me', authorKind: 'HUMAN', body: longParagraph, createdAt: '2026-06-06T03:01:00',
      reactions: emojis.map((emoji, i) => ({ emoji, count: i + 1, reacted: i % 2 === 0 })),
      attachments: [
        { fileId: 901, messageId: THREAD_PARENT_ID + 1, originalName: `2026-10-01_스레드첨부_${'아주긴파일명_'.repeat(14)}.xlsx`, mimeType: 'application/vnd.ms-excel', sizeBytes: 49152, attachedById: 1, attachedByName: 'me', attachedAt: '2026-06-06T03:01:00' },
      ],
    })
    const peerReply = createMessage({
      id: THREAD_PARENT_ID + 2, channelId: THREAD_CHANNEL_ID, parentMessageId: THREAD_PARENT_ID,
      authorId: 20, authorName: '동료', authorKind: 'HUMAN', body: '동료 답글', createdAt: '2026-06-06T03:02:00',
    })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, THREAD_CHANNEL_ID, [
      createChannelMember({ userId: 1, name: 'me', kind: 'HUMAN' }),
      createChannelMember({ userId: 20, name: '동료', kind: 'HUMAN' }),
    ])
    await stubMessages(page, THREAD_CHANNEL_ID, [parent])
    // 답글은 ASC 페이지.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${THREAD_PARENT_ID}/replies`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [ownReply, peerReply], nextCursor: null, hasMore: false }),
            })
          : route.fallback(),
    )
    await stubMarkRead(page, THREAD_CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${THREAD_CHANNEL_ID}`)
    await page.getByTestId(`message-thread-link-${THREAD_PARENT_ID}`).click()
    const panel = page.getByTestId('thread-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId(`message-${THREAD_PARENT_ID + 1}`)).toBeVisible()
    await expect(panel.getByTestId('attachment-card-901')).toBeVisible()

    // 패널 폭은 384px 고정.
    expect((await box(page, 'thread-panel')).width).toBeCloseTo(384, 0)

    // (c) 페이지·조상이 밀리지 않았는지 — 패널 자신의 스크롤 컨테이너(overflow-y:auto) 위쪽 조상은 scrollTop 이 0 이어야 한다.
    //     스크롤 컨테이너 자체는 답글이 길어 스크롤될 수 있으므로 제외한다.
    const assertNoPageShift = async (when: string) => {
      const r = await page.evaluate(() => {
        const panelEl = document.querySelector('[data-testid="thread-panel"]')!
        const inner = panelEl.querySelector(':scope > div.overflow-y-auto')
        const bad: string[] = []
        for (let n: Element | null = panelEl; n; n = n.parentElement) {
          if (n.scrollTop !== 0 || n.scrollLeft !== 0) bad.push(`${n.tagName}.${(n as HTMLElement).className}:${n.scrollTop}/${n.scrollLeft}`)
        }
        return { scrollY: window.scrollY, docTop: document.documentElement.scrollTop, bad, innerFound: !!inner }
      })
      expect(r.innerFound, `${when} 패널 스크롤 컨테이너`).toBe(true)
      expect(r.scrollY, `${when} window.scrollY`).toBe(0)
      expect(r.docTop, `${when} documentElement.scrollTop`).toBe(0)
      expect(r.bad, `${when} 패널·조상의 scroll 오프셋`).toEqual([])
    }
    await assertNoPageShift('열기 직후')

    // (a) 가로 넘침 없음 — 패널과 그 조상 전부.
    expect(await hasHorizontalOverflow(page, 'thread-panel')).toBe(false)

    // (b) 부모 hover → 툴바 표시, 툴바 top 이 패널 스크롤 뷰포트 위로 나가지 않는다.
    const parentRow = panel.getByTestId(`message-${THREAD_PARENT_ID}`)
    await parentRow.hover()
    const toolbar = panel.getByTestId(`message-toolbar-${THREAD_PARENT_ID}`)
    await expect(toolbar).toHaveCSS('opacity', '1')
    const tb = (await toolbar.boundingBox())!
    const viewportTop = await panel.evaluate((el) => el.querySelector(':scope > div.overflow-y-auto')!.getBoundingClientRect().top)
    expect(tb.y).toBeGreaterThanOrEqual(viewportTop)
    await assertNoPageShift('hover 후')

    // 툴바 버튼 포커스 후에도 스크롤 오프셋이 생기지 않는다(focus 로 인한 scrollIntoView 회귀).
    await toolbar.getByRole('button').first().focus()
    await assertNoPageShift('버튼 포커스 후')
    expect(await hasHorizontalOverflow(page, 'thread-panel')).toBe(false)

    // 긴 문단 답글·첨부는 패널(384px) 밖으로 나가지 않는다.
    const panelBox = await box(page, 'thread-panel')
    const card = (await panel.getByTestId('attachment-card-901').boundingBox())!
    expect(card.x).toBeGreaterThanOrEqual(panelBox.x)
    expect(card.x + card.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
    const reply = (await panel.getByTestId(`message-body-${THREAD_PARENT_ID + 1}`).boundingBox())!
    expect(reply.x + reply.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
  })
})

test.describe('메시지 좌/우 분리 — 터치', () => {
  // hover 가 없는 터치 입력에서는 탭으로 툴바를 드러낸다.
  test.use({ hasTouch: true })

  test('메시지를 탭하면 툴바가 보이고, 다른 곳을 탭하면 닫힌다', async ({ authenticatedPage: page }) => {
    await setupSplitChannel(page)
    const peerRow = page.getByTestId('message-31')
    await expect(peerRow).not.toHaveAttribute('data-tap-active', 'true')

    await page.getByTestId('message-body-31').tap()
    await expect(peerRow).toHaveAttribute('data-tap-active', 'true')
    await expect(page.getByTestId('message-toolbar-31')).toHaveCSS('opacity', '1')

    // 다른 메시지를 탭하면 활성 행이 옮겨간다.
    await page.getByTestId('message-body-30').tap()
    await expect(peerRow).not.toHaveAttribute('data-tap-active', 'true')
    await expect(page.getByTestId('message-30')).toHaveAttribute('data-tap-active', 'true')
    await expect(page.getByTestId('message-toolbar-30')).toHaveCSS('opacity', '1')

    // 메시지 행이 아닌 곳(컴포저 영역)을 탭하면 활성 행이 닫힌다 —
    // useTapReveal 의 "행이 아닌 곳에서 pointerdown" 분기. 에뮬레이트된 hover 로 opacity 가 1 일 수 있어
    // 판별은 opacity 가 아니라 data-tap-active 로 한다.
    await page.getByTestId('message-composer-input').tap()
    await expect(page.getByTestId('message-30')).not.toHaveAttribute('data-tap-active', 'true')
  })
})

// ── 후속 줄 hover 시각(거터) — 컴팩트 24h + opacity 토글(레이아웃 점프 방지) ──────────
// 같은 작성자 연속 메시지의 2번째(그룹 비시작) 행은 아바타 대신 hover 시각을 거터에 둔다.
const HOVERTIME_CHANNEL_ID = 703

test.describe('후속 줄 hover 시각', () => {
  test('컴팩트 24h 포맷 + 호버 전 opacity 0 → 호버 시 1 (행 높이 불변)', async ({
    authenticatedPage: page,
  }) => {
    const channel = createChannel({ id: HOVERTIME_CHANNEL_ID, name: '시각테스트', memberCount: 2 })
    // 동일 작성자(id 20) 연속 2건 → 2번째(id 41)는 그룹 비시작 → 거터에 hover 시각.
    const first = createMessage({
      id: 40,
      channelId: HOVERTIME_CHANNEL_ID,
      authorId: 20,
      authorName: '동료',
      authorKind: 'HUMAN',
      body: '첫 줄',
      createdAt: '2026-06-06T13:00:00Z',
    })
    const second = createMessage({
      id: 41,
      channelId: HOVERTIME_CHANNEL_ID,
      authorId: 20,
      authorName: '동료',
      authorKind: 'HUMAN',
      body: '후속 줄',
      createdAt: '2026-06-06T13:00:30Z',
    })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, HOVERTIME_CHANNEL_ID, [
      createChannelMember({ userId: 1, name: 'me', kind: 'HUMAN' }),
      createChannelMember({ userId: 20, name: '동료', kind: 'HUMAN' }),
    ])
    await stubMessages(page, HOVERTIME_CHANNEL_ID, [second, first]) // DESC
    await stubMarkRead(page, HOVERTIME_CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${HOVERTIME_CHANNEL_ID}`)
    await expect(page.getByTestId('message-list')).toBeVisible()

    const hoverTime = page.getByTestId('message-hovertime-41')
    // 13:00:30Z = KST 22:00 → 컴팩트 24h "22:00"(오전/오후 없음, 한 줄).
    await expect(hoverTime).toHaveText('22:00')
    // 호버 전: opacity 0 (자리는 차지하되 보이지 않음 — display:none 아님이라 행 높이 고정).
    await expect(hoverTime).toHaveCSS('opacity', '0')
    // 행 호버 → opacity 1 로 드러남.
    await page.getByTestId('message-41').hover()
    await expect(hoverTime).toHaveCSS('opacity', '1')
  })
})

// ── #356: AI(에이전트) 메시지 마크다운 렌더링 ─────────────────────────────────────
// AI 버블만 마크다운(##, **, 리스트)을 파싱 렌더하고, 사람 메시지는 원시 텍스트 그대로 유지.

const MD_CHANNEL_ID = 702

test.describe('#356 AI 메시지 마크다운 렌더링', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: MD_CHANNEL_ID, name: '마크다운테스트', memberCount: 2 })

    // AGENT(id 50): 마크다운 본문 / HUMAN(id 51): 마크다운 기호가 든 본문(원시 유지 기대)
    const mdMessages = [
      createMessage({
        id: 50,
        channelId: MD_CHANNEL_ID,
        authorId: 99,
        authorName: 'My AI',
        authorKind: 'AGENT',
        body: '## 보고서 제목\n\n- 항목 하나\n- 항목 둘\n\n**중요** 강조',
        createdAt: '2026-06-06T03:00:00',
      }),
      createMessage({
        id: 51,
        channelId: MD_CHANNEL_ID,
        authorId: 10,
        authorName: 'bluleo78',
        authorKind: 'HUMAN',
        body: '## 사람 메시지는 ** 그대로',
        createdAt: '2026-06-06T03:05:00',
      }),
    ]

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, MD_CHANNEL_ID, [
      createChannelMember({ userId: 10, name: 'bluleo78', kind: 'HUMAN' }),
      createChannelMember({ userId: 99, name: 'My AI', kind: 'AGENT' }),
    ])
    await stubMessages(page, MD_CHANNEL_ID, [...mdMessages].reverse())
    await stubMarkRead(page, MD_CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${MD_CHANNEL_ID}`)
    await expect(page.getByTestId('message-list')).toBeVisible()
  })

  test('AGENT 메시지는 마크다운으로 렌더(heading/list/strong), 원시 기호 미노출', async ({
    authenticatedPage: page,
  }) => {
    const body = page.getByTestId('message-body-50')
    // 마크다운 컨테이너 존재
    await expect(body.getByTestId('markdown-content')).toBeVisible()
    // ## → heading 요소로 렌더
    await expect(body.getByRole('heading', { name: '보고서 제목' })).toBeVisible()
    // - 항목 → 리스트 아이템
    await expect(body.locator('li', { hasText: '항목 하나' })).toBeVisible()
    // ** 강조 → strong 요소
    await expect(body.locator('strong', { hasText: '중요' })).toBeVisible()
    // 원시 마크다운 기호(##, **)는 그대로 노출되지 않아야 함
    await expect(body).not.toContainText('##')
    await expect(body).not.toContainText('**')
  })

  test('사람(HUMAN) 메시지는 마크다운을 파싱하지 않고 원시 텍스트 유지', async ({
    authenticatedPage: page,
  }) => {
    const body = page.getByTestId('message-body-51')
    // 마크다운 렌더 컨테이너가 없어야 함
    await expect(body.getByTestId('markdown-content')).toHaveCount(0)
    // 원시 기호가 그대로 보임
    await expect(body).toContainText('## 사람 메시지는 ** 그대로')
  })
})
