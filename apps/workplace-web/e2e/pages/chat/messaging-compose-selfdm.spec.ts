// messaging 인라인 compose + self-DM E2E
// (A) 받는 사람 후보 목록(RecipientInput)이 본인(id=1)을 결과에서 제외하는지 검증 (클라이언트 측 필터).
// (B) /chat/new 에서 수신자 선택 → 메시지 전송 → DM 페이지 이동 happy path.
// (C) 사이드바 self-DM 링크 레이블 + /chat/dms/self 클릭 → POST {userIds:[1]} → DM 페이지 이동.
// 백엔드 없이 page.route() 모킹.
import type { Page } from '@playwright/test'

import { createDm, createDmParticipant, createMessage } from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'

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

/** 구성원 검색 stub(#833 — 디렉터리 /members) — 전달한 users 리스트를 MemberSummary 로 변환해 반환. */
async function stubUserSearch(
  page: Page,
  users: { userId: number; name: string; username: string; kind: string }[],
) {
  await page.route(
    (url) => url.pathname === '/api/v1/members',
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
  // (A) 받는 사람 후보 목록 자기 자신 제외 검증
  test(
    '피커가 본인(id=1)을 검색 결과에서 제외한다',
    async ({ authenticatedPage: page }) => {
      await stubSidebarLists(page)
      // API 응답에 본인(id=1)과 타인(id=2)을 함께 반환 → 컴포넌트의 excludeUserIds 필터 확인.
      await stubUserSearch(page, [
        { userId: MY_ID, name: MY_NAME, username: 'testuser', kind: 'HUMAN' },
        { userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' },
      ])

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('사용자')

      // 본인 row 는 렌더되지 않아야 한다.
      await expect(page.getByTestId(`member-search-row-${MY_ID}`)).toHaveCount(0)
      // 타인 row 는 렌더된다.
      await expect(page.getByTestId('member-search-row-2')).toBeVisible()
    },
  )

  // (F) 회귀: /chat/new 받는사람 검색은 AGENT 사용자도 포함해야 한다 (#691)
  test(
    '받는사람 검색이 kind=ALL 로 요청되어 AGENT 사용자도 검색 결과에 노출된다',
    async ({ authenticatedPage: page }) => {
      await stubSidebarLists(page)

      // 실제 백엔드 동작을 모킹: kind=ALL 이면 사람+에이전트, 그 외엔 사람만 반환.
      let capturedKind: string | null = null
      await page.route(
        (url) => url.pathname === '/api/v1/members',
        (route) => {
          capturedKind = new URL(route.request().url()).searchParams.get('kind')
          const users =
            capturedKind === 'ALL'
              ? [{ userId: 9, name: 'My AI', username: 'myai', kind: 'AGENT' }]
              : []
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ content: users, totalElements: users.length }),
          })
        },
      )

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('My AI')

      // 요청 쿼리에 kind=ALL 이 실제로 전달됐는지 확인 — 누락되면 AGENT 가 제외된다(회귀 재현 조건).
      await expect.poll(() => capturedKind).toBe('ALL')
      // AGENT 사용자 row 가 렌더되고 AgentBadge 도 함께 표시된다.
      const row = page.getByTestId('member-search-row-9')
      await expect(row).toBeVisible()
      await expect(row).toContainText('My AI')

      // 선택 → 수신자 칩에도 AGENT 배지가 붙는다.
      await row.click()
      const chip = page.getByTestId('recipient-chip-9')
      await expect(chip).toBeVisible()
      await expect(chip).toContainText('My AI')
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
      await stubUserSearch(page, [{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])

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

  // (G) 회귀: /chat/new 에서 파일 첨부 시 channelId=0 으로 사전 업로드해 403 나던 문제 (WP-99)
  // 전송 전엔 업로드하지 않고, 전송 시 DM 생성 → 그 DM 으로 업로드 → 실제 fileId 로 첫 메시지 전송.
  test(
    '첨부는 전송 시 생성된 DM 으로 업로드되고 channels/0 업로드는 발생하지 않는다',
    async ({ authenticatedPage: page }) => {
      const DM_ID = 201
      const UPLOADED_FILE_ID = 77
      const dm = createDm({
        id: DM_ID,
        participants: [
          createDmParticipant({ userId: MY_ID, name: MY_NAME }),
          createDmParticipant({ userId: 2, name: '밥' }),
        ],
      })

      await stubSidebarLists(page)
      await stubUserSearch(page, [{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])

      // 호출 순서 기록 — DM 생성이 업로드보다 먼저여야 한다.
      const calls: string[] = []
      // 채널 0(미생성 DM) 업로드 시도 감지 — 한 번이라도 오면 회귀.
      let zeroChannelUploads = 0
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/channels/0/attachments',
        (route) => {
          zeroChannelUploads++
          return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' })
        },
      )
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/dms',
        (route) => {
          const m = route.request().method()
          if (m === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(calls.includes('dm') ? [dm] : []),
            })
          }
          if (m === 'POST') {
            calls.push('dm')
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(dm) })
          }
          return route.fallback()
        },
      )
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/attachments`,
        (route) => {
          calls.push('upload')
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { fileId: UPLOADED_FILE_ID, originalName: 'report.txt', mimeType: 'text/plain', sizeBytes: 5 },
            ]),
          })
        },
      )
      let capturedMsgPayload: { body: string; fileIds?: number[] } | null = null
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/messages`,
        (route) => {
          const m = route.request().method()
          if (m === 'POST') {
            calls.push('message')
            capturedMsgPayload = route.request().postDataJSON() as { body: string; fileIds?: number[] }
            return route.fulfill({
              status: 201,
              contentType: 'application/json',
              body: JSON.stringify(createMessage({ id: 11, channelId: DM_ID, authorId: MY_ID, body: '' })),
            })
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
          })
        },
      )
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/read`,
        (route) => route.fulfill({ status: 204, body: '' }),
      )

      await page.goto('/chat/new')
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
      await page.getByTestId('member-search-row-2').click()
      await expect(page.getByTestId('recipient-chip-2')).toBeVisible()

      // 파일 선택 → 업로드 없이 첨부 칩만 표시.
      await page.getByTestId('composer-file-input').setInputFiles({
        name: 'report.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      })
      await expect(page.getByTestId('composer-attachments')).toContainText('report.txt')
      expect(calls).toEqual([])

      // 본문 없이 첨부만으로 전송.
      await page.getByTestId('message-composer-submit').click()

      await expect.poll(() => capturedMsgPayload?.fileIds).toEqual([UPLOADED_FILE_ID])
      expect(calls).toEqual(['dm', 'upload', 'message'])
      expect(zeroChannelUploads).toBe(0)
      await expect(page).toHaveURL(new RegExp(`/chat/dms/${DM_ID}$`))
    },
  )

  // (H) WP-99: 첫 메시지 전송이 실패하면 본문·첨부를 유지하고, 재시도 시 이미 올린 첨부는 다시 올리지 않는다.
  test(
    '전송 실패 시 본문·첨부가 유지되고 재시도는 첨부를 재업로드하지 않는다',
    async ({ authenticatedPage: page }) => {
      const DM_ID = 202
      const UPLOADED_FILE_ID = 88
      const dm = createDm({
        id: DM_ID,
        participants: [
          createDmParticipant({ userId: MY_ID, name: MY_NAME }),
          createDmParticipant({ userId: 2, name: '밥' }),
        ],
      })
      await stubSidebarLists(page)
      await stubUserSearch(page, [{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])
      await page.route(
        (url) => url.pathname === '/api/v1/messaging/dms',
        (route) =>
          route.request().method() === 'POST'
            ? route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(dm) })
            : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      )
      let uploads = 0
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/attachments`,
        (route) => {
          uploads++
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              { fileId: UPLOADED_FILE_ID, originalName: 'report.txt', mimeType: 'text/plain', sizeBytes: 5 },
            ]),
          })
        },
      )
      // 첫 메시지 POST 는 500, 이후엔 201.
      let messagePosts = 0
      let lastMsgPayload: { body: string; fileIds?: number[] } | null = null
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/messages`,
        (route) => {
          if (route.request().method() !== 'POST') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
            })
          }
          messagePosts++
          lastMsgPayload = route.request().postDataJSON() as { body: string; fileIds?: number[] }
          if (messagePosts === 1) {
            return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
          }
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(createMessage({ id: 12, channelId: DM_ID, authorId: MY_ID, body: '보고서' })),
          })
        },
      )
      await page.route(
        (url) => url.pathname === `/api/v1/messaging/channels/${DM_ID}/read`,
        (route) => route.fulfill({ status: 204, body: '' }),
      )

      await page.goto('/chat/new')
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
      await page.getByTestId('member-search-row-2').click()
      await page.getByTestId('composer-file-input').setInputFiles({
        name: 'report.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      })
      await page.getByTestId('message-composer-input').click()
      await page.keyboard.type('보고서')
      await page.getByTestId('message-composer-submit').click()

      // 실패: 페이지에 머물고 본문·첨부 칩이 그대로 남는다.
      await expect.poll(() => messagePosts).toBe(1)
      await expect(page).toHaveURL(/\/chat\/new$/)
      await expect(page.getByTestId('message-composer-input')).toContainText('보고서')
      await expect(page.getByTestId('composer-attachments')).toContainText('report.txt')

      // 재시도: 첨부는 다시 올리지 않고 첫 업로드의 fileId 로 전송된다.
      await page.getByTestId('message-composer-submit').click()
      await expect(page).toHaveURL(new RegExp(`/chat/dms/${DM_ID}$`))
      expect(uploads).toBe(1)
      expect(lastMsgPayload).toEqual({ body: '보고서', fileIds: [UPLOADED_FILE_ID] })
    },
  )

  // (D) 회귀: /chat/new 수신자 미선택 상태에서 "보관됨" 오표시 금지 (#118)
  test(
    '수신자 미선택 시 "이 채널은 보관되었습니다" 가 표시되지 않는다',
    async ({ authenticatedPage: page }) => {
      await stubSidebarLists(page)
      await stubUserSearch(page, [{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()

      // 초기(수신자 0): 빈 상태 안내만, "보관됨" 오표시 없음, 입력기도 미마운트.
      await expect(page.getByText('받는 사람을 추가하면 대화를 시작할 수 있어요.')).toBeVisible()
      await expect(page.getByText('이 채널은 보관되었습니다')).toHaveCount(0)
      await expect(page.getByTestId('message-composer-input')).toHaveCount(0)

      // 수신자 1명 추가 → 입력기 정상 노출, 여전히 "보관됨" 문구 없음.
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
      await stubUserSearch(page, [{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }])

      await page.goto('/chat/new')
      await expect(page.getByTestId('new-message-page')).toBeVisible()

      // 수신자 추가
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
