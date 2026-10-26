// 데스크톱 AI 사이드 패널 라이브 대화 — 페이지 테스트(WP-966 웨이브 3).
// 도구 단계 인라인 표시(ai-chat-tool-steps)·답 뒤 후속 질문(ai-followups)·멀티 세션(ai-multi-session)·통합 SSE 한 줄기(sse-single-stream)는
// 열린 SSE 에 프레임을 밀어 넣고 화면·요청을 보는 판정이라 브라우저 없이 된다 — e2e/pages/ 의 그 spec 들에서 옮겼다.
// SSE 는 앱의 실제 파서(fetch + ReadableStream)를 지나고, 프레임은 testkit-b2a 의 liveChat 이 보낸다.
// AI 패널은 앱 셸(AppLayout)이 SSE 구독과 함께 띄우므로 renderPage 로 연다.
// E2E 에 남은 것: 후속 질문 행 모양·정렬(@layout), 대표 배선 1건(ai-followups @wiring), 확인 카드 조회 XHR 시간 제한(@platform).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { server } from '@/test/msw/server'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { HomeMessage, HomeSessionPage } from '@/types/home'

import {
  aiPreferences,
  ask,
  fillInput,
  homeChatGeneration,
  liveChat,
  msg,
  openChatPanel,
  openSession,
  sendButton,
  sessionItem,
  settle,
  summary,
  TITLE_A,
  TITLE_B,
  TITLE_C,
} from './testkit-b2a'

const A = { correlationId: 'corr-a', sessionId: 's-a' }
const B = { correlationId: 'corr-b', sessionId: 's-b' }
const ITEMS = ['내일 회의 준비할 것 정리해줘', '참석자 일정 알려줘', 'WP-12 상태 알려줘']
const panelText = () => screen.getByTestId('chat-panel').textContent ?? ''
const followupTexts = () => screen.queryAllByTestId('chat-followup').map((e) => e.textContent)

// ── 도구 단계(ai-chat-tool-steps) ─────────────────────────────────────────

// 위임 헤더·도구 행(한국어 라벨·이슈키·✓)이 그려지고, 숨김 도구(show_*)는 행을 만들지 않으며, 최종 답(delta) 뒤에도 남는다(#449).
test('도구 호출이 인라인으로 렌더되고 done(✓) 으로 전이되며, 최종 답 뒤에도 남는다', async () => {
  const gen = homeChatGeneration([
    { event: 'progress', data: { label: '이슈 전문가에게 위임 중' } },
    { event: 'tool', data: { seq: 1, phase: 'start', toolName: 'update_issue', args: { issueKey: 'EX-2', status: '진행중' } } },
    { event: 'tool', data: { seq: 1, phase: 'result', toolName: 'update_issue', isError: false } },
    { event: 'tool', data: { seq: 2, phase: 'start', toolName: 'show_issue_list', args: {} } },
    { event: 'tool', data: { seq: 2, phase: 'result', toolName: 'show_issue_list', isError: false } },
    { event: 'delta', data: { text: '상태를 변경했어요.' } },
    { event: 'done', data: { sessionId: 's-tool-1' } },
  ])
  await openChatPanel(gen.handlers)
  await ask(gen, 'EX-2 진행중으로 바꿔줘')
  await gen.done
  await waitFor(() => expect(panelText()).toContain('상태를 변경했어요.'))
  expect(screen.getByTestId('tool-step-delegation')).toHaveTextContent('이슈 전문가에게 위임 중')
  const rows = screen.getAllByTestId('tool-step-tool')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toHaveTextContent('이슈 수정')
  expect(rows[0]).toHaveTextContent('EX-2')
  expect(rows[0]).toHaveTextContent('✓')
})

