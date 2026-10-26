// 채팅 일정 제안 카드 E2E — 참석자 칩 넘침과 시작·종료 칸 배치처럼 실제 폭에서만 잴 수 있는 것(@layout)만 남긴다.
// KST 표시·충돌 배지·승인 payload·종료<시작 안내는 vitest 로 옮겼다(WP-984): src/pages/chat/channelPage.test.tsx.
// 백엔드 없이 page.route() 로 모킹.

import { expect, test } from '../../fixtures/auth.fixture'
import { createChannel, createMessage } from '../../factories/messaging.factory'
import type { MessageProposal } from '../../../src/types/messaging'

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

  // 비위임자 읽기전용(확인 대기) 블록의 UTC→KST 시간 표시는 calendar.test(proposalTimeRange)가 지킨다.

  // #852: 승인하면 그대로 초대되므로 위임자·비위임자·확정 후 모두 누구를 부르는지 보여야 한다. 참석자 없는 카드엔 줄이 없다.
  test('초대 참석자를 편집·대기·확정 세 상태 모두에 표시한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

test.describe('일정 제안 카드 시작·종료 칸 배치(WP-593)', { tag: '@layout' }, () => {
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
