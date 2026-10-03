// 모바일 뒤로가기 히스토리 — 채팅 스레드(?thread)(WP-207).
// 채널 안 "답글"도 push 라 시스템 뒤로가기가 스레드만 닫는다. 모바일은 스레드를 전체폭으로(채널 컬럼 숨김) 보인다.
import type { Page } from '@playwright/test'

import { createMessage, createThreadInboxItem } from '../../factories/messaging.factory'
import { json, stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

// 실데이터 폭 검증용 긴 답글.
const LONG_REPLY = '배포 전 체크리스트를 다시 확인해 보니 결제 모듈 마이그레이션 스크립트가 운영 DB 에서 잠금을 오래 잡을 수 있어 야간 배포로 옮기는 게 좋겠습니다.'

async function stubThread(page: Page) {
  await stubChannelMessages(page) // 채널 1(모바일-개편), 메시지 10(답글 2)·11
  await page.route((u) => u.pathname === '/api/v1/messaging/messages/10/replies', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json({ items: [createMessage({ id: 30, channelId: 1, parentMessageId: 10, authorId: 20, authorName: '동료', body: LONG_REPLY })], nextCursor: null, hasMore: false }))
      : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/messages/10/thread/read', (r) => r.fulfill({ status: 204, body: '' }))
}

test('답글 → 전체폭 스레드, goBack 은 스레드만 닫고 채널에 남는다 — ‹ 도 같은 결과', async ({ authenticatedPage: page }) => {
  await stubThread(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('message-thread-link-10').tap()
  const panel = page.getByTestId('thread-panel')
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(/\/chat\/channels\/1\?thread=10$/)
  // 모바일: 채널 컬럼 숨김 + 스레드 전체폭 + 상세 헤더(‹ 스레드 #채널명).
  await expect(page.getByTestId('channel-column')).toBeHidden()
  expect((await panel.boundingBox())!.width).toBeGreaterThanOrEqual(389)
  await expect(panel.getByTestId('mobile-back-title')).toHaveText('스레드')
  await expect(panel.getByTestId('thread-channel-name')).toHaveText('#모바일-개편')
  await expect(panel.getByTestId('message-30')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)

  await page.goBack()
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  await expect(panel).toHaveCount(0)
  await expect(page.getByTestId('channel-column')).toBeVisible()

  await page.getByTestId('message-thread-link-10').tap()
  await expect(panel).toBeVisible()
  await panel.getByTestId('mobile-back').tap()
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  await expect(panel).toHaveCount(0)
})

test('딥링크(푸시 알림 콜드 진입) ?thread → ‹ 는 thread 만 지우고 채널에 남는다', async ({ authenticatedPage: page }) => {
  await stubThread(page)
  await page.goto('/chat/channels/1?thread=10')
  const panel = page.getByTestId('thread-panel')
  await expect(panel).toBeVisible()
  await panel.getByTestId('mobile-back').tap()
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  await expect(page.getByTestId('channel-column')).toBeVisible()
})

test('스레드 인박스 → 스레드: ‹ 와 goBack 이 모두 인박스로 돌아간다', async ({ authenticatedPage: page }) => {
  await stubThread(page)
  const item = createThreadInboxItem({
    channelName: '모바일-개편',
    rootMessage: { id: 10, channelId: 1, body: '<@20> 확인 부탁해요', replyCount: 2, unreadReplyCount: 1, followed: true },
  })
  await page.route((u) => u.pathname === '/api/v1/messaging/threads/inbox', (r) =>
    r.fulfill(json({ items: [item], nextCursor: null, hasMore: false })))
  await page.route((u) => u.pathname === '/api/v1/messaging/threads/inbox/unread-count', (r) => r.fulfill(json({ count: 1 })))

  await page.goto('/chat/threads/inbox')
  await page.getByTestId('thread-inbox-card-10').tap()
  const panel = page.getByTestId('thread-panel')
  await expect(panel).toBeVisible()
  await panel.getByTestId('mobile-back').tap()
  await expect(page).toHaveURL(/\/chat\/threads\/inbox$/)

  await page.getByTestId('thread-inbox-card-10').tap()
  await expect(panel).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/chat\/threads\/inbox$/)
})

test('루트를 못 찾는 ?thread 는 채널을 숨기지 않는다(빈 전체폭 화면 방지)', async ({ authenticatedPage: page }) => {
  await stubThread(page)
  await page.goto('/chat/channels/1?thread=999')
  await expect(page.getByTestId('thread-panel')).toHaveCount(0)
  await expect(page.getByTestId('channel-column')).toBeVisible()
  await expect(page.getByTestId('message-body-10')).toBeVisible()
})

test('데스크톱(≥1024px)은 채널 옆 w-96 패널 그대로', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await stubThread(page)
  await page.goto('/chat/channels/1?thread=10')
  const panel = page.getByTestId('thread-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('channel-column')).toBeVisible()
  expect(Math.round((await panel.boundingBox())!.width)).toBe(384)
  await expect(panel.getByTestId('thread-close')).toBeVisible()
})
