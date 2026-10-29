// 모바일 AI 위임 작업(WP-377) — 페이지 테스트(WP-971).
// 에픽 묶음 머리·완료 보기 결과 배지·프로젝트 머리 순서·다음 회차 대기 라벨은 API 응답이 화면 문구·순서로 바뀌는 것이라
// 브라우저 없이 판정되므로 e2e/pages/mobile/ai-tasks.spec.ts 에서 옮겼다.
// 메타 줄 잘림·칩 줄 가로 스크롤(@layout)과 대표 행 구조(@wiring)는 E2E 에 남는다.
// 앱 셸을 보지 않으므로 AI 위임 작업 화면 컴포넌트만 renderScreen 으로 띄운다(WP-1002).
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'
import type { IssueResponse } from '@/types/issue'

import {
  agentWorker as agent,
  createAgentWork,
  createAiTaskCounts,
  createScheduledIssue,
  KST_1430,
  minutesAgo,
} from '../../../e2e/factories/agentWork.factory'
import { createAiAgentsResponse, createAiAgentStatus, createAiAgentWork } from '../../../e2e/factories/aiAgent.factory'
import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { GROUPED_ROWS } from '../../../e2e/fixtures/ai-tasks-groups'
import { projectRows } from '../../../e2e/fixtures/ai-tasks-projects'
import AiDelegatedTasksPage from '../me/AiDelegatedTasksPage'

// 모바일(iPhone 13 폭·터치) — matchMedia 결과가 파일 안에서 캐시되므로 첫 렌더 전에 한 번.
mockViewport()

afterEach(() => {
  vi.useRealTimers()
})

/** /me/ai-tasks 목록·카운트 응답. */
function aiTaskHandlers(rows: IssueResponse[], counts: Parameters<typeof createAiTaskCounts>[0]) {
  return [
    http.get('/api/v1/me/ai-tasks', () => HttpResponse.json(createIssueSearchResponse(rows))),
    http.get('/api/v1/me/ai-tasks/counts', () => HttpResponse.json(createAiTaskCounts(counts))),
  ]
}

