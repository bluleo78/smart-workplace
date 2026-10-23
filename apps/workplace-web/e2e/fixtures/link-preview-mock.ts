// 링크 미리보기(WP-874) E2E 공용 목 — 팀 채팅 채널 1 에 링크가 든 메시지 3개와 미리보기 썸네일·지우기 경로를 스텁한다.
// 데스크톱(chat/)·모바일(mobile/) spec 이 같이 쓴다(spec 끼리 import 하면 테스트가 두 번 등록되므로 fixture 로 둔다).
import type { Page } from '@playwright/test'

import { createChannelMember, createLinkPreview, createMessage } from '../factories/messaging.factory'
import { json } from './mobile-chat'
import { stubChat } from './mobile.fixture'
import { solidPng } from './png'
import { trackRequests } from './requests'

export const PNG = solidPng(120, 63)

// 실제처럼 긴 데이터 — 공백 없는 긴 URL·두 줄을 넘는 제목·설명으로 넘침을 확인한다.
export const LONG_URL =
  'https://github.com/CopilotKit/OpenIntelligentUI/blob/main/packages/react-core/src/components/chat/IntelligentMessageRenderer.tsx?plain=1#L120-L188'
export const LONG_TITLE =
  'GitHub - CopilotKit/OpenIntelligentUI: Open-source building blocks for intelligent, agent-native user interfaces — React components, hooks and examples for building AI copilots'

/** 10: 동료(이진우) — 긴 URL + 썸네일 있는 카드. 11: 본인 — www. 링크 + 썸네일 없는 카드. 12: 동료 — 아직 미리보기 없음(SSE 로 붙는다). */
export function linkMessages() {
  return [
    createMessage({
      id: 12, channelId: 1, authorId: 20, authorName: '이진우', createdAt: '2026-10-23T04:50:00Z',
      body: '문서 공유 https://docs.example.com/a',
    }),
    createMessage({
      id: 11, channelId: 1, authorId: 1, authorName: 'me', createdAt: '2026-10-23T04:45:00Z',
      body: '회의록은 www.example.com/notes 에 있어요.',
      linkPreviews: [
        createLinkPreview({ url: 'https://www.example.com/notes', title: 'Example Notes', siteName: null, description: 'og:image 가 없는 페이지 — 썸네일 없이 글만' }),
      ],
    }),
    createMessage({
      id: 10, channelId: 1, authorId: 20, authorName: '이진우', createdAt: '2026-10-23T04:42:00Z',
      body: `이거 참고해 보세요 ${LONG_URL} UI 구성 괜찮네요`,
      linkPreviews: [
        createLinkPreview({
          url: LONG_URL,
          title: LONG_TITLE,
          description:
            'Open-source building blocks for intelligent, agent-native user interfaces. React components, hooks and examples for building AI copilots, in-app agents and generative UI that adapts to what your users are doing right now.',
          hasImage: true,
        }),
      ],
    }),
  ]
}

/**
 * 채널 1 + 링크 메시지 + 썸네일(PNG, 실패시키려면 imageStatus)·지우기(dismissStatus) 경로를 스텁한다.
 * 돌려주는 추적기로 썸네일·DELETE 요청을 확인한다.
 */
export async function stubLinkPreviewChannel(
  page: Page,
  opts: {
    dismissStatus?: number
    imageStatus?: number
    // 뒤에 덧붙일 짧은 새 메시지 수 — 모바일 길게 누르기 대상을 화면 위쪽으로 올린다(시트가 손가락 아래에 열리면
    // CDP 터치 에뮬레이션이 손을 뗄 때의 click 을 시트 행에 떨어뜨린다. 실기기는 길게 누른 뒤 click 을 보내지 않는다).
    padNewer?: number
  } = {},
) {
  await stubChat(page)
  const pad = Array.from({ length: opts.padNewer ?? 0 }, (_, i) =>
    createMessage({ id: 100 + i, channelId: 1, authorId: 20, authorName: '이진우', body: `확인 ${i + 1}`, createdAt: `2026-10-23T05:${String(10 + i * 6).padStart(2, '0')}:00Z` }),
  ).reverse()
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ items: [...pad, ...linkMessages()], nextCursor: null, hasMore: false })) : r.fallback())
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/members', (r) =>
    r.fulfill(json([createChannelMember({ userId: 1, name: 'me' }), createChannelMember({ userId: 20, name: '이진우' })])))
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/read', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route(
    (u) => /^\/api\/v1\/messaging\/messages\/\d+\/link-previews\/\d+\/image$/.test(u.pathname),
    (r) =>
      opts.imageStatus && opts.imageStatus !== 200
        ? r.fulfill({ status: opts.imageStatus, body: '' })
        : r.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  )
  await page.route(
    (u) => /^\/api\/v1\/messaging\/messages\/\d+\/link-previews$/.test(u.pathname),
    (r) =>
      r.request().method() === 'DELETE'
        ? r.fulfill(opts.dismissStatus && opts.dismissStatus >= 400 ? { ...json({ message: '실패' }), status: opts.dismissStatus } : { status: 204, body: '' })
        : r.fallback(),
  )
  return {
    images: trackRequests(page, 'GET', (u) => /\/link-previews\/\d+\/image$/.test(u.pathname)),
    dismisses: trackRequests(page, 'DELETE', (u) => /\/link-previews$/.test(u.pathname)),
  }
}

/** messaging.message.link-previews SSE 프레임 — 서버 payload 와 같은 모양. */
export function linkPreviewsFrame(id: number, linkPreviews: ReturnType<typeof createLinkPreview>[]) {
  return `event: messaging.message.link-previews\ndata: ${JSON.stringify({ channelId: 1, id, linkPreviews })}\n\n`
}
