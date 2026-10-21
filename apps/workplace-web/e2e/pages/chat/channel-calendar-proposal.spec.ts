// 채팅 일정 제안 카드 E2E — calendar.create_event 카드 렌더 + 위임자 편집 + 승인 payload(override) 검증.
// 백엔드 없이 page.route() 로 모킹. channel-proposal.spec.ts 패턴 미러.

import { expect, test } from '../../fixtures/auth.fixture'
import { createChannel, createMessage } from '../../factories/messaging.factory'
import type { MessageProposal } from '../../../src/types/messaging'
import { trackRequests } from '../../fixtures/requests'

const CHANNEL_ID = 9
const PROPOSAL_ID = 77
// auth.fixture 가 주입하는 로그인 사용자 id = 1 (createUser() 기본값).
// proposedByUserId = 1 → 위임자(delegator) 시나리오 → 편집 폼 노출.
const ME = 1

/** 일정 생성 제안 객체 — 충돌 1건 포함. */
function makeEventProposal(): MessageProposal {
  return {
    id: PROPOSAL_ID,
    proposedByUserId: ME,
    actionType: 'calendar.create_event',
    status: 'PENDING',
    title: '스프린트 리뷰',
    priority: null,
    projectName: null,
    projectKey: null,
    candidates: [],
    resultIssueKey: null,
    // ⭐백엔드는 일정 instant 를 UTC('Z')로 저장한다(DB message_action_proposal.payload 확인).
    // 06:00Z == 15:00 KST(오후 3시), 07:00Z == 16:00 KST. 카드는 KST 로 변환해 표시해야 한다.
    startsAt: '2026-07-05T06:00:00Z',
    endsAt: '2026-07-05T07:00:00Z',
    location: null,
    allDay: false,
    conflicts: [
      { id: 7, title: '기존 회의', startsAt: '2026-07-05T06:30:00Z', endsAt: '2026-07-05T07:30:00Z' },
    ],
    attendees: null,
  }
}

// channel-proposal.spec.ts 의 setupChannelStubs 인라인 복제.
// 채널 목록·상세·SSE 공통 모킹.
async function setupChannelStubs(
  page: import('@playwright/test').Page,
  channel: ReturnType<typeof createChannel>,
) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([channel]),
      })
    },
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(channel),
      })
    },
  )
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