describe('모바일 AI 위임 작업', () => {
  // 에픽 묶음 머리는 키·하위 진행(└ 완료/전체)을 보이고, 에픽 자신 작업이 있을 때만 머리 아래 메타 줄을 그린다.
  test('묶음 머리 — 키·하위 진행, 에픽 자신 작업이 있는 묶음만 메타 줄', async () => {
    renderScreen(<AiDelegatedTasksPage />, { path: '/me/ai-tasks', handlers: aiTaskHandlers(GROUPED_ROWS, { all: 8 }) })
    const head = await screen.findByTestId('ai-epic-412')
    expect(head).toHaveTextContent('WP-412')
    expect(head).toHaveTextContent('└ 1/5')
    expect(screen.getByTestId('ai-epic-412-meta')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-epic-420-meta')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-row-413')).toBeInTheDocument()
  })

  // WP-1211: 에픽 없는 행은 「에픽 없음 · n건」 머리 아래에 모인다.
  test('에픽 없는 행은 「에픽 없음」 머리 아래에 모인다', async () => {
    renderScreen(<AiDelegatedTasksPage />, { path: '/me/ai-tasks', handlers: aiTaskHandlers(GROUPED_ROWS, { all: 8 }) })
    const head = await screen.findByTestId('ai-no-epic-WP')
    expect(head).toHaveTextContent(/^에픽 없음2건$/)
    const order = [...document.querySelectorAll('[data-testid]')]
      .map((e) => e.getAttribute('data-testid')!)
      .filter((t) => /^ai-(row-\d+|epic-\d+|no-epic-[A-Z]+)$/.test(t))
    expect(order.slice(-3)).toEqual(['ai-no-epic-WP', 'ai-row-430', 'ai-row-431'])
  })

  // 완료 보기(WP-396): 모바일 메타 줄엔 칸 제목이 없어 시간 앞에 「종료」를 붙이고, 실패 배지는 옅은 위험 tint 다.
  test('완료 보기 행은 「종료 n분 전」과 실패 배지를 보인다', async () => {
    const failed = createIssue({
      id: 602, number: 602, title: '대용량 첨부 미리보기 생성 실패 원인 조사', status: 'IN_PROGRESS', assignees: [agent],
      agentWork: [createAgentWork({ state: 'FAILED', note: '샌드박스 메모리 한도 초과로 중단', updatedAt: minutesAgo(3 * 24 * 60), endedAt: minutesAgo(20) })],
    })
    renderScreen(<AiDelegatedTasksPage />, { path: '/me/ai-tasks?state=DONE', handlers: aiTaskHandlers([failed], { all: 3, done: 1 }) })
    const state = await screen.findByTestId('ai-row-602-state')
    expect(state).toHaveTextContent(/^실패$/)
    expect(state).toHaveClass('bg-destructive/10')
    expect(screen.getByTestId('ai-row-602-last')).toHaveTextContent(/^종료 20분 전$/)
  })

  // WP-426: 프로젝트 머리 줄은 목록 맨 앞과 프로젝트가 바뀌는 자리에 오고, 건수는 서버 값(aiProject.size)이다.
  test('프로젝트 머리 줄이 목록 맨 앞과 프로젝트가 바뀌는 자리에 온다', async () => {
    renderScreen(<AiDelegatedTasksPage />, { path: '/me/ai-tasks', handlers: aiTaskHandlers(projectRows(), { all: 11 }) })
    const firstRow = await screen.findByTestId('ai-row-2061')
    const list = firstRow.closest('ul')!
    const ids = within(list)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === list)
      .map((li) => li.getAttribute('data-testid'))
    expect(ids[0]).toBe('ai-project-WP-head')
    expect(ids[ids.indexOf('ai-row-430') + 1]).toBe('ai-project-HR-head')
    expect(ids[ids.indexOf('ai-row-1015') + 1]).toBe('ai-project-MKT-head')
    expect(screen.getByTestId('ai-project-HR-head-count')).toHaveTextContent(/^HR · 4$/)
  })

  // WP-450: 다음 회차 대기 행은 메타 줄에 배지와 예정 시각 라벨(기준 2026-10-18 14:30 KST → 「내일 09:00 이후」)을 보인다.
  test('다음 회차 대기 행은 메타 줄에 배지와 예정 시각을 보인다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(KST_1430))
    const rows = [createScheduledIssue(601, '주간 리포트 생성', { note: '다른 작업에 양보했어요' })]
    renderScreen(<AiDelegatedTasksPage />, { path: '/me/ai-tasks', handlers: aiTaskHandlers(rows, { all: 1, scheduled: 1 }) })
    await screen.findByTestId('ai-row-601')
    expect(screen.getByTestId('ai-row-601-state')).toHaveTextContent('다음 회차 대기')
    expect(screen.getByTestId('ai-row-601-next-run')).toHaveTextContent(/^내일 09:00 이후$/)
    expect(screen.getByTestId('ai-row-601-meta')).toHaveTextContent('내일 09:00 이후')
    expect(screen.getByTestId('ai-row-601-note')).toHaveTextContent(/^다른 작업에 양보했어요$/)
  })

  // WP-989: 반복 작업 행은 메타 줄에 반복 표식(요약)을 보인다.
  test('반복 작업 행은 메타 줄에 「매일 08:30」 반복 표식을 보인다', async () => {
    const rows = [{ ...createScheduledIssue(611, '아침 브리핑'), recurrence: { rrule: 'FREQ=DAILY', time: '08:30', enabled: true } }]
    renderScreen(<AiDelegatedTasksPage />, { path: '/me/ai-tasks', handlers: aiTaskHandlers(rows, { all: 1, scheduled: 1 }) })
    await screen.findByTestId('ai-row-611')
    expect(screen.getByTestId('ai-row-611-recurrence')).toHaveTextContent(/^매일 08:30$/)
    expect(screen.getByTestId('ai-row-611-meta')).toContainElement(screen.getByTestId('ai-row-611-recurrence'))
  })

  // AI별 보기(WP-1201) — 모바일은 표 대신 AI 한 명이 카드 하나: 머리(이름·상태·n째) · 지금 하는 일 · 맡은 일 칩 + 자리.
  test('AI별 보기는 AI 마다 카드로 상태·지금 하는 일·맡은 일·자리를 보인다', async () => {
    const roster = [
      createAiAgentStatus(11, 'AI 개발자1', {
        works: [createAiAgentWork({ number: 1090, title: 'AI별로 보고 싶다', state: 'INPUT_REQUIRED', stateChangedAt: minutesAgo(38) })],
      }),
    ]
    renderScreen(<AiDelegatedTasksPage />, {
      path: '/me/ai-tasks?view=agents',
      handlers: [http.get('/api/v1/me/ai-agents', () => HttpResponse.json(createAiAgentsResponse(roster)))],
    })
    const card = await screen.findByTestId('ai-agent-11')
    expect(screen.getByTestId('ai-roster-mobile')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-roster-table')).not.toBeInTheDocument()
    expect(within(card).getByTestId('ai-agent-11-state')).toHaveTextContent('답변 필요')
    expect(within(card).getByTestId('ai-agent-11-since')).toHaveTextContent('38분째')
    expect(within(card).getByTestId('ai-agent-11-lead')).toHaveTextContent('AI별로 보고 싶다')
    expect(within(card).getByTestId('ai-agent-11-work-WP-1090')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-agent-11-slots')).toHaveTextContent('1/3')
  })
})
