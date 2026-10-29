// 모바일 뒤로가기 히스토리 — 채팅 스레드(?thread)(WP-207).
// 채널 안 "답글"도 push 라 시스템 뒤로가기가 스레드만 닫는다. 모바일은 스레드를 전체폭으로(채널 컬럼 숨김) 보인다.
// 브라우저가 있어야 판정되는 폭·시스템 뒤로가기만 남긴다. 딥링크 ?thread 의 ‹ 닫기·루트 없는 ?thread 에서 채널 유지는
// 페이지 테스트 src/pages/mobile/backThread.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test'

import { createMessage, createThreadInboxItem } from '../../factories/messaging.factory'
import { json, stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'
import { measureBox } from '../../fixtures/wait'

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

test('답글 → 전체폭 스레드, goBack 은 스레드만 닫고 채널에 남는다 — ‹ 도 같은 결과', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

test('스레드 인박스 → 스레드: ‹ 와 goBack 이 모두 인박스로 돌아간다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
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

test('데스크톱(≥1024px)은 채널 옆 w-96 패널 그대로', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await stubThread(page)
  await page.goto('/chat/channels/1?thread=10')
  const panel = page.getByTestId('thread-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('channel-column')).toBeVisible()
  // 셸·패널 배치가 자리 잡기 전 측정을 피하려 null 아님·폭까지 재시도한다(WP-225).
  await expect(async () => {
    expect(Math.round((await measureBox(panel)).width)).toBe(384)
  }).toPass()
  await expect(panel.getByTestId('thread-close')).toBeVisible()
})

// WP-1133: 채널 이름이 길면 이름이 두 줄로 늘어나며 「새 답글 N개」 배지를 밀어 「새 답글 / 1개」 두 줄로 꺾였다.
test('스레드 인박스 카드 — 채널 이름이 길어도 새 답글 배지는 한 줄 그대로, 이름은 말줄임', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const longName = '디지털전환추진본부클라우드플랫폼사업부인프라운영팀주간회의채널공지사항모음'
  const item = createThreadInboxItem({
    channelName: longName,
    rootMessage: { id: 10, channelId: 1, body: '배포 일정 확인 부탁드립니다', replyCount: 2, unreadReplyCount: 1, followed: true },
  })
  await page.route((u) => u.pathname === '/api/v1/messaging/threads/inbox', (r) =>
    r.fulfill(json({ items: [item], nextCursor: null, hasMore: false })))
  await page.route((u) => u.pathname === '/api/v1/messaging/threads/inbox/unread-count', (r) => r.fulfill(json({ count: 1 })))

  await page.goto('/chat/threads/inbox')
  const label = page.getByTestId('thread-inbox-card-label-10')
  const badge = page.getByTestId('thread-inbox-card-badge-10')
  await expect(badge).toHaveText('새 답글 1개')
  // 배지는 한 줄 — 높이가 글자 한 줄(16px 안팎)이고 이름 줄과 같은 줄에 선다.
  const [lb, bb] = await Promise.all([measureBox(label), measureBox(badge)])
  expect(bb.height, `배지 높이 ${bb.height}`).toBeLessThan(24)
  expect(lb.height, `이름 높이 ${lb.height}`).toBeLessThan(24)
  expect(Math.abs(lb.y + lb.height / 2 - (bb.y + bb.height / 2))).toBeLessThanOrEqual(2)
  // 이름은 남은 폭 안에서 말줄임되고 전체 이름은 title 로 볼 수 있다. 배지는 이름과 겹치지 않는다.
  await expect(label).toHaveAttribute('title', `#${longName}`)
  const { sw, cw } = await label.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  expect(sw).toBeGreaterThan(cw)
  expect(lb.x + lb.width).toBeLessThanOrEqual(bb.x)
  await expect(badge).toBeInViewport({ ratio: 1 })
})
