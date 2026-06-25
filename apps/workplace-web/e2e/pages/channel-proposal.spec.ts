// L3 위임 확인 카드 E2E — 제안 카드 렌더 + 위임자 승인/거부 버튼 + 비위임자 대기 표시.
// 백엔드 없이 page.route() 로 모킹. channel-catchup.spec.ts 의 setupChannelStubs 패턴 미러.

import { expect, test } from '../fixtures/auth.fixture'
import { createChannel, createMessage } from '../factories/messaging.factory'
import type { MessageProposal } from '../../src/types/messaging'

const CHANNEL_ID = 9
const PROPOSAL_ID = 55

// 테스트용 제안 객체 — proposedByUserId 는 각 테스트에서 주입.
function makeProposal(proposedByUserId: number): MessageProposal {
  return {
    id: PROPOSAL_ID,
    proposedByUserId,
    actionType: 'CREATE_ISSUE',
    status: 'PENDING',
    title: '로그인 버그',
    priority: 'HIGH',
    projectName: 'Smart Workplace',
    projectKey: null,
    candidates: [],
    resultIssueKey: null,
    // 일정 전용 필드 — 이슈 제안이므로 모두 비어 있음(#490 MessageProposal 확장).
    startsAt: null,
    endsAt: null,
    location: null,
    allDay: null,
    conflicts: null,
  }
}

// 후보 프로젝트 2개 포함 제안 — 드롭다운 테스트용.
function makeProposalWithCandidates(proposedByUserId: number): MessageProposal {
  return {
    id: PROPOSAL_ID,
    proposedByUserId,
    actionType: 'CREATE_ISSUE',
    status: 'PENDING',
    title: '로그인 버그',
    priority: 'HIGH',
    projectName: '개인 작업',
    projectKey: 'P1',
    candidates: [
      { key: 'P1', name: '개인 작업' },
      { key: 'DESIGN', name: '디자인팀' },
    ],
    resultIssueKey: null,
    // 일정 전용 필드 — 이슈 제안이므로 모두 비어 있음(#490 MessageProposal 확장).
    startsAt: null,
    endsAt: null,
    location: null,
    allDay: null,
    conflicts: null,
  }
}

// 채널 목록/상세/SSE 공통 모킹.
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

// 채널 멤버 목록 모킹(빈 응답 — 멘션 후보 로드용).
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

// 메시지 목록 모킹 — proposal 이 붙은 AGENT 메시지 포함.
async function stubMessagesWithProposal(
  page: import('@playwright/test').Page,
  proposedByUserId: number,
) {
  const proposalMessage = createMessage({
    id: 200,
    channelId: CHANNEL_ID,
    authorId: 99,
    authorName: 'AI 어시스턴트',
    authorKind: 'AGENT',
    body: '이슈 생성을 제안합니다.',
    proposal: makeProposal(proposedByUserId),
  })
  const normalMessage = createMessage({
    id: 199,
    channelId: CHANNEL_ID,
    body: '일반 메시지',
  })
  // DESC 정렬로 반환(최신→오래된).
  const items = [proposalMessage, normalMessage]
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
      })
    },
  )
}

// 메시지 목록 모킹 — 후보 프로젝트 2개를 가진 proposal 포함.
async function stubMessagesWithCandidateProposal(
  page: import('@playwright/test').Page,
  proposedByUserId: number,
) {
  const proposalMessage = createMessage({
    id: 200,
    channelId: CHANNEL_ID,
    authorId: 99,
    authorName: 'AI 어시스턴트',
    authorKind: 'AGENT',
    body: '이슈 생성을 제안합니다.',
    proposal: makeProposalWithCandidates(proposedByUserId),
  })
  const normalMessage = createMessage({ id: 199, channelId: CHANNEL_ID, body: '일반 메시지' })
  const items = [proposalMessage, normalMessage]
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${CHANNEL_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items, nextCursor: null, hasMore: false }),
      })
    },
  )
}

