// messaging Phase 5 E2E — 스레드 답글(패널·replyCount) · 이모지 리액션(토글·payload·pill).
// 백엔드 없이 page.route() 로 모든 API 모킹. 컴포저는 contenteditable(RichInput/TipTap).
// 남은 테스트는 답글 입력·수정(@input)과 ?thread= 딥링크의 헤더/스레드 칸 배치(@layout)다.
// 퀵 반응·삭제 메시지 반응 막힘·토글 취소·연타·SSE 반응·빈 스레드 문구·눌린 칩 토큰은 vitest 로 옮겼다(WP-984):
// src/pages/chat/messageList.test.tsx · realtime.test.tsx.
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
} from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf, expectBelowHeader, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
import { trackRequests } from '../../fixtures/requests'

// auth.fixture 의 createUser() 기본 id = 1 → "본인" 메시지 판정 기준.
const ME_ID = 1

// 채널 목록 GET stub.
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

// DM 목록 GET stub.
async function stubDmsList(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
        : route.fallback(),
  )
}

// SSE 스트림 stub — body 로 임의 이벤트(또는 keep-alive)를 흘릴 수 있다.
async function stubStream(page: Page, body = `:\n\n`) {
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body,
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

// 채널 멤버 GET stub — @멘션 후보.
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

// 스레드 답글 GET stub.
async function stubReplies(
  page: Page,
  parentId: number,
  items: ReturnType<typeof createMessage>[],
) {
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

test.describe('messaging Phase 5 — 스레드·리액션', () => {
  // 1) 스레드: 답글수 링크 클릭 → 패널 → 답글 작성 → payload.parentMessageId 검증 + 패널 표시.
  test(
    '답글을 작성하면 parentMessageId 가 전송되고 스레드 패널에 보인다',
    { tag: ['@input', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 500
      const PARENT_ID = 9001
      const channel = createChannel({ id: CHANNEL_ID, name: '스레드채널' })
      const parent = createMessage({ id: PARENT_ID, channelId: CHANNEL_ID, body: '부모글', replyCount: 1 })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [parent])
      await stubReplies(page, PARENT_ID, [
        createMessage({ id: 9100, channelId: CHANNEL_ID, parentMessageId: PARENT_ID, body: '기존답글' }),
      ])

      // POST 답글.
      const posts = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CHANNEL_ID}/messages`)
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          const body = route.request().postDataJSON() as { body: string; parentMessageId?: number }
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: 9101,
                channelId: CHANNEL_ID,
                parentMessageId: PARENT_ID,
                authorId: ME_ID,
                authorName: '나',
                body: body.body,
              }),
            ),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)
      // 답글수 링크 → 패널 오픈(replyCount=1 이므로 thread-link 가 렌더된다).
      await page.getByTestId(`message-thread-link-${PARENT_ID}`).click()
      await expect(page.getByTestId('thread-panel')).toBeVisible()
      await expect(page.getByTestId('message-9100')).toBeVisible() // 기존 답글

      // 패널 컴포저에 입력 후 전송(RichInput contenteditable).
      const composer = page.getByTestId('thread-panel').getByTestId('message-composer-input')
      await composer.click()
      await composer.fill('새 답글')
      await page.getByTestId('thread-panel').getByTestId('message-composer-submit').click()

      await posts.waitFor()
      expect(posts.lastBody<{ parentMessageId?: number }>()?.parentMessageId).toBe(PARENT_ID)
      await expect(page.getByTestId('message-9101')).toContainText('새 답글')
    },
  )

  // 6) 회귀: 스레드 패널 내 답글 수정 시 thread 캐시가 갱신돼 UI 에 수정된 본문이 보인다.
  //    useUpdateMessage.onSuccess 가 thread 캐시를 patch 하지 않으면 이 테스트는 FAIL 한다.
  test(
    '스레드 패널에서 내 답글을 수정하면 패널 내 본문이 갱신된다(thread 캐시 패치 회귀)',
    { tag: '@input' },
    async ({ authenticatedPage: page }) => {
      const CHANNEL_ID = 505
      const PARENT_ID = 9600
      const REPLY_ID = 9601
      const EDITED_BODY = '수정된 답글'
      const channel = createChannel({ id: CHANNEL_ID, name: '수정회귀채널' })
      const parent = createMessage({
        id: PARENT_ID,
        channelId: CHANNEL_ID,
        body: '부모글',
        replyCount: 1,
      })
      const reply = createMessage({
        id: REPLY_ID,
        channelId: CHANNEL_ID,
        parentMessageId: PARENT_ID,
        authorId: ME_ID,
        authorName: '나',
        body: '원본 답글',
      })

      await stubChannelsList(page, [channel])
      await stubDmsList(page)
      await stubStream(page)
      await stubChannelDetail(page, channel)
      await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
      await stubMessages(page, CHANNEL_ID, [parent])
      await stubReplies(page, PARENT_ID, [reply])

      // PATCH /api/v1/messaging/messages/:replyId → 수정된 메시지 응답.
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/messages/${REPLY_ID}`,
        (route) =>
          route.request().method() === 'PATCH'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(
                  createMessage({
                    id: REPLY_ID,
                    channelId: CHANNEL_ID,
                    parentMessageId: PARENT_ID,
                    authorId: ME_ID,
                    authorName: '나',
                    body: EDITED_BODY,
                    editedAt: new Date('2026-06-03T00:00:00Z').toISOString(),
                  }),
                ),
              })
            : route.fallback(),
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)
      // 답글수 링크 클릭 → 스레드 패널 오픈(replyCount=1 이므로 thread-link 가 렌더됨).
      await page.getByTestId(`message-thread-link-${PARENT_ID}`).click()
      const panel = page.getByTestId('thread-panel')
      await expect(panel).toBeVisible()

      // 스레드 패널 내 답글 hover → 수정 버튼 클릭(group-hover toolbar).
      await panel.getByTestId(`message-${REPLY_ID}`).hover()
      await panel.getByTestId(`message-edit-${REPLY_ID}`).click()

      // 인라인 에디터에 새 내용 입력 후 저장.
      await panel.getByTestId(`message-editor-input-${REPLY_ID}`).fill(EDITED_BODY)
      await panel.getByTestId(`message-editor-save-${REPLY_ID}`).click()

      // thread 캐시가 패치되면 패널 내 본문이 갱신된다.
      await expect(panel.getByTestId(`message-body-${REPLY_ID}`)).toContainText(EDITED_BODY)
    },
  )

  // 레이아웃 회귀: 채널 헤더는 스레드 칸 위까지 전체 폭으로 덮고, 스레드는 헤더 아래 본문 안 보조 칸이다
  // (스레드 칸이 헤더 옆 화면 맨 위까지 올라가 앱 사이드 패널처럼 보이던 것 방지). ?thread= 딥링크 + ✕ 닫기.
  test('?thread= 딥링크 — 채널 헤더가 스레드 칸 위까지 덮고 스레드는 헤더 아래 칸, ✕ 로 닫힌다', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const CHANNEL_ID = 512
    const PARENT_ID = 9900
    const channel = createChannel({ id: CHANNEL_ID, name: '레이아웃채널' })
    const parent = createMessage({ id: PARENT_ID, channelId: CHANNEL_ID, body: '부모글', replyCount: 0 })

    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubStream(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '나' })])
    await stubMessages(page, CHANNEL_ID, [parent])
    await stubReplies(page, PARENT_ID, [])

    await page.goto(`/chat/channels/${CHANNEL_ID}?thread=${PARENT_ID}`)
    const header = page.getByTestId('channel-header')
    const panel = page.getByTestId('thread-panel')
    await expect(panel).toBeVisible()

    // 헤더 하단선 56px, 헤더 폭 = 채널 칸 + 스레드 칸(좌단은 채널 칸, 우단은 스레드 칸과 일치).
    await expectHeaderBottomAt56(header)
    const [hb, cb, pb] = [await boxOf(header), await boxOf(page.getByTestId('channel-column')), await boxOf(panel)]
    expect(Math.abs(hb.x - cb.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(hb.x + hb.width - (pb.x + pb.width))).toBeLessThanOrEqual(1)

    // 스레드 칸은 헤더 아래에서 시작하고, 상단 소제목 줄은 보조 칸 규격(34px).
    await expectBelowHeader(panel)
    expect((await boxOf(page.getByTestId('thread-panel-header'))).height).toBe(34)

    // 헤더 제목 · 첫 메시지 · 입력창이 같은 16px 축에서 시작한다.
    const title = page.getByTestId('channel-header-name')
    const column = page.getByTestId('channel-column')
    await expectStartAligned(title, column.getByTestId(`message-${PARENT_ID}`))
    await expectStartAligned(title, column.getByTestId('message-composer-input-wrap'))

    // ✕ 닫기 → 패널 사라지고 URL 에서 thread 제거.
    await page.getByTestId('thread-close').click()
    await expect(panel).toHaveCount(0)
    await expect(page).not.toHaveURL(/[?&]thread=/)
  })
})
