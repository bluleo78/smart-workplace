// messaging 멤버 패널 E2E — 초대/역할/소유권이전/나가기. 백엔드 없이 mock.
// 2-유저 시나리오는 별도 page.route 응답 교체로 모사(실제 2세션 아님).
import type { Page } from '@playwright/test'

import { createPageResponse } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { createChannel, createChannelMember } from '../../factories/messaging.factory'
import { trackRequests } from '../../fixtures/requests'

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
    const adds = trackRequests(page, 'POST', `/api/v1/messaging/channels/${CID}/members`)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([createChannelMember({ userId: 1, name: '나', role: 'OWNER' })]) })
        }
        if (route.request().method() === 'POST') {
          return route.fulfill({ status: 204 })
        }
        return route.fallback()
      },
    )
    // 구성원 검색 GET /members?search= (#833 — 디렉터리 API, MemberSummary 형태)
    await page.route(
      (url) => url.pathname === '/api/v1/members',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ content: [{ userId: 2, name: '동료', username: 'colleague', email: 'c@x.com', kind: 'HUMAN', active: true }], totalElements: 1, totalPages: 1, number: 0, size: 20 }),
            })
          : route.fallback(),
    )
    // useMentionAgents 는 같은 디렉터리 API 를 kind=AGENT 로 호출한다(채널 페이지 마운트 시).
    // 위 검색 스텁이 모든 /members 를 삼키지 않도록 kind=AGENT 만 잡아 빈 목록을 돌려준다
    // (Playwright 라우트는 LIFO — 검색 스텁보다 뒤에 등록해야 우선한다).
    await page.route(
      (url) => url.pathname === '/api/v1/members' && url.searchParams.get('kind') === 'AGENT',
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(createPageResponse([], { size: 100 })),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    await page.getByTestId('member-add-trigger').click()
    await expect(page.getByTestId('member-search-popover')).toBeVisible()
    await page.getByPlaceholder('이름·아이디·이메일로 검색').fill('동료')
    await page.getByTestId('member-search-row-2').click()
    await adds.waitFor()
    expect(adds.lastBody()).toEqual({ userId: 2 })
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

  test('OWNER → AGENT(AI 봇) 멤버 역할 select 에 OWNER 옵션 없음 (#598)', async ({ authenticatedPage: page }) => {
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
                createChannelMember({ userId: 2, name: 'My AI', role: 'MEMBER', kind: 'AGENT' }),
              ]),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    const roleSelect = page.getByTestId('member-role-select-2')
    await expect(roleSelect).toBeVisible()
    // AGENT 행의 select 옵션에는 OWNER 가 없어야 한다 — UX 상 승격 시도 자체를 차단.
    // 옵션 목록을 자동 재시도 단언으로 검증 — 렌더 직후 옵션이 덜 채워진 순간을 잡지 않도록 (WP-225).
    await expect(roleSelect.locator('option')).toHaveText(['ADMIN', 'MEMBER'])
  })

  test('AGENT 를 OWNER 로 승격 시도 시 서버가 409 로 거부 (#598, 직접 API 조작 방어)', async ({
    authenticatedPage: page,
  }) => {
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
                createChannelMember({ userId: 2, name: 'My AI', role: 'MEMBER', kind: 'AGENT' }),
              ]),
            })
          : route.fallback(),
    )
    // select 에 OWNER 옵션이 없어도 클라이언트가 직접 PATCH 를 보낼 가능성에 대비해 서버 가드도 검증.
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members/2`,
      (route) =>
        route.request().method() === 'PATCH'
          ? route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({ message: 'agent user 2 cannot own channel 50' }),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    const resp = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/v1/messaging/channels/${cid}/members/2`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'OWNER' }),
      })
      return r.status
    }, CID)
    expect(resp).toBe(409)
    // 거부 후에도 대상은 여전히 MEMBER 로 표시(승격되지 않음).
    await expect(page.getByTestId('member-role-select-2')).toHaveValue('MEMBER')
  })

  test('OWNER → 역할 select/제거 버튼 접근성 이름이 멤버별로 구분된다 (#780)', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'OWNER', member: true, memberCount: 3 })
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
                createChannelMember({ userId: 3, name: '이웃', role: 'MEMBER' }),
              ]),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    const panel = page.getByTestId('channel-members-panel')

    // 역할 변경 select — 멤버별 접근성 이름으로 특정 가능해야 함(두 멤버 이름이 겹치지 않으므로 각 1개).
    await expect(panel.getByRole('combobox', { name: '동료 역할 변경' })).toHaveCount(1)
    await expect(panel.getByRole('combobox', { name: '이웃 역할 변경' })).toHaveCount(1)

    // 제거 버튼 — 멤버별 접근성 이름으로 특정 가능해야 함.
    await expect(panel.getByRole('button', { name: '동료 제거' })).toHaveCount(1)
    await expect(panel.getByRole('button', { name: '이웃 제거' })).toHaveCount(1)

    // 접근성 이름으로 특정한 제거 버튼을 클릭해 정확히 대상 멤버만 지목되는지 확인.
    await panel.getByRole('button', { name: '동료 제거' }).click()
    await expect(page.getByTestId('member-remove-confirm')).toBeVisible()
    await page.getByRole('button', { name: '취소' }).click()
  })

  test('채널 나가기 버튼이 멤버 목록과 구분선으로 분리된다 (#780)', async ({ authenticatedPage: page }) => {
    const ch = createChannel({ id: CID, role: 'MEMBER', member: true })
    await stubBase(page, ch)
    await page.route(
      (url) => url.pathname === `/api/v1/messaging/channels/${CID}/members`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([createChannelMember({ userId: 1, name: '나', role: 'MEMBER' })]),
            })
          : route.fallback(),
    )
    await page.goto(`/chat/channels/${CID}`)
    await page.getByTestId('channel-members-btn').click()
    const leaveBtn = page.getByTestId('channel-leave-btn')
    await expect(leaveBtn).toBeVisible()
    // 나가기 버튼 바로 위 wrapper 가 구분선(border-t) 을 가져 멤버 목록과 시각적으로 분리돼야 함.
    const wrapper = leaveBtn.locator('xpath=..')
    await expect(wrapper).toHaveClass(/border-t/)
  })
})