test('tool result isError:true 이면 도구 행이 오류(✗) 상태로 렌더된다', async () => {
  const gen = homeChatGeneration([
    { event: 'tool', data: { seq: 2, phase: 'start', toolName: 'get_issue_detail', args: { issueKey: 'XX-99' } } },
    { event: 'tool', data: { seq: 2, phase: 'result', toolName: 'get_issue_detail', isError: true } },
    { event: 'delta', data: { text: '조회에 실패했어요.' } },
    { event: 'done', data: { sessionId: 's-tool-err' } },
  ])
  await openChatPanel(gen.handlers)
  await ask(gen, 'XX-99 조회해줘')
  await gen.done
  await waitFor(() => expect(screen.getByTestId('tool-step-tool')).toHaveTextContent('✗'))
  expect(screen.getByTestId('tool-step-tool')).toHaveTextContent('이슈 상세 조회')
})

// WP-157 회귀: 도구B 가 첫 도구 풍선에, 텍스트2 가 텍스트1 풍선에 합쳐지던 문제 — 도착순으로 풍선 4개가 분리된다.
test('도구 호출과 텍스트가 도착순으로 각각 새 풍선에 분리 렌더된다 (WP-157)', async () => {
  const gen = homeChatGeneration([
    { event: 'tool', data: { seq: 1, phase: 'start', toolName: 'get_issue_detail', args: { issueKey: 'EX-1' } } },
    { event: 'tool', data: { seq: 1, phase: 'result', toolName: 'get_issue_detail', isError: false } },
    { event: 'delta', data: { text: 'EX-1 을 확인했어요. ' } },
    { event: 'delta', data: { text: '상태를 바꿀게요.' } },
    { event: 'tool', data: { seq: 2, phase: 'start', toolName: 'update_issue', args: { issueKey: 'EX-1', status: '진행중' } } },
    { event: 'tool', data: { seq: 2, phase: 'result', toolName: 'update_issue', isError: false } },
    { event: 'delta', data: { text: '진행중으로 변경했어요.' } },
    { event: 'done', data: { sessionId: 's-tool-interleave' } },
  ])
  const { panel } = await openChatPanel(gen.handlers)
  await ask(gen, 'EX-1 확인하고 진행중으로')
  await gen.done
  await waitFor(() => expect(panelText()).toContain('진행중으로 변경했어요.'))
  const bubbles = [...panel.querySelectorAll('[data-testid="chat-block-tools"], [data-testid="chat-block"]')] as HTMLElement[]
  expect(bubbles).toHaveLength(4)
  expect(within(bubbles[0]).getAllByTestId('tool-step-tool')).toHaveLength(1)
  expect(bubbles[0]).toHaveTextContent('이슈 상세 조회')
  expect(bubbles[1]).toHaveTextContent('EX-1 을 확인했어요. 상태를 바꿀게요.')
  expect(bubbles[1]).not.toHaveTextContent('진행중으로 변경했어요.')
  expect(within(bubbles[2]).getAllByTestId('tool-step-tool')).toHaveLength(1)
  expect(bubbles[2]).toHaveTextContent('이슈 수정')
  expect(bubbles[2]).toHaveTextContent('✓')
  expect(bubbles[3]).toHaveTextContent(/^진행중으로 변경했어요\.$/)
})

