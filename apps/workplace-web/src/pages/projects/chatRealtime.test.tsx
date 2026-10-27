// 이슈 채팅 실시간 SSE(Phase 6b) — 페이지 테스트(WP-980).
// 통합 SSE(/api/v1/events)는 fetch 스트림이라 MSW 로 열린 스트림을 주고 chat.message.created 프레임을 밀어 넣는다.
// 실제 서버 없이 프레임 → 캐시 upsert → 렌더만 보므로 e2e/pages/projects/chat-realtime.spec.ts 에서 옮겼다.
// 이슈 상세 화면만 renderIssueDetailScreen 으로 띄운다(WP-1002) — 채팅 드로워는 상세 화면이 ?chat=1 로 연다.
// 본인 메시지 self-echo 중복 제거(#37)는 TipTap 입력창에 글자를 쳐야 해(jsdom 은 ProseMirror 입력·좌표 API 가 없다) E2E @input 으로 남는다.
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { controllableEvents } from '@/test/kits/projects/issueDetailEvents'
import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { appEventStream, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { ChatMessageResponse } from '@/types/chat'

import { createChatMember, createChatMessage, createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'
const THREAD_ID = 100
const ME_ID = 1

const message = (id: number, body: string) =>
  createChatMessage({ id, threadId: THREAD_ID, authorId: ME_ID, authorName: '테스트 사용자', authorKind: 'HUMAN', body })

/** 이슈 상세 + 채팅 스레드(시드 메시지) + 열린 SSE. create POST 는 이 시나리오에서 불리면 안 된다(404). */
function chatHandlers(seed: ChatMessageResponse[]) {
  const events = controllableEvents()
  const thread = createChatThread({
    threadId: THREAD_ID,
    issueId: 1,
    members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
    recentMessages: seed,
  })
  const handlers = issueDetailHandlers({
    key: KEY,
    detail: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: 'SSE 실시간 테스트' }) }),
    extra: [
      events.handler,
      http.get(`/api/v1/projects/${KEY}/issues/1/chat/thread`, () => HttpResponse.json(thread)),
      http.get(`/api/v1/chat/threads/${THREAD_ID}/messages`, () => HttpResponse.json({ items: seed, nextCursor: null, hasMore: false })),
      http.post(`/api/v1/chat/threads/${THREAD_ID}/messages`, () => new HttpResponse(null, { status: 404 })),
      http.post(`/api/v1/chat/threads/${THREAD_ID}/read`, () => new HttpResponse(null, { status: 204 })),
    ],
  })
  return { handlers, events }
}

describe('chat 실시간 SSE', () => {
  // 드로워를 열어 메시지 캐시가 준비된 뒤(시드 메시지가 보인 뒤) 도착한 프레임이 create POST 없이 upsert 되는지.
  test('SSE 로 도착한 메시지가 create POST 없이 바로 그려진다', async () => {
    const { handlers, events } = chatHandlers([message(1, '기존 메시지')])
    const { user } = renderIssueDetailScreen(`/projects/${KEY}/issues/1`, { handlers, extra: appEventStream(ME_ID) })
    await user.click(await screen.findByTestId('issue-chat-open', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
    expect(await screen.findByText('기존 메시지')).toBeInTheDocument()
    await events.push(`event: chat.message.created\ndata: ${JSON.stringify(message(999, 'SSE 실시간 메시지'))}\n\n`)
    expect(await screen.findByText('SSE 실시간 메시지')).toBeInTheDocument()
  })

})
