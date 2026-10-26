// 전역 AI 어시스턴트(칩 → 사이드 → 전체 화면) 페이지 테스트(WP-971, WP-982).
// 보내기 버튼 활성·Enter/Shift+Enter 전송 payload·5xx 오류 버블·세션 삭제 확인·칩 모드 순환·⌘K/Esc·헤더 모드 버튼·
// 전체 화면 세션 transcript·위임 진행 버블·확인 카드 승인/거부·델타 누적 렌더·세션 선택 뒤 드롭다운 닫힘·
// 레일 이동 시 전체 화면 강등(#454)·aiAvailable 게이트는 브라우저 없이 판정되므로 e2e/pages/global-chat.spec.ts 에서 옮겼다.
// 그 spec 에는 기하(치수·겹침·넘침·스크롤 고정)와 대표 배선 1건만 남는다.
// renderPage 를 쓰는 이유: 칩·사이드 패널·전체 화면·통합 SSE 구독(useEventStream)·aiAvailable 게이트가 모두 앱 셸(AppLayout)에 있고,
// 레일 이동(#454)은 다른 라우트로 넘어간 뒤 AI 모드를 본다 — 컴포넌트 하나로 띄우면 셸의 조립 자체를 검증하지 못한다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { beforeEach, expect, test } from 'vitest'

import { chatStreams } from '@/lib/ai/chatStreams'
import { controllableEvents } from '@/test/kits/projects/issueDetailEvents'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { HomeMessage, HomeSessionPage } from '@/types/home'

import { createUser } from '../../../e2e/factories/auth.factory'

type Frame = { event: string; data: Record<string, unknown> }
type StartBody = { sessionId: string | null; query: string; correlationId: string }

/** home.chat.* 프레임 → SSE 본문(웹이 보낸 correlationId 를 각 프레임에 싣는다 — 실제 서버와 같음). */
const sse = (frames: Frame[], correlationId: string) =>
  frames.map((f) => `event: home.chat.${f.event}\ndata: ${JSON.stringify({ correlationId, ...f.data })}\n\n`).join('')

/**
 * POST /api/v1/ai/chat 시작(correlationId 그대로 반환) + 통합 SSE 로 frames 를 흘린다 — E2E mockHomeChatGeneration 자리.
 * 시작 요청 본문은 bodies 에 모인다. frames 는 응답을 돌려준 다음 틱에 열린 스트림으로 보낸다(전송 뒤에 도착하게).
 */
function homeChat(frames: Frame[], { status = 200 }: { status?: number } = {}) {
  const events = controllableEvents()
  const bodies: StartBody[] = []
  const handlers = [
    events.handler,
    http.post('/api/v1/ai/chat', async ({ request }) => {
      const body = (await request.json()) as StartBody
      bodies.push(body)
      if (status !== 200) return HttpResponse.json({ message: 'AI agent internal error' }, { status })
      setTimeout(() => void events.push(sse(frames, body.correlationId)), 0)
      return HttpResponse.json({ correlationId: body.correlationId })
    }),
  ]
  return { handlers, bodies }
}

const sessionsOf = (items: HomeSessionPage['items']) =>
  http.get('/api/v1/home/sessions', () => HttpResponse.json({ items, nextCursor: null } satisfies HomeSessionPage))

const msg = (id: number, role: HomeMessage['role'], content: string): HomeMessage => ({
  id, role, content, widgets: null, toolCalls: null, createdAt: '2026-06-08T00:00:00Z',
})

/** 확인 카드 1건 — pending_action 봉투의 actions 원소(서버가 영속한 제안). */
const proposal = (id: number, summary: string) => ({
  id, sessionId: 's-prop', actionType: 'calendar.create_event', summary, params: {}, status: 'PENDING', errorMessage: null,
})

// 대화 저장소(chatStreams)는 모듈 전역이라 파일 안에서 앞 테스트의 턴이 남는다 — 새로고침한 것처럼 매번 새 대화에서 시작한다.
beforeEach(() => chatStreams.newConversation())

/** 앱을 띄우고 칩이 보일 때까지 기다린다. */
async function openApp(path = '/', handlers: Parameters<typeof renderPage>[1] = {}) {
  const view = renderPage(path, handlers)
  const chip = await screen.findByTestId('chat-launcher', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, chip }
}

/** 칩을 눌러 사이드 패널을 열고 질의를 보낸다. */
async function sendFromSide(user: ReturnType<typeof renderPage>['user'], chip: HTMLElement, query: string) {
  await user.click(chip)
  fireEvent.change(await screen.findByTestId('chat-input'), { target: { value: query } })
  await user.click(screen.getByRole('button', { name: '보내기' }))
}