test('세션 복원 시 toolCalls 가 ToolStepList(위임+도구 행) 로 렌더된다 (전체화면)', async () => {
  const sessions: HomeSessionPage = {
    items: [{ id: 's-restore-1', title: '복원 대화', lastMessageAt: '2026-06-22T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  }
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: '이슈 EX-5 상태 변경해줘', widgets: null, toolCalls: null, createdAt: '2026-06-22T00:00:00Z' },
    {
      id: 2, role: 'ASSISTANT', content: '상태를 완료로 변경했어요.', widgets: null, createdAt: '2026-06-22T00:00:01Z',
      toolCalls: [
        { kind: 'delegation', label: '이슈 전문가에게 위임 중' },
        { kind: 'tool', seq: 1, toolName: 'update_issue', args: { issueKey: 'EX-5', status: '완료' }, status: 'done' },
      ],
    },
  ]
  const { user } = renderPage('/projects', {
    handlers: [
      http.get('/api/v1/home/sessions', () => HttpResponse.json(sessions)),
      http.get('/api/v1/home/sessions/s-restore-1/messages', () => HttpResponse.json(messages)),
    ],
  })
  const launcher = await screen.findByTestId('chat-launcher', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await user.click(launcher)
  await user.click(launcher) // 두 번 → 전체화면
  await screen.findByTestId('ai-fullscreen')
  await user.click((await within(screen.getByTestId('ai-fs-sessions')).findAllByTestId('chat-session-select'))[0])
  const panel = screen.getByTestId('chat-panel')
  expect(await within(panel).findByTestId('tool-step-list')).toBeInTheDocument()
  expect(within(panel).getByTestId('tool-step-delegation')).toHaveTextContent('이슈 전문가에게 위임 중')
  const row = within(panel).getByTestId('tool-step-tool')
  expect(row).toHaveTextContent('이슈 수정')
  expect(row).toHaveTextContent('EX-5')
  expect(row).toHaveTextContent('✓')
  expect(panel).toHaveTextContent('상태를 완료로 변경했어요.')
})

// ── 후속 질문(ai-followups, WP-139) ────────────────────────────────────────

test('답이 끝나고 후속 질문이 오면 보이고, 누르면 같은 대화로 묻고 초안은 남으며 목록이 사라진다', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.queueStart(A)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  const { user } = await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await live.push('delta', { ...A, text: '내일 10시 디자인 리뷰가 있어요.' })
  await live.push('done', { ...A, widgets: null })
  expect(followupTexts()).toEqual([]) // 생성 중 안내 없음
  await live.push('followups', { ...A, messageId: 2, items: ITEMS })
  await waitFor(() => expect(followupTexts()).toEqual(ITEMS))
  expect(screen.getByRole('group', { name: '이어서 물어보기' })).toBeInTheDocument()

  fillInput('쓰던 초안')
  await user.click(screen.getAllByTestId('chat-followup').find((e) => e.textContent === '참석자 일정 알려줘')!)
  await waitFor(() => expect(live.starts.count()).toBe(2))
  expect(live.starts.last()).toMatchObject({ sessionId: 's-a', query: '참석자 일정 알려줘' })
  expect(screen.getByTestId('chat-input')).toHaveValue('쓰던 초안')
  await waitFor(() => expect(followupTexts()).toEqual([]))
})

test('이력의 마지막 답 후속 질문만 보인다', async () => {
  const live = liveChat()
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [
    msg(1, 'USER', '첫 질문'),
    { ...msg(2, 'ASSISTANT', '첫 답'), followups: ['옛 후속 질문 알려줘'] },
    msg(3, 'USER', '둘째 질문'),
    { ...msg(4, 'ASSISTANT', '둘째 답'), followups: ITEMS },
  ])
  const { user } = await openChatPanel(live.handlers)
  await openSession(user, TITLE_A)
  await waitFor(() => expect(panelText()).toContain('둘째 답'))
  await waitFor(() => expect(followupTexts()).toEqual(ITEMS))
  expect(panelText()).not.toContain('옛 후속 질문 알려줘')
})

test('확인 카드가 있으면 후속 질문을 보이지 않는다', async () => {
  const live = liveChat()
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', '회의 잡아줘'), { ...msg(2, 'ASSISTANT', '준비했어요'), followups: ITEMS }])
  const { user } = await openChatPanel([
    ...live.handlers,
    http.get('/api/v1/home/sessions/s-a/proposals', () =>
      HttpResponse.json([{ id: 9, actionType: 'calendar.create_event', summary: '회의 잡기', params: {} }])),
  ])
  await openSession(user, TITLE_A)
  expect(await screen.findByTestId('pending-action-card')).toBeInTheDocument()
  expect(followupTexts()).toEqual([])
})

