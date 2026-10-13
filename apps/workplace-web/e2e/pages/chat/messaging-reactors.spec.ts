// WP-106 반응자 확인(데스크톱) — 칩 호버 카드 요약(지연 로딩) · 모두 보기 다이얼로그(이모지 탭) · 나 중복 없음.
// 백엔드 없이 page.route() 로 API 모킹.
import type { Page } from '@playwright/test'

import {
  createChannel,
  createChannelMember,
  createMessage,
  createReaction,
} from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { pushHeldEvents } from '../../fixtures/gatedEvents'
import { trackRequests } from '../../fixtures/requests'
import { expectStays, stableBox } from '../../fixtures/wait'

const ME_ID = 1
const CHANNEL_ID = 610
const MSG_ID = 9610

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

/** 반응자 API stub — emoji 별 사람 목록을 그대로 한 페이지로 돌려준다. */
async function stubReactors(page: Page, byEmoji: Record<string, { userId: number; name: string; kind?: string }[]>) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}/reactions/users`,
    (route) => {
      const emoji = new URL(route.request().url()).searchParams.get('emoji') ?? ''
      const items = (byEmoji[emoji] ?? []).map((r) => ({ kind: 'HUMAN', ...r }))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
      })
    },
  )
}

async function setup(page: Page) {
  const channel = createChannel({ id: CHANNEL_ID, name: '반응자채널' })
  const msg = createMessage({
    id: MSG_ID,
    channelId: CHANNEL_ID,
    authorId: 2,
    authorName: '김민수',
    body: '배포 끝났습니다',
    reactions: [
      createReaction({ emoji: '👍', count: 5, reacted: true }),
      createReaction({ emoji: '🎉', count: 2, reacted: false }),
    ],
  })
  await stubChannelsList(page, [channel])
  await stubDmsList(page)
  // SSE 는 auth.fixture 기본의 '열린 채 유지되는' 스트림을 그대로 쓴다. 유한 본문으로 덮으면 1~2초마다 재연결되고,
  // 끊긴 구간이 800ms 를 넘을 때마다 재연결 배너가 켜졌다 꺼지며 화면을 밀어 칩이 마우스 밑에서 빠져 호버 카드가 닫힌다.
  await stubChannelDetail(page, channel)
  await stubMembers(page, CHANNEL_ID, [
    createChannelMember({ userId: ME_ID, name: '양동희' }),
    createChannelMember({ userId: 2, name: '김민수' }),
  ])
  await stubMessages(page, CHANNEL_ID, [msg])
  await stubReactors(page, {
    // 서버 목록에 나(1)도 포함 — 화면에선 "나" 행 하나만 보여야 한다.
    '👍': [
      { userId: 3, name: '이영희' },
      { userId: ME_ID, name: '양동희' },
      { userId: 4, name: '박지훈' },
      { userId: 5, name: '최수진' },
      { userId: 6, name: 'Genia', kind: 'AGENT' },
    ],
    '🎉': [
      { userId: 3, name: '이영희' },
      { userId: 4, name: '박지훈' },
    ],
  })
}

test.describe('WP-106 반응자 확인 — 데스크톱', () => {
  test('칩에 마우스를 올리면 그때 반응자를 불러와 요약을 보여준다', async ({ authenticatedPage: page }) => {
    await setup(page)
    const gets = trackRequests(page, 'GET', `/api/v1/messaging/messages/${MSG_ID}/reactions/users`)
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId(`reaction-pill-${MSG_ID}-👍`)).toBeVisible()
    // 목록 로딩만으로는 반응자 API 를 부르지 않는다(지연 로딩) — 잠깐 지켜봐도 요청이 없어야 한다.
    await expectStays(page, () => gets.count(), 0)

    await page.getByTestId(`reaction-pill-${MSG_ID}-👍`).hover()
    await expect(page.getByTestId(`reaction-hover-summary-${MSG_ID}`)).toHaveText(
      '나, 이영희, 박지훈 외 2명이 반응했습니다',
    )
    // 카드는 칩 아래로 열려 작성자·본문 줄을 가리지 않는다.
    const chip = (await page.getByTestId(`reaction-pill-${MSG_ID}-👍`).boundingBox())!
    const card = (await stableBox(page.getByTestId(`reaction-hover-${MSG_ID}`).locator('..')))
    expect(card.y).toBeGreaterThanOrEqual(chip.y + chip.height - 1)
    // 첫 카드가 완전히 닫힌 뒤 다른 칩으로 — 두 카드가 겹치는 구간(같은 testid 둘)을 피한다.
    await page.mouse.move(0, 0)
    await expect(page.getByTestId(`reaction-hover-${MSG_ID}`)).toHaveCount(0)
    // 받침 없는 마지막 이름 + 외 없음
    await page.getByTestId(`reaction-pill-${MSG_ID}-🎉`).hover()
    await expect(page.getByTestId(`reaction-hover-summary-${MSG_ID}`)).toHaveText('이영희, 박지훈이 반응했습니다')
  })

  test('모두 보기 → 누른 이모지 탭이 선택된 다이얼로그, 나는 한 번만, 탭 전환', async ({ authenticatedPage: page }) => {
    await setup(page)
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await page.getByTestId(`reaction-pill-${MSG_ID}-👍`).hover()
    await page.getByTestId(`reaction-hover-all-${MSG_ID}`).click()

    const dialog = page.getByTestId('reactors-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('reactors-tab-👍')).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByTestId('reactor-row-me')).toContainText('양동희')
    await expect(dialog.getByTestId(`reactor-row-${ME_ID}`)).toHaveCount(0)
    await expect(dialog.getByTestId('reactor-row-6')).toContainText('Genia')
    await expect(dialog.locator('[data-testid^="reactor-row-"]')).toHaveCount(5)
    // 폭은 sm 이상에서도 max-w-sm(24rem) — 기본 DialogContent 의 sm:max-w-lg 를 덮어야 한다.
    expect((await stableBox(dialog)).width).toBeLessThanOrEqual(384)

    await dialog.getByTestId('reactors-tab-🎉').click()
    await expect(dialog.getByTestId('reactors-tab-🎉')).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByTestId('reactor-row-me')).toHaveCount(0)
    await expect(dialog.locator('[data-testid^="reactor-row-"]')).toHaveCount(2)
  })

  test('반응자 조회가 실패하면 호버 카드에 스켈레톤 대신 실패 문구를 보여준다', async ({ authenticatedPage: page }) => {
    await setup(page)
    // 나중에 등록한 route 가 먼저 매칭된다 — setup 의 성공 stub 을 403 으로 덮는다(4xx 는 재시도하지 않음).
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}/reactions/users`,
      (route) =>
        route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'forbidden' }) }),
    )
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await page.getByTestId(`reaction-pill-${MSG_ID}-👍`).hover()
    await expect(page.getByTestId(`reaction-hover-error-${MSG_ID}`)).toHaveText('불러오지 못했습니다')
    await expect(page.getByLabel('반응한 사람 불러오는 중')).toHaveCount(0)
    // 모두 보기는 그대로 남는다(다이얼로그에서 다시 시도할 수 있게).
    await expect(page.getByTestId(`reaction-hover-all-${MSG_ID}`)).toBeVisible()
  })

  test('키보드만으로 툴바의 반응한 사람 보기 버튼에 도달해 전체 목록을 연다', async ({ authenticatedPage: page }) => {
    await setup(page)
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    const toolbar = page.getByTestId(`message-toolbar-${MSG_ID}`)
    await expect(toolbar).toHaveCSS('opacity', '0')
    // 행 안 툴바 첫 버튼(반응 추가)에 키보드 포커스 → 툴바가 드러나고 Tab 으로 다음 버튼에 간다.
    await page.getByTestId(`message-${MSG_ID}-react`).focus()
    await expect(toolbar).toHaveCSS('opacity', '1')
    await page.keyboard.press('Tab')
    const button = page.getByTestId(`message-reactors-${MSG_ID}`)
    await expect(button).toBeFocused()
    await expect(button).toHaveAccessibleName('반응한 사람 보기')
    await page.keyboard.press('Enter')

    const dialog = page.getByTestId('reactors-dialog')
    await expect(dialog).toBeVisible()
    // 첫 이모지 탭이 선택된 채 열린다.
    await expect(dialog.getByTestId('reactors-tab-👍')).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.locator('[data-testid^="reactor-row-"]')).toHaveCount(5)
  })

  test('반응이 없는 메시지의 툴바엔 반응한 사람 보기 버튼이 없다', async ({ authenticatedPage: page }) => {
    await setup(page)
    // 반응 없는 같은 id 메시지로 히스토리 stub 을 덮는다.
    await stubMessages(page, CHANNEL_ID, [
      createMessage({ id: MSG_ID, channelId: CHANNEL_ID, authorId: 2, authorName: '김민수', body: '반응 없음', reactions: [] }),
    ])
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await expect(page.getByTestId(`message-toolbar-${MSG_ID}`)).toHaveCount(1)
    await expect(page.getByTestId(`message-reactors-${MSG_ID}`)).toHaveCount(0)
  })

  test('칩 클릭은 여전히 토글이다(호버 카드가 있어도)', async ({ authenticatedPage: page }) => {
    await setup(page)
    const deletes = trackRequests(page, 'DELETE', `/api/v1/messaging/messages/${MSG_ID}/reactions`)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}/reactions`,
      (route) => (route.request().method() === 'DELETE' ? route.fulfill({ status: 204, body: '' }) : route.fallback()),
    )
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await page.getByTestId(`reaction-pill-${MSG_ID}-👍`).click()
    await deletes.waitFor()
    await expect(page.getByTestId(`reaction-count-${MSG_ID}-👍`)).toHaveText('4')
  })

  test('열린 동안 마지막 반응이 사라져 닫힌 다이얼로그는 나중에 반응이 달려도 저절로 다시 열리지 않는다', async ({
    authenticatedPage: page,
  }) => {
    const channel = createChannel({ id: CHANNEL_ID, name: '반응자채널' })
    const msg = createMessage({
      id: MSG_ID,
      channelId: CHANNEL_ID,
      authorId: 2,
      authorName: '김민수',
      body: '배포 끝났습니다',
      reactions: [createReaction({ emoji: '🎉', count: 1, reacted: false })],
    })
    await stubChannelsList(page, [channel])
    await stubDmsList(page)
    await stubChannelDetail(page, channel)
    await stubMembers(page, CHANNEL_ID, [createChannelMember({ userId: ME_ID, name: '양동희' })])
    await stubMessages(page, CHANNEL_ID, [msg])
    await stubReactors(page, { '🎉': [{ userId: 3, name: '이영희' }] })
    const posts = trackRequests(page, 'POST', `/api/v1/messaging/messages/${MSG_ID}/reactions`)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/messages/${MSG_ID}/reactions`,
      (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 204, body: '' }) : route.fallback()),
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    await page.getByTestId(`reaction-pill-${MSG_ID}-🎉`).hover()
    await page.getByTestId(`reaction-hover-all-${MSG_ID}`).click()
    const dialog = page.getByTestId('reactors-dialog')
    await expect(dialog).toBeVisible()

    // 다른 사람(3)이 마지막 반응을 거두면 반응이 0 이 되어 다이얼로그가 닫힌다.
    // 연결을 끊지 않고 이벤트를 밀어 넣는다 — 응답을 보류하는 mockGatedEvents 는 '연결 안 됨'이라 재연결 배너가 화면을 민다.
    await pushHeldEvents(
      page,
      `event: messaging.reaction.removed\n` +
        `data: ${JSON.stringify({ channelId: CHANNEL_ID, messageId: MSG_ID, emoji: '🎉', userId: 3 })}\n\n`,
    )
    await expect(page.getByTestId(`reaction-pill-${MSG_ID}-🎉`)).toHaveCount(0)
    await expect(dialog).toHaveCount(0)

    // 이후 같은 메시지에 반응이 다시 달려도 사용자가 열기 전에는 닫혀 있어야 한다.
    await page.getByTestId(`message-${MSG_ID}`).hover()
    await page.getByTestId(`message-${MSG_ID}-react`).click()
    await page.getByTestId(`message-${MSG_ID}-quick-👍`).click()
    await posts.waitFor()
    await expect(page.getByTestId(`reaction-pill-${MSG_ID}-👍`)).toBeVisible()
    await expectStays(page, () => dialog.count(), 0)
  })
})

// 넓은 화면의 터치 기기(태블릿 가로·터치 노트북)는 터치 셸이 아니라 호버 카드·길게 누르기 시트가 없다 —
// 행을 탭해 드러난 툴바의 버튼이 유일한 반응자 확인 경로다.
test.describe('WP-106 반응자 확인 — 넓은 터치 기기(터치 셸 아님)', () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } })

  test('행을 탭해 툴바를 드러내고 반응한 사람 보기를 탭하면 전체 목록 다이얼로그가 열린다', async ({
    authenticatedPage: page,
  }) => {
    await setup(page)
    await page.goto(`/chat/channels/${CHANNEL_ID}`)
    // 에뮬레이션이 coarse 포인터로 잡혀야 "넓은 터치 기기" 조건이 성립한다.
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)

    await page.getByTestId(`message-body-${MSG_ID}`).tap()
    await expect(page.getByTestId(`message-${MSG_ID}`)).toHaveAttribute('data-tap-active', 'true')
    await page.getByTestId(`message-reactors-${MSG_ID}`).tap()

    const dialog = page.getByTestId('reactors-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('reactors-tab-👍')).toHaveAttribute('aria-selected', 'true')
  })
})