// 보내기 버튼 disabled 가 입력 상태와 맞물린다(#144).
test('입력이 비어 있으면 보내기 버튼이 비활성이고, 글자가 있으면 활성이다', async () => {
  const { user, chip } = await openApp()
  await user.click(chip)
  const send = screen.getByRole('button', { name: '보내기' })
  expect(send).toBeDisabled()
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '안녕' } })
  expect(send).toBeEnabled()
  fireEvent.change(screen.getByTestId('chat-input'), { target: { value: '' } })
  expect(send).toBeDisabled()
})

// 홈이 아닌 화면에서 보내도 홈으로 이동하지 않고 그 자리 패널에 질의·응답 턴이 그려지며, 시작 payload 는 새 세션(null)·입력 그대로다.
test('비-홈(이슈) 화면에서 보내면 제자리에서 응답하고 payload 는 sessionId null + 입력 query 다', async () => {
  const chat = homeChat([
    { event: 'delta', data: { text: '내 HIGH 이슈를 ' } },
    { event: 'delta', data: { text: '정리했어요' } },
    { event: 'done', data: { sessionId: 's-nonhome' } },
  ])
  const { user, chip, location } = await openApp('/projects', { handlers: chat.handlers })
  await sendFromSide(user, chip, '내 HIGH 이슈')
  await waitFor(() => expect(screen.getByTestId('chat-panel')).toHaveTextContent('내 HIGH 이슈를 정리했어요'))
  expect(chat.bodies).toHaveLength(1)
  expect(chat.bodies[0]).toMatchObject({ sessionId: null, query: '내 HIGH 이슈' })
  expect(location()).toBe('/projects')
  expect(screen.queryByTestId('home-widget')).not.toBeInTheDocument()
})

// 여러 줄 입력 — Shift+Enter 는 줄바꿈(전송 안 함), Enter 는 전송하고 query 에 \n 이 보존된다. 전송 뒤 입력창은 비워진다.
test('Shift+Enter 는 줄바꿈, Enter 는 전송하고 query 에 줄바꿈이 남는다', async () => {
  const chat = homeChat([{ event: 'done', data: { sessionId: 's-multiline' } }])
  const { user, chip } = await openApp('/', { handlers: chat.handlers })
  await user.click(chip)
  const input = await screen.findByTestId('chat-input')
  await user.click(input)
  await user.keyboard('첫 줄{Shift>}{Enter}{/Shift}둘째 줄')
  expect(input).toHaveValue('첫 줄\n둘째 줄')
  expect(chat.bodies).toHaveLength(0)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(chat.bodies[0]?.query).toBe('첫 줄\n둘째 줄'))
  await waitFor(() => expect(input).toHaveValue(''))
})