test('추천을 끈 사용자는 라이브 후속 질문도 보지 않는다', async () => {
  const prefs = aiPreferences(false)
  const live = liveChat()
  live.queueStart(A)
  await openChatPanel([prefs.handler, ...live.handlers])
  await ask(live, '질문')
  await live.push('delta', { ...A, text: '답' })
  await live.push('done', { ...A, widgets: null })
  await live.push('followups', { ...A, messageId: 2, items: ITEMS })
  await waitFor(() => expect(panelText()).toContain('답'))
  await settle()
  expect(followupTexts()).toEqual([])
})

// ── 멀티 세션(ai-multi-session, WP-190·265·266·268) ───────────────────────

test('A 답변 중 새 대화 B 를 물어도 A 는 끊기지 않고, 돌아가면 이어서 끝까지 보인다', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.queueStart(B)
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  const { user } = await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await live.push('delta', { ...A, text: '첫 문단입니다. ' })
  await waitFor(() => expect(panelText()).toContain('첫 문단입니다.'))

  await user.click(screen.getByTestId('chat-new-session'))
  await waitFor(() => expect(panelText()).not.toContain(TITLE_A))
  await ask(live, TITLE_B)
  expect(live.starts.last()).toMatchObject({ sessionId: null, query: TITLE_B })

  await live.push('delta', { ...A, text: '둘째 문단입니다.' }) // 보이지 않는 A 에 도착
  await settle()
  expect(panelText()).not.toContain('둘째 문단입니다.')

  await openSession(user, TITLE_A)
  await waitFor(() => expect(panelText()).toContain('첫 문단입니다. 둘째 문단입니다.'))
  expect(screen.getByTestId('chat-stop')).toBeInTheDocument() // 아직 생성 중
  await live.push('done', { ...A, widgets: null })
  await waitFor(() => expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument())
  expect(panelText()).toContain('첫 문단입니다. 둘째 문단입니다.')
  expect(live.cancels.count()).toBe(0) // 전환은 취소하지 않는다
  expect(screen.queryByTestId('session-switch-guard')).not.toBeInTheDocument()
})

test('■ 정지는 그 대화만 멈추고 취소 요청 1회, 다른 대화의 생성은 계속된다', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.queueStart(B)
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  const { user } = await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await user.click(screen.getByTestId('chat-new-session'))
  await ask(live, TITLE_B)
  await live.push('delta', { ...B, text: 'B 부분 답변' })
  await user.click(screen.getByTestId('chat-stop'))
  await waitFor(() => expect(live.cancels.count()).toBe(1))
  expect(live.cancels.urls[0]).toBe(`/api/v1/ai/chat/${live.cid('corr-b')}`)

  await live.push('delta', { ...A, text: 'A 는 계속' })
  await openSession(user, TITLE_A)
  await waitFor(() => expect(panelText()).toContain('A 는 계속'))
  await settle()
  expect(live.cancels.count()).toBe(1)
})

test('패널을 닫으면 칩이 다른 대화의 생성·새 답변까지 모아 보여 준다', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.queueStart(B)
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  const { user } = await openChatPanel(live.handlers)
  const chip = screen.getByTestId('chat-launcher')
  await ask(live, TITLE_A)
  await user.click(screen.getByTestId('chat-new-session'))
  await ask(live, TITLE_B)
  await live.push('done', { ...B, widgets: null })
  await waitFor(() => expect(chip).toHaveAttribute('data-ai-activity', 'idle')) // 열려 있으면 idle
  await user.click(screen.getByTestId('ai-panel-close'))
  await waitFor(() => expect(chip).toHaveAttribute('data-ai-activity', 'pending'))
  await live.push('done', { ...A, widgets: null })
  await waitFor(() => expect(chip).toHaveAttribute('data-ai-activity', 'done'))
  expect(chip).toHaveAttribute('aria-label', 'AI 어시스턴트, 새 답변')
  // 다시 열었다 닫아도 A 는 아직 안 봤으므로 "새 답변" 유지.
  await user.click(chip)
  await user.click(await screen.findByTestId('ai-panel-close'))
  await waitFor(() => expect(chip).toHaveAttribute('data-ai-activity', 'done'))
})

