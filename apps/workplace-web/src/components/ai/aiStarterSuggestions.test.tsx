// 빈 AI 대화 추천 질문(WP-139·398)과 화면 공간 싣기(WP-386) — 페이지 테스트(WP-966 웨이브 3).
// 고정 문구 → AI 결과 교체·저장 결과 재사용(다시 띄움)·지난 날짜 갱신·클릭 전송(초안 유지)·이슈 상세 화면 맞춤과 × 전환·실패·꺼짐·
// enabled:false·응답 대기 중 전송·이력 읽는 중 숨김·동시 답변 상한 비활성은 브라우저 없이 판정되므로 e2e/pages/ai-starter-suggestions.spec.ts 에서,
// 채팅 시작 요청의 space(프로젝트 키·화면 정보 제외 시에도 유지·공간 없는 화면엔 없음)는 e2e/pages/ai-shared-memory-space.spec.ts 에서 옮겼다.
// E2E 에 남은 것: 호버·키보드 포커스로 교체를 미루는 것(@input), 줄바꿈·가운데 배치·safe center(@layout).
// AI 패널은 앱 셸의 AI 조립(SSE 구독·칩·옆 패널)만 renderScreen 으로 띄운다(test/kits/ai/c-aiShell, WP-1002) — 앱 레일·인증 부팅은 건너뛴다.
// 본문에는 원래 화면(프로젝트 목록·이슈 상세)을 그대로 두어 화면 참고·공간 판정이 같은 화면 컨텍스트를 지난다.
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { beforeEach, describe, expect, test } from 'vitest'

import { chatStreams } from '@/lib/ai/chatStreams'
import { clearStarterStorage, STARTER_STORAGE_PREFIX } from '@/lib/ai/starterStorage'
import IssueDetailPage from '@/pages/projects/IssueDetailPage'
import ProjectListPage from '@/pages/projects/ProjectListPage'
import { openAiPanel } from '@/test/kits/ai/aiShell'
import {
  aiPreferences,
  fillInput,
  gate,
  homeChatGeneration,
  liveChat,
  msg,
  openSession,
  sendButton,
  settle,
  starterSuggestions,
  summary,
  TITLE_A,
} from '@/test/kits/ai/testkit-b2a'
import { atRoute } from '@/test/kits/projects/atRoute'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const GENERAL = ['오늘 일정 요약해줘', '나를 멘션한 메시지 정리해줘', '내 작업 우선순위 정리해줘', '답장이 필요한 메일 알려줘']
const AI = ['3분기 매출 보고서 진행 알려줘', '오늘 오후 회의 안건 정리해줘', '어제 받은 메일 중 급한 것 알려줘', '내 리뷰 대기 이슈 보여줘']
const ISSUE_PATH = '/projects/WP/issues/12'
const ISSUE_STARTERS = ['이 이슈 관련 작업 정리해줘', '비슷한 이슈 찾아줘', '이 이슈를 막고 있는 이슈 상태 알려줘']

const rows = () => screen.queryAllByTestId('starter-suggestion')
const texts = () => rows().map((r) => r.textContent)
const rowOf = (text: string) => rows().find((r) => r.textContent === text)!

// 추천 저장소의 앞단 메모리는 모듈 전역이다 — 테스트마다 비운다(setup 은 localStorage 만 비운다).
beforeEach(() => clearStarterStorage())

