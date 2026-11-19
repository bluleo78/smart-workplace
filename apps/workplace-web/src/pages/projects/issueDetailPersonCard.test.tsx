// 이슈 상세에서 이름을 눌러 사람 카드를 연다(WP-1767) — 코멘트 작성자·보고자·담당자·이슈 챗 작성자.
// 담당자·보고자는 고르기(편집) 단추와 이름 단추가 따로다 — 이름을 누르면 카드만, 고르기 단추는 그대로 고르기를 연다.
// AI 카드의 「일 맡기기」는 이 이슈의 프로젝트로 새 이슈 창을 열고 그 AI 를 골라 둔다. 이슈 상세 밖(맡길 곳이 없는 곳)에서는 「일 맡기기」가 없다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { ChatMessageRow } from '@/pages/projects/components/chat/ChatMessageRow'
import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueChatHandlers } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'
import type { UserSummary } from '@/types/user'

import { createChatMessage, createChatThread } from '../../../e2e/factories/chat.factory'
import { createComment, createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createAgentMember, createMember } from '../../../e2e/factories/project.factory'

const KEY = 'WP'
const HUMAN: UserSummary = { id: 7, username: 'minsu', name: '김민수', kind: 'HUMAN' }
const REPORTER: UserSummary = { id: 5, username: 'kim', name: '김보고', kind: 'HUMAN' }
const AGENT: UserSummary = { id: 9, username: 'reviewbot', name: '리뷰봇', kind: 'AGENT' }

/** 카드가 부르는 프로필·연락처·메일 계정·AI 현황, 새 이슈 창이 부르는 유형·맡길 AI 후보. */
const cardHandlers = [
  http.get('/api/v1/members/:id', ({ params }) => {
    const u = [HUMAN, REPORTER, AGENT].find((p) => p.id === Number(params.id)) ?? HUMAN
    return HttpResponse.json({
      userId: u.id, username: u.username, name: u.name, email: `${u.username}@example.com`, title: null, kind: u.kind,
      active: true, membershipRole: null, membershipStatus: null, department: null,
    })
  }),
  http.get('/api/v1/contacts/members/:id', ({ params }) =>
    HttpResponse.json({ id: Number(params.id), username: 'x', name: 'x', email: null, title: null, kind: 'HUMAN', groups: [], isFavorite: false }),
  ),
  http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
  http.get('/api/v1/me/ai-agents', () => HttpResponse.json({ agents: [] })),
  http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  http.get(`/api/v1/projects/${KEY}/recurrence-agents`, () =>
    HttpResponse.json([{ id: AGENT.id, username: AGENT.username, name: AGENT.name, personalAssistant: false }]),
  ),
]

/** 담당자(AI)·보고자·코멘트 둘(사람·AI)이 있는 이슈 1 을 연다. */
async function openDetail({ canChangeReporter = false, chat = false, canEditWorkflow = true } = {}) {
  const detail = createIssueDetail({
    summary: createIssue({ id: 1, number: 1, projectKey: KEY, title: '카드 테스트', assignees: [AGENT] }),
    reporter: REPORTER,
    viewerCanChangeReporter: canChangeReporter,
    viewerCanEditWorkflow: canEditWorkflow,
    comments: [
      createComment({ id: 31, authorId: HUMAN.id, authorName: HUMAN.name, authorKind: 'HUMAN', body: '사람 코멘트' }),
      createComment({ id: 32, authorId: AGENT.id, authorName: AGENT.name, authorKind: 'AGENT', body: 'AI 코멘트' }),
    ],
  })
  const thread = createChatThread({
    threadId: 100,
    issueId: 1,
    recentMessages: [createChatMessage({ id: 501, threadId: 100, authorId: HUMAN.id, authorName: HUMAN.name, body: '챗 메시지' })],
  })
  return openIssueDetailScreen({
    key: KEY,
    detail,
    members: [
      createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
      createMember({ userId: HUMAN.id, username: HUMAN.username, name: HUMAN.name }),
      createMember({ userId: REPORTER.id, username: REPORTER.username, name: REPORTER.name }),
      createAgentMember({ userId: AGENT.id, username: AGENT.username, name: AGENT.name }),
    ],
    handlers: [...cardHandlers, ...(chat ? issueChatHandlers({ key: KEY, number: 1, thread }) : [])],
  })
}

/** 카드가 열리고 그 사람 이름을 보인다. */
async function expectCard(name: string) {
  const card = await screen.findByTestId('person-card')
  expect(within(card).getByText(name)).toBeInTheDocument()
  return card
}