test('대화 목록 둘째 줄: 답변 생성 중 → 새 답변 → 열면 상대시간', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.queueStart(B)
  live.setSessions([summary('s-b', TITLE_B, 1), summary('s-a', TITLE_A, 2)])
  const { user } = await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await user.click(screen.getByTestId('chat-new-session'))
  await ask(live, TITLE_B)
  await live.push('done', { ...B, widgets: null })

  await user.click(screen.getByTestId('chat-session-switcher'))
  await waitFor(() => expect(within(sessionItem(TITLE_A)).getByTestId('chat-session-status')).toHaveTextContent('답변 생성 중…'))
  expect(within(sessionItem(TITLE_B)).queryByTestId('chat-session-status')).not.toBeInTheDocument()
  expect(sessionItem(TITLE_B)).toHaveTextContent('1분 전')

  await live.push('done', { ...A, widgets: null })
  await waitFor(() => expect(within(sessionItem(TITLE_A)).getByTestId('chat-session-status')).toHaveTextContent('새 답변'))
  expect(sessionItem(TITLE_A)).toHaveAttribute('data-status', 'unseen')
  expect(sessionItem(TITLE_A).querySelector('.font-semibold')).toHaveTextContent(TITLE_A)

  await user.click(within(sessionItem(TITLE_A)).getByTestId('chat-session-select'))
  await user.click(screen.getByTestId('chat-session-switcher'))
  await waitFor(() => expect(sessionItem(TITLE_A)).toHaveAttribute('data-status', 'idle'))
  expect(within(sessionItem(TITLE_A)).queryByTestId('chat-session-status')).not.toBeInTheDocument()
})

test('다른 대화가 답변 중·새 답변이면 헤더 대화 목록 버튼에 점과 접근 이름', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.setSessions([summary('s-a', TITLE_A, 2)])
  const { user } = await openChatPanel(live.handlers)
  const switcher = screen.getByTestId('chat-session-switcher')
  await ask(live, TITLE_A)
  expect(within(switcher).queryByTestId('chat-session-switcher-dot')).not.toBeInTheDocument() // 현재 대화 자신은 제외
  await user.click(screen.getByTestId('chat-new-session'))
  expect(await within(screen.getByTestId('chat-session-switcher')).findByTestId('chat-session-switcher-dot')).toBeInTheDocument()
  expect(screen.getByTestId('chat-session-switcher')).toHaveAttribute('aria-label', expect.stringMatching(/다른 대화 답변 중$/))
  await live.push('done', { ...A, widgets: null })
  await waitFor(() =>
    expect(screen.getByTestId('chat-session-switcher')).toHaveAttribute('aria-label', expect.stringMatching(/다른 대화에 새 답변$/)))
  await openSession(user, TITLE_A)
  await waitFor(() => expect(screen.queryByTestId('chat-session-switcher-dot')).not.toBeInTheDocument())
})

test('생성 중인 대화 삭제는 중단 안내 후 취소 → 삭제 순으로 요청', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.setSessions([summary('s-a', TITLE_A, 2)])
  const { user } = await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await user.click(screen.getByTestId('chat-new-session'))
  await user.click(screen.getByTestId('chat-session-switcher'))
  await waitFor(() => expect(sessionItem(TITLE_A)).toBeTruthy())
  await user.click(within(sessionItem(TITLE_A)).getByTestId('chat-session-delete'))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('삭제하면 진행 중인 답변도 중단돼요')
  await user.click(within(dialog).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(live.deletes.urls).toHaveLength(2))
  expect(live.deletes.urls).toEqual([`/api/v1/ai/chat/${live.cid('corr-a')}`, '/api/v1/home/sessions/s-a'])
})

