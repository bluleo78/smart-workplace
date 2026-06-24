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
    startsAt: '2026-07-05T14:00:00+09:00',
    endsAt: '2026-07-05T15:00:00+09:00',
    location: null,
    allDay: false,
    conflicts: [
      { id: 7, title: '기존 회의', startsAt: '2026-07-05T14:30:00+09:00', endsAt: '2026-07-05T15:30:00+09:00' },
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
  test(
    '일정 제안 카드: 충돌 배지 + 편집 후 승인 payload 검증',
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

      // 3. 제목 입력란 편집.
      await page.getByTestId(`event-proposal-title-${PROPOSAL_ID}`).fill('스프린트 리뷰(수정)')

      // 4. 승인 버튼 클릭 → confirm POST 호출.
      await page.getByTestId(`event-proposal-confirm-${PROPOSAL_ID}`).click()

      // 5. 승인 payload 에 편집된 제목이 실렸는지 검증.
      await expect.poll(() => confirmBody?.title).toBe('스프린트 리뷰(수정)')
      // startsAt 은 toOffsetIso 변환 결과(문자열)여야 한다 — 정확한 값 대신 truthy 만 검증.
      // non-null 단언 — 위 poll 이 통과했으면 confirmBody 는 반드시 채워져 있다.
      expect((confirmBody as unknown as Record<string, unknown>).startsAt).toBeTruthy()
    },
  )
})
