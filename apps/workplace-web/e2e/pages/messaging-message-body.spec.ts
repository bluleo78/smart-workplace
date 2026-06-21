// messaging 메시지 본문 기본기 E2E — 연속 그룹핑·아바타·타임스탬프·하단 고정 검증.
// 백엔드 없이 page.route() 로 API 모킹.
// 검증 범위:
//   - 같은 작성자 연속 메시지 → 하나의 그룹(첫 줄만 헤더+아바타 노출, 후속 줄 숨김)
//   - 다른 작성자/간격 초과 메시지 → 새 그룹 시작
//   - 페이지 진입 시 최신 메시지가 viewport 안에 보임(stick-to-bottom)
//   - @멘션 칩 시맨틱 토큰 적용 확인 (#258 회귀 방지)
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
} from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

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

/** useMentionAgents 가 호출하는 GET /api/v1/users stub. */
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
      authorId: 1,
      authorName: 'me',
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
      (url) => url.pathname === '/api/v1/messaging/stream',
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

// ── 본인 메시지 우측 정렬 버블 ────────────────────────────────────────────────
// currentUserId(=1) 의 메시지는 우측 정렬 + 버블, 타인/AGENT 는 좌측(아바타+이름) 유지.

const OWN_CHANNEL_ID = 702

test.describe('본인 메시지 우측 정렬', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: OWN_CHANNEL_ID, name: '정렬테스트', memberCount: 3 })

    // id 30: 본인(authorId=1), id 31: 타인(id=20), id 32: AGENT(id=99)
    const ownMsg = createMessage({
      id: 30,
      channelId: OWN_CHANNEL_ID,
      authorId: 1,
      authorName: 'me',
      authorKind: 'HUMAN',
      body: '내 메시지',
      createdAt: '2026-06-06T03:00:00',
    })
    const peerMsg = createMessage({
      id: 31,
      channelId: OWN_CHANNEL_ID,
      authorId: 20,
      authorName: '동료',
      authorKind: 'HUMAN',
      body: '동료 메시지',
      createdAt: '2026-06-06T03:01:00',
    })
    const agentMsg = createMessage({
      id: 32,
      channelId: OWN_CHANNEL_ID,
      authorId: 99,
      authorName: 'My AI',
      authorKind: 'AGENT',
      body: '에이전트 메시지',
      createdAt: '2026-06-06T03:02:00',
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
    await stubMessages(page, OWN_CHANNEL_ID, [agentMsg, peerMsg, ownMsg]) // DESC
    await stubMarkRead(page, OWN_CHANNEL_ID)
    await stubUsers(page)

    await page.goto(`/chat/channels/${OWN_CHANNEL_ID}`)
    await expect(page.getByTestId('message-list')).toBeVisible()
  })

  test(
    '본인 메시지는 data-own=true + 우측 정렬 버블, 이름 헤더 없음',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 본인 메시지: 행에 data-own=true + justify-end, 본문은 버블(rounded-2xl bg-primary/10).
      const ownRow = page.getByTestId('message-30')
      await expect(ownRow).toHaveAttribute('data-own', 'true')
      await expect(ownRow).toHaveClass(/justify-end/)
      await expect(page.getByTestId('message-body-30')).toHaveClass(/rounded-2xl/)
      // 본인 메시지엔 이름('me') 헤더가 없다(자명) — 본문 영역에 작성자명 미노출.
      await expect(ownRow.getByText('me', { exact: true })).toHaveCount(0)
    },
  )

  test(
    '타인·AGENT 메시지는 data-own=false + 좌측(아바타) 유지',
    async ({ authenticatedPage: page }) => {
      // 동료(타인) 메시지: 좌측 유지, 아바타·이름 노출.
      await expect(page.getByTestId('message-31')).toHaveAttribute('data-own', 'false')
      await expect(page.getByTestId('chat-avatar-20')).toBeVisible()
      await expect(page.getByTestId('message-body-31')).not.toHaveClass(/bg-primary\/10/)

      // AGENT 는 본인이 아니므로 좌측 유지.
      await expect(page.getByTestId('message-32')).toHaveAttribute('data-own', 'false')
      await expect(page.getByTestId('chat-avatar-agent-99')).toBeVisible()
    },
  )

  test(
    // #290 회귀 — 본인 메시지 hover 툴바가 right-2에 위치해야 함 (left-2 버그 수정)
    '본인 메시지 hover 툴바 — 메시지 버블과 인접한 right-2에 표시됨',
    async ({ authenticatedPage: page }) => {
      const ownRow = page.getByTestId('message-30')
      const toolbar = page.getByTestId('message-toolbar-30')

      // 본인 메시지 행에 호버 → 툴바가 flex로 나타남
      await ownRow.hover()

      // 툴바가 화면에 보여야 함
      await expect(toolbar).toBeVisible()

      // 툴바 위치 검증: right-2 배치이므로 메시지 버블(우측)과 인접해야 함.
      // 컨테이너 우단 근처(right edge 기준 ≤ 60px)에 위치해야 하며,
      // 버그(left-2) 때는 뷰포트 왼쪽 끝(x≈0~10)에 나타났었음.
      const toolbarBox = await toolbar.boundingBox()
      const viewportSize = page.viewportSize()
      expect(toolbarBox).not.toBeNull()
      expect(viewportSize).not.toBeNull()
      // 툴바 왼쪽 끝이 뷰포트 우측 절반에 위치해야 함 (중앙 기준 우측)
      expect(toolbarBox!.x).toBeGreaterThan(viewportSize!.width / 2)
    },
  )
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
