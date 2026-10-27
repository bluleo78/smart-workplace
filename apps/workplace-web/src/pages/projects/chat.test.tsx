// 이슈 채팅 드로워(Phase 6d·#208·#289·#338·WP-213·WP-365) — 페이지 테스트(WP-980).
// AGENT 메시지 표식, 이전 메시지 더 보기(커서 요청), 변경 없는 저장의 PATCH 생략, 날짜 구분선(KST), canPost=false 안내는
// 브라우저 없이 판정되므로 e2e/pages/projects/chat.spec.ts 에서 옮겼다.
// 그 spec 에는 작성 흐름 배선(@wiring)·에디터 입력·포커스(@input)·말풍선 배치·스크롤(@layout)·실시간 typing·브라우저 시간대(@platform)가 남는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueChatHandlers, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { openIssueDetail } from '@/test/kits/projects/openIssueDetail'
import { PAGE_LOAD_TIMEOUT } from '@/test/renderPage'
import type { ChatMessageResponse, ChatThreadResponse } from '@/types/chat'

import { createChatMember, createChatMessage, createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const THREAD_ID = 100
const ME_ID = 1

/** 나와 AI 에이전트가 멤버인 스레드 — 덮어쓸 필드만 준다. */
function thread(over: Partial<ChatThreadResponse> = {}): ChatThreadResponse {
  return createChatThread({
    threadId: THREAD_ID,
    issueId: 1,
    members: [
      createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' }),
      createChatMember({ userId: 99, username: 'ai-agent', name: 'AI Agent', kind: 'AGENT' }),
    ],
    recentMessages: [],
    ...over,
  })
}

/** 이슈 상세를 열고 헤더 버튼으로 채팅 드로워를 연다(#558). */
async function openChat(
  t: ChatThreadResponse,
  { handlers = [], ...extra }: Omit<Parameters<typeof issueChatHandlers>[0], 'thread'> & { handlers?: RequestHandler[] } = {},
) {
  const view = await openIssueDetail({
    detail: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: 'chat 테스트' }) }),
    handlers: [...handlers, ...issueChatHandlers({ thread: t, ...extra })],
  })
  await view.user.click(screen.getByTestId('issue-chat-open'))
  await screen.findByTestId('chat-section', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

describe('메시지 표시', () => {
  // #208: AGENT 표식은 ai-accent 토큰(raw purple 팔레트 회귀 방지), #289: 아바타 우하단 AGENT 배지.
  test('AGENT 메시지는 data-agent·배지·ai-accent 테두리와 아바타 AGENT 표식을 단다', async () => {
    const msg = createChatMessage({ id: 500, threadId: THREAD_ID, authorId: 99, authorName: 'AI Agent', authorKind: 'AGENT', body: 'AI 응답입니다' })
    await openChat(thread({ recentMessages: [msg] }))
    const row = await screen.findByTestId('chat-message-500')
    expect(row).toHaveAttribute('data-agent', 'true')
    expect(row.className).toMatch(/border-ai-accent/)
    expect(row.className).not.toMatch(/border-purple/)
    expect(within(row).getByTestId('chat-avatar-99')).toBeInTheDocument()
    expect(within(row).getByTestId('chat-avatar-agent-99')).toBeInTheDocument()
    const badge = within(row).getByTestId('agent-badge')
    expect(badge.className).toMatch(/bg-ai-accent-subtle/)
    expect(badge.className).toMatch(/text-ai-accent/)
  })

  // #338: 날짜가 바뀔 때마다(첫 메시지 앞 포함) 구분선 — 같은 날 메시지 사이엔 없다. vitest TZ 는 Asia/Seoul.
  test('3일에 걸친 메시지 4건이면 날짜 구분선이 3개 — KST 날짜로 나뉜다', async () => {
    const msgs = [
      createChatMessage({ id: 10, body: 'day1-msg1', createdAt: '2026-06-01T01:00:00Z' }),
      createChatMessage({ id: 11, body: 'day1-msg2', createdAt: '2026-06-01T10:00:00Z' }),
      // UTC 로는 6월 1일이지만 KST 로는 6월 2일 01시 — UTC 날짜로 자르면 전날에 묶이는 회귀를 잡는다.
      createChatMessage({ id: 12, body: 'day2-msg1', createdAt: '2026-06-01T16:00:00Z' }),
      createChatMessage({ id: 13, body: 'day3-msg1', createdAt: '2026-06-03T06:00:00Z' }),
    ]
    await openChat(thread({ recentMessages: msgs }))
    await screen.findByTestId('chat-message-13')
    const dividers = screen.getAllByTestId('date-divider')
    expect(dividers).toHaveLength(3)
    expect(dividers[0]).toHaveTextContent(/2026년 6월 1일/)
    expect(dividers[1]).toHaveTextContent(/2026년 6월 2일/)
    expect(dividers[2]).toHaveTextContent(/2026년 6월 3일/)
  })

  // WP-365: 시드 페이지 뒤에 커서가 있으면 「이전 메시지 더 보기」로 그 커서 페이지를 불러오고, 마지막 페이지면 버튼이 사라진다.
  test('이전 메시지 더 보기는 커서로 오래된 페이지를 불러오고, 마지막 페이지면 버튼을 숨긴다', async () => {
    const at = (i: number) => new Date(Date.now() - (30 - i) * 60_000).toISOString()
    const recent = Array.from({ length: 20 }, (_, i) =>
      createChatMessage({ id: i + 2, threadId: THREAD_ID, body: `최근 ${i + 2}`, createdAt: at(i + 2) }),
    )
    const oldest = createChatMessage({ id: 1, threadId: THREAD_ID, body: '가장 오래된 메시지', createdAt: at(1) })
    const requests = recordRequests()
    const { user } = await openChat(
      thread({ recentMessages: recent, recentNextCursor: 'cursor-1', recentHasMore: true }),
      { messages: recent, nextCursor: 'cursor-1', olderPages: { 'cursor-1': [oldest] } },
    )
    expect(await screen.findByTestId('chat-message-21')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-message-1')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('chat-load-more'))
    expect(await screen.findByTestId('chat-message-1')).toHaveTextContent('가장 오래된 메시지')
    const cursors = requests
      .of('GET', `/api/v1/chat/threads/${THREAD_ID}/messages`)
      .map((r) => r.search.get('cursor'))
    expect(cursors).toContain('cursor-1')
    await waitFor(() => expect(screen.queryByTestId('chat-load-more')).not.toBeInTheDocument())
  })
})

describe('수정·권한', () => {
  test('본인 메시지를 변경 없이 저장하면 편집기만 닫히고 PATCH 를 보내지 않는다', async () => {
    const msg: ChatMessageResponse = createChatMessage({
      id: 800, threadId: THREAD_ID, authorId: ME_ID, authorName: '테스트 사용자', authorKind: 'HUMAN', body: '원본',
    })
    const requests = recordRequests()
    const { user } = await openChat(thread({ recentMessages: [msg] }), {
      // PATCH 가 오면 응답은 주되 기록으로 잡는다 — 미처리 요청 실패와 구분해 「보내지 않음」을 직접 단언한다.
      handlers: [http.patch(/\/api\/v1\/chat\/messages\/\d+$/, () => HttpResponse.json(msg))],
    })

    await user.hover(await screen.findByTestId('chat-message-800'))
    await user.click(screen.getByTestId('chat-message-edit-800'))
    expect(await screen.findByTestId('chat-message-editor-input')).toBeInTheDocument()
    await user.click(screen.getByTestId('chat-message-editor-save'))

    await waitFor(() => expect(screen.queryByTestId('chat-message-editor')).not.toBeInTheDocument())
    expect(screen.getByTestId('chat-message-body-800')).toHaveTextContent('원본')
    // 늦게 나가는 PATCH 가 없는지 잠시 더 본다(부재 확인).
    await act(() => new Promise((r) => setTimeout(r, 300)))
    expect(requests.count('PATCH', /\/api\/v1\/chat\/messages\/\d+$/)).toBe(0)
  })

  // WP-213: 쓸 권한이 없으면 대화는 읽되 입력창 대신 안내를 보인다.
  test('canPost=false 면 기존 대화는 보이고 입력창 대신 작성 불가 안내를 보인다', async () => {
    const existing = createChatMessage({ id: 1, threadId: THREAD_ID, authorId: 2, body: '기존 대화' })
    await openChat(thread({ canPost: false, recentMessages: [existing] }))
    expect(await screen.findByText('기존 대화')).toBeInTheDocument()
    expect(screen.getByTestId('chat-composer-readonly')).toHaveTextContent(
      '이 대화는 프로젝트 멤버와 이슈를 등록한 사람만 쓸 수 있습니다.',
    )
    expect(screen.queryByTestId('chat-composer')).not.toBeInTheDocument()
  })
})
