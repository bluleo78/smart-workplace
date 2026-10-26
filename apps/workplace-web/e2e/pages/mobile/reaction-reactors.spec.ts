// WP-106 모바일 — 반응 칩 길게 누르기 → 반응자 시트(누른 이모지 탭), 손 뗀 뒤 토글 없음.
// 칩 밖(말풍선) 길게 누르기는 기존 메시지 작업 시트, 칩 짧은 탭은 토글 그대로.
// 칩 짧은 탭 → 반응 토글은 src/pages/mobile/reactionReactors.test.tsx 가 지킨다(WP-981). 여기엔 길게 누르기(@input)·시트 높이(@layout)만.
import type { Page } from '@playwright/test'

import { createChannelMember, createMessage, createReaction } from '../../factories/messaging.factory'
import { json, longPress } from '../../fixtures/mobile-chat'
import { expect, stubChat, test } from '../../fixtures/mobile.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

const MSG = 10

async function setup(page: Page, authorId = 20) {
  await stubChat(page)
  const msg = createMessage({
    id: MSG,
    channelId: 1,
    authorId,
    authorName: authorId === 1 ? '양동희' : '동료',
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
  test('칩을 길게 누르면 반응자 시트가 열리고, 손을 떼도 반응이 토글되지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

  test('반응자가 많아도 시트가 화면을 넘지 않고, 마지막 행까지 스크롤해 온전히 볼 수 있다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await setup(page)
    // 👍 반응자를 시트 최대 높이를 넘길 만큼 늘린다(내 행 포함 12행) — 목록이 시트 안에서 스크롤돼야 한다.
    const many = Array.from({ length: 11 }, (_, i) => ({ userId: 100 + i, name: `동료${i + 1}`, kind: 'HUMAN' }))
    await page.route((u) => u.pathname === `/api/v1/messaging/messages/${MSG}/reactions/users`, (r) =>
      r.fulfill(json({ items: [{ userId: 1, name: '양동희', kind: 'HUMAN' }, ...many], nextCursor: null, hasMore: false })))
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId(`reaction-pill-${MSG}-👍`))
    const sheet = page.getByTestId('reactors-sheet')
    await expect(sheet).toBeVisible()
    const vh = page.viewportSize()!.height
    const last = sheet.getByTestId('reactor-row-110')
    await expect(last).toHaveCount(1)
    // 슬라이드 인 애니메이션(500ms)이 끝나 시트가 제자리에 앉을 때까지 기다린다.
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.y + (await sheet.boundingBox())!.height)).toBe(vh)
    const box = (await sheet.boundingBox())!
    expect(box.height).toBeLessThanOrEqual(vh * 0.8 + 1)
    await last.scrollIntoViewIfNeeded()
    const row = (await last.boundingBox())!
    expect(row.y + row.height).toBeLessThanOrEqual(vh)
    expect(row.y).toBeGreaterThanOrEqual(box.y)
    // 마지막 행 아래에 숨 쉴 여백이 있어야 한다(안전영역 0 인 기기에서도 시트 가장자리에 붙어 잘려 보이지 않게).
    expect(box.y + box.height - (row.y + row.height)).toBeGreaterThanOrEqual(8)
  })

  test('내 메시지를 수정 중이어도 그 메시지의 칩을 길게 누르면 반응자 시트가 열린다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    // 수정 중 행은 작업 시트 대상에서 빠지지만(C2), 에디터 밖의 반응 칩은 반응자 조회 대상이다.
    await setup(page, 1)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId(`message-body-${MSG}`))
    await page.getByTestId('message-action-sheet').getByTestId('message-action-edit').tap()
    await expect(page.getByTestId(`message-editor-input-${MSG}`)).toBeFocused()

    await longPress(page, page.getByTestId(`reaction-pill-${MSG}-👍`))
    await expect(page.getByTestId('reactors-sheet')).toBeVisible()
    await expect(page.getByTestId('message-action-sheet')).toHaveCount(0)
  })

  test('칩 밖(본문)을 길게 누르면 기존 메시지 작업 시트', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await setup(page)
    await page.goto('/chat/channels/1')
    await longPress(page, page.getByTestId(`message-body-${MSG}`))
    await expect(page.getByTestId('message-action-sheet')).toBeVisible()
    await expect(page.getByTestId('reactors-sheet')).toHaveCount(0)
  })
})
