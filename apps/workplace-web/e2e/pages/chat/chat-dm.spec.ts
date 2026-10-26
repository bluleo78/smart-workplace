// messaging DM E2E — 새 DM 만들기 → 사이드바 → 진입 흐름(@flow), 받는 사람·입력기에 실제로 치는 입력(@input),
// 선택 행·배지 줄바꿈·헤더 잘림·시작선 정렬(@layout). 백엔드 없이 page.route() 모킹.
// 정지된 상대 안내·비참여자·목록 오류·7명 상한·DM 아바타는 vitest 로 옮겼다(WP-984):
// src/pages/chat/dmPage.test.tsx · channelSidebar.test.tsx.
import type { Page } from '@playwright/test'

import { createDm, createDmParticipant, createMessage } from '../../factories/messaging.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { DESKTOP_WIDTHS, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
import { expectSelectedRow } from '../../fixtures/selection'

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

// 구성원 디렉터리(/members) stub — 받는 사람 후보 목록. 실제 백엔드처럼 search 로 이름·아이디를 거른다.
async function stubMembers(
  page: Page,
  content: { userId: number; name: string; username: string; kind: 'HUMAN' | 'AGENT' }[],
) {
  await page.route(
    (url) => url.pathname === '/api/v1/members',
    (route) => {
      const search = new URL(route.request().url()).searchParams.get('search') ?? ''
      const matched = content.filter((m) => m.name.includes(search) || m.username.includes(search))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: matched, totalElements: matched.length }),
      })
    },
  )
}

