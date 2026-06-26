// messaging 멤버 패널 E2E — 초대/역할/소유권이전/나가기. 백엔드 없이 mock.
// 2-유저 시나리오는 별도 page.route 응답 교체로 모사(실제 2세션 아님).
import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { createChannel, createChannelMember } from '../factories/messaging.factory'

const CID = 50

async function stubBase(page: Page, channel: ReturnType<typeof createChannel>) {
  await page.route(
    (url) => url.pathname === '/api/v1/messaging/channels',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([channel]) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'cache-control': 'no-cache' }, body: ':\n\n' }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(channel) })
        : route.fallback(),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/messaging/channels/${channel.id}/messages`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }) })
        : route.fallback(),
  )
}

test.describe('messaging 멤버 패널', () => {
  test('OWNER → 멤버 목록 + 역할 뱃지', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true, memberCount: 2 })
    await stubBase(page, ch)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([
                createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
                createChannelMember({ userId: 2, name: '동료', role: 'MEMBER' }),
              ]),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    await expect(page.getByTestId('channel-members-panel')).toBeVisible()
    await expect(page.getByTestId('member-row-2')).toContainText('동료')
    // userId 1 = self = Badge 렌더 (본인은 select 미노출)
    await expect(page.getByTestId('member-role-1')).toContainText('OWNER')
  })

  test('OWNER → 멤버 제거 (AlertDialog 확인 후 제거)', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true })
    await stubBase(page, ch)
    let removed = false
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const members = removed
          ? [createChannelMember({ userId: 1, name: '나', role: 'OWNER' })]
          : [
              createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
              createChannelMember({ userId: 2, name: '동료', role: 'MEMBER' }),
            ]
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
      },
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members/2`,
      (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback()
        removed = true
        return route.fulfill({ status: 204 })
      },
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    // 제거 버튼 클릭 → AlertDialog 확인 단계 거쳐야 실제 제거됨
    await page.getByTestId('member-remove-2').click()
    // AlertDialog 가 열려야 함 (즉시 제거 방지 검증)
    await expect(page.getByTestId('member-remove-confirm')).toBeVisible()
    await page.getByTestId('member-remove-confirm').click()
    await expect(page.getByTestId('member-row-2')).toHaveCount(0)
  })

  test('OWNER → 멤버 제거 취소 시 멤버 유지', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true })
    await stubBase(page, ch)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([
                createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
                createChannelMember({ userId: 2, name: '동료', role: 'MEMBER' }),
              ]),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    await page.getByTestId('member-remove-2').click()
    // AlertDialog 에서 취소 → 멤버 유지
    await expect(page.getByTestId('member-remove-confirm')).toBeVisible()
    await page.getByRole('button', { name: '취소' }).click()
    await expect(page.getByTestId('member-row-2')).toBeVisible()
  })

  test('비공개 초대 — OWNER 가 검색해서 추가(POST payload 검증)', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, visibility: 'PRIVATE', role: 'OWNER', member: true })
    await stubBase(page, ch)
    // POST payload 검증용 플래그 — 라우트 핸들러가 expect 를 통과했는지 확인.
    let addPayloadVerified = false
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([createChannelMember({ userId: 1, name: '나', role: 'OWNER' })]) })
        }
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON() as { userId: number }
          expect(payload).toEqual({ userId: 2 })
          addPayloadVerified = true
          return route.fulfill({ status: 204 })
        }
        return route.fallback()
      },
    )
    // 멤버 검색 GET /users?search=
    await page.route(
      (url) => url.pathname === '/api/v1/users',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ content: [{ id: 2, name: '동료', username: 'colleague', email: 'c@x.com', kind: 'HUMAN', roles: [] }], totalElements: 1, totalPages: 1, number: 0, size: 20 }),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    await page.getByTestId('member-add-trigger').click()
    await expect(page.getByTestId('member-search-popover')).toBeVisible()
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('동료')
    await page.getByTestId('member-search-row-2').click()
    // POST 가 호출되어 payload 검증을 통과했는지 poll 로 확인
    await expect.poll(() => addPayloadVerified).toBe(true)
  })

  test('B(비초대 전) 재진입 후 채널 보임 — 초대 반영 모사', async ({ authenticatedPage: page }) => {
    // B 관점: 처음 GET /channels 빈 목록 → 페이지엔 사이드바만. 초대 반영본을 직접 stub.
    const ch = createChannel({ id: CID, visibility: 'PRIVATE', member: true, role: 'MEMBER' })
    await stubBase(page, ch)
    await page.goto('/chat')
    await expect(page.getByTestId('channel-link-50')).toBeVisible()
    await expect(page.getByTestId('channel-lock-50')).toBeVisible()
  })

  test('OWNER 소유권 이전 후 나가기', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true })
    await stubBase(page, ch)
    let transferred = false
    // 채널 상세 — 이전 후 caller(나)는 OWNER→ADMIN 으로 강등(실제 백엔드 동작). stubBase 보다 나중에 등록되어 우선.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...ch, role: transferred ? 'ADMIN' : 'OWNER' }),
        })
      },
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        const members = [
          createChannelMember({ userId: 1, name: '나', role: transferred ? 'ADMIN' : 'OWNER' }),
          createChannelMember({ userId: 2, name: '동료', role: transferred ? 'OWNER' : 'MEMBER' }),
        ]
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) })
      },
    )
    // PATCH role:OWNER → 소유권 이전.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members/2`,
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback()
        const payload = route.request().postDataJSON() as { role: string }
        expect(payload).toEqual({ role: 'OWNER' })
        transferred = true
        return route.fulfill({ status: 204 })
      },
    )
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/leave`,
      (route) => (route.request().method() === 'POST' ? route.fulfill({ status: 204 }) : route.fallback()),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    // 동료(2)를 OWNER 로 — 역할 select 사용(myRole=OWNER, isSelf=false → select 렌더).
    await page.getByTestId('member-role-select-2').selectOption('OWNER')
    // 이전 후 detail 무효화 → 나는 ADMIN 으로 강등(isOwner=false) → 동료(2)는 뱃지로 OWNER 표시.
    await expect(page.getByTestId('member-role-2')).toContainText('OWNER')
    // 이제 나가기.
    await page.getByTestId('channel-leave-btn').click()
    await page.getByTestId('channel-leave-confirm').click()
    await expect(page).toHaveURL(/\/chat$/)
  })
})
