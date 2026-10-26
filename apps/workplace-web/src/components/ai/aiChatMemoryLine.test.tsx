// AI 채팅 메모리 결과 줄(WP-55·379·380·386·581) — 페이지 테스트(WP-966 웨이브 3).
// 결과 줄이 동작대로 생기는지·문구(범위·기한·공용)·done 전 비활성·되돌리기 payload(messageId·blockIndex)·줄별 잠금·오류 토스트 6종과
// 설정 이동·이력 복원(at 자리·구 이력·깨진 공용 줄)은 브라우저 없이 판정되므로 e2e/pages/ai-memory-result-line.spec.ts 에서 옮겼다.
// 「답 아래·후속 질문 위」 같은 자리는 문서 순서로 본다(그려질 흐름 위치). 실제 기하·밑줄·nowrap·들여쓰기·넘침은 그 spec 의 @layout 이 지킨다.
// AI 패널은 앱 셸이 SSE 구독과 함께 띄우므로 renderPage 로 연다(testkit-b2a).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import type { MemoryBlock } from '@/types/home'

import {
  aiPreferences,
  ask,
  gate,
  liveChat,
  memoryError,
  memoryTool,
  memoryUndo,
  msg,
  openChatPanel,
  openSession,
  precedes,
  summary,
  TITLE_A,
  TITLE_B,
} from './testkit-b2a'

const C = { correlationId: 'corr-a', sessionId: 's-a' }
const lines = () => screen.queryAllByTestId('chat-memory-result')
const undoOf = (i: number) => within(lines()[i]).getByTestId('chat-memory-undo')
const lastBlock = () => screen.getAllByTestId('chat-block').at(-1)!

const saved = { action: 'saved', memoryId: 12, kind: 'PREFERENCE', content: '이슈 목록은 짧은 목록으로 보여 준다', source: 'AI' }
const updated = { action: 'updated', memoryId: 9, kind: 'CONTEXT', content: '백엔드 팀이다', previousContent: '프론트 팀이다', source: 'AI' }
const forgotten = { action: 'forgotten', memoryId: 7, kind: 'PREFERENCE', content: '표로 보여 준다', source: 'USER' }
const shared = { action: 'shared' as const, changeId: 41, memoryId: 9, spaceName: 'Smart Workplace(WP)', content: '배포는 API 먼저 한다' }

/** 생성 하나를 시작한 패널 — undo 응답·추가 핸들러를 받는다. */
async function startChat(question: string, undo = memoryUndo(), extra: Parameters<typeof openChatPanel>[0] = []) {
  const live = liveChat()
  live.queueStart(C)
  const view = await openChatPanel([undo.handler, ...extra, ...live.handlers])
  await ask(live, question)
  return { ...view, live, undo }
}

test('저장 결과 줄은 답 아래·후속 질문 위, done 전엔 되돌리기가 꺼져 있다가 누르면 되돌림으로 바뀐다', async () => {
  const { live, undo, user } = await startChat('앞으로는 이슈 목록을 짧은 목록으로 보여줘')
  await live.push('delta', { ...C, text: '알겠어요. 앞으로 짧은 목록으로 보여 드릴게요.' })
  await memoryTool(live, 1, 'mcp__workplace__remember_memory', saved)

  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(lines()[0]).toHaveTextContent('메모리에 저장함: "이슈 목록은 짧은 목록으로 보여 준다" · 되돌리기')
  expect(undoOf(0)).toBeDisabled() // done 전 — 메시지 id 없음
  expect(screen.queryByTestId('chat-block-tools')).not.toBeInTheDocument() // 도구 단계 목록에는 없다

  await live.push('done', { ...C, widgets: null, messageId: 2 })
  await live.push('followups', { ...C, messageId: 2, items: ['내 이슈 보여줘'] })
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  const followups = await screen.findByTestId('chat-followups')
  expect(precedes(lastBlock(), lines()[0])).toBe(true)
  expect(precedes(lines()[0], followups)).toBe(true)

  await user.click(undoOf(0))
  await waitFor(() => expect(undo.calls.count()).toBe(1))
  expect(undo.calls.last()).toEqual({ messageId: 2, blockIndex: 0 })
  await waitFor(() => expect(lines()[0]).toHaveAttribute('data-undone', 'true'))
  expect(lines()[0]).toHaveTextContent('· 되돌림')
  expect(screen.queryByTestId('chat-memory-undo')).not.toBeInTheDocument()
})