// 채널 멤버 목록 모킹 — 멘션 후보 로드용(빈 응답).
async function stubMembers(page: import('@playwright/test').Page) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/members`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      })
    },
  )
}

test.describe('채팅 일정 제안 카드', () => {
  // ⭐타임존 고정 — 시각 변환은 브라우저 로컬 기준이라, 핀하지 않으면 UTC 호스트에서
  // 버그(나이브 slice)와 수정(로컬 변환)이 같은 06:00 을 내 red/green 구분이 불가능하다.
  test.use({ timezoneId: 'Asia/Seoul' })

  test(
    '일정 제안 카드: UTC payload 를 KST 로 표시 + 충돌 배지 + 승인 시 instant 보존',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const channel = createChannel({ id: CHANNEL_ID, member: true })
      await setupChannelStubs(page, channel)
      await stubMembers(page)

      // AGENT 메시지에 일정 제안 첨부.
      const proposalMessage = createMessage({
        id: 300,
        channelId: CHANNEL_ID,
        authorId: 99,
        authorName: 'AI 어시스턴트',
        authorKind: 'AGENT',
        body: '💡 일정 생성을 제안했어요',
        proposal: makeEventProposal(),
      })
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback()
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [proposalMessage], nextCursor: null, hasMore: false }),
          })
        },
      )

      // confirm 요청 — CONFIRMED 카드 반환.
      const confirms = trackRequests(page, 'POST', `/api/v1/messaging/proposals/${PROPOSAL_ID}/confirm`)
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/proposals/${PROPOSAL_ID}/confirm`,
        async (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          const confirmed = { ...makeEventProposal(), status: 'CONFIRMED', resultIssueKey: 'event:501' }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...proposalMessage, proposal: confirmed }),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      // 1. 카드 렌더 확인.
      await expect(page.getByTestId(`event-proposal-card-${PROPOSAL_ID}`)).toBeVisible()

      // 2. 충돌 배지 노출 — '충돌 1건' 텍스트 포함(exact=false).
      await expect(page.getByTestId(`event-proposal-conflicts-${PROPOSAL_ID}`)).toContainText('충돌 1건')

      // 3. ⭐핵심 회귀: UTC payload(06:00Z/07:00Z)가 datetime-local 입력에 KST(15:00/16:00)로 표시돼야 한다.
      //    버그(나이브 slice)면 06:00/07:00 이 그대로 떠 실패한다.
      await expect(page.getByTestId(`event-proposal-starts-${PROPOSAL_ID}`)).toHaveValue('2026-07-05T15:00')
      await expect(page.getByTestId(`event-proposal-ends-${PROPOSAL_ID}`)).toHaveValue('2026-07-05T16:00')

      // WP-687: 제목·장소는 서버 상한(200자)에서 더 입력되지 않는다.
      await page.getByTestId(`event-proposal-title-${PROPOSAL_ID}`).fill('가'.repeat(201))
      await expect(page.getByTestId(`event-proposal-title-${PROPOSAL_ID}`)).toHaveValue('가'.repeat(200))
      const location = page.getByTestId(`event-proposal-location-${PROPOSAL_ID}`)
      const originalLocation = await location.inputValue()
      await location.fill('나'.repeat(201))
      await expect(location).toHaveValue('나'.repeat(200))
      await location.fill(originalLocation)

      // 4. 제목만 편집(시간은 그대로) → 승인 round-trip 으로 instant 보존 확인.
      await page.getByTestId(`event-proposal-title-${PROPOSAL_ID}`).fill('스프린트 리뷰(수정)')

      // 5. 승인 버튼 클릭 → confirm POST 호출.
      await page.getByTestId(`event-proposal-confirm-${PROPOSAL_ID}`).click()

      // 6. 승인 payload: 편집된 제목 + 시간은 원본 instant 그대로(KST 표시 → toOffsetIso → UTC 복원).
      await confirms.waitFor()
      const confirmBody = confirms.lastBody<Record<string, unknown>>()
      expect(confirmBody?.title).toBe('스프린트 리뷰(수정)')
      // 표시값 15:00 KST 를 미수정 승인 → 06:00Z 로 복원(input == output instant). 0.000 밀리초 포함.
      expect(confirmBody?.startsAt).toBe('2026-07-05T06:00:00.000Z')
      expect(confirmBody?.endsAt).toBe('2026-07-05T07:00:00.000Z')
    },
  )

  test('종료를 시작보다 앞으로 고치면 안내가 뜨고 승인이 막힌다 (WP-727)', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true })
    await setupChannelStubs(page, channel)
    await stubMembers(page)
    const proposalMessage = createMessage({
      id: 301,
      channelId: CHANNEL_ID,
      authorId: 99,
      authorName: 'AI 어시스턴트',
      authorKind: 'AGENT',
      body: '💡 일정 생성을 제안했어요',
      proposal: makeEventProposal(),
    })
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [proposalMessage], nextCursor: null, hasMore: false }),
            })
          : route.fallback(),
    )
    const confirms = trackRequests(page, 'POST', `/api/v1/messaging/proposals/${PROPOSAL_ID}/confirm`)
    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    const ends = page.getByTestId(`event-proposal-ends-${PROPOSAL_ID}`)
    const confirm = page.getByTestId(`event-proposal-confirm-${PROPOSAL_ID}`)
    await expect(confirm).toBeEnabled()
    // 시작 15:00 인데 종료를 14:30 으로 — 안내가 뜨고 승인 버튼이 꺼진다
    await ends.fill('2026-07-05T14:30')
    await expect(page.getByTestId(`event-proposal-range-error-${PROPOSAL_ID}`)).toHaveText('종료는 시작보다 뒤여야 합니다')
    await expect(ends).toHaveAttribute('aria-invalid', 'true')
    await expect(confirm).toBeDisabled()
    // 같은 시각도 막는다
    await ends.fill('2026-07-05T15:00')
    await expect(confirm).toBeDisabled()
    // 고치면 안내가 사라지고 다시 승인할 수 있다
    await ends.fill('2026-07-05T16:30')
    await expect(page.getByTestId(`event-proposal-range-error-${PROPOSAL_ID}`)).toHaveCount(0)
    await expect(confirm).toBeEnabled()
    expect(confirms.count()).toBe(0)
  })

  // 비위임자 읽기전용(확인 대기) 블록의 UTC→KST 시간 표시는 calendar.test(proposalTimeRange)가 지킨다.

  // #852: 승인하면 그대로 초대되므로 위임자·비위임자·확정 후 모두 누구를 부르는지 보여야 한다. 참석자 없는 카드엔 줄이 없다.
  test('초대 참석자를 편집·대기·확정 세 상태 모두에 표시한다', async ({ authenticatedPage: page }) => {
    const channel = createChannel({ id: CHANNEL_ID, member: true })
    await setupChannelStubs(page, channel)
    await stubMembers(page)

    // 실데이터처럼 긴 이름·여러 명 — 카드 폭 넘침(가로 스크롤) 회귀까지 같이 본다.
    const attendees = [
      { userId: 5, name: '김민수(플랫폼개발팀 백엔드 파트장)' },
      { userId: 6, name: '이지영(Product Design · UX Research)' },
      { userId: 8, name: 'Alexander Montgomery-Wellington' },
    ]
    const withAttendees = (id: number, extra: Partial<MessageProposal>): MessageProposal => ({
      ...makeEventProposal(),
      id,
      conflicts: null,
      attendees,
      ...extra,
    })
    const messages = [
      withAttendees(81, {}), // 위임자 편집 폼
      withAttendees(82, { proposedByUserId: 2 }), // 비위임자 대기
      withAttendees(83, { status: 'CONFIRMED', resultIssueKey: 'event:501' }), // 확정
      { ...makeEventProposal(), id: 84, conflicts: null, attendees: null }, // 참석자 없음
    ].map((proposal, idx) =>
      createMessage({
        id: 400 + idx,
        channelId: CHANNEL_ID,
        authorId: 99,
        authorName: 'AI 어시스턴트',
        authorKind: 'AGENT',
        body: '💡 일정 생성을 제안했어요',
        proposal,
      }),
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: messages, nextCursor: null, hasMore: false }),
        })
      },
    )

    await page.goto(`/chat/channels/${CHANNEL_ID}`)

    for (const id of [81, 82, 83]) {
      const line = page.getByTestId(`event-proposal-attendees-${id}`)
      await expect(line).toContainText('김민수(플랫폼개발팀 백엔드 파트장), 이지영(Product Design · UX Research)')
      await expect(line).toContainText('Alexander Montgomery-Wellington')
      // 긴 이름이 카드 밖으로 넘치지 않는다(줄바꿈).
      const card = page.getByTestId(`event-proposal-card-${id}`)
      const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    }
    await expect(page.getByTestId('event-proposal-card-84')).toBeVisible()
    await expect(page.getByTestId('event-proposal-attendees-84')).toHaveCount(0)
  })
})

