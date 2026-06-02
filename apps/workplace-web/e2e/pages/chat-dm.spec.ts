// messaging DM E2E — 백엔드 없이 page.route() 모킹.
import type { Page } from '@playwright/test'

import { createDm, createDmParticipant, createMessage } from '../factories/messaging.factory'
import { expect, test } from '../fixtures/auth.fixture'

// 채널·DM 사이드바 목록 + SSE 스트림 stub.
// ChatModuleLayout 이 useMessageStream() 으로 /messaging/stream 을 항상 구독하므로 함께 stub.
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

test.describe('messaging DM', () => {
  test('새 1:1 DM 생성 → DM 섹션 등장 → 진입', { tag: '@smoke' }, async ({
    authenticatedPage: page,
  }) => {
    // 초기: DM 없음. 생성 후: DM 1개.
    const created = createDm({
      id: 100,
      participants: [
        createDmParticipant({ userId: 1, name: '나' }),
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

    await page.goto('/chat')
    await page.getByTestId('dm-new-btn').click()
    await page.getByTestId('new-dm-add-btn').click()
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('밥')
    await page.getByTestId('member-search-row-2').click()
    await expect(page.getByTestId('new-dm-chip-2')).toBeVisible()
    await page.getByTestId('new-dm-start-btn').click()

    await expect(page).toHaveURL(/\/chat\/dms\/100$/)
    await expect(page.getByTestId('dm-title')).toHaveText('밥')
  })

  test('그룹 DM 표시명 — 상대 이름 결합', async ({ authenticatedPage: page }) => {
    const group = createDm({
      id: 101,
      participants: [
        createDmParticipant({ userId: 1, name: '나' }),
        createDmParticipant({ userId: 2, name: '밥' }),
        createDmParticipant({ userId: 3, name: '캐럴' }),
      ],
    })
    await stubLists(page, [group])
    await stubMessages(page, 101, [])

    await page.goto('/chat/dms/101')
    await expect(page.getByTestId('dm-title')).toHaveText('밥, 캐럴')
  })

  test('DM 메시지 전송 → payload 검증 + UI 반영', async ({ authenticatedPage: page }) => {
    const dm = createDm({ id: 102 })
    await stubLists(page, [dm])
    await stubMessages(page, 102, [])
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
})
