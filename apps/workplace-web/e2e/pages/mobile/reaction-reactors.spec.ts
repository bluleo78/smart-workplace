// WP-106 모바일 — 반응 칩 길게 누르기 → 반응자 시트(누른 이모지 탭), 손 뗀 뒤 토글 없음.
// 칩 밖(말풍선) 길게 누르기는 기존 메시지 작업 시트, 칩 짧은 탭은 토글 그대로.
import type { Page } from '@playwright/test'

import { createChannelMember, createMessage, createReaction } from '../../factories/messaging.factory'
import { json, longPress } from '../../fixtures/mobile-chat'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

const MSG = 10

async function setup(page: Page) {
  await stubChat(page)
  const msg = createMessage({
    id: MSG,
    channelId: 1,
    authorId: 20,
    authorName: '동료',
    body: '배포 끝났습니다',
    createdAt: '2026-09-30T03:00:00Z',
    reactions: [
      createReaction({ emoji: '👍', count: 2, reacted: true }),
      createReaction({ emoji: '🎉', count: 1, reacted: false }),
    ],
  })
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ items: [msg], nextCursor: null, hasMore: false })) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/members', (r) =>
    r.fulfill(json([createChannelMember({ userId: 1, name: '양동희' }), createChannelMember({ userId: 20, name: '동료' })])))
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/read', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route((u) => u.pathname === `/api/v1/messaging/messages/${MSG}/reactions/users`, (r) => {
    const emoji = new URL(r.request().url()).searchParams.get('emoji')
    const items = emoji === '👍'
      ? [{ userId: 1, name: '양동희', kind: 'HUMAN' }, { userId: 20, name: '동료', kind: 'HUMAN' }]
      : [{ userId: 20, name: '동료', kind: 'HUMAN' }]
    return r.fulfill(json({ items, nextCursor: null, hasMore: false }))
  })
}

test.describe('WP-106 반응자 — 모바일 길게 누르기', () => {
  test('칩을 길게 누르면 반응자 시트가 열리고, 손을 떼도 반응이 토글되지 않는다', async ({ authenticatedPage: page }) => {
    await setup(page)
    const toggles = trackRequests(page, 'DELETE', `/api/v1/messaging/messages/${MSG}/reactions`)
    await page.goto('/chat/channels/1')
    // 터치 셸엔 툴바가 없으므로 툴바의 "반응한 사람 보기" 버튼도 없다 — 길게 누르기가 그 경로를 맡는다.
    await expect(page.getByTestId(`reaction-pill-${MSG}-👍`)).toBeVisible()
    await expect(page.getByTestId(`message-reactors-${MSG}`)).toHaveCount(0)
    await longPress(page, page.getByTestId(`reaction-pill-${MSG}-👍`))

    const sheet = page.getByTestId('reactors-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('reactors-tab-👍')).toHaveAttribute('aria-selected', 'true')
    await expect(sheet.getByTestId('reactor-row-me')).toBeVisible()
    await expect(sheet.getByTestId('reactor-row-20')).toContainText('동료')
    await expect(page.getByTestId('message-action-sheet')).toHaveCount(0)
    // 발동 뒤 click 이 칩 토글로 새지 않는다.
    await expect(page.getByTestId(`reaction-count-${MSG}-👍`)).toHaveText('2')
    await expectStays(page, () => toggles.count(), 0, { ms: 300 })
  })

  test('칩 밖(본문)을 길게 누르면 기존 메시지 작업 시트', async ({ authenticatedPage: page }) => {
    await setup(page)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId(`message-body-${MSG}`))
    await expect(page.getByTestId('message-action-sheet')).toBeVisible()
    await expect(page.getByTestId('reactors-sheet')).toHaveCount(0)
  })

  test('칩 짧은 탭은 그대로 토글', async ({ authenticatedPage: page }) => {
    await setup(page)
    const posts = trackRequests(page, 'POST', `/api/v1/messaging/messages/${MSG}/reactions`)
    await page.route((u) => u.pathname === `/api/v1/messaging/messages/${MSG}/reactions`, (r) =>
      r.request().method() === 'POST' ? r.fulfill({ status: 204, body: '' }) : r.fallback())
    await page.goto('/chat/channels/1')
    await page.getByTestId(`reaction-pill-${MSG}-🎉`).tap()
    await expect.poll(() => posts.lastBody<{ emoji: string }>()?.emoji).toBe('🎉')
    await expect(page.getByTestId('reactors-sheet')).toHaveCount(0)
  })
})