describe('이슈 상세 — 이름을 눌러 사람 카드 (WP-1767)', () => {
  test('코멘트 작성자 이름을 누르면 카드가 열리고, 코멘트 행의 링크 복사·보내기 단추는 그대로 있다', async () => {
    const { user } = await openDetail()
    const header = await screen.findByTestId('issue-comment-header-31')
    await user.click(within(header).getByTestId(`person-card-trigger-${HUMAN.id}`))
    await expectCard(HUMAN.name)
    expect(within(header).getByTestId('issue-comment-copy-link-31')).toBeInTheDocument()
    expect(within(header).getByTestId('issue-comment-send-31')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('person-card')).not.toBeInTheDocument())
  })

  test('보고자 이름을 누르면 카드가 열리고 고르기는 열리지 않는다 — 고르기 단추는 따로 고르기를 연다', async () => {
    const { user } = await openDetail({ canChangeReporter: true })
    const reporter = screen.getByTestId('issue-reporter')
    await user.click(within(reporter).getByTestId(`person-card-trigger-${REPORTER.id}`))
    await expectCard(REPORTER.name)
    expect(screen.queryByTestId('reporter-picker')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('person-card')).not.toBeInTheDocument())

    await user.click(screen.getByTestId('reporter-picker-trigger'))
    expect(await screen.findByTestId('reporter-picker')).toBeInTheDocument()
    expect(screen.queryByTestId('person-card')).not.toBeInTheDocument()
  })

  test('담당자 이름을 누르면 카드만 열리고 담당자 고르기 팝오버는 열리지 않는다 — 고르기 단추는 그대로 연다', async () => {
    const { user } = await openDetail()
    const assignees = screen.getByTestId('issue-assignees')
    await user.click(within(assignees).getByTestId(`person-card-trigger-${AGENT.id}`))
    await expectCard(AGENT.name)
    expect(screen.queryByTestId('assignee-picker')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('person-card')).not.toBeInTheDocument())

    await user.click(screen.getByTestId('assignee-picker-trigger'))
    expect(await screen.findByTestId('assignee-picker')).toBeInTheDocument()
  })

  test('AI 담당자 카드의 「일 맡기기」는 이 프로젝트의 새 이슈 창을 그 AI 를 골라 둔 채 연다', async () => {
    const { user } = await openDetail()
    await user.click(within(screen.getByTestId('issue-assignees')).getByTestId(`person-card-trigger-${AGENT.id}`))
    const card = await expectCard(AGENT.name)
    await user.click(await within(card).findByRole('button', { name: '일 맡기기' }))
    const dialog = await screen.findByRole('dialog', { name: '새 이슈' })
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent(AGENT.name))
    expect(screen.queryByTestId('person-card')).not.toBeInTheDocument()
  })

  test('AI 코멘트 작성자 카드에도 「일 맡기기」가 있다', async () => {
    const { user } = await openDetail()
    const header = await screen.findByTestId('issue-comment-header-32')
    await user.click(within(header).getByTestId(`person-card-trigger-${AGENT.id}`))
    const card = await expectCard(AGENT.name)
    expect(await within(card).findByRole('button', { name: '일 맡기기' })).toBeInTheDocument()
  })

  test('이슈 챗 작성자 이름을 누르면 같은 카드가 열린다', async () => {
    const { user } = await openDetail({ chat: true })
    await user.click(screen.getByTestId('issue-chat-open'))
    const row = await screen.findByTestId('chat-message-501', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await user.click(within(row).getByTestId(`person-card-trigger-${HUMAN.id}`))
    await expectCard(HUMAN.name)
  })
})

describe('이슈 상세 — 권한·키보드 (WP-1767)', () => {
  test('편집 권한이 없어도 담당자 이름은 카드를 열고, 고르기 단추는 비활성이다 — 값 줄은 예전처럼 흐리다', async () => {
    const { user } = await openDetail({ canEditWorkflow: false })
    expect(screen.getByTestId('assignee-picker-trigger')).toBeDisabled()
    expect(screen.getByTestId('issue-assignees')).toHaveClass('opacity-50')
    await user.click(within(screen.getByTestId('issue-assignees')).getByTestId(`person-card-trigger-${AGENT.id}`))
    await expectCard(AGENT.name)
    expect(screen.queryByTestId('assignee-picker')).not.toBeInTheDocument()
  })

  test('담당자 고르기는 키보드로 닿는다 — Tab 으로 「담당자 편집」 단추에 포커스, Enter 로 연다', async () => {
    const { user } = await openDetail()
    const picker = screen.getByRole('button', { name: /^담당자 편집: / })
    // 문서 순서의 탭 정지점에서 고르기 단추 바로 앞 요소에 포커스를 두고 Tab 한 번 — 고르기 단추가 다음 정지점이다.
    // (맨 앞에서 Tab 을 이어 가면 jsdom 이 머리글 링크에서 멈춰 도착 여부를 가리지 못한다.)
    const stops = Array.from(document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]'))
    const before = stops[stops.indexOf(picker) - 1]
    expect(before).toBeDefined()
    before.focus()
    await user.tab()
    expect(picker).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByTestId('assignee-picker')).toBeInTheDocument()
    expect(screen.queryByTestId('person-card')).not.toBeInTheDocument()
  })
})