test('3개가 답변 중이면 4번째 대화는 안내와 함께 전송이 막히고, 하나가 끝나면 풀린다', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.queueStart(B)
  live.queueStart({ correlationId: 'corr-c', sessionId: 's-c' })
  live.setSessions([summary('s-c', TITLE_C, 1), summary('s-b', TITLE_B, 2), summary('s-a', TITLE_A, 3)])
  const { user } = await openChatPanel(live.handlers)
  for (const t of [TITLE_A, TITLE_B, TITLE_C]) {
    await ask(live, t)
    await user.click(screen.getByTestId('chat-new-session'))
  }
  const notice = await screen.findByTestId('chat-limit-notice')
  expect(notice).toHaveTextContent('다른 대화 3개가 답변 중이에요. 하나가 끝나면 보낼 수 있어요.')
  fillInput('넷째 질문입니다')
  expect(sendButton()).toBeDisabled()
  fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Enter' })
  await settle()
  expect(live.starts.count()).toBe(3)
  expect(screen.getByTestId('chat-input')).toHaveValue('넷째 질문입니다') // 입력은 가능·유지

  await user.click(within(notice).getByRole('button', { name: '대화 목록 보기' }))
  await waitFor(() => expect(sessionItem(TITLE_A)).toBeTruthy())
  await user.keyboard('{Escape}')

  await live.push('done', { correlationId: 'corr-c', sessionId: 's-c', widgets: null })
  await waitFor(() => expect(screen.queryByTestId('chat-limit-notice')).not.toBeInTheDocument())
  expect(sendButton()).toBeEnabled()
})

test('서버가 409 로 거절하면 "아직 답변 중" 토스트, 입력은 남는다', async () => {
  const live = liveChat()
  live.queueStart({ status: 409 })
  live.setSessions([summary('s-a', TITLE_A, 2)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  const { user } = await openChatPanel(live.handlers)
  await openSession(user, TITLE_A)
  await waitFor(() => expect(panelText()).toContain('요약본입니다'))
  await ask(live, '조금 더 짧게')
  expect(await screen.findByText('이 대화는 아직 답변 중이에요')).toBeInTheDocument()
  expect(screen.getByTestId('chat-input')).toHaveValue('조금 더 짧게')
})

// 새로고침은 서버 이력(STOPPED)을 다시 읽는 것이라 다시 띄운 앱으로 본다 — 브라우저 저장소에 기대지 않는다.
test('■ 정지 → 부분 답변 아래 "중단됨", 종결 전엔 같은 대화 전송을 막고, 다시 띄워 열어도 유지', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  const first = await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await live.push('delta', { ...A, text: '매출은 전 분기 대비' })
  await first.user.click(screen.getByTestId('chat-stop'))
  await waitFor(() => expect(screen.getByTestId('chat-interrupted')).toHaveTextContent('중단됨'))
  fillInput('이어서')
  expect(sendButton()).toBeDisabled() // 서버 종결 전(R12)
  await live.push('cancelled', { ...A, reason: 'user' })
  await waitFor(() => expect(sendButton()).toBeEnabled())
  expect(screen.getAllByTestId('chat-interrupted')).toHaveLength(1)

  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '매출은 전 분기 대비', 'STOPPED')])
  first.unmount()
  const again = await openChatPanel(live.handlers)
  await openSession(again.user, TITLE_A)
  await waitFor(() => expect(screen.getByTestId('chat-interrupted')).toHaveTextContent('중단됨'))
})