// 세션 삭제는 휴지통 → AlertDialog 확인 뒤에만(#193). 취소하면 DELETE 가 나가지 않는다.
test('세션 휴지통은 확인 대화상자를 띄우고, 취소하면 삭제 요청이 없다', async () => {
  let deletes = 0
  const { user, chip } = await openApp('/', {
    handlers: [
      sessionsOf([{ id: 'sc1', title: '테스트 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }]),
      http.delete('/api/v1/home/sessions/sc1', () => {
        deletes++
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  await user.click(chip)
  await user.click(await screen.findByTestId('chat-session-switcher'))
  await user.click(await screen.findByTestId('chat-session-delete'))
  const dialog = await screen.findByRole('alertdialog')
  expect(dialog).toHaveTextContent('대화 삭제')
  expect(dialog).toHaveTextContent('삭제된 대화는 복구할 수 없습니다')
  await user.click(within(dialog).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(deletes).toBe(0)
})

test('세션 삭제 확인을 누르면 DELETE 가 나가고 대화상자가 닫힌다 (#193)', async () => {
  let deletes = 0
  const { user, chip } = await openApp('/', {
    handlers: [
      sessionsOf([{ id: 'sc2', title: '삭제할 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 }]),
      http.delete('/api/v1/home/sessions/sc2', () => {
        deletes++
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  await user.click(chip)
  await user.click(await screen.findByTestId('chat-session-switcher'))
  await user.click(await screen.findByTestId('chat-session-delete'))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deletes).toBe(1))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})

// #353 — 시작 요청이 5xx 면 빈 어시스턴트 턴이 사라지지 않고 실패 안내로 채워지며, 입력창은 다시 쓸 수 있다.
test('AI 응답 시작이 5xx 면 실패 안내 버블이 남고 입력창이 활성이다 (#353)', async () => {
  const chat = homeChat([], { status: 500 })
  const { user, chip } = await openApp('/', { handlers: chat.handlers })
  await sendFromSide(user, chip, '현재 진행 중인 프로젝트 목록 알려줘')
  const panel = screen.getByTestId('chat-panel')
  await waitFor(() => expect(within(panel).getAllByTestId('chat-turn').at(-1)).toHaveTextContent('응답 생성에 실패했습니다'))
  expect(panel).toHaveTextContent('현재 진행 중인 프로젝트 목록 알려줘')
  expect(screen.getByTestId('chat-input')).toBeEnabled()
})

// 칩 클릭은 closed → side → fullscreen → closed 로 순환하고, 칩의 data-mode 가 따라간다.
test('칩 클릭이 closed→side→fullscreen→closed 로 순환한다', async () => {
  const { user, chip } = await openApp()
  expect(chip).toHaveAttribute('data-mode', 'closed')
  expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument()
  await user.click(chip)
  expect(await screen.findByTestId('ai-side-panel')).toBeInTheDocument()
  expect(chip).toHaveAttribute('data-mode', 'side')
  await user.click(chip)
  expect(await screen.findByTestId('ai-fullscreen')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument()
  expect(chip).toHaveAttribute('data-mode', 'fullscreen')
  await user.click(chip)
  await waitFor(() => expect(screen.queryByTestId('ai-fullscreen')).not.toBeInTheDocument())
  expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument()
  expect(chip).toHaveAttribute('data-mode', 'closed')
})

// 전역 단축키 — ⌘K 는 닫힌 패널을 side 로 열고, Esc 는 닫는다(AIAssistantProvider 의 window keydown).
test('⌘K 로 사이드 패널이 열리고 Esc 로 닫힌다', async () => {
  await openApp()
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  expect(await screen.findByTestId('ai-side-panel')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument())
})

// 헤더 모드 버튼(WP-111) — 사이드 ↔ 전체 화면 전환, 눌린 상태(aria-pressed), 전체 화면에서도 같은 닫기 버튼.
test('헤더 모드 버튼으로 사이드 ↔ 전체 화면을 전환하고 닫기로 닫힌다 (WP-111)', async () => {
  const { user, chip } = await openApp()
  await user.click(chip)
  expect(await screen.findByTestId('ai-panel-header')).toHaveTextContent('AI 어시스턴트')
  expect(screen.getByTestId('ai-mode-side')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('ai-mode-fullscreen')).toHaveAttribute('aria-pressed', 'false')
  await user.click(screen.getByTestId('ai-mode-fullscreen'))
  expect(await screen.findByTestId('ai-fullscreen')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument()
  expect(screen.getByTestId('ai-mode-fullscreen')).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByTestId('ai-mode-side'))
  expect(await screen.findByTestId('ai-side-panel')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-fullscreen')).not.toBeInTheDocument()
  // 사이드 패널의 닫기 → 패널 제거·칩 closed, 칩으로 다시 열 수 있다.
  await user.click(screen.getByTestId('ai-panel-close'))
  await waitFor(() => expect(screen.queryByTestId('ai-side-panel')).not.toBeInTheDocument())
  expect(chip).toHaveAttribute('data-mode', 'closed')
  await user.click(chip)
  expect(await screen.findByTestId('ai-side-panel')).toBeInTheDocument()
  // 전체 화면에서도 같은 닫기 버튼으로 닫힌다.
  await user.click(screen.getByTestId('ai-mode-fullscreen'))
  await user.click(await screen.findByTestId('ai-panel-close'))
  await waitFor(() => expect(screen.queryByTestId('ai-fullscreen')).not.toBeInTheDocument())
  expect(chip).toHaveAttribute('data-mode', 'closed')
})

// 전체 화면 2단 — 왼쪽 세션 목록에서 고르면 오른쪽 채팅 패널에 그 세션의 메시지가 턴으로 그려진다.
test('전체 화면에서 세션을 고르면 오른쪽 채팅 패널에 transcript 가 그려진다', async () => {
  const { user, chip } = await openApp('/', {
    handlers: [
      sessionsOf([{ id: 's-fs1', title: '풀스크린 테스트 대화', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 1 }]),
      http.get('/api/v1/home/sessions/s-fs1/messages', () =>
        HttpResponse.json([msg(1, 'USER', '풀스크린 질문'), msg(2, 'ASSISTANT', '풀스크린 응답입니다')]),
      ),
    ],
  })
  await user.click(chip)
  await user.click(chip)
  const sessions = await screen.findByTestId('ai-fs-sessions')
  await waitFor(() => expect(within(sessions).getAllByTestId('chat-session-item')).toHaveLength(1))
  await user.click(within(sessions).getByTestId('chat-session-select'))
  const panel = screen.getByTestId('chat-panel')
  await waitFor(() => expect(within(panel).getAllByTestId('chat-turn')).toHaveLength(2))
  expect(panel).toHaveTextContent('풀스크린 질문')
  expect(panel).toHaveTextContent('풀스크린 응답입니다')
})

// #333 — progress 프레임은 위임 진행 버블로, 이어지는 delta 는 최종 응답으로 그려진다(progress 가 스트림을 끊지 않음).
test('위임 진행 이벤트가 위임 버블을 그리고 응답도 이어서 그려진다 (#333)', async () => {
  const chat = homeChat([
    { event: 'progress', data: { label: '캘린더 전문가에게 위임 중' } },
    { event: 'delta', data: { text: '일정을 확인했어요' } },
    { event: 'done', data: { sessionId: 's-prog-1' } },
  ])
  const { user, chip } = await openApp('/', { handlers: chat.handlers })
  await sendFromSide(user, chip, '다음주 회의 잡아줘')
  expect(await screen.findByTestId('tool-step-delegation')).toHaveTextContent('캘린더 전문가에게 위임 중')
  await waitFor(() => expect(screen.getByTestId('chat-panel')).toHaveTextContent('일정을 확인했어요'))
})

// 확인 카드(#333, #843) — pending_action 이 요약 카드로 보이고, 승인은 params 없이 제안 id 로 confirm 한 뒤
// 서버가 돌려준 결과(승인 완료)를 결과 줄로 남긴다. 거부는 reject 1회 + 「사용자가 거절」 결과 줄.
function proposalHandlers(calls: { id: number; op: string }[], summary: string) {
  return http.post('/api/v1/home/proposals/:id/:op', ({ params }) => {
    const id = Number(params.id)
    const op = String(params.op)
    calls.push({ id, op })
    const done = op === 'confirm'
    return HttpResponse.json({
      proposal: { ...proposal(id, summary), status: done ? 'DONE' : 'REJECTED' },
      message: {
        id: 1000 + id, role: done ? 'ACTION_DONE' : 'ACTION_REJECTED',
        content: done ? `승인 완료: ${summary}` : `사용자가 거절: ${summary}`,
        widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:00Z',
      },
    })
  })
}

test('확인 카드 — 승인하면 제안 id 로 confirm 하고 카드 대신 결과 줄을 남긴다 (#333, #843)', async () => {
  const calls: { id: number; op: string }[] = []
  const chat = homeChat([
    { event: 'delta', data: { text: '6/26 10시 팀 미팅을 제안할게요' } },
    { event: 'pending_action', data: { sessionId: 's-conf-1', actions: [proposal(11, '6/26 10시 팀 미팅(1시간)')] } },
    { event: 'done', data: { sessionId: 's-conf-1' } },
  ])
  const { user, chip } = await openApp('/', { handlers: [...chat.handlers, proposalHandlers(calls, '6/26 10시 팀 미팅(1시간)')] })
  await sendFromSide(user, chip, '다음주 팀미팅 잡아줘')
  const card = await screen.findByTestId('pending-action-card')
  expect(card).toHaveTextContent('6/26 10시 팀 미팅(1시간)')
  await user.click(within(card).getByRole('button', { name: '승인' }))
  await waitFor(() => expect(screen.queryByTestId('pending-action-card')).not.toBeInTheDocument())
  expect(calls).toEqual([{ id: 11, op: 'confirm' }])
  const result = await screen.findByTestId('action-result')
  expect(result).toHaveAttribute('data-status', 'done')
  expect(result).toHaveTextContent('승인 완료: 6/26 10시 팀 미팅(1시간)')
})

test('확인 카드 — 거부하면 reject 1회를 기록하고 거절 결과 줄을 남긴다 (#333, #843)', async () => {
  const calls: { id: number; op: string }[] = []
  const chat = homeChat([
    { event: 'pending_action', data: { sessionId: 's-conf-2', actions: [proposal(12, '취소 대상')] } },
    { event: 'done', data: { sessionId: 's-conf-2' } },
  ])
  const { user, chip } = await openApp('/', { handlers: [...chat.handlers, proposalHandlers(calls, '취소 대상')] })
  await sendFromSide(user, chip, '일정 잡아줘')
  const card = await screen.findByTestId('pending-action-card')
  await user.click(within(card).getByRole('button', { name: '거부' }))
  await waitFor(() => expect(screen.queryByTestId('pending-action-card')).not.toBeInTheDocument())
  expect(calls).toEqual([{ id: 12, op: 'reject' }])
  const result = await screen.findByTestId('action-result')
  expect(result).toHaveAttribute('data-status', 'rejected')
  expect(result).toHaveTextContent('사용자가 거절: 취소 대상')
})

// 델타 누적 — '안'·'녕'·'하세요' 세 토큰을 모두 이어 붙여야만 '안녕하세요' 가 된다. 끝나면 3-dot 대기 표시가 사라진다.
test('델타 토큰이 누적되어 응답이 그려지고 끝나면 대기 표시가 사라진다', async () => {
  const chat = homeChat([
    { event: 'delta', data: { text: '안' } },
    { event: 'delta', data: { text: '녕' } },
    { event: 'delta', data: { text: '하세요' } },
    { event: 'done', data: { sessionId: 's-stream-1' } },
  ])
  const { user, chip } = await openApp('/', { handlers: chat.handlers })
  await sendFromSide(user, chip, '인사해줘')
  await waitFor(() => expect(screen.getByTestId('chat-panel')).toHaveTextContent('안녕하세요'))
  expect(screen.getByTestId('chat-panel')).toHaveTextContent('인사해줘')
  await waitFor(() => expect(screen.queryByTestId('chat-pending')).not.toBeInTheDocument())
})

// #451 — 세션 스위처에서 세션을 고르면 드롭다운이 닫힌다(controlled DropdownMenu).
test('사이드 패널 세션 스위처에서 세션을 고르면 드롭다운이 닫힌다 (#451)', async () => {
  const { user, chip } = await openApp('/', {
    handlers: [
      sessionsOf([
        { id: 's-a', title: '대화 A', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 },
        { id: 's-b', title: '대화 B', lastMessageAt: '2026-06-08T00:00:00Z', widgetCount: 0 },
      ]),
      http.get('/api/v1/home/sessions/s-a/messages', () => HttpResponse.json([])),
    ],
  })
  await user.click(chip)
  await user.click(await screen.findByTestId('chat-session-switcher'))
  const items = await screen.findAllByTestId('chat-session-select')
  await user.click(items[0])
  await waitFor(() => expect(screen.queryByTestId('chat-session-item')).not.toBeInTheDocument())
  expect(screen.getByTestId('chat-session-title')).toHaveTextContent('대화 A')
})

// #454 — 레일로 앱을 바꾸면 전체 화면 AI 는 side 로 강등되고(새 앱이 가려지지 않게), side 는 그대로 둔다.
test('레일로 앱을 바꾸면 전체 화면 AI 는 사이드 패널로 내려간다 (#454)', async () => {
  const { user, chip, location } = await openApp()
  await user.click(chip)
  await user.click(chip)
  await screen.findByTestId('ai-fullscreen')
  await user.click(screen.getByTestId('rail-link-/projects'))
  await waitFor(() => expect(location()).toMatch(/^\/projects/))
  expect(await screen.findByTestId('ai-side-panel')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-fullscreen')).not.toBeInTheDocument()
})

test('레일로 앱을 바꿔도 사이드 모드는 그대로다 (#454 회귀가드)', async () => {
  const { user, chip, location } = await openApp()
  await user.click(chip)
  await screen.findByTestId('ai-side-panel')
  await user.click(screen.getByTestId('rail-link-/projects'))
  await waitFor(() => expect(location()).toMatch(/^\/projects/))
  // 이동 직후 한 틱 더 — 모드가 잘못 바뀐다면 이 사이에 반영된다.
  await act(async () => {})
  expect(screen.getByTestId('ai-side-panel')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-fullscreen')).not.toBeInTheDocument()
})

// aiAvailable 게이트 — 비서가 없으면 셸이 AI 칩을 그리지 않는다(사이드·전체 화면도 마찬가지).
test('aiAvailable=false 이면 AI 칩이 그려지지 않는다', async () => {
  renderPage('/', { user: createUser({ aiAvailable: false }) })
  await screen.findByTestId('rail-link-/projects', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(screen.queryByTestId('chat-launcher')).not.toBeInTheDocument()
})
