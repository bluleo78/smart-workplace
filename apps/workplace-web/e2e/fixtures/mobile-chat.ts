// 모바일 채팅 E2E 공용 헬퍼 — 길게 누르기(CDP 터치)·팀 채팅 채널 1·이슈 MOB-1 채팅 목 데이터.
// U4·U5 spec 이 함께 쓴다(spec 끼리 import 하면 테스트가 두 번 등록되므로 fixture 로 둔다).
import type { Locator, Page } from '@playwright/test'

import { createChatMember, createChatMessage, createChatThread } from '../factories/chat.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../factories/issue.factory'
import { createChannelMember, createMessage } from '../factories/messaging.factory'
import { createProject } from '../factories/project.factory'
import { stubChat } from './mobile.fixture'
import { stableBox } from './wait'

export const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/**
 * 실제 손가락 길게 누르기 — CDP 터치 이벤트로 touchStart → 대기 → touchEnd.
 * 합성 dispatchEvent 와 달리 브라우저가 pointer·contextmenu·click 을 실제 순서대로 만들어,
 * "발동 뒤 손을 뗄 때 오는 click" 억제까지 검증할 수 있다.
 */
export async function longPress(page: Page, target: Locator, holdMs = 700) {
  const box = await stableBox(target)
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
  // eslint-disable-next-line playwright/no-wait-for-timeout -- 길게 누르기 제스처 자체의 유지 시간(손가락을 누르고 있는 동작)이라 조건 대기로 바꿀 수 없다
  await page.waitForTimeout(holdMs)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

/**
 * 마우스 길게 누르기 — 요소 중심으로 이동 → down → holdMs 유지 → up.
 * 보드 카드·이슈 행처럼 마우스 포인터 이벤트로 길게 누르기를 판정하는 화면에서 쓴다.
 */
export async function longPressWithMouse(page: Page, target: Locator, holdMs = 650) {
  const box = await stableBox(target)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  // eslint-disable-next-line playwright/no-wait-for-timeout -- 길게 누르기 제스처 자체의 유지 시간(누르고 있는 동작)이라 조건 대기로 바꿀 수 없다
  await page.waitForTimeout(holdMs)
  await page.mouse.up()
}

// ── 팀 채팅(채널 1) ────────────────────────────────────────────────────────────
// auth.fixture 의 본인 id = 1. 10: 타인(답글 2개·멘션 칩), 11: 본인.
export const MENTIONS = [{ id: 20, username: 'peer', name: '동료', kind: 'HUMAN' as const }]
export async function stubChannelMessages(page: Page) {
  await stubChat(page)
  const peer = createMessage({
    id: 10, channelId: 1, authorId: 20, authorName: '동료', body: '<@20> 확인 부탁해요', mentions: MENTIONS,
    replyCount: 2, createdAt: '2026-09-30T03:00:00Z',
  })
  const own = createMessage({
    id: 11, channelId: 1, authorId: 1, authorName: 'me', body: '모바일 화면 캡처 공유드립니다.',
    createdAt: '2026-09-30T03:10:00Z',
  })
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ items: [own, peer], nextCursor: null, hasMore: false })) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/members', (r) =>
    r.fulfill(json([createChannelMember({ userId: 1, name: 'me' }), createChannelMember({ userId: 20, name: '동료' })])))
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/read', (r) => r.fulfill({ status: 204, body: '' }))
}

// ── 이슈 상세·이슈 채팅 ───────────────────────────────────────────────────────────
export const KEY = 'MOB'
export const DETAIL = new RegExp(`/projects/${KEY}/issues/1$`)
export async function stubIssue(page: Page, opts: { unread?: boolean } = {}) {
  const issue = createIssue({ id: 1, number: 1, projectKey: KEY, title: '하단 탭바' })
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))))
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(createIssueSearchResponse([issue], null))) : r.fallback())
  const base = `/api/v1/projects/${KEY}/issues/1`
  await page.route((u) => u.pathname === base, (r) => r.fulfill(json(createIssueDetail({ summary: issue }))))
  await page.route((u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${base}/${s}`),
    (r) => r.fulfill(json([])))
  for (const p of [`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`]) {
    await page.route((u) => u.pathname === p, (r) => r.fulfill(json([])))
  }
  const peerMsg = createChatMessage({ id: 501, threadId: 100, authorId: 20, authorName: '동료', body: '확인했습니다' })
  const ownMsg = createChatMessage({ id: 502, threadId: 100, authorId: 1, authorName: 'me', body: '내 메시지' })
  const thread = createChatThread({
    threadId: 100,
    members: [createChatMember({ userId: 1, lastReadMessageId: opts.unread ? 0 : 502 }), createChatMember({ userId: 20, name: '동료' })],
    recentMessages: opts.unread ? [peerMsg] : [peerMsg, ownMsg],
  })
  await page.route(`**${base}/chat/thread`, (r) => r.fulfill(json(thread)))
  await page.route('**/api/v1/chat/threads/100/messages', (r) =>
    r.request().method() === 'GET'
      ? r.fulfill(json({ items: opts.unread ? [peerMsg] : [ownMsg, peerMsg], nextCursor: null, hasMore: false }))
      : r.fallback())
  await page.route('**/api/v1/chat/threads/100/read', (r) => r.fulfill({ status: 204, body: '' }))
}

