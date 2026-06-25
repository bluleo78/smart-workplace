// 채팅 일정 제안 카드 E2E — calendar.create_event 카드 렌더 + 위임자 편집 + 승인 payload(override) 검증.
// 백엔드 없이 page.route() 로 모킹. channel-proposal.spec.ts 패턴 미러.

import { expect, test } from '../fixtures/auth.fixture'
import { createChannel, createMessage } from '../factories/messaging.factory'
import type { MessageProposal } from '../../src/types/messaging'

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

      // confirm 요청 가로채기 — payload(override) 검증 + CONFIRMED 카드 반환.
      let confirmBody: Record<string, unknown> | null = null
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/proposals/${PROPOSAL_ID}/confirm`,
        async (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          confirmBody = route.request().postDataJSON() as Record<string, unknown>
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

      // 4. 제목만 편집(시간은 그대로) → 승인 round-trip 으로 instant 보존 확인.
      await page.getByTestId(`event-proposal-title-${PROPOSAL_ID}`).fill('스프린트 리뷰(수정)')

      // 5. 승인 버튼 클릭 → confirm POST 호출.
      await page.getByTestId(`event-proposal-confirm-${PROPOSAL_ID}`).click()

      // 6. 승인 payload: 편집된 제목 + 시간은 원본 instant 그대로(KST 표시 → toOffsetIso → UTC 복원).
      await expect.poll(() => confirmBody?.title).toBe('스프린트 리뷰(수정)')
      // 표시값 15:00 KST 를 미수정 승인 → 06:00Z 로 복원(input == output instant). 0.000 밀리초 포함.
      expect((confirmBody as unknown as Record<string, unknown>).startsAt).toBe('2026-07-05T06:00:00.000Z')
      expect((confirmBody as unknown as Record<string, unknown>).endsAt).toBe('2026-07-05T07:00:00.000Z')
    },
  )

  test(
    '비위임자 읽기전용 뷰도 UTC payload 를 KST 로 표시한다',
    async ({ authenticatedPage: page }) => {
      const channel = createChannel({ id: CHANNEL_ID, member: true })
      await setupChannelStubs(page, channel)
      await stubMembers(page)

      // proposedByUserId=2(≠ME) → 비위임자 → 읽기전용 "확인 대기 중" 블록(편집 폼 아님).
      const proposalMessage = createMessage({
        id: 301,
        channelId: CHANNEL_ID,
        authorId: 99,
        authorName: 'AI 어시스턴트',
        authorKind: 'AGENT',
        body: '💡 일정 생성을 제안했어요',
        proposal: { ...makeEventProposal(), proposedByUserId: 2 },
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

      // 읽기전용 블록(별도 표시 지점)도 06:00Z/07:00Z → KST 15:00 ~ 16:00. 버그면 '06:00' 이 떠 실패.
      await expect(page.getByTestId(`event-proposal-pending-${PROPOSAL_ID}`)).toContainText(
        '2026-07-05 15:00 ~ 16:00',
      )
    },
  )
})