test('오류·서버 타임아웃으로 끝난 답변은 "오류로 중단됨"/"시간 초과로 중단됨"', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.queueStart(B)
  const { user } = await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await live.push('delta', { ...A, text: '반쯤' })
  await live.push('error', { ...A, message: 'AI 구성 요청에 실패했어요.' })
  await waitFor(() => expect(screen.getByTestId('chat-interrupted')).toHaveTextContent('오류로 중단됨'))
  await user.click(screen.getByTestId('chat-new-session'))
  await ask(live, TITLE_B)
  await live.push('delta', { ...B, text: '오래 걸리는' })
  await live.push('cancelled', { ...B, reason: 'timeout' })
  await waitFor(() => expect(screen.getByTestId('chat-interrupted')).toHaveTextContent('시간 초과로 중단됨'))
  expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument()
})

test('서버 생성 중 목록으로 상태를 복원하고, 끝나면 다시 읽어 보여 준다(중간 조각은 버린다)', async () => {
  const live = liveChat()
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '2026-10-05T00:00:00Z' }])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A)])
  const { user } = await openChatPanel(live.handlers)
  await user.click(screen.getByTestId('chat-session-switcher'))
  await waitFor(() => expect(within(sessionItem(TITLE_A)).getByTestId('chat-session-status')).toHaveTextContent('답변 생성 중…'))
  await user.click(within(sessionItem(TITLE_A)).getByTestId('chat-session-select'))
  expect(await screen.findByTestId('chat-pending')).toBeInTheDocument()
  expect(screen.getByTestId('chat-stop')).toBeInTheDocument()

  await live.push('delta', { ...A, text: '중간 조각' })
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '완성된 요약입니다')])
  live.setActive([])
  await live.push('done', { ...A, widgets: null })
  await waitFor(() => expect(panelText()).toContain('완성된 요약입니다'))
  expect(panelText()).not.toContain('중간 조각')
  expect(screen.queryByTestId('chat-pending')).not.toBeInTheDocument()
})

test('열어 둔 대화가 다른 창에서 답변을 시작하면 이유를 안내하고, 그 질문과 "답변 중" 을 이어받는다 (WP-266)', async () => {
  const live = liveChat()
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  const { user } = await openChatPanel(live.handlers)
  await openSession(user, TITLE_A)
  await waitFor(() => expect(panelText()).toContain('요약본입니다'))

  const release = live.holdMessages('s-a')
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다'), msg(3, 'USER', '다른 창에서 보낸 질문')])
  await live.push('delta', { correlationId: 'corr-o', sessionId: 's-a', text: '다른 창 답변' })
  const notice = await screen.findByTestId('chat-busy-elsewhere')
  expect(notice).toHaveTextContent('이 대화는 다른 창에서 답변 중이에요. 끝나면 보낼 수 있어요.')
  fillInput('나도 물어볼게')
  expect(sendButton()).toBeDisabled()
  expect(sendButton()).toHaveAttribute('aria-describedby', 'chat-busy-notice')

  release()
  await waitFor(() => expect(panelText()).toContain('다른 창에서 보낸 질문'))
  expect(screen.getByTestId('chat-pending')).toBeInTheDocument()
  expect(screen.getByTestId('chat-stop')).toBeInTheDocument()
  expect(screen.queryByTestId('chat-busy-elsewhere')).not.toBeInTheDocument()
  expect(panelText()).not.toContain('다른 창 답변')

  live.setMessages('s-a', [
    msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다'),
    msg(3, 'USER', '다른 창에서 보낸 질문'), msg(4, 'ASSISTANT', '다른 창의 완성된 답변'),
  ])
  await live.push('done', { correlationId: 'corr-o', sessionId: 's-a', widgets: null })
  await waitFor(() => expect(panelText()).toContain('다른 창의 완성된 답변'))
  expect(screen.queryByTestId('chat-pending')).not.toBeInTheDocument()
  expect(sendButton()).toBeEnabled()
  expect(screen.getByTestId('chat-input')).toHaveValue('나도 물어볼게')
})

