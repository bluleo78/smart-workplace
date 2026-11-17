// 이슈 챗 메시지 수정 — 첨부 칩(×)으로 붙인 파일 빼기(WP-1680) 페이지 테스트.
// 칩 표시·× 후 저장 payload({body, keepFileIds})·취소·모두 비면 저장 비활성·SSE 로 첨부가 줄 때의 일관성·400 처리는
// 브라우저 없이 판정되므로 여기서 본다. 칩의 줄바꿈·넘침(기하)은 jsdom 이 못 재서 e2e/pages/mobile/uiux-u4.spec.ts(@layout)가 맡는다.
// 준비는 chatQuestionOptions.test.tsx 와 같다(renderIssueDetailScreen + controllableEvents, 스레드 100, 나 = 1).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { controllableEvents } from '@/test/kits/projects/issueDetailEvents'
import { setRichText } from '@/test/kits/projects/issueDetailRef'
import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { appEventStream, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { ChatMessageResponse } from '@/types/chat'
import type { MessageAttachment } from '@/types/messaging'

import { createChatMember, createChatMessage, createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'
const THREAD_ID = 100
const ME_ID = 1
const MSG_ID = 800
const EDITED_AT = '2026-10-14T02:00:00Z'

const att = (fileId: number, originalName: string): MessageAttachment => ({
  fileId, messageId: MSG_ID, originalName, mimeType: 'application/pdf', sizeBytes: 2048,
  attachedById: ME_ID, attachedByName: '테스트 사용자', attachedAt: '2026-10-14T01:00:00Z',
})
const A = att(1, 'a.pdf')
const B = att(2, 'b.txt')

const own = (extra: Partial<ChatMessageResponse> = {}) =>
  createChatMessage({ id: MSG_ID, threadId: THREAD_ID, authorId: ME_ID, authorName: '테스트 사용자', body: '보고서', attachments: [A, B], ...extra })

/** 이슈 상세 + 채팅 스레드 + 열린 SSE. PATCH 본문은 patched 에 모으고 응답은 reply 가 정한다. */
function setup(seed: ChatMessageResponse, reply: (body: Record<string, unknown>) => Response) {
  const events = controllableEvents()
  const patched: Record<string, unknown>[] = []
  const thread = createChatThread({
    threadId: THREAD_ID,
    issueId: 1,
    members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
    recentMessages: [seed],
  })
  const handlers = issueDetailHandlers({
    key: KEY,
    detail: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '수정 첨부 테스트' }) }),
    extra: [
      events.handler,
      http.get(`/api/v1/projects/${KEY}/issues/1/chat/thread`, () => HttpResponse.json(thread)),
      http.get(`/api/v1/chat/threads/${THREAD_ID}/messages`, () => HttpResponse.json({ items: [seed], nextCursor: null, hasMore: false })),
      http.post(`/api/v1/chat/threads/${THREAD_ID}/read`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`/api/v1/chat/messages/${MSG_ID}`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patched.push(body)
        return reply(body)
      }),
    ],
  })
  return { handlers, events, patched }
}

/** 채팅 드로워를 열고 메시지가 보일 때까지 기다린다. */
async function openChat(handlers: ReturnType<typeof setup>['handlers']) {
  const view = renderIssueDetailScreen(`/projects/${KEY}/issues/1`, { handlers, extra: appEventStream(ME_ID) })
  await view.user.click(await screen.findByTestId('issue-chat-open', {}, { timeout: SCREEN_LOAD_TIMEOUT }))
  await screen.findByTestId(`chat-message-${MSG_ID}`)
  return view
}

/** 수정 열기 — hover 해야 연필이 보인다. */
async function openEditor(user: Awaited<ReturnType<typeof openChat>>['user']) {
  await user.hover(screen.getByTestId(`chat-message-${MSG_ID}`))
  await user.click(screen.getByTestId(`chat-message-edit-${MSG_ID}`))
  return screen.findByTestId('chat-message-editor')
}

