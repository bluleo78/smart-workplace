// messaging 인라인 compose + self-DM E2E
// (A) MemberSearchPopover 가 본인(id=1)을 결과에서 제외하는지 검증 (클라이언트 측 필터).
// (B) /chat/new 에서 수신자 선택 → 메시지 전송 → DM 페이지 이동 happy path.
// (C) 사이드바 self-DM 링크 레이블 + /chat/dms/self 클릭 → POST {userIds:[1]} → DM 페이지 이동.
// 백엔드 없이 page.route() 모킹.
import type { Page } from '@playwright/test'

import { createDm, createDmParticipant, createMessage } from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

// auth.fixture createUser() 기본 id=1, name='테스트 사용자'.
const MY_ID = 1
const MY_NAME = '테스트 사용자'

// ── stub helpers ──────────────────────────────────────────────────────────────

/** 채널 목록 + DM 목록(GET) + SSE 스트림 stub. DM POST 는 stub 불포함 — 각 테스트에서 별도 처리. */
async function stubSidebarLists(page: Page, dms: ReturnType<typeof createDm>[] = []) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/dms',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(dms),
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

/** 사용자 검색 stub — 전달한 users 리스트 그대로 반환. */
async function stubUserSearch(
  page: Page,
  users: { id: number; name: string; username: string; kind: string }[],
) {
  await page.route(
    (url) => url.pathname === '/api/v1/users',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: users, totalElements: users.length }),
      }),
  )
}

// ── test suite ─────────────────────────────────────────────────────────────────