test.describe('L3 위임 확인 카드', () => {
  test(
    '제안 카드: 위임자는 제목·프로젝트·우선순위 + 승인/거부 버튼이 보이고 승인 시 confirm 엔드포인트 호출',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // auth fixture 의 로그인 사용자 id = 1 (createUser() 기본값).
      // proposedByUserId = 1 → 위임자(delegator) 시나리오.
      const DELEGATOR_USER_ID = 1
      const channel = createChannel({ id: CHANNEL_ID, member: true })
      await setupChannelStubs(page, channel)
      await stubMembers(page)
      await stubMessagesWithProposal(page, DELEGATOR_USER_ID)

      // 승인 POST 호출 여부 추적.
      let confirmCalled = false
      // 승인 후 반환될 갱신 카드(status CONFIRMED).
      const confirmedMessage = createMessage({
        id: 200,
        channelId: CHANNEL_ID,
        authorId: 99,
        authorName: 'AI 어시스턴트',
        authorKind: 'AGENT',
        body: '이슈 생성을 제안합니다.',
        proposal: {
          ...makeProposal(DELEGATOR_USER_ID),
          status: 'CONFIRMED',
          resultIssueKey: 'SWP-42',
        },
      })
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/proposals/${PROPOSAL_ID}/confirm`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          confirmCalled = true
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(confirmedMessage),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      // 카드가 렌더되고 제목·프로젝트·우선순위가 표시된다.
      await expect(page.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toBeVisible()
      await expect(page.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toContainText('로그인 버그')
      await expect(page.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toContainText('Smart Workplace')
      await expect(page.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toContainText('HIGH')
      // AI 배지 — 🤖 이모지에서 Bot lucide 아이콘으로 변경(SVG는 텍스트 미포함).
      await expect(page.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toContainText('담당: AI')

      // 위임자에게 승인/거부 버튼이 보인다.
      await expect(page.getByTestId(`proposal-confirm-${PROPOSAL_ID}`)).toBeVisible()
      await expect(page.getByTestId(`proposal-reject-${PROPOSAL_ID}`)).toBeVisible()

      // 대기 표시는 없다(위임자는 버튼이 대신 뜸).
      await expect(page.getByTestId(`proposal-pending-${PROPOSAL_ID}`)).toHaveCount(0)

      // 승인 클릭 → POST /messaging/proposals/{id}/confirm 호출.
      await page.getByTestId(`proposal-confirm-${PROPOSAL_ID}`).click()
      await expect.poll(() => confirmCalled).toBe(true)
    },
  )

  test(
    '제안 카드: 비위임자는 버튼 대신 "확인 대기 중" 표시만 보인다',
    async ({ authenticatedPage: page }) => {
      // proposedByUserId = 99 → 로그인 사용자(id=1)와 다른 사람이 요청한 제안 → 비위임자.
      const OTHER_USER_ID = 99
      const channel = createChannel({ id: CHANNEL_ID, member: true })
      await setupChannelStubs(page, channel)
      await stubMembers(page)
      await stubMessagesWithProposal(page, OTHER_USER_ID)

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      // 카드 렌더 확인.
      await expect(page.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toBeVisible()
      await expect(page.getByTestId(`proposal-card-${PROPOSAL_ID}`)).toContainText('로그인 버그')

      // 비위임자에게는 버튼 없고 대기 표시만.
      await expect(page.getByTestId(`proposal-pending-${PROPOSAL_ID}`)).toBeVisible()
      await expect(page.getByTestId(`proposal-confirm-${PROPOSAL_ID}`)).toHaveCount(0)
      await expect(page.getByTestId(`proposal-reject-${PROPOSAL_ID}`)).toHaveCount(0)
    },
  )

  test(
    '제안 카드: 거부 버튼 클릭 시 reject 엔드포인트 호출',
    async ({ authenticatedPage: page }) => {
      const DELEGATOR_USER_ID = 1
      const channel = createChannel({ id: CHANNEL_ID, member: true })
      await setupChannelStubs(page, channel)
      await stubMembers(page)
      await stubMessagesWithProposal(page, DELEGATOR_USER_ID)

      let rejectCalled = false
      const rejectedMessage = createMessage({
        id: 200,
        channelId: CHANNEL_ID,
        authorKind: 'AGENT',
        proposal: {
          ...makeProposal(DELEGATOR_USER_ID),
          status: 'REJECTED',
        },
      })
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/proposals/${PROPOSAL_ID}/reject`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          rejectCalled = true
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(rejectedMessage),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      await expect(page.getByTestId(`proposal-reject-${PROPOSAL_ID}`)).toBeVisible()
      await page.getByTestId(`proposal-reject-${PROPOSAL_ID}`).click()
      await expect.poll(() => rejectCalled).toBe(true)
    },
  )

  test(
    '제안 카드: 프로젝트 드롭다운 변경 후 승인 시 projectKey 전달',
    async ({ authenticatedPage: page }) => {
      // proposedByUserId = 1 → 위임자(delegator). candidates 2개.
      const DELEGATOR_USER_ID = 1
      const channel = createChannel({ id: CHANNEL_ID, member: true })
      await setupChannelStubs(page, channel)
      await stubMembers(page)
      await stubMessagesWithCandidateProposal(page, DELEGATOR_USER_ID)

      // 승인 POST body 캡처.
      let body: Record<string, unknown> | null = null
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/proposals/${PROPOSAL_ID}/confirm`,
        (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          body = route.request().postDataJSON() as Record<string, unknown>
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              createMessage({
                id: 200,
                channelId: CHANNEL_ID,
                authorKind: 'AGENT',
                proposal: { ...makeProposalWithCandidates(DELEGATOR_USER_ID), status: 'CONFIRMED', resultIssueKey: 'DESIGN-1' },
              }),
            ),
          })
        },
      )

      await page.goto(`/chat/channels/${CHANNEL_ID}`)

      // 드롭다운(SelectTrigger)이 렌더된다.
      await expect(page.getByTestId(`proposal-project-${PROPOSAL_ID}`)).toBeVisible()

      // 드롭다운에서 '디자인팀' 선택.
      await page.getByTestId(`proposal-project-${PROPOSAL_ID}`).click()
      await page.getByRole('option', { name: '디자인팀' }).click()

      // 승인 클릭 → confirm 호출 시 body 에 projectKey:'DESIGN' 포함.
      await page.getByTestId(`proposal-confirm-${PROPOSAL_ID}`).click()
      await expect.poll(() => body).toEqual({ projectKey: 'DESIGN' })
    },
  )
})
