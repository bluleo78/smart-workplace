// messaging DM E2E — 백엔드 없이 page.route() 모킹.
import type { Page } from '@playwright/test'

import { createDm, createDmParticipant, createMessage } from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

// 채널·DM 사이드바 목록 + SSE 스트림 stub.
// AppLayout 이 useEventStream() 으로 /api/v1/events 를 항상 구독하므로 함께 stub (#506).
async function stubLists(page: Page, dms: ReturnType<typeof createDm>[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          })
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
  await stubStream(page)
}

// SSE 스트림 stub — 빈 keep-alive body.
async function stubStream(page: Page) {
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

// DM 메시지 히스토리 stub.
async function stubMessages(page: Page, dmId: number, items: ReturnType<typeof createMessage>[]) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${dmId}/messages`,
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

// mark-read stub — 응답만 처리, 검증 불필요.
async function stubMarkRead(page: Page, dmId: number) {
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${dmId}/read`,
    (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, body: '' })
        : route.fallback(),
  )
}

test.describe('messaging DM', () => {
  test('새 1:1 DM 생성 → DM 섹션 등장 → 진입', { tag: '@smoke' }, async ({
    authenticatedPage: page,
  }) => {
    // 초기: DM 없음. 생성 후: DM 1개. POST /messaging/dms 로 find-or-create.
    const created = createDm({
      id: 100,
      participants: [
        createDmParticipant({ userId: 1, name: '테스트 사용자' }),
        createDmParticipant({ userId: 2, name: '밥' }),
      ],
    })
    let dmsState: ReturnType<typeof createDm>[] = []
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) => {
        const m = route.request().method()
        if (m === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(dmsState),
          })
        }
        if (m === 'POST') {
          const payload = route.request().postDataJSON() as { userIds: number[] }
          expect(payload).toEqual({ userIds: [2] })
          dmsState = [created] // 이후 GET 에 반영
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(created),
          })
        }
        return route.fallback()
      },
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          : route.fallback(),
    )
    await stubStream(page)
    await stubMessages(page, 100, [])
    await stubMarkRead(page, 100)
    // 첫 메시지 전송 stub
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/100/messages',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(createMessage({ id: 1, channelId: 100, authorId: 1, body: '안녕' })),
        })
      },
    )
    // 사용자 검색(MemberSearchPopover) stub — id=2 '밥'. PageResponse<UserResponse> 형태.
    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [{ id: 2, name: '밥', username: 'bob', kind: 'HUMAN' }],
            totalElements: 1,
          }),
        }),
    )

    // dm-new-btn 은 <Link to="/chat/new"> — /chat/new 로 이동해 인라인 compose 렌더.
    await page.goto('/chat')
    await page.getByTestId('dm-new-btn').click()
    await expect(page).toHaveURL(/\/chat\/new$/)
    await expect(page.getByTestId('new-message-page')).toBeVisible()

    // 수신자 선택
    await page.getByTestId('new-message-add-recipient').click()
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
    await page.getByTestId('member-search-row-2').click()
    await expect(page.getByTestId('recipient-chip-2')).toBeVisible()

    // 메시지 작성 + 전송(Enter)
    await page.getByTestId('message-composer-input').click()
    await page.keyboard.type('안녕')
    await page.keyboard.press('Enter')

    // 1) URL 라우팅 2) 사이드바 DM 섹션에 상대 이름으로 등장 3) 대화 헤더 진입.
    await expect(page).toHaveURL(/\/chat\/dms\/100$/)
    await expect(page.getByTestId('dm-link-100')).toBeVisible()
    await expect(page.getByTestId('dm-title')).toHaveText('밥')
  })

  test('그룹 DM 생성 → 다중 선택 → payload → 표시명', async ({ authenticatedPage: page }) => {
    // 그룹 DM 을 인라인 compose 다중 선택으로 직접 만들고, POST payload·표시명을 검증한다.
    const group = createDm({
      id: 101,
      participants: [
        createDmParticipant({ userId: 1, name: '테스트 사용자' }),
        createDmParticipant({ userId: 2, name: '밥' }),
        createDmParticipant({ userId: 3, name: '캐럴' }),
      ],
    })
    let dmsState: ReturnType<typeof createDm>[] = []
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) => {
        const m = route.request().method()
        if (m === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(dmsState),
          })
        }
        if (m === 'POST') {
          // userIds 는 순서 무관 — 2·3 둘 다 포함.
          const payload = route.request().postDataJSON() as { userIds: number[] }
          expect(payload.userIds).toHaveLength(2)
          expect(payload.userIds).toContain(2)
          expect(payload.userIds).toContain(3)
          dmsState = [group] // 생성 후 refetch 에 반영
          return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(group),
          })
        }
        return route.fallback()
      },
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          : route.fallback(),
    )
    await stubStream(page)
    await stubMessages(page, 101, [])
    await stubMarkRead(page, 101)
    // 첫 메시지 전송 stub
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/101/messages',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(createMessage({ id: 2, channelId: 101, authorId: 1, body: '안녕' })),
        })
      },
    )
    // 사용자 검색 stub — 밥(2)·캐럴(3) 둘 다 반환.
    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [
              { id: 2, name: '밥', username: 'bob', kind: 'HUMAN' },
              { id: 3, name: '캐럴', username: 'carol', kind: 'HUMAN' },
            ],
            totalElements: 2,
          }),
        }),
    )

    await page.goto('/chat/new')
    await expect(page.getByTestId('new-message-page')).toBeVisible()
    await page.getByTestId('new-message-add-recipient').click()
    // MemberSearchPopover 는 select 시 닫히지 않고 쿼리만 비운다 → 같은 입력에 이어서 검색.
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
    await page.getByTestId('member-search-row-2').click()
    await expect(page.getByTestId('recipient-chip-2')).toBeVisible()
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('캐럴')
    await page.getByTestId('member-search-row-3').click()
    await expect(page.getByTestId('recipient-chip-3')).toBeVisible()

    // 메시지 작성 + 전송
    await page.getByTestId('message-composer-input').click()
    await page.keyboard.type('안녕')
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/\/chat\/dms\/101$/)
    await expect(page.getByTestId('dm-title')).toHaveText('밥, 캐럴')
  })

  test('DM 메시지 전송 → payload 검증 + UI 반영', async ({ authenticatedPage: page }) => {
    const dm = createDm({ id: 102 })
    await stubLists(page, [dm])
    await stubMessages(page, 102, [])
    await stubMarkRead(page, 102)
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels/102/messages',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        const payload = route.request().postDataJSON() as { body: string }
        expect(payload).toEqual({ body: '안녕 밥' })
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(
            createMessage({ id: 5, channelId: 102, authorId: 1, body: '안녕 밥' }),
          ),
        })
      },
    )

    await page.goto('/chat/dms/102')
    // MessageComposer 는 Enter 전송(별도 send 버튼 없음). 기존 chat.spec.ts 와 동일한 셀렉터·동작.
    await page.getByTestId('message-composer-input').click()
    await page.keyboard.type('안녕 밥')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('message-body-5')).toHaveText('안녕 밥')
  })

  test('비참여자 직접 진입 → 대화 없음', async ({ authenticatedPage: page }) => {
    await stubLists(page, []) // 내 DM 목록에 없음
    await stubMessages(page, 999, [])
    await page.goto('/chat/dms/999')
    await expect(page.getByTestId('dm-not-found')).toBeVisible()
  })

  test('DM 목록 API 오류 → 오류 메시지(미존재 오표시 아님)', async ({
    authenticatedPage: page,
  }) => {
    // /api/v1/messaging/dms 를 500 으로 막아 isError=true 분기 검증.
    // 실제 버그(#190): isError 미구분 → "대화를 찾을 수 없습니다." 오표시.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 500, body: 'Internal Server Error' })
          : route.fallback(),
    )
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/channels',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
          : route.fallback(),
    )
    await stubStream(page)

    await page.goto('/chat/dms/100')

    // isError → dm-load-error 표시, dm-not-found 는 표시되지 않아야 함.
    await expect(page.getByTestId('dm-load-error')).toBeVisible()
    await expect(page.getByTestId('dm-not-found')).toHaveCount(0)
    await expect(page.getByText('대화 목록을 불러오지 못했습니다')).toBeVisible()
  })

  test('참여자 7명 초과 선택 거부(본인 포함 8명 상한)', async ({
    authenticatedPage: page,
  }) => {
    // 후보 8명(ids 2~9) — 7명까지 선택 후 8번째 시도가 무시됨을 검증.
    // 참고: 구 NewDmModal 은 7명 도달 시 추가 버튼을 disabled 처리했으나,
    // 인라인 compose(NewMessagePage)는 addRecipient 로직에서 초과를 무시하고 버튼 disabled 는 없다.
    // 이는 UX 어포던스 차이이며, 상한 로직 자체는 정상 동작함을 이 테스트로 검증한다.
    const candidates = [
      { id: 2, name: '밥', username: 'bob' },
      { id: 3, name: '캐럴', username: 'carol' },
      { id: 4, name: '데이브', username: 'dave' },
      { id: 5, name: '이브', username: 'eve' },
      { id: 6, name: '프랭크', username: 'frank' },
      { id: 7, name: '그레이스', username: 'grace' },
      { id: 8, name: '하이디', username: 'heidi' },
    ]
    const extra = { id: 9, name: '아이반', username: 'ivan', kind: 'HUMAN' }
    await stubLists(page, [])
    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [...candidates.map((c) => ({ ...c, kind: 'HUMAN' })), extra],
            totalElements: candidates.length + 1,
          }),
        }),
    )

    await page.goto('/chat/new')
    await expect(page.getByTestId('new-message-page')).toBeVisible()
    await page.getByTestId('new-message-add-recipient').click()
    // popover 는 select 시 닫히지 않으므로 같은 입력에 이어서 7명을 누적 선택.
    for (const c of candidates) {
      await page.getByPlaceholder('이름·아이디·이메일로 검색').fill(c.name)
      await page.getByTestId(`member-search-row-${c.id}`).click()
      await expect(page.getByTestId(`recipient-chip-${c.id}`)).toBeVisible()
    }

    // 8번째(아이반) 시도 — addRecipient 가 MAX_TARGETS(7) 초과로 무시해야 한다.
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill(extra.name)
    await page.getByTestId(`member-search-row-${extra.id}`).click()

    // 칩이 여전히 7개 — 8번째 추가 거부 확인.
    await expect(
      page.getByTestId('new-message-recipients').locator('[data-testid^="recipient-chip-"]'),
    ).toHaveCount(7)
    await expect(page.getByTestId(`recipient-chip-${extra.id}`)).toHaveCount(0)
  })

  test('DM 생성 400 → 에러 토스트', async ({ authenticatedPage: page }) => {
    await stubLists(page, [])
    // 서버가 400 + 한국어 message → handleApiError 가 그 message 를 토스트로 노출.
    await page.route(
      (url) => url.pathname === '/api/v1/messaging/dms',
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback()
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 400,
            error: 'Bad Request',
            message: '자기 자신과는 DM 할 수 없습니다',
          }),
        })
      },
    )
    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [{ id: 2, name: '밥', username: 'bob', kind: 'HUMAN' }],
            totalElements: 1,
          }),
        }),
    )

    await page.goto('/chat/new')
    await expect(page.getByTestId('new-message-page')).toBeVisible()
    await page.getByTestId('new-message-add-recipient').click()
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
    await page.getByTestId('member-search-row-2').click()
    await expect(page.getByTestId('recipient-chip-2')).toBeVisible()

    // 메시지 작성 + 전송 → POST /dms 400 → 토스트 표시.
    await page.getByTestId('message-composer-input').click()
    await page.keyboard.type('테스트')
    await page.keyboard.press('Enter')

    // Sonner 토스트 — 기존 스펙과 동일하게 메시지 텍스트로 검증.
    await expect(page.getByText('자기 자신과는 DM 할 수 없습니다')).toBeVisible()
  })

  test('DM 사이드바 — 각 DM 아이템이 상대 식별 아바타로 시각 구분된다 (#298)', async ({
    authenticatedPage: page,
  }) => {
    // 회귀 방지: 모든 DM 이 동일 MessageSquare 아이콘이던 결함.
    // self/1:1/AI/그룹 이 각각 상대 식별 아바타(user-avatar-<id>)를 렌더해야 한다.
    const dms = [
      createDm({
        id: 2,
        participants: [
          createDmParticipant({ userId: 1, name: '테스트 사용자' }),
          createDmParticipant({ userId: 2, name: '밥' }),
        ],
      }),
      createDm({
        id: 3,
        participants: [
          createDmParticipant({ userId: 1, name: '테스트 사용자' }),
          createDmParticipant({ userId: 10, name: 'My AI', kind: 'AGENT' }),
        ],
      }),
      createDm({
        id: 4,
        participants: [
          createDmParticipant({ userId: 1, name: '테스트 사용자' }),
          createDmParticipant({ userId: 2, name: '밥' }),
          createDmParticipant({ userId: 3, name: '캐럴' }),
        ],
      }),
    ]
    await stubLists(page, dms)
    await page.goto('/chat')

    // self-DM: 본인(id=1) 이니셜 아바타 '테'
    const selfLink = page.getByTestId('dm-self-link')
    await expect(selfLink.getByTestId('user-avatar-1')).toHaveText('테')

    // 1:1 DM(상대 id=2): 상대 이니셜 '밥' — self 와 다른 식별 신호
    const dm2 = page.getByTestId('dm-link-2')
    await expect(dm2.getByTestId('user-avatar-2')).toHaveText('밥')

    // AI DM(상대 id=10): 상대 아바타 + 에이전트 배지 공존(Bot 마커 중복 없음)
    const dm3 = page.getByTestId('dm-link-3')
    await expect(dm3.getByTestId('user-avatar-10')).toBeVisible()
    await expect(dm3.getByTestId('agent-badge')).toBeVisible()

    // 그룹 DM(대표 상대 id=2): 첫 비-본인 참여자 아바타
    const dm4 = page.getByTestId('dm-link-4')
    await expect(dm4.getByTestId('user-avatar-2')).toBeVisible()

    // 더 이상 동일 아이콘이 아님: 사이드바 DM 영역에 MessageSquare(lucide) 아이콘 없음
    await expect(page.getByTestId('dm-list').locator('svg.lucide-message-square')).toHaveCount(0)
  })
})