/** 이슈 상세(WP-12)의 화면 데이터 — 화면 참고 칩·화면 맞춤 추천이 이 이슈를 가리킨다. */
const issueHandlers = () =>
  issueDetailHandlers({
    number: 12,
    detail: createIssueDetail({ summary: createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH' }) }),
  })

/** 프로젝트 목록(/projects, 공간 없는 화면)을 띄우고 AI 패널을 연다. */
const openChatPanel = (handlers: RequestHandler[]) => openAiPanel(handlers, { path: '/projects', page: <ProjectListPage /> })

/** 이슈 상세를 열고 AI 패널을 연다. */
const openOnIssue = (handlers: RequestHandler[]) =>
  openAiPanel([...handlers, ...issueHandlers()], {
    path: ISSUE_PATH,
    page: atRoute('/projects/:key/issues/:number', <IssueDetailPage />),
  })

/**
 * 새로고침 흉내 — 화면을 내리고 모듈 전역 저장소(채팅 스트림·추천 앞단 메모리)를 비운 뒤 localStorage 는 그대로 둔다.
 * 다시 띄운 앱은 브라우저 새로고침처럼 localStorage 에서 저장 결과를 읽어 올린다.
 */
function reload(unmount: () => void) {
  unmount()
  const kept: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (k.startsWith(STARTER_STORAGE_PREFIX)) kept[k] = localStorage.getItem(k)!
  }
  clearStarterStorage()
  act(() => chatStreams.setOwner(null))
  Object.entries(kept).forEach(([k, v]) => localStorage.setItem(k, v))
}

describe('추천 질문 (ai-starter-suggestions)', () => {
  test('빈 대화는 일반 고정 문구를 즉시 보이고, AI 결과가 오면 한 번 바꾼다(화면 참고 없는 목록은 본문이 비어 있다)', async () => {
    const g = gate()
    const s = starterSuggestions({ replies: [{ items: AI, enabled: true }], gate: g.p })
    await openChatPanel([s.handler])
    expect(await screen.findByTestId('starter-suggestions')).toHaveTextContent('추천 질문')
    expect(texts()).toEqual(GENERAL)
    await waitFor(() => expect(s.calls.count()).toBe(1))
    expect(s.calls.last()).toEqual({})
    g.release()
    await waitFor(() => expect(texts()).toEqual(AI))
    expect(screen.getByTestId('chat-panel')).toHaveTextContent('AI 어시스턴트에게 물어보세요')
  })

  test('다시 띄우면 저장된 AI 결과가 즉시 보이고, 오늘 것이면 다시 부르지 않는다', async () => {
    const s = starterSuggestions({ replies: [{ items: AI, enabled: true }] })
    const first = await openChatPanel([s.handler])
    await waitFor(() => expect(texts()).toEqual(AI))
    reload(first.unmount)
    await openChatPanel([s.handler])
    await screen.findByTestId('starter-suggestions')
    expect(texts()).toEqual(AI) // 고정 문구를 거치지 않는다
    await settle(800) // 디바운스(300ms)보다 길게 지켜본다
    expect(s.calls.count()).toBe(1)
  })

  test('저장 날짜가 지났으면 저장 결과를 먼저 보이고 뒤에서 새로 받아 바꾼다', async () => {
    const NEXT = ['새로 만든 추천 하나 알려줘', '새로 만든 추천 둘 알려줘', '새로 만든 추천 셋 알려줘', '새로 만든 추천 넷 알려줘']
    const second = gate()
    const s = starterSuggestions({ replies: [{ items: AI, enabled: true }, { items: NEXT, enabled: true }], gates: [undefined, second.p] })
    const first = await openChatPanel([s.handler])
    await waitFor(() => expect(texts()).toEqual(AI))
    reload(first.unmount)
    // 저장된 모든 항목의 날짜를 과거로 돌린다.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (!k.startsWith(STARTER_STORAGE_PREFIX)) continue
      const map = JSON.parse(localStorage.getItem(k)!) as Record<string, { date: string }>
      Object.values(map).forEach((e) => (e.date = '2000-01-01'))
      localStorage.setItem(k, JSON.stringify(map))
    }
    await openChatPanel([s.handler])
    await screen.findByTestId('starter-suggestions')
    expect(texts()).toEqual(AI)
    await waitFor(() => expect(s.calls.count()).toBe(2))
    second.release()
    await waitFor(() => expect(texts()).toEqual(NEXT))
  })

  test('추천을 누르면 그 문구로 바로 보내고 쓰던 초안은 그대로 두며 목록이 사라진다', async () => {
    const gen = homeChatGeneration([{ event: 'done', data: { sessionId: 's-1' } }])
    await openChatPanel(gen.handlers)
    await screen.findByTestId('starter-suggestions')
    fillInput('쓰던 초안')
    fireEvent.click(rowOf('답장이 필요한 메일 알려줘'))
    await waitFor(() => expect(gen.starts.count()).toBe(1))
    expect(gen.starts.last()).toMatchObject({ sessionId: null, query: '답장이 필요한 메일 알려줘' })
    expect(screen.getByTestId('chat-input')).toHaveValue('쓰던 초안')
    await waitFor(() => expect(screen.queryByTestId('starter-suggestions')).not.toBeInTheDocument())
    await gen.done
  })

  test('이슈 상세는 화면 맞춤 3개, × 로 빼면 일반 추천으로 바뀌고 요청에서도 빠진다', async () => {
    const s = starterSuggestions({ replies: [{ items: [], enabled: true }] })
    const gen = homeChatGeneration([{ event: 'done', data: { sessionId: 's-2' } }])
    const { user } = await openOnIssue([s.handler, ...gen.handlers])
    await waitFor(() => expect(screen.getByTestId('starter-suggestions')).toHaveTextContent('이 이슈에 대해'))
    expect(texts()).toEqual(ISSUE_STARTERS)
    await waitFor(() => expect(s.calls.count()).toBe(1))
    expect((s.calls.last() as { screenContext: { focus: { refs: unknown } } }).screenContext.focus.refs).toEqual({ issueKey: 'WP-12' })

    await user.click(screen.getByTestId('chat-context-remove'))
    await waitFor(() => expect(screen.getByTestId('starter-suggestions')).toHaveTextContent('추천 질문'))
    expect(texts()).toEqual(GENERAL)
    await waitFor(() => expect(s.calls.count()).toBe(2))
    expect(s.calls.last()).toEqual({})

    // × 상태에서 누르면 화면 정보 없이 보낸다(전송 규칙과 같다).
    fireEvent.click(rows()[0])
    await waitFor(() => expect(gen.starts.count()).toBe(1))
    expect(gen.starts.last()).not.toHaveProperty('screenContext')
    await gen.done
  })

  test('이슈 상세에서 누르면 화면 정보가 함께 실린다', async () => {
    const gen = homeChatGeneration([{ event: 'done', data: { sessionId: 's-3' } }])
    await openOnIssue(gen.handlers)
    await waitFor(() => expect(texts()).toContain('비슷한 이슈 찾아줘'))
    fireEvent.click(rowOf('비슷한 이슈 찾아줘'))
    await waitFor(() => expect(gen.starts.count()).toBe(1))
    expect(gen.starts.last()).toMatchObject({
      query: '비슷한 이슈 찾아줘',
      screenContext: { focus: { type: '이슈', refs: { issueKey: 'WP-12' } } },
    })
    await gen.done
  })

  test('추천 생성이 실패하면 고정 문구를 그대로 두고 오류를 띄우지 않는다', async () => {
    const s = starterSuggestions({ replies: [{ status: 502 }] })
    await openChatPanel([s.handler])
    await waitFor(() => expect(s.answered()).toBe(1))
    await settle(500)
    expect(texts()).toEqual(GENERAL)
    expect(document.querySelector('[data-sonner-toast][data-type="error"]')).toBeNull()
  })

  /** 켜져 있을 때 저장된 결과를 흉내 — 활성 워크스페이스가 없으므로 소유자 키는 `<userId>:0` 이다. */
  const seedStoredStarter = () =>
    localStorage.setItem(`${STARTER_STORAGE_PREFIX}1:0`, JSON.stringify({ general: { items: ['저장된 추천 알려줘'], date: '2999-01-01', at: 1 } }))

  test('시드한 저장소 키(1:0)는 추천이 켜져 있으면 실제로 보인다 — 꺼짐 검증이 공허하지 않다는 근거', async () => {
    const g = gate()
    const s = starterSuggestions({ replies: [{ items: AI, enabled: true }], gate: g.p })
    seedStoredStarter()
    await openChatPanel([s.handler])
    await screen.findByTestId('starter-suggestions')
    expect(texts()).toEqual(['저장된 추천 알려줘'])
    await waitFor(() => expect(s.calls.count()).toBe(1))
    g.release()
    await waitFor(() => expect(texts()).toEqual(AI))
  })

  test('추천을 끈 사용자에게는 목록(저장·고정 문구 포함)이 없고 생성 요청도 없다', async () => {
    const prefs = aiPreferences(false)
    const s = starterSuggestions({ replies: [{ items: AI, enabled: true }] })
    seedStoredStarter()
    await openChatPanel([prefs.handler, s.handler])
    // 설정 응답(꺼짐)이 반영된 뒤에 부재를 지켜본다 — 응답 전에 재면 「아직 안 그려졌을 뿐」인 거짓 통과가 된다.
    await waitFor(() => expect(prefs.gets()).toBeGreaterThan(0))
    expect(screen.getByTestId('chat-panel')).toHaveTextContent('AI 어시스턴트에게 물어보세요')
    await settle(800)
    expect(screen.queryByTestId('starter-suggestions')).not.toBeInTheDocument()
    expect(s.calls.count()).toBe(0)
  })

  test('서버가 enabled:false 를 돌려주면 목록이 사라지고 이후 다시 부르지 않는다', async () => {
    const s = starterSuggestions({ replies: [{ items: [], enabled: false }] })
    // 화면 참고 칩이 있는 이슈 상세에서 시작해야 × 로 다른 키(일반)를 만들 수 있다.
    const { user } = await openOnIssue([s.handler])
    await waitFor(() => expect(s.calls.count()).toBe(1))
    await waitFor(() => expect(screen.queryByTestId('starter-suggestions')).not.toBeInTheDocument())
    await user.click(screen.getByTestId('chat-context-remove'))
    await settle(800)
    expect(s.calls.count()).toBe(1)
    expect(screen.queryByTestId('starter-suggestions')).not.toBeInTheDocument()
  })

  test('응답을 기다리는 중 다른 질문을 보내 목록이 사라져도, 새 대화에서는 그 저장 결과가 보인다', async () => {
    const g = gate()
    const s = starterSuggestions({ replies: [{ items: AI, enabled: true }], gate: g.p })
    const gen = homeChatGeneration([{ event: 'done', data: { sessionId: 's-r' } }])
    const { user } = await openChatPanel([s.handler, ...gen.handlers])
    await waitFor(() => expect(s.calls.count()).toBe(1))
    fillInput('직접 쓴 질문')
    fireEvent.click(sendButton())
    await waitFor(() => expect(screen.queryByTestId('starter-suggestions')).not.toBeInTheDocument())
    g.release()
    await waitFor(() => expect(s.answered()).toBe(1))
    await gen.done
    await user.click(screen.getByTestId('chat-new-session'))
    await screen.findByTestId('starter-suggestions')
    await waitFor(() => expect(texts()).toEqual(AI)) // 오늘 받은 저장 결과 — 고정 문구로 되돌아가지 않는다
  })

  test('기존 대화를 여는 동안에는 추천이 보이지 않는다', async () => {
    const live = liveChat()
    live.setSessions([summary('s-a', TITLE_A, 1)])
    live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
    const { user } = await openChatPanel(live.handlers)
    await screen.findByTestId('starter-suggestions')
    const release = live.holdMessages('s-a')
    await openSession(user, TITLE_A)
    await settle(300)
    expect(screen.queryByTestId('starter-suggestions')).not.toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.getByTestId('chat-panel')).toHaveTextContent('요약본입니다'))
    expect(screen.queryByTestId('starter-suggestions')).not.toBeInTheDocument()
  })

  test('전송이 막힌 상태(동시 답변 상한)면 추천을 누를 수 없다', async () => {
    const live = liveChat()
    live.setActive([
      { sessionId: 's-1', correlationId: 'c-1', startedAt: '2026-10-13T00:00:00Z' },
      { sessionId: 's-2', correlationId: 'c-2', startedAt: '2026-10-13T00:00:00Z' },
      { sessionId: 's-3', correlationId: 'c-3', startedAt: '2026-10-13T00:00:00Z' },
    ])
    await openChatPanel(live.handlers)
    await screen.findByTestId('chat-limit-notice')
    await waitFor(() => expect(rows()[0]).toBeDisabled())
  })
})