// WP-593: 시작·종료 칸 배치 — 카드 폭이 좁으면(모바일 390) 세로로 쌓아 칸마다 시각까지 보이게, 넓으면(데스크톱) 한 줄에 나란히.
// 칸 안 글자가 잘렸는지는 브라우저가 그리는 datetime-local 내부라 직접 볼 수 없어, 칸 폭·위치(기하)로 지킨다.
async function openPendingEventProposal(page: import('@playwright/test').Page) {
  const channel = createChannel({ id: CHANNEL_ID, member: true })
  await setupChannelStubs(page, channel)
  await stubMembers(page)
  const proposalMessage = createMessage({
    id: 300,
    channelId: CHANNEL_ID,
    authorId: 99,
    authorName: 'AI 어시스턴트',
    authorKind: 'AGENT',
    body: '💡 일정 생성을 제안했어요',
    proposal: makeEventProposal(),
  })
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [proposalMessage], nextCursor: null, hasMore: false }),
      })
    },
  )
  await page.goto(`/chat/channels/${CHANNEL_ID}`)
  const starts = page.getByTestId(`event-proposal-starts-${PROPOSAL_ID}`)
  const ends = page.getByTestId(`event-proposal-ends-${PROPOSAL_ID}`)
  await expect(starts).toBeVisible()
  return { starts: (await starts.boundingBox())!, ends: (await ends.boundingBox())! }
}

test.describe('일정 제안 카드 시작·종료 칸 배치(WP-593)', () => {
  test.describe('모바일 390', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('시작·종료를 세로로 쌓고 칸마다 날짜·시각이 들어갈 폭을 준다', async ({ authenticatedPage: page }) => {
      const { starts, ends } = await openPendingEventProposal(page)
      // 종료 칸이 시작 칸 아래 — 한 줄에 반씩 놓이면 날짜만 보이고 시각이 잘린다.
      expect(ends.y).toBeGreaterThanOrEqual(starts.y + starts.height - 1)
      // 「2026. 07. 05. 오후 03:00」 이 다 들어갈 폭(반씩 놓였을 때는 약 130px 이었다).
      expect(starts.width).toBeGreaterThanOrEqual(220)
      expect(ends.width).toBeGreaterThanOrEqual(220)
    })
  })

  test.describe('데스크톱 1440', () => {
    test.use({ viewport: { width: 1440, height: 900 } })
    test('넓은 카드에서는 시작·종료를 한 줄에 나란히 둔다', async ({ authenticatedPage: page }) => {
      const { starts, ends } = await openPendingEventProposal(page)
      expect(Math.abs(ends.y - starts.y)).toBeLessThanOrEqual(1)
      expect(ends.x).toBeGreaterThan(starts.x + starts.width - 1)
    })
  })
})