test.describe('messaging DM', () => {
  test('새 1:1 DM 생성 → DM 섹션 등장 → 진입', { tag: ['@flow', '@smoke'] }, async ({
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
    // 구성원 검색(RecipientInput) stub — userId=2 '밥'. PageResponse<MemberSummary> 형태(#833).
    await page.route(
      (url) => url.pathname === '/api/v1/members',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }],
            totalElements: 1,
          }),
        }),
    )

    // dm-new-btn 은 <Link to="/chat/new"> — /chat/new 로 이동해 인라인 compose 렌더.
    await page.goto('/chat')
    await page.getByTestId('dm-new-btn').click()
    await expect(page).toHaveURL(/\/chat\/new$/)
    await expect(page.getByTestId('new-message-page')).toBeVisible()

    // '+' 로 들어오면 별도 조작 없이 입력이 포커스되고 후보 목록이 바로 보인다 — '추가' 버튼은 없다(#883).
    await expect(page.getByTestId('new-message-recipient-input')).toBeFocused()
    await expect(page.getByTestId('recipient-suggestions')).toBeVisible()
    await expect(page.getByRole('button', { name: '추가', exact: true })).toHaveCount(0)

    // 수신자 선택
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

  test('그룹 DM 생성 → 다중 선택 → payload → 표시명', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
      (url) => url.pathname === '/api/v1/members',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [
              { userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' },
              { userId: 3, name: '캐럴', username: 'carol', kind: 'HUMAN' },
            ],
            totalElements: 2,
          }),
        }),
    )

    await page.goto('/chat/new')
    await expect(page.getByTestId('new-message-page')).toBeVisible()
    // 후보 목록은 select 시 닫히지 않고 쿼리만 비운다 → 같은 입력에 이어서 검색.
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

  test('DM 메시지 전송 → payload 검증 + UI 반영', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  // WP-368 — 열린 DM 행만 선택 표시(막대 + bg-selected), 다른 DM·셀프 DM 행엔 없다. 색 차이는 계산된 배경으로 확인.
  test('사이드바 — 열린 DM 행만 bg-selected·selection-bar 를 갖는다 (WP-368)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const dms = [
      createDm({ id: 102, participants: [createDmParticipant({ userId: 1, name: '테스트 사용자' }), createDmParticipant({ userId: 2, name: '밥' })] }),
      createDm({ id: 103, participants: [createDmParticipant({ userId: 1, name: '테스트 사용자' }), createDmParticipant({ userId: 3, name: '캐럴' })] }),
    ]
    await stubLists(page, dms)
    await stubMessages(page, 102, [])
    await stubMarkRead(page, 102)
    await page.goto('/chat/dms/102')
    const open = page.getByTestId('dm-link-102')
    const other = page.getByTestId('dm-link-103')
    await expectSelectedRow(open, other, { current: 'page' })
    await expect(page.getByTestId('dm-self-link')).not.toHaveAttribute('aria-current')
  })

  // /chat/dms/self 는 실제 DM id 로 리다이렉트한다 — 그 id 로 열린 셀프 DM 도 「나」 행이 선택·현재 항목이어야 한다(WP-368).
  test('사이드바 — 셀프 DM 을 실제 id 로 열어도 「나」 행이 선택·aria-current (WP-368)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const dms = [
      createDm({ id: 101, participants: [createDmParticipant({ userId: 1, name: '테스트 사용자' })] }),
      createDm({ id: 102, participants: [createDmParticipant({ userId: 1, name: '테스트 사용자' }), createDmParticipant({ userId: 2, name: '밥' })] }),
    ]
    await stubLists(page, dms)
    await stubMessages(page, 101, [])
    await stubMarkRead(page, 101)
    await page.goto('/chat/dms/101')
    const self = page.getByTestId('dm-self-link')
    const other = page.getByTestId('dm-link-102')
    await expectSelectedRow(self, other, { current: 'page' })
  })

  test('받는 사람 입력 — 포커스 이탈·Esc 로 닫히고 재포커스로 다시 열린다 (#883)', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    await stubLists(page, [])
    await stubMembers(page, [
      { userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' },
      { userId: 3, name: '캐럴', username: 'carol', kind: 'HUMAN' },
    ])

    await page.goto('/chat/new')
    const input = page.getByTestId('new-message-recipient-input')
    const list = page.getByTestId('recipient-suggestions')
    // 자동 포커스 → 검색어 없이도 기본 후보가 보인다.
    await expect(input).toBeFocused()
    await expect(page.getByTestId('member-search-row-2')).toBeVisible()

    // Esc — 목록만 닫히고 포커스는 입력에 남는다. 타이핑하면 다시 열린다.
    await expect(input).toHaveAttribute('aria-expanded', 'true')
    await input.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(input).toBeFocused()
    await expect(input).toHaveAttribute('aria-expanded', 'false')
    await input.pressSequentially('b')
    await expect(list).toBeVisible()
    await input.fill('')

    // "받는 사람:" 라벨을 눌러도 포커스는 입력에 남는다(타이핑이 계속 먹어야 한다).
    await page.getByText('받는 사람:').click()
    await expect(input).toBeFocused()

    // 포커스 이탈(페이지 제목 클릭) → 닫힘. 다시 입력을 포커스하면 열린다.
    await page.getByText('새 메시지', { exact: true }).click()
    await expect(input).not.toBeFocused()
    await expect(list).toHaveCount(0)
    await input.focus()
    await expect(list).toBeVisible()
  })

  test('받는 사람 입력 — 키보드만으로 연속 선택·제거 후 Tab 으로 메시지 입력 이동 (#883)', { tag: '@input' }, async ({
    authenticatedPage: page,
  }) => {
    await stubLists(page, [])
    await stubMembers(page, [
      { userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' },
      { userId: 3, name: '캐럴', username: 'carol', kind: 'HUMAN' },
      { userId: 4, name: '데이브', username: 'dave', kind: 'HUMAN' },
    ])

    await page.goto('/chat/new')
    const input = page.getByTestId('new-message-recipient-input')
    await expect(page.getByTestId('member-search-row-2')).toBeVisible()

    // 검색 → 곧바로 Enter: 결과가 오기 전(디바운스 중)의 Enter 는 이전 목록의 첫 후보(밥)를 고르지 않는다.
    await input.fill('dave')
    await input.press('Enter')
    await expect(page.getByTestId('member-search-row-2')).toHaveCount(0)
    await expect(page.getByTestId('member-search-row-4')).toBeVisible()
    await expect(page.getByTestId('recipient-chip-2')).toHaveCount(0)
    await input.fill('')
    await expect(page.getByTestId('member-search-row-2')).toBeVisible()

    // Enter = 하이라이트된 첫 후보 선택. 목록은 유지되고 고른 상대는 목록에서 빠진다.
    await input.press('Enter')
    await expect(page.getByTestId('recipient-chip-2')).toBeVisible()
    await expect(page.getByTestId('recipient-suggestions')).toBeVisible()
    await expect(page.getByTestId('member-search-row-2')).toHaveCount(0)
    // 곧바로 ↓ + Enter — 남은 후보(캐럴, 데이브) 중 두 번째를 고른다.
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect(page.getByTestId('recipient-chip-4')).toBeVisible()
    await expect(input).toBeFocused()

    // 검색어가 있으면 Backspace 는 글자만 지운다(칩 유지). 비어 있으면 마지막 칩을 지운다.
    await input.pressSequentially('a')
    await input.press('Backspace')
    await expect(page.getByTestId('recipient-chip-4')).toBeVisible()
    await input.press('Backspace')
    await expect(page.getByTestId('recipient-chip-4')).toHaveCount(0)
    await expect(page.getByTestId('recipient-chip-2')).toBeVisible()

    // x 버튼으로 제거해도 포커스는 입력으로 돌아와 목록이 유지된다.
    await page.getByRole('button', { name: '밥 제거' }).click()
    await expect(page.getByTestId('recipient-chip-2')).toHaveCount(0)
    await expect(input).toBeFocused()

    // Tab — 목록의 탭 버튼을 거치지 않고 메시지 입력으로 넘어가며 목록은 닫힌다.
    await input.press('Enter')
    await expect(page.getByTestId('recipient-chip-2')).toBeVisible()
    await input.press('Tab')
    await expect(page.getByTestId('recipient-suggestions')).toHaveCount(0)
    await expect(page.getByTestId('message-composer-input')).toBeFocused()
  })

  test('DM 생성 400 → 에러 토스트', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
      (url) => url.pathname === '/api/v1/members',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: [{ userId: 2, name: '밥', username: 'bob', kind: 'HUMAN' }],
            totalElements: 1,
          }),
        }),
    )

    await page.goto('/chat/new')
    await expect(page.getByTestId('new-message-page')).toBeVisible()
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

  test('DM 사이드바 — 참가자 이름이 길어도 에이전트 배지가 줄바꿈되지 않는다 (#711)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // 긴 그룹 DM 표시명("양동희2, My AI" 등)이 flex 컨테이너 폭을 압박해도 배지 자체는 항상 한 줄 유지.
    const dms = [
      createDm({
        id: 5,
        participants: [
          createDmParticipant({ userId: 1, name: '테스트 사용자' }),
          createDmParticipant({ userId: 2, name: '아주아주긴이름의사용자2' }),
          createDmParticipant({ userId: 10, name: 'My AI', kind: 'AGENT' }),
        ],
      }),
    ]
    await stubLists(page, dms)
    await page.goto('/chat')

    const badge = page.getByTestId('dm-link-5').getByTestId('agent-badge')
    await expect(badge).toBeVisible()
    const box = await badge.boundingBox()
    expect(box).not.toBeNull()
    // 배지 텍스트가 두 줄로 줄바꿈되면 높이가 급격히 커짐 — 한 줄 높이(20px 이내) 유지 확인.
    expect(box!.height).toBeLessThan(20)
  })

  test('DM 헤더 — 상대 이름이 길어도 truncate 적용 + 헤더 높이 고정 (#797)', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    // 상대 표시명이 매우 길면 <h1> 이 줄바꿈되며 h-14 고정 높이가 깨지던 회귀(#797).
    const longName = '나'.repeat(80)
    const dm = createDm({
      id: 103,
      participants: [
        createDmParticipant({ userId: 1, name: '나' }),
        createDmParticipant({ userId: 2, name: longName }),
      ],
    })
    await stubLists(page, [dm])
    await stubMessages(page, 103, [])
    await stubMarkRead(page, 103)
    await page.goto('/chat/dms/103')

    const header = page.getByTestId('dm-header')
    const title = page.getByTestId('dm-title')
    await expect(title).toBeVisible()

    // 헤더 컨테이너가 h-14 로 고정된 채 유지되어야 한다 — 2줄로 줄바꿈되면 clientHeight 가 56px 를 초과한다.
    await expect
      .poll(async () => header.evaluate((el) => el.clientHeight))
      .toBeLessThanOrEqual(56)

    // 제목 요소 자체는 1줄로 잘려야 한다 — scrollWidth 가 clientWidth 를 넘어서면 truncate 미적용.
    const isTruncated = await title.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(isTruncated).toBe(true)

    // hover 시 전체 이름 확인 가능하도록 title 속성 보강.
    await expect(title).toHaveAttribute('title', longName)
  })

  // 레이아웃 회귀: DM 헤더는 페이지 표준 헤더(Page.Header) — 하단선 56px, 제목·첫 메시지·입력창이 같은 16px 축.
  for (const width of DESKTOP_WIDTHS) {
    test(`DM 헤더 제목·첫 메시지·입력창이 같은 시작선에 있다 (${width}px)`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
      await page.setViewportSize({ width, height: 900 })
      const dm = createDm({
        id: 104,
        participants: [
          createDmParticipant({ userId: 1, name: '나' }),
          createDmParticipant({ userId: 2, name: '밥' }),
        ],
      })
      await stubLists(page, [dm])
      await stubMessages(page, 104, [createMessage({ id: 8800, channelId: 104, authorId: 2, authorName: '밥', body: '첫 메시지' })])
      await stubMarkRead(page, 104)
      await page.goto('/chat/dms/104')

      const title = page.getByTestId('dm-title')
      await expectHeaderBottomAt56(page.getByTestId('dm-header'))
      await expectStartAligned(title, page.getByTestId('message-8800'))
      await expectStartAligned(title, page.getByTestId('message-composer-input-wrap'))
    })
  }
})