test.describe('messaging 인라인 compose + self-DM', () => {
  // (A) MemberSearchPopover 자기 자신 제외 검증
  test(
    '피커가 본인(id=1)을 검색 결과에서 제외한다',
    async ({ authenticatedPage: page }) => {
      await stubSidebarLists(page)
      // API 응답에 본인(id=1)과 타인(id=2)을 함께 반환 → 컴포넌트의 excludeUserIds 필터 확인.
      await stubUserSearch(page, [
        { id: MY_ID, name: MY_NAME, username: 'testuser', kind: 'HUMAN' },
        { id: 2, name: '밥', username: 'bob', kind: 'HUMAN' },
      ])

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()
      await page.getByTestId('new-message-add-recipient').click()
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('사용자')

      // 본인 row 는 렌더되지 않아야 한다.
      await expect(page.getByTestId(`member-search-row-${MY_ID}`)).toHaveCount(0)
      // 타인 row 는 렌더된다.
      await expect(page.getByTestId('member-search-row-2')).toBeVisible()
    },
  )

  // (B) 인라인 compose happy path
  test(
    '수신자 선택 → 메시지 전송 → DM 페이지 이동',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const DM_ID = 200
      const dm = createDm({
        id: DM_ID,
        participants: [
          createDmParticipant({ userId: MY_ID, name: MY_NAME }),
          createDmParticipant({ userId: 2, name: '밥' }),
        ],
      })

      await stubSidebarLists(page)
      await stubUserSearch(page, [{ id: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])

      // DM find-or-create POST 캡처 후 DM 반환. 이후 GET /dms 도 dm 포함으로 교체.
      let capturedDmsPayload: { userIds: number[] } | null = null
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/dms',
        (route) => {
          const m = route.request().method()
          if (m === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(capturedDmsPayload ? [dm] : []),
            })
          }
          if (m === 'POST') {
            capturedDmsPayload = route.request().postDataJSON() as { userIds: number[] }
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify(dm),
            })
          }
          return route.fallback()
        },
      )

      // 첫 메시지 POST 캡처
      let capturedMsgPayload: { body: string } | null = null
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/messages`,
        (route) => {
          const m = route.request().method()
          if (m === 'POST') {
            capturedMsgPayload = route.request().postDataJSON() as { body: string }
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify(createMessage({ id: 10, channelId: DM_ID, authorId: MY_ID, body: '안녕' })),
            })
          }
          if (m === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
            })
          }
          return route.fallback()
        },
      )
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/read`,
        (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({ status: 204, body: '' })
            : route.fallback(),
      )

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()

      // 수신자 선택
      await page.getByTestId('new-message-add-recipient').click()
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
      await page.getByTestId('member-search-row-2').click()
      await expect(page.getByTestId('recipient-chip-2')).toBeVisible()

      // 메시지 작성 + 전송
      await page.getByTestId('message-composer-input').click()
      await page.keyboard.type('안녕')
      await page.keyboard.press('Enter')

      // POST /messaging/dms payload 검증
      await expect.poll(() => capturedDmsPayload).toEqual({ userIds: [2] })
      // POST /messaging/channels/{id}/messages payload 검증
      await expect.poll(() => capturedMsgPayload?.body).toBe('안녕')

      // DM 페이지로 이동
      await expect(page).toHaveURL(new RegExp(`/chat/dms/${DM_ID}$`))
      await expect(page.getByTestId('dm-title')).toHaveText('밥')
    },
  )

  // (D) 회귀: /chat/new 수신자 미선택 상태에서 "보관됨" 오표시 금지 (#118)
  test(
    '수신자 미선택 시 "이 채널은 보관되었습니다" 가 표시되지 않는다',
    async ({ authenticatedPage: page }) => {
      await stubSidebarLists(page)
      await stubUserSearch(page, [{ id: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()

      // 초기(수신자 0): 빈 상태 안내만, "보관됨" 오표시 없음, 입력기도 미마운트.
      await expect(page.getByText('받는 사람을 추가하면 대화를 시작할 수 있어요.')).toBeVisible()
      await expect(page.getByText('이 채널은 보관되었습니다')).toHaveCount(0)
      await expect(page.getByTestId('message-composer-input')).toHaveCount(0)

      // 수신자 1명 추가 → 입력기 정상 노출, 여전히 "보관됨" 문구 없음.
      await page.getByTestId('new-message-add-recipient').click()
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
      await page.getByTestId('member-search-row-2').click()
      await expect(page.getByTestId('recipient-chip-2')).toBeVisible()
      await expect(page.getByTestId('message-composer-input')).toBeVisible()
      await expect(page.getByText('이 채널은 보관되었습니다')).toHaveCount(0)
    },
  )

  // (E) 회귀: 수신자 칩 X 버튼 클릭 → 칩 제거 (#314)
  test(
    '수신자 칩 X 버튼을 클릭하면 해당 칩이 제거된다',
    async ({ authenticatedPage: page }) => {
      await stubSidebarLists(page)
      await stubUserSearch(page, [{ id: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()

      // 수신자 추가
      await page.getByTestId('new-message-add-recipient').click()
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
      await page.getByTestId('member-search-row-2').click()
      const chip = page.getByTestId('recipient-chip-2')
      await expect(chip).toBeVisible()

      // X 버튼 hover → 상태 확인 (disabled가 아닌 interactive 버튼인지)
      const removeBtn = chip.getByRole('button', { name: '밥 제거' })
      await expect(removeBtn).toBeVisible()
      await expect(removeBtn).toBeEnabled()

      // X 클릭 → 칩 사라짐
      await removeBtn.click()
      await expect(chip).toHaveCount(0)
    },
  )

  // (C) self-DM 사이드바 링크 + redirect
  test(
    'self-DM 링크 레이블이 "테스트 사용자 (나)"이고 클릭 시 POST {userIds:[1]} → DM 이동',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const SELF_DM_ID = 300
      const selfDm = createDm({
        id: SELF_DM_ID,
        participants: [createDmParticipant({ userId: MY_ID, name: MY_NAME })],
      })

      await stubSidebarLists(page)

      // SelfDmRedirect 가 POST /messaging/dms {userIds:[myId]} 를 호출한다.
      let capturedSelfPayload: { userIds: number[] } | null = null
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/dms',
        (route) => {
          const m = route.request().method()
          if (m === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(capturedSelfPayload ? [selfDm] : []),
            })
          }
          if (m === 'POST') {
            capturedSelfPayload = route.request().postDataJSON() as { userIds: number[] }
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify(selfDm),
            })
          }
          return route.fallback()
        },
      )
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${SELF_DM_ID}/messages`,
        (route) =>
          route.request().method() === 'GET'
            ? route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
              })
            : route.fallback(),
      )
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${SELF_DM_ID}/read`,
        (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({ status: 204, body: '' })
            : route.fallback(),
      )

      await page.goto('/chat')

      // 사이드바 self-DM 링크 텍스트 검증
      // (#298) 링크 앞에 본인 이니셜 아바타가 추가돼 정확 일치 대신 라벨 포함으로 검증.
      const selfLink = page.getByTestId('dm-self-link')
      await expect(selfLink).toBeVisible()
      await expect(selfLink).toContainText(`${MY_NAME} (나)`)

      // 클릭 → /chat/dms/self → SelfDmRedirect 가 POST 후 navigate
      await selfLink.click()

      // POST {userIds:[MY_ID]} 검증
      await expect.poll(() => capturedSelfPayload).toEqual({ userIds: [MY_ID] })

      // self-DM 페이지로 이동
      await expect(page).toHaveURL(new RegExp(`/chat/dms/${SELF_DM_ID}$`))

      // DmHeader 표시명이 "테스트 사용자 (나)"
      await expect(page.getByTestId('dm-title')).toHaveText(`${MY_NAME} (나)`)
    },
  )
})