test('여러 줄은 동작별로 생기고(답보다 먼저 와도 답 아래) 줄마다 따로 되돌린다', async () => {
  const { live, undo, user } = await startChat('정리해줘')
  await memoryTool(live, 1, 'remember_memory', saved)
  await memoryTool(live, 2, 'update_memory', updated)
  await memoryTool(live, 3, 'workplace_forget_memory', forgotten)
  await live.push('delta', { ...C, text: '세 가지를 정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(precedes(lastBlock(), lines()[0])).toBe(true) // WP-581: 답보다 먼저 기억한 줄은 답 아래
  expect(lines().map((l) => l.getAttribute('data-action'))).toEqual(['saved', 'updated', 'forgotten'])

  await waitFor(() => expect(undoOf(1)).toBeEnabled())
  await user.click(undoOf(1))
  await waitFor(() => expect(undo.calls.count()).toBe(1))
  expect(undo.calls.last()).toEqual({ messageId: 5, blockIndex: 1 })
  await waitFor(() => expect(lines()[1]).toHaveAttribute('data-undone', 'true'))
  expect(lines()[0]).toHaveAttribute('data-undone', 'false')
  expect(lines()[2]).toHaveAttribute('data-undone', 'false')
})

// 패널이 되돌리기 뮤테이션 하나를 공유해도 진행 중 표시는 줄마다 따로다.
test('응답 전에 다른 줄을 눌러도 앞 줄은 요청이 끝날 때까지 잠겨 있다', async () => {
  const held = gate()
  const { live, undo, user } = await startChat('정리해줘', memoryUndo([], held.p))
  await memoryTool(live, 1, 'remember_memory', saved)
  await memoryTool(live, 2, 'update_memory', updated)
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  await waitFor(() => expect(undoOf(0)).toBeDisabled())
  expect(undoOf(1)).toBeEnabled()
  await user.click(undoOf(1))
  await waitFor(() => expect(undoOf(1)).toBeDisabled())
  expect(undoOf(0)).toBeDisabled() // 둘째 요청이 첫 줄의 진행 중 표시를 지우지 않는다
  await waitFor(() => expect(undo.calls.count()).toBe(2))

  held.release()
  await waitFor(() => expect(lines()[0]).toHaveAttribute('data-undone', 'true'))
  await waitFor(() => expect(lines()[1]).toHaveAttribute('data-undone', 'true'))
})

test('이미 지워진 메모리·가득 참이면 안내 토스트를 띄우고 줄은 그대로 둔다 — 가득 참은 설정으로 이동할 수 있다', async () => {
  const { live, user } = await startChat('정리해줘', memoryUndo([memoryError(404, 'AI_MEMORY_GONE'), memoryError(409, 'AI_MEMORY_FULL')]))
  await memoryTool(live, 1, 'update_memory', updated)
  await memoryTool(live, 2, 'forget_memory', forgotten)
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  expect(await screen.findByText('이미 지워진 메모리예요')).toBeInTheDocument()
  expect(lines()[0]).toHaveAttribute('data-undone', 'false')

  await user.click(undoOf(1))
  expect(await screen.findByText('메모리가 가득 찼어요. 설정에서 정리해 주세요')).toBeInTheDocument()
  expect(lines()[1]).toHaveAttribute('data-undone', 'false')
  fireEvent.click(screen.getByRole('button', { name: '설정 열기' }))
  await waitFor(() => expect(window.location.pathname).toBe('/settings/assistant'))
})

// CR4: 고친 뒤 또 바뀐 메모리는 서버가 409 CHANGED 로 거절한다 — 줄은 되돌리지 않은 채(다시 누를 수 있게) 둔다.
test('고친 뒤 또 바뀐 메모리면 안내 토스트를 띄우고 줄은 그대로 둔다', async () => {
  const { live, undo, user } = await startChat('팀 바꿔줘', memoryUndo([memoryError(409, 'AI_MEMORY_CHANGED')]))
  await memoryTool(live, 1, 'update_memory', { ...updated, previousKind: 'PREFERENCE' })
  await live.push('delta', { ...C, text: '고쳤어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  await waitFor(() => expect(undo.calls.count()).toBe(1))
  expect(await screen.findByText('그 뒤에 바뀐 메모리라 되돌리지 않았어요')).toBeInTheDocument()
  expect(lines()[0]).toHaveAttribute('data-undone', 'false')
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
})

// 추천을 끈 사용자(followups 없음)도 done 의 messageId 로 되돌리기가 켜지고, 위임 답(안내 문장이 버려지는 턴)에서도 순번 0 이다.
test('추천을 꺼도 done 뒤 되돌리기가 켜지고 위임 답에서도 순번이 맞다', async () => {
  const { live, undo, user } = await startChat('앞으로 이슈는 짧게, 그리고 WP-1 닫아줘', memoryUndo(), [aiPreferences(false).handler])
  await live.push('progress', { ...C, label: '이슈 전문가에게 위임 중' })
  await live.push('delta', { ...C, text: '확인해 볼게요. ' })
  await memoryTool(live, 1, 'remember_memory', saved)
  await live.push('delta', { ...C, text: 'WP-1 을 닫았어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 8 })
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  await waitFor(() => expect(undo.calls.count()).toBe(1))
  expect(undo.calls.last()).toEqual({ messageId: 8, blockIndex: 0 })
})

// WP-379: 앱 범위 결과는 범위 이름을 붙인 문구로, 공통은 WP-55 문구 그대로. 되돌리기 가득 참은 서버가 알려 준 범위로 안내한다.
test('앱 범위 결과 줄은 "이슈 메모리에 저장함" 이고, 되돌리기 가득 참은 그 범위 이름으로 안내한다', async () => {
  const { live, user } = await startChat('정리해줘', memoryUndo([memoryError(409, 'AI_MEMORY_FULL', '오류', { scope: 'MAIL' })]))
  await memoryTool(live, 1, 'remember_memory', { ...saved, scope: 'ISSUE' })
  await memoryTool(live, 2, 'update_memory', { ...updated, scope: null, previousScope: 'ISSUE' })
  await memoryTool(live, 3, 'forget_memory', { ...forgotten, scope: 'MAIL' })
  await live.push('delta', { ...C, text: '정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })

  await waitFor(() => expect(lines()).toHaveLength(3))
  expect(lines()[0]).toHaveTextContent('이슈 메모리에 저장함: "이슈 목록은 짧은 목록으로 보여 준다"')
  expect(lines()[1]).toHaveTextContent('메모리를 고침: "백엔드 팀이다"')
  expect(lines()[2]).toHaveTextContent('메일 메모리에서 지움: "표로 보여 준다"')
  await waitFor(() => expect(undoOf(2)).toBeEnabled())
  await user.click(undoOf(2))
  expect(await screen.findByText('메일 메모리가 가득 찼어요. 설정에서 정리해 주세요')).toBeInTheDocument()
  expect(lines()[2]).toHaveAttribute('data-undone', 'false')
})

/** 이벤트의 memory → 이력 블록(서버 ChatBlockRecorder.Memory 모양). at 은 앞에 오는 표시 블록 수. */
const historyBlock = (m: Record<string, unknown>, at?: number) =>
  ({ ...m, kind: 'memory', memoryKind: m.kind, undone: false, ...(at === undefined ? {} : { at }) }) as unknown as MemoryBlock

async function wikiTool(live: ReturnType<typeof liveChat>, seq: number, toolName: string) {
  await live.push('tool', { ...C, seq, phase: 'start', toolName, args: {} })
  await live.push('tool', { ...C, seq, phase: 'result', toolName, isError: false })
}

// WP-581: 결과 줄은 도착한 자리에 들어간다 — 뒤이은 도구 호출은 결과 줄 아래 새 단계 묶음으로 시작한다.
test('메모리 결과 줄 뒤의 도구 호출은 결과 줄 아래 새 단계 묶음으로 보이고, 답 아래에 한 번 더 그리지 않는다', async () => {
  const { live } = await startChat('오늘 업무 노트 정리해줘')
  await live.push('progress', { ...C, label: '노트 전문가에게 위임 중' })
  await wikiTool(live, 1, 'get_wiki_page')
  await wikiTool(live, 2, 'update_wiki_page')
  await memoryTool(live, 3, 'update_memory', updated)
  await wikiTool(live, 4, 'move_wiki_page')
  await wikiTool(live, 5, 'list_wiki_pages')

  // 답변 전(본문 없음)에도 결과 줄이 제자리에 보인다.
  await waitFor(() => expect(screen.getAllByTestId('chat-block-tools')).toHaveLength(2))
  const groups = screen.getAllByTestId('chat-block-tools')
  expect(groups[0]).toHaveTextContent('노트 수정')
  expect(groups[0]).not.toHaveTextContent('노트 이동')
  expect(groups[1]).toHaveTextContent('노트 이동')
  expect(groups[1]).toHaveTextContent('노트 목록')
  expect(lines()).toHaveLength(1)
  expect(precedes(groups[0], lines()[0]) && precedes(lines()[0], groups[1])).toBe(true)

  await live.push('delta', { ...C, text: '노트를 정리했어요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  expect(precedes(screen.getAllByTestId('chat-block-tools')[1], lastBlock())).toBe(true)
  expect(screen.getAllByTestId('chat-memory-results')).toHaveLength(1)
})

test('이력의 결과 줄은 저장된 자리(at)에 복원되고, 자리가 없는 구 이력은 답 아래에 모인다', async () => {
  const undo = memoryUndo()
  const live = liveChat()
  live.setSessions([summary('s-a', TITLE_A, 1), summary('s-b', TITLE_B, 1)])
  const steps = ['get_wiki_page', 'move_wiki_page'].map((toolName, k) => ({ kind: 'tool' as const, seq: k + 1, toolName, status: 'done' as const }))
  live.setMessages('s-a', [
    msg(1, 'USER', TITLE_A),
    {
      ...msg(2, 'ASSISTANT', '노트를 정리했어요.'),
      toolCalls: steps,
      contentBlocks: [{ kind: 'tools', stepStart: 0 }, { kind: 'tools', stepStart: 1 }, { kind: 'text', textStart: 0 }],
      memoryBlocks: [historyBlock(saved, 1), historyBlock(updated, 1)],
    },
  ])
  live.setMessages('s-b', [
    msg(1, 'USER', TITLE_B),
    {
      ...msg(2, 'ASSISTANT', '기억했어요.'),
      toolCalls: steps.slice(0, 1),
      contentBlocks: [{ kind: 'tools', stepStart: 0 }, { kind: 'text', textStart: 0 }],
      memoryBlocks: [historyBlock(saved)],
    },
  ])
  const { user } = await openChatPanel([undo.handler, ...live.handlers])
  await openSession(user, TITLE_A)

  await waitFor(() => expect(lines()).toHaveLength(2))
  const results = screen.getAllByTestId('chat-memory-results')
  expect(results).toHaveLength(1) // 같은 자리의 연속 줄은 한 묶음
  const groups = screen.getAllByTestId('chat-block-tools')
  expect(precedes(groups[0], results[0]) && precedes(results[0], groups[1]) && precedes(groups[1], lastBlock())).toBe(true)
  // 되돌리기 순번은 끼운 자리와 상관없이 memoryBlocks 원본 순번이다.
  await user.click(undoOf(1))
  await waitFor(() => expect(undo.calls.count()).toBe(1))
  expect(undo.calls.last()).toEqual({ messageId: 2, blockIndex: 1 })

  await openSession(user, TITLE_B)
  expect(await screen.findByText('기억했어요.')).toBeInTheDocument()
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(precedes(lastBlock(), lines()[0])).toBe(true)
})

// WP-380: 기한 문구는 날짜만(시간대 무관) — 지움 줄엔 없다. 되돌린 뒤 취소선은 E2E @layout 이 본다.
test('기한 있는 결과 줄은 " · 10월 24일까지" 이고 지움 줄엔 기한이 없다', async () => {
  const { live } = await startChat('이번 주는 결제 모듈만 볼 거야')
  await memoryTool(live, 1, 'remember_memory', { ...saved, content: '이번 주는 결제 모듈 집중', scope: 'ISSUE', expiresOn: '2026-10-24' })
  await memoryTool(live, 2, 'forget_memory', { ...forgotten, expiresOn: '2026-10-20' })
  await live.push('delta', { ...C, text: '기억할게요.' })
  await live.push('done', { ...C, widgets: null, messageId: 5 })
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  expect(lines()[0]).toHaveTextContent('이슈 메모리에 저장함: "이번 주는 결제 모듈 집중" · 10월 24일까지 · 되돌리기')
  expect(within(lines()[1]).queryByTestId('chat-memory-expiry')).not.toBeInTheDocument()
})

// ── 공용 메모리 결과 줄(WP-386) ───────────────────────────────────────────

test('공용 저장 결과 줄이 공간 이름과 함께 보이고 같은 경로로 되돌린다', async () => {
  const { live, undo, user } = await startChat('이건 팀 규칙으로 기억해')
  await memoryTool(live, 1, 'mcp__workplace__remember_memory', saved)
  await memoryTool(live, 2, 'mcp__workplace__remember_shared_memory', shared)
  await live.push('done', { ...C, widgets: null, messageId: 8 })
  await waitFor(() => expect(lines()).toHaveLength(2))
  expect(lines()[1]).toHaveAttribute('data-action', 'shared')
  expect(lines()[1]).toHaveTextContent('Smart Workplace(WP) 공용 메모리에 기억했어요: "배포는 API 먼저 한다" · 되돌리기')
  await waitFor(() => expect(undoOf(1)).toBeEnabled())
  await user.click(undoOf(1))
  await waitFor(() => expect(undo.calls.count()).toBe(1))
  expect(undo.calls.last()).toEqual({ messageId: 8, blockIndex: 1 })
  await waitFor(() => expect(lines()[1]).toHaveAttribute('data-undone', 'true'))
})

test('공용 결과 줄 되돌리기가 그 뒤 바뀜·이미 되돌림이면 안내한다', async () => {
  const { live, user } = await startChat('기억해', memoryUndo([memoryError(409, 'SHARED_MEMORY_CHANGED'), memoryError(409, 'SHARED_MEMORY_CHANGE_UNDONE')]))
  await memoryTool(live, 1, 'remember_shared_memory', shared)
  await live.push('done', { ...C, widgets: null, messageId: 8 })
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  expect(await screen.findByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeInTheDocument()
  expect(lines()[0]).toHaveAttribute('data-undone', 'false')
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  expect(await screen.findByText('이미 되돌린 기록이에요')).toBeInTheDocument()
})

// 최종 리뷰 T17·M5: 403·404 어느 쪽이든 안내하고 줄은 되돌리지 않은 채 둔다.
test('공용 결과 줄 되돌리기가 권한 없음(403)·기록 사라짐(404)이면 안내하고 줄은 그대로 둔다', async () => {
  const { live, undo, user } = await startChat('기억해', memoryUndo([memoryError(403, 'SHARED_MEMORY_FORBIDDEN'), memoryError(404, 'SHARED_MEMORY_NOT_FOUND')]))
  await memoryTool(live, 1, 'remember_shared_memory', shared)
  await live.push('done', { ...C, widgets: null, messageId: 8 })
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  await waitFor(() => expect(undo.calls.count()).toBe(1))
  expect(await screen.findByText('되돌릴 권한이 없어요')).toBeInTheDocument()
  expect(lines()[0]).toHaveAttribute('data-undone', 'false')
  await waitFor(() => expect(undoOf(0)).toBeEnabled())
  await user.click(undoOf(0))
  expect(await screen.findByText('이 기록은 더 이상 되돌릴 수 없어요')).toBeInTheDocument()
  expect(lines()[0]).toHaveAttribute('data-undone', 'false')
})

test('이력의 공용 결과 줄도 복원된다', async () => {
  const live = liveChat()
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [
    msg(1, 'USER', TITLE_A),
    { ...msg(2, 'ASSISTANT', '기억했어요.'), contentBlocks: [{ kind: 'text', textStart: 0 }], memoryBlocks: [{ kind: 'memory', ...shared, undone: true }] },
  ])
  const { user } = await openChatPanel(live.handlers)
  await openSession(user, TITLE_A)
  await waitFor(() => expect(lines()).toHaveLength(1))
  expect(lines()[0]).toHaveTextContent('Smart Workplace(WP) 공용 메모리에 기억했어요')
  expect(lines()[0]).toHaveAttribute('data-undone', 'true')
})

// 그릴 수 있는 줄이 하나도 없으면(깨진 공용 줄뿐) 빈 래퍼(여백)도 내지 않고, 하나라도 있으면 래퍼를 낸다.
test('깨진 공용 줄뿐이면 결과 줄 래퍼를 그리지 않고, 정상 줄이 섞이면 그 줄만 그린다', async () => {
  const live = liveChat()
  live.setSessions([summary('s-a', TITLE_A, 1), summary('s-b', TITLE_B, 2)])
  const broken = { kind: 'memory' as const, action: 'shared' as const, changeId: 0, memoryId: 9, spaceName: '', content: '', undone: false }
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), { ...msg(2, 'ASSISTANT', '기억했어요.'), contentBlocks: [{ kind: 'text', textStart: 0 }], memoryBlocks: [broken, broken] }])
  live.setMessages('s-b', [msg(1, 'USER', TITLE_B), { ...msg(2, 'ASSISTANT', '기억했어요.'), contentBlocks: [{ kind: 'text', textStart: 0 }], memoryBlocks: [broken, { kind: 'memory' as const, ...shared, undone: false }] }])
  const { user } = await openChatPanel(live.handlers)
  await openSession(user, TITLE_A)
  expect(await screen.findByText('기억했어요.')).toBeInTheDocument()
  expect(screen.queryByTestId('chat-memory-results')).not.toBeInTheDocument()

  await openSession(user, TITLE_B)
  await waitFor(() => expect(screen.getAllByTestId('chat-memory-results')).toHaveLength(1))
  expect(lines()).toHaveLength(1) // 깨진 줄(순번 0)은 빠지고 정상 줄(순번 1)만
})