const ok = (message: ChatMessageResponse) => HttpResponse.json(message)
const chips = () => within(screen.getByTestId('chat-message-editor-attachments'))

describe('이슈 챗 메시지 수정 — 첨부 빼기 (WP-1680)', () => {
  test('수정을 열면 입력창 위에 첨부 칩 두 개(×)가 보인다', async () => {
    const { handlers } = setup(own(), () => ok(own()))
    const { user } = await openChat(handlers)
    const editor = await openEditor(user)

    expect(within(editor).getByTestId('chat-message-editor-attachments')).toBeInTheDocument()
    expect(chips().getByText('a.pdf')).toBeInTheDocument()
    expect(chips().getByText('b.txt')).toBeInTheDocument()
    expect(chips().getAllByRole('button', { name: '첨부 제거' })).toHaveLength(2)
  })

  test('× 후 저장하면 {body, keepFileIds:[1]} 을 보내고 파일 하나와 (수정됨)이 보인다', async () => {
    const { handlers, patched } = setup(own(), () => ok(own({ attachments: [A], editedAt: EDITED_AT })))
    const { user } = await openChat(handlers)
    await openEditor(user)

    await user.click(chips().getAllByRole('button', { name: '첨부 제거' })[1])
    await user.click(screen.getByTestId('chat-message-editor-save'))

    await waitFor(() => expect(screen.queryByTestId('chat-message-editor')).not.toBeInTheDocument())
    expect(patched).toEqual([{ body: '보고서', keepFileIds: [1] }])
    expect(screen.getByTestId('attachment-card-1')).toBeInTheDocument()
    expect(screen.queryByTestId('attachment-card-2')).not.toBeInTheDocument()
    expect(screen.getByLabelText('수정됨')).toBeInTheDocument()
  })

  test('× 후 취소하면 PATCH 없이 두 파일 그대로, 다시 열면 칩 두 개', async () => {
    const { handlers, patched } = setup(own(), () => ok(own()))
    const { user } = await openChat(handlers)
    await openEditor(user)

    await user.click(chips().getAllByRole('button', { name: '첨부 제거' })[0])
    expect(chips().getAllByRole('button', { name: '첨부 제거' })).toHaveLength(1)
    await user.click(screen.getByTestId('chat-message-editor-cancel'))

    await waitFor(() => expect(screen.queryByTestId('chat-message-editor')).not.toBeInTheDocument())
    expect(screen.getByTestId('attachment-card-1')).toBeInTheDocument()
    expect(screen.getByTestId('attachment-card-2')).toBeInTheDocument()
    await openEditor(user)
    expect(chips().getAllByRole('button', { name: '첨부 제거' })).toHaveLength(2)
    expect(patched).toHaveLength(0)
  })

  test('첨부만 있는 메시지에서 모두 빼면 저장이 비활성', async () => {
    const { handlers } = setup(own({ body: '', attachments: [A] }), () => ok(own()))
    const { user } = await openChat(handlers)
    await openEditor(user)
    expect(screen.getByTestId('chat-message-editor-save')).toBeEnabled()

    await user.click(chips().getByRole('button', { name: '첨부 제거' }))
    expect(screen.queryByTestId('chat-message-editor-attachments')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-message-editor-save')).toBeDisabled()
  })

  test('첨부가 있어도 본문만 고치면 {body} 만 보낸다(keepFileIds 키 없음)', async () => {
    const { handlers, patched } = setup(own(), () => ok(own({ body: '보고서 v2', editedAt: EDITED_AT })))
    const { user } = await openChat(handlers)
    await openEditor(user)

    setRichText(screen.getByTestId('chat-message-editor-input'), '보고서 v2')
    await user.click(screen.getByTestId('chat-message-editor-save'))

    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toEqual({ body: '보고서 v2' })
    expect('keepFileIds' in patched[0]).toBe(false)
  })

  test('드라이브 링크만 남으면 본문이 비어도 저장, {body:\'\', keepFileIds:[]}', async () => {
    const link = { id: 7, fileId: 70, name: '자료.docx' } as never
    const seed = own({ body: '', attachments: [A], driveLinks: [link] })
    const { handlers, patched } = setup(seed, () => ok(own({ body: '', attachments: [], driveLinks: [link], editedAt: EDITED_AT })))
    const { user } = await openChat(handlers)
    await openEditor(user)

    await user.click(chips().getByRole('button', { name: '첨부 제거' }))
    expect(screen.getByTestId('chat-message-editor-save')).toBeEnabled()
    await user.click(screen.getByTestId('chat-message-editor-save'))

    await waitFor(() => expect(patched).toEqual([{ body: '', keepFileIds: [] }]))
  })

  test('다른 사람이 뺀 수정이 SSE 로 오면 보던 화면에서 바로 하나만 남는다', async () => {
    const { handlers, events } = setup(own(), () => ok(own()))
    await openChat(handlers)
    expect(screen.getByTestId('attachment-card-2')).toBeInTheDocument()

    await events.push(`event: chat.message.updated\ndata: ${JSON.stringify({
      threadId: THREAD_ID, id: MSG_ID, body: '보고서', mentions: [], editedAt: EDITED_AT, attachments: [A],
    })}\n\n`)

    await waitFor(() => expect(screen.queryByTestId('attachment-card-2')).not.toBeInTheDocument())
    expect(screen.getByTestId('attachment-card-1')).toBeInTheDocument()
    expect(screen.getByLabelText('수정됨')).toBeInTheDocument()
  })

  test('편집 중 SSE 로 첨부가 줄면 칩에서도 사라지고, 본문만 고친 저장은 {body} 만', async () => {
    const { handlers, events, patched } = setup(own(), () => ok(own({ body: '새 본문', attachments: [A], editedAt: EDITED_AT })))
    const { user } = await openChat(handlers)
    await openEditor(user)
    expect(chips().getAllByRole('button', { name: '첨부 제거' })).toHaveLength(2)

    await events.push(`event: chat.message.updated\ndata: ${JSON.stringify({
      threadId: THREAD_ID, id: MSG_ID, body: '보고서', mentions: [], editedAt: EDITED_AT, attachments: [A],
    })}\n\n`)
    await waitFor(() => expect(chips().getAllByRole('button', { name: '첨부 제거' })).toHaveLength(1))
    expect(chips().queryByText('b.txt')).not.toBeInTheDocument()

    // 빠진 파일을 되살려 keep 에 싣지 않는다 — 본문만 고쳤으니 keepFileIds 키 자체가 없다.
    setRichText(screen.getByTestId('chat-message-editor-input'), '새 본문')
    await user.click(screen.getByTestId('chat-message-editor-save'))
    await waitFor(() => expect(patched).toHaveLength(1))
    expect(patched[0]).toEqual({ body: '새 본문' })
  })

  test('저장이 400 이면 서버 문구를 보이고 에디터와 칩 상태를 유지한다', async () => {
    const { handlers, patched } = setup(own(), () =>
      HttpResponse.json({ message: '이 메시지에 붙은 첨부가 아닙니다' }, { status: 400 }))
    const { user } = await openChat(handlers)
    await openEditor(user)

    await user.click(chips().getAllByRole('button', { name: '첨부 제거' })[1])
    await user.click(screen.getByTestId('chat-message-editor-save'))

    expect(await screen.findByText('이 메시지에 붙은 첨부가 아닙니다')).toBeInTheDocument()
    expect(patched).toEqual([{ body: '보고서', keepFileIds: [1] }])
    expect(screen.getByTestId('chat-message-editor')).toBeInTheDocument()
    expect(chips().getAllByRole('button', { name: '첨부 제거' })).toHaveLength(1)
    expect(chips().queryByText('b.txt')).not.toBeInTheDocument()
  })
})
