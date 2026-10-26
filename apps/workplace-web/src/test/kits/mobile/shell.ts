// 모바일 셸 페이지 테스트 공용(WP-981) — E2E mobile.fixture 의 stubChat 과 같은 채널·DM 목록을 MSW 로 준다.
// moduleLayout·shell·uiuxU2 페이지 테스트가 같이 쓴다.
import { http, HttpResponse, type RequestHandler } from 'msw'

import { renderPage } from '@/test/renderPage'

import { createChannel, createDm } from '../../../../e2e/factories/messaging.factory'

const emptyCursor = { items: [], nextCursor: null, hasMore: false }

/** 채널 1개(모바일-개편)·DM 1개와 채널 상세·메시지·드라이브 공간 — 탭 루트와 채널 상세가 부르는 조회. */
export function chatHandlers({ unread = 0 } = {}): RequestHandler[] {
  const channel = createChannel({ id: 1, name: '모바일-개편', unreadCount: unread })
  return [
    http.get('/api/v1/messaging/channels', () => HttpResponse.json([channel])),
    http.get('/api/v1/messaging/channels/1', () => HttpResponse.json(channel)),
    http.get('/api/v1/messaging/channels/1/messages', () => HttpResponse.json(emptyCursor)),
    http.get('/api/v1/messaging/dms', () => HttpResponse.json([createDm({ id: 2, unreadCount: 0 })])),
  ]
}

/** 모바일 화면을 채팅 기본 스텁과 함께 띄운다. extra 가 먼저 등록돼 우선한다. */
export function renderMobile(path: string, options: Parameters<typeof renderPage>[1] = {}, chat: { unread?: number } = {}) {
  return renderPage(path, { ...options, handlers: [...(options.handlers ?? []), ...chatHandlers(chat)] })
}