describe('이슈 상세 — 흐림·접근 이름 (WP-1767)', () => {
  test('편집 권한이 있으면 담당자 값 줄은 흐리지 않다', async () => {
    await openDetail()
    expect(screen.getByTestId('issue-assignees')).not.toHaveClass('opacity-50')
  })

  test('보고자를 바꾸는 중에는 값 줄이 흐리고, 이름은 그래도 카드를 연다', async () => {
    const { user } = await openDetail({ canChangeReporter: true })
    // 바꾸기 요청이 끝나지 않게 둔다 — 그동안 고르기 단추가 막히고 값 줄이 흐려야 한다.
    server.use(http.put(`/api/v1/projects/${KEY}/issues/1/reporter`, () => new Promise<never>(() => {})))
    expect(screen.getByTestId('reporter-picker-value')).not.toHaveClass('opacity-50')
    await user.click(screen.getByTestId('reporter-picker-trigger'))
    await user.click(await screen.findByTestId(`reporter-option-${HUMAN.id}`))
    await waitFor(() => expect(screen.getByTestId('reporter-picker-trigger')).toBeDisabled())
    expect(screen.getByTestId('reporter-picker-value')).toHaveClass('opacity-50')
    await user.click(within(screen.getByTestId('issue-reporter')).getByTestId(`person-card-trigger-${REPORTER.id}`))
    await expectCard(REPORTER.name)
  })

  test('이름 단추의 접근 이름은 이름을 한 번만 읽는다 — AI 는 「(에이전트)」를 붙인다', async () => {
    await openDetail()
    expect(within(screen.getByTestId('issue-assignees')).getByTestId(`person-card-trigger-${AGENT.id}`)).toHaveAccessibleName(`${AGENT.name} (에이전트)`)
    expect(within(screen.getByTestId('issue-reporter')).getByTestId(`person-card-trigger-${REPORTER.id}`)).toHaveAccessibleName(REPORTER.name)
  })
})

describe('이슈 상세 밖 — 맡길 곳이 없으면 「일 맡기기」를 숨긴다 (WP-1767)', () => {
  test('챗 행만 따로 그리면 AI 작성자 카드에 「일 맡기기」가 없다', async () => {
    const message = createChatMessage({ id: 77, authorId: AGENT.id, authorName: AGENT.name, authorKind: 'AGENT', body: 'AI 메시지' })
    const view = renderScreen(<ChatMessageRow message={message} isOwn={false} canEdit={false} />, { handlers: cardHandlers })
    await view.user.click(await screen.findByTestId(`person-card-trigger-${AGENT.id}`, {}, { timeout: SCREEN_LOAD_TIMEOUT }))
    const card = await expectCard(AGENT.name)
    await waitFor(() => expect(within(card).getByRole('button', { name: '메시지' })).toBeInTheDocument())
    expect(within(card).queryByRole('button', { name: '일 맡기기' })).not.toBeInTheDocument()
  })

  test('챗 작성자 카드는 프로필 요청이 실패해도 메시지의 아이디로 아이디를 보이고 「일정 잡기」가 그 사람을 참석자로 넘긴다', async () => {
    const message = createChatMessage({ id: 78, authorId: HUMAN.id, authorName: HUMAN.name, authorKind: 'HUMAN', authorUsername: HUMAN.username, body: '사람 메시지' })
    const view = renderScreen(<ChatMessageRow message={message} isOwn={false} canEdit={false} />, {
      handlers: [http.get('/api/v1/members/:id', () => HttpResponse.json({ message: 'x' }, { status: 500 })), ...cardHandlers],
    })
    await view.user.click(await screen.findByTestId(`person-card-trigger-${HUMAN.id}`, {}, { timeout: SCREEN_LOAD_TIMEOUT }))
    const card = await expectCard(HUMAN.name)
    expect(within(card).getByText(HUMAN.username)).toBeInTheDocument()
    await view.user.click(await within(card).findByRole('button', { name: '일정 잡기' }))
    await waitFor(() => expect(view.location()).toBe(`/calendar?new=true&attendee=${HUMAN.username}`))
  })
})
