// 이슈 챗 AI 질문 「빠른 답변」 선택지(WP-1569) — 페이지 테스트.
// 열린 질문(질문한 AI 가 INPUT_REQUIRED, 그 AI 의 마지막 질문)에만 선택지가 보이고, 누르면 그 문구가 답으로 바로 전송된다.
// 서버가 뒤늦게 뽑은 선택지는 chat.message.options SSE 프레임으로 오면 그 질문 아래에 나타난다.
// 이슈 상세 화면을 renderIssueDetailScreen 으로 띄우고 채팅 드로워를 연다(chatRealtime.test.tsx 와 같은 방식).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { controllableEvents } from '@/test/kits/projects/issueDetailEvents'
import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { appEventStream, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { ChatMessageResponse } from '@/types/chat'

import { createAgentWork } from '../../../e2e/factories/agentWork.factory'
import { createChatMember, createChatMessage, createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'
const THREAD_ID = 100
const ME_ID = 1
const AI_ID = 50
const OPTIONS = ['A안으로 진행', 'B안으로 진행', '보류']

/** 질문한 AI(50)의 글 — question 이면 질문 글, options 는 답 선택지. */
const ai = (id: number, createdAt: string, body: string, extra: Partial<ChatMessageResponse> = {}) =>
  createChatMessage({ id, threadId: THREAD_ID, authorId: AI_ID, authorName: '코드 봇', authorKind: 'AGENT', body, createdAt, ...extra })

/**
 * 이슈 상세(질문한 AI 가 답변 대기) + 채팅 스레드 + 열린 SSE. 보낸 글은 posted 에 모은다.
 * @param seed 시드 메시지 @param canPost false 면 쓸 수 없는 사용자
 */
function setup(seed: ChatMessageResponse[], canPost = true) {
  const events = controllableEvents()
  const posted: unknown[] = []
  const thread = createChatThread({
    threadId: THREAD_ID,
    issueId: 1,
    members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
    recentMessages: seed,
    canPost,
  })
  const detail = createIssueDetail({
    summary: createIssue({
      id: 1,
      number: 1,
      title: '빠른 답변 테스트',
      agentWork: [createAgentWork({ worker: { id: AI_ID, username: 'codebot', name: '코드 봇', kind: 'AGENT' }, state: 'INPUT_REQUIRED' })],
    }),
  })
  const handlers = issueDetailHandlers({
    key: KEY,
    detail,
    extra: [
      events.handler,
      http.get(`/api/v1/projects/${KEY}/issues/1/chat/thread`, () => HttpResponse.json(thread)),
      http.get(`/api/v1/chat/threads/${THREAD_ID}/messages`, () => HttpResponse.json({ items: seed, nextCursor: null, hasMore: false })),
      http.post(`/api/v1/chat/threads/${THREAD_ID}/messages`, async ({ request }) => {
        const body = (await request.json()) as { body: string }
        posted.push(body)
        return HttpResponse.json(
          createChatMessage({ id: 900 + posted.length, threadId: THREAD_ID, authorId: ME_ID, authorName: '테스트 사용자', body: body.body }),
        )
      }),
      http.post(`/api/v1/chat/threads/${THREAD_ID}/read`, () => new HttpResponse(null, { status: 204 })),
    ],
  })
  return { handlers, events, posted }
}

/** 이슈 상세를 띄우고 채팅 드로워를 연 뒤 시드 본문이 보일 때까지 기다린다. */
async function openChat(handlers: ReturnType<typeof setup>['handlers'], waitText: string) {
  const view = renderIssueDetailScreen(`/projects/${KEY}/issues/1`, { handlers, extra: appEventStream(ME_ID) })
  await view.user.click(await screen.findByTestId('issue-chat-open', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
  expect(await screen.findByText(waitText)).toBeInTheDocument()
  return view
}

describe('이슈 챗 질문 빠른 답변 (WP-1569)', () => {
  test('열린 질문에만 선택지가 보이고, 같은 AI 의 이전(답변된) 질문엔 없다 — 누르면 그 문구로 한 번만 전송된다', async () => {
    const { handlers, posted } = setup([
      ai(101, '2026-10-14T01:00:00Z', '이전 질문이에요', { question: true, options: ['예전 1', '예전 2'] }),
      ai(102, '2026-10-14T01:04:00Z', '어느 쪽으로 갈까요?', { question: true, options: OPTIONS }),
    ])
    const { user } = await openChat(handlers, '어느 쪽으로 갈까요?')

    // 이전 질문(답변됨)엔 선택지가 없다.
    expect(within(screen.getByTestId('chat-message-101')).queryByTestId('chat-question-options')).not.toBeInTheDocument()
    const list = within(screen.getByTestId('chat-message-102')).getByTestId('chat-question-options')
    expect(list).toHaveAccessibleName('빠른 답변')
    const items = within(list).getAllByTestId('chat-question-option')
    expect(items.map((b) => b.textContent)).toEqual(OPTIONS)

    await user.click(items[1])
    await waitFor(() => expect(posted).toEqual([{ body: 'B안으로 진행' }]))
    // 보낸 뒤 이슈(작업 상태)를 다시 받기 전까지 질문이 열려 있어도 같은 질문엔 다시 보낼 수 없다.
    for (const b of within(screen.getByTestId('chat-message-102')).getAllByTestId('chat-question-option')) expect(b).toBeDisabled()
    // 보낸 답이 내 글로 목록에 들어온다(서버 응답 id 901).
    expect(await screen.findByTestId('chat-message-body-901')).toHaveTextContent('B안으로 진행')
    expect(posted).toHaveLength(1)
  })

  // 개수(2~4개)는 서버가 보장하므로 화면은 비었는지만 본다 — 빈 배열이면 칩이 없다.
  test('선택지가 빈 배열이면 칩이 없다', async () => {
    const { handlers } = setup([ai(102, '2026-10-14T01:04:00Z', '이대로 할까요?', { question: true, options: [] })])
    await openChat(handlers, '이대로 할까요?')
    expect(screen.queryByTestId('chat-question-options')).not.toBeInTheDocument()
  })

  test('쓸 수 없는 사용자(canPost false)에게는 선택지가 비활성이다', async () => {
    const { handlers, posted } = setup([ai(102, '2026-10-14T01:04:00Z', '어느 쪽으로 갈까요?', { question: true, options: OPTIONS })], false)
    await openChat(handlers, '어느 쪽으로 갈까요?')
    const items = screen.getAllByTestId('chat-question-option')
    expect(items).toHaveLength(3)
    for (const b of items) expect(b).toBeDisabled()
    expect(posted).toHaveLength(0)
  })

  test('chat.message.options 프레임이 오면 선택지 없던 열린 질문 아래에 칩이 나타난다', async () => {
    const { handlers, events } = setup([ai(102, '2026-10-14T01:04:00Z', '어느 쪽으로 갈까요?', { question: true, options: null })])
    await openChat(handlers, '어느 쪽으로 갈까요?')
    expect(screen.queryByTestId('chat-question-options')).not.toBeInTheDocument()

    await events.push(`event: chat.message.options\ndata: ${JSON.stringify({ threadId: THREAD_ID, messageId: 102, options: ['A안', 'B안'] })}\n\n`)
    const list = await screen.findByTestId('chat-question-options')
    expect(within(list).getAllByTestId('chat-question-option').map((b) => b.textContent)).toEqual(['A안', 'B안'])
    // 본문은 그대로다(chat.message.updated 처럼 덮어쓰지 않는다).
    expect(screen.getByTestId('chat-message-body-102')).toHaveTextContent('어느 쪽으로 갈까요?')
  })
})