// SSE 재연결(앱의 백오프 1~2초)을 실제로 기다린다 — 끊긴 사이 조각은 이어 붙이지 않고, 끝나면 전체 답변으로 바꾼다(WP-265).
test('답변 중 SSE 가 다시 이어지면 받은 부분을 두고 안내하다가, 끝나면 전체 답변으로 바꾼다', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  await openChatPanel(live.handlers)
  await ask(live, TITLE_A)
  await live.push('delta', { ...A, text: '첫 문단입니다.' })
  await waitFor(() => expect(panelText()).toContain('첫 문단입니다.'))

  live.setActive([{ sessionId: 's-a', correlationId: 'corr-a', startedAt: '2026-10-05T00:00:00Z' }])
  await live.reconnect()
  const note = await screen.findByTestId('chat-reconnected', {}, { timeout: 5_000 })
  expect(note).toHaveTextContent('연결이 다시 이어졌어요 · 답변이 끝나면 전체를 불러와요')
  expect(panelText()).toContain('첫 문단입니다.')
  expect(screen.getByTestId('chat-stop')).toBeInTheDocument()

  await live.push('delta', { ...A, text: ' 이어진 조각' })
  await settle()
  expect(panelText()).not.toContain('이어진 조각')

  live.setActive([])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '첫 문단입니다. 끊긴 사이 조각까지 온전한 답변')])
  await live.push('done', { ...A, widgets: null })
  await waitFor(() => expect(panelText()).toContain('첫 문단입니다. 끊긴 사이 조각까지 온전한 답변'))
  expect(screen.queryByTestId('chat-reconnected')).not.toBeInTheDocument()
  expect(screen.queryByTestId('chat-stop')).not.toBeInTheDocument()
}, 20_000)

test('대화를 열고 이력을 읽는 동안은 보내기를 막고, 이력이 오면 그 뒤에 이어 보낸다 (WP-268)', async () => {
  const live = liveChat()
  live.queueStart(A)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  const { user } = await openChatPanel(live.handlers)
  const release = live.holdMessages('s-a')
  await openSession(user, TITLE_A)
  fillInput(TITLE_A)
  expect(sendButton()).toBeDisabled()
  fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Enter' }) // Enter 도 같은 판정
  await settle()
  expect(live.starts.count()).toBe(0)

  release()
  await waitFor(() => expect(panelText()).toContain('요약본입니다'))
  await waitFor(() => expect(sendButton()).toBeEnabled())
  await ask(live, TITLE_A) // 같은 질문을 다시 보내도 지난 쌍이 숨지 않는다
  await waitFor(() => expect(within(screen.getByTestId('chat-panel')).getAllByTestId('chat-user-bubble')).toHaveLength(2))
  expect(panelText()).toContain('요약본입니다')
  expect(live.starts.last()).toMatchObject({ sessionId: 's-a', query: TITLE_A, correlationId: live.cid('corr-a') })
})

// ── 통합 SSE 한 줄기(sse-single-stream, #506) ──────────────────────────────

// 구 스트림(/chat/stream·/messaging/stream·/notifications/stream)이 열리면 핸들러 없는 요청이라 setup 이 테스트를 실패시킨다.
// 여기서는 그 요청이 없고 /events 가 실제로 열렸음을 함께 본다(「안 열림」 단언이 공허하지 않게).
test('인증된 앱 셸은 통합 /api/v1/events 한 커넥션만 열고 구 스트림은 열지 않는다', async () => {
  const paths: string[] = []
  const onStart = ({ request }: { request: Request }) => void paths.push(new URL(request.url).pathname)
  server.events.on('request:start', onStart)
  try {
    renderPage('/projects')
    await screen.findByTestId('chat-launcher', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(paths).toContain('/api/v1/events'))
    await act(() => settle(200))
    expect(paths.filter((p) => p === '/api/v1/events')).toHaveLength(1)
    expect(paths.filter((p) => /\/(chat|messaging|notifications)\/stream$/.test(p))).toEqual([])
  } finally {
    server.events.removeListener('request:start', onStart)
  }
})