// ── 채팅 요청의 화면 공간(ai-shared-memory-space, WP-386) ─────────────────

describe('채팅 시작 요청의 space', () => {
  test('이슈 상세에서 보내면 space 는 그 프로젝트 키다', async () => {
    const gen = homeChatGeneration([{ event: 'done', data: { sessionId: 's-space' } }])
    await openOnIssue(gen.handlers)
    await screen.findByTestId('chat-context-chip')
    fillInput('이건 팀 규칙으로 기억해')
    fireEvent.click(sendButton())
    await waitFor(() => expect(gen.starts.count()).toBe(1))
    expect(gen.starts.last()!.space).toEqual({ type: 'PROJECT', key: 'WP' })
    await gen.done
  })

  test('화면 정보를 빼고 보내도 space 는 실린다(서버가 권한을 다시 확인한다)', async () => {
    const gen = homeChatGeneration([{ event: 'done', data: { sessionId: 's-space' } }])
    const { user } = await openOnIssue(gen.handlers)
    await user.click(await screen.findByTestId('chat-context-remove'))
    fillInput('첫 질문')
    fireEvent.click(sendButton())
    await waitFor(() => expect(gen.starts.count()).toBe(1))
    const body = gen.starts.last()!
    expect(body).not.toHaveProperty('screenContext')
    expect(body.space).toEqual({ type: 'PROJECT', key: 'WP' })
    await gen.done
  })

  test('공간이 없는 화면(목록)에서는 space 키가 없다', async () => {
    const gen = homeChatGeneration([{ event: 'done', data: { sessionId: 's-space' } }])
    await openChatPanel(gen.handlers)
    fillInput('오늘 할 일')
    fireEvent.click(sendButton())
    await waitFor(() => expect(gen.starts.count()).toBe(1))
    expect(gen.starts.last()).not.toHaveProperty('space')
    await gen.done
  })
})
