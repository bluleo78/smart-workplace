// 모바일 페이지 테스트 공용 MSW 응답(WP-981) — E2E 의 e2e/fixtures/mobile.fixture(stubChat)·mobile-chat(stubChannelMessages·stubIssue)를
// 네트워크 계층(MSW)으로 옮긴 것. 데이터는 E2E 와 같은 팩토리를 써서 두 쪽 테스트가 같은 화면 상태를 본다.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { useEffect } from 'react'
import { BrowserRouter, useLocation } from 'react-router-dom'

import App from '@/App'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/hooks/AuthContext'
import { authHandlers, MOCK_USER_ROLE, shellHandlers } from '@/test/msw/baseHandlers'
import { server } from '@/test/msw/server'
import type { ChannelResponse, DmResponse } from '@/types/messaging'

import { createUser } from '../../../../e2e/factories/auth.factory'
import { createChatMember, createChatMessage, createChatThread } from '../../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { createChannel, createChannelMember, createDm, createMessage } from '../../../../e2e/factories/messaging.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

const API = '/api/v1'

/** 채널·DM 목록과 채널 1 상세(stubChat 과 같음). */
export function chatHandlers(opts: { channels?: ChannelResponse[]; dms?: DmResponse[] } = {}) {
  const channels = opts.channels ?? [createChannel({ id: 1, name: '모바일-개편', unreadCount: 0 })]
  const dms = opts.dms ?? [createDm({ id: 2, unreadCount: 0 })]
  return [
    http.get(`${API}/messaging/channels`, () => HttpResponse.json(channels)),
    http.get(`${API}/messaging/channels/1`, () => HttpResponse.json(channels[0])),
    http.get(`${API}/messaging/dms`, () => HttpResponse.json(dms)),
  ]
}

/** 채널 1 메시지(stubChannelMessages 와 같음) — 10: 타인(답글 2개·멘션 칩), 11: 본인(id 1). */
export function channelMessageHandlers(messages?: ReturnType<typeof createMessage>[]) {
  const peer = createMessage({
    id: 10, channelId: 1, authorId: 20, authorName: '동료', body: '<@20> 확인 부탁해요',
    mentions: [{ id: 20, username: 'peer', name: '동료', kind: 'HUMAN' }], replyCount: 2, createdAt: '2026-09-30T03:00:00Z',
  })
  const own = createMessage({ id: 11, channelId: 1, authorId: 1, authorName: 'me', body: '모바일 화면 캡처 공유드립니다.', createdAt: '2026-09-30T03:10:00Z' })
  return [
    ...chatHandlers(),
    http.get(`${API}/messaging/channels/1/messages`, () => HttpResponse.json({ items: messages ?? [own, peer], nextCursor: null, hasMore: false })),
    http.get(`${API}/messaging/channels/1/members`, () =>
      HttpResponse.json([createChannelMember({ userId: 1, name: 'me' }), createChannelMember({ userId: 20, name: '동료' })])),
    http.post(`${API}/messaging/channels/1/read`, () => new HttpResponse(null, { status: 204 })),
  ]
}

/** 이슈 MOB-1 상세·이슈 채팅(stubIssue 와 같음) — 501: 타인, 502: 본인. */
export const ISSUE_KEY = 'MOB'
export function issueChatHandlers() {
  const issue = createIssue({ id: 1, number: 1, projectKey: ISSUE_KEY, title: '하단 탭바' })
  const base = `${API}/projects/${ISSUE_KEY}/issues/1`
  const peerMsg = createChatMessage({ id: 501, threadId: 100, authorId: 20, authorName: '동료', body: '확인했습니다' })
  const ownMsg = createChatMessage({ id: 502, threadId: 100, authorId: 1, authorName: 'me', body: '내 메시지' })
  const thread = createChatThread({
    threadId: 100,
    members: [createChatMember({ userId: 1, lastReadMessageId: 502 }), createChatMember({ userId: 20, name: '동료' })],
    recentMessages: [peerMsg, ownMsg],
  })
  return [
    http.get(`${API}/projects/${ISSUE_KEY}`, () => HttpResponse.json(createProject({ key: ISSUE_KEY }))),
    http.get(`${API}/projects/${ISSUE_KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([issue], null))),
    http.get(base, () => HttpResponse.json(createIssueDetail({ summary: issue }))),
    ...['watchers', 'labels', 'attachments'].map((s) => http.get(`${base}/${s}`, () => HttpResponse.json([]))),
    http.get(`${base}/chat/thread`, () => HttpResponse.json(thread)),
    http.get(`${API}/chat/threads/100/messages`, () => HttpResponse.json({ items: [ownMsg, peerMsg], nextCursor: null, hasMore: false })),
    http.post(`${API}/chat/threads/100/read`, () => new HttpResponse(null, { status: 204 })),
  ]
}

/** 주소가 바뀔 때마다 알린다(renderPage 의 LocationProbe 와 같음). */
 
function LocationProbe({ onChange }: { onChange: (location: string) => void }) {
  const loc = useLocation()
  useEffect(() => onChange(loc.pathname + loc.search), [loc, onChange])
  return null
}

/**
 * renderPage(src/test/renderPage.tsx)와 같되 MemoryRouter 대신 BrowserRouter 로 띄운다.
 * 왜: 상세 닫기(useHistoryParam.close)는 BrowserRouter 가 history.state 에 심는 idx 로 「앱 안에서 연 항목」을 알아보고 history.back 으로 닫는다.
 * MemoryRouter 는 window.history 를 쓰지 않아 닫기가 무동작이 된다 — 닫기 뒤 화면을 보는 테스트는 jsdom 의 실제 세션 히스토리를 쓴다.
 */
export function renderPageWithHistory(path: string, { handlers = [] }: { handlers?: RequestHandler[] } = {}) {
  server.use(...handlers, ...authHandlers(createUser({ aiAvailable: true }), [MOCK_USER_ROLE]), ...shellHandlers)
  window.localStorage.setItem('hasSession', '1')
  window.history.replaceState(null, '', path)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false }, mutations: { retry: false, networkMode: 'always' } },
  })
  let current = path
  const view = render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
        <LocationProbe
          onChange={(l) => {
            current = l
          }}
        />
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>,
  )
  return { ...view, user: userEvent.setup(), queryClient, location: () => current }
}
