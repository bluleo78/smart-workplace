// 모바일 채팅 스레드(?thread) 진입·닫기(WP-207) — 페이지 테스트(WP-981).
// 딥링크 ?thread 에서 ‹ 가 thread 만 지우는 것, 루트를 못 찾는 ?thread 가 채널을 숨기지 않는 것은 주소·조건부 렌더라
// e2e/pages/mobile/back-thread.spec.ts 에서 옮겼다. 전체폭 스레드(폭)·시스템 뒤로가기(브라우저 히스토리)는 그 E2E 가 지킨다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import { mockViewport } from '@/test/viewport'

import { createChannel, createChannelMember, createMessage } from '../../../e2e/factories/messaging.factory'

mockViewport()

const MENTIONS = [{ id: 20, username: 'peer', name: '동료', kind: 'HUMAN' as const }]
const CHANNEL = createChannel({ id: 1, name: '모바일-개편', unreadCount: 0 })
const ROOT = createMessage({
  id: 10, channelId: 1, authorId: 20, authorName: '동료', body: '<@20> 확인 부탁해요', mentions: MENTIONS,
  replyCount: 2, createdAt: '2026-09-30T03:00:00Z',
})
const OWN = createMessage({ id: 11, channelId: 1, authorId: 1, authorName: 'me', body: '모바일 화면 캡처 공유드립니다.', createdAt: '2026-09-30T03:10:00Z' })
const REPLY = createMessage({ id: 30, channelId: 1, parentMessageId: 10, authorId: 20, authorName: '동료', body: '야간 배포로 옮기는 게 좋겠습니다.' })

/** 채널 1(메시지 10·11)과 메시지 10 의 답글 — e2e fixtures/mobile-chat 의 stubChannelMessages 와 같은 구성. */
const handlers = [
  http.get('/api/v1/messaging/channels', () => HttpResponse.json([CHANNEL])),
  http.get('/api/v1/messaging/channels/1', () => HttpResponse.json(CHANNEL)),
  http.get('/api/v1/messaging/channels/1/messages', () => HttpResponse.json({ items: [OWN, ROOT], nextCursor: null, hasMore: false })),
  http.get('/api/v1/messaging/channels/1/members', () =>
    HttpResponse.json([createChannelMember({ userId: 1, name: 'me' }), createChannelMember({ userId: 20, name: '동료' })]),
  ),
  http.post('/api/v1/messaging/channels/1/read', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/v1/messaging/messages/10/replies', () => HttpResponse.json({ items: [REPLY], nextCursor: null, hasMore: false })),
  http.post('/api/v1/messaging/messages/10/thread/read', () => new HttpResponse(null, { status: 204 })),
]

test('딥링크(푸시 알림 콜드 진입) ?thread → 상세 헤더(스레드 #채널), ‹ 는 thread 만 지우고 채널에 남는다', async () => {
  const { user, location } = renderPage('/chat/channels/1?thread=10', { handlers })
  const panel = await screen.findByTestId('thread-panel', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 모바일 스레드는 상세 헤더(‹ 스레드 #채널명)를 보이고 탭바가 없다. 채널 컬럼 숨김(CSS)은 E2E 가 본다.
  expect(within(panel).getByTestId('mobile-back-title')).toHaveTextContent('스레드')
  expect(within(panel).getByTestId('thread-channel-name')).toHaveTextContent('#모바일-개편')
  expect(await within(panel).findByTestId('message-30')).toBeInTheDocument()
  expect(screen.queryByTestId('mobile-tabbar')).not.toBeInTheDocument()

  await user.click(within(panel).getByTestId('mobile-back'))
  await waitFor(() => expect(location()).toBe('/chat/channels/1'))
  expect(screen.queryByTestId('thread-panel')).not.toBeInTheDocument()
  expect(screen.getByTestId('message-body-10')).toBeInTheDocument()
})

test('루트를 못 찾는 ?thread 는 채널을 숨기지 않는다(빈 전체폭 화면 방지)', async () => {
  renderPage('/chat/channels/1?thread=999', { handlers })
  expect(await screen.findByTestId('message-body-10', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.getByTestId('channel-column')).toBeInTheDocument()
  expect(screen.queryByTestId('thread-panel')).not.toBeInTheDocument()
})
