// 이슈 상세 AI 진행(WP-377·WP-450·WP-1079) — 페이지 테스트(WP-980).
// 제목 아래 「AI 진행」 칸 행의 서버 순서·상태 배지(진행률 포함)·최근 보고·마지막 보고, 「답변 필요」 배지 → 채팅(?chat=1 + 드로워),
// 작업 없음·인증 필요·시작 전·다음 회차 대기 문구는 응답 → 문구로 브라우저 없이 판정된다. 칸의 위치와 한 줄·말줄임(@layout)은
// e2e/pages/projects/issue-agent-work.spec.ts 에 남는다.
// 화면 테스트(WP-1002) — 이슈 상세 화면만 renderIssueDetailScreen 으로 띄운다(App·인증 부팅·앱 셸 없이).
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { AgentWorkView } from '@/types/issue'

import { agentWorker as aki, createAgentWork, humanWorker as human, KST_1430, twoWorks } from '../../../e2e/factories/agentWork.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const URL = '/projects/WP/issues/12'

/** WP-12 상세에 agentWork 를 싣고 띄운다 — 담당자 그룹이 그려질 때까지 기다린다. */
async function open(agentWork: AgentWorkView[] | undefined, assignees = [human, aki]) {
  const summary = createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH', assignees, ...(agentWork ? { agentWork } : {}) })
  const view = renderIssueDetailScreen(URL, { handlers: issueDetailHandlers({ detail: createIssueDetail({ summary }) }) })
  await screen.findByTestId('property-group-status-people', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  return view
}

afterEach(() => vi.useRealTimers())

describe('AI 진행 칸', () => {
  // 서버가 급한 순(답변 필요 → 작업 중)으로 내려주면 화면은 그 순서를 지킨다. 진행률은 배지에 합치고, 도구 이름은 보이지 않는다.
  test('작업자별 상태(진행률 포함)·최근 보고·마지막 보고를 서버 순서대로 보이고, 속성 레일에는 없다', async () => {
    await open(twoWorks('A안/B안 중 어느 쪽으로 진행할까요?'))
    const card = screen.getByTestId('agent-work-card')
    expect(card).toHaveTextContent('AI 진행')
    expect([...card.querySelectorAll('li[data-testid^="agent-work-"]')].map((li) => li.getAttribute('data-testid'))).toEqual([
      'agent-work-9',
      'agent-work-1',
    ])
    expect(within(screen.getByTestId('property-rail')).queryByText('AI 진행')).not.toBeInTheDocument()

    const akiRow = screen.getByTestId('agent-work-9')
    expect(akiRow).toHaveTextContent('아키')
    expect(within(akiRow).getByTestId('agent-work-9-state')).toHaveTextContent(/답변 필요$/)
    expect(akiRow).toHaveTextContent('A안/B안 중 어느 쪽으로 진행할까요?')
    expect(within(akiRow).getByTestId('agent-work-9-last')).toHaveTextContent(/^1시간 전$/)
    expect(akiRow.textContent).not.toContain('Claude Code')
    expect(akiRow.textContent).not.toContain('—')

    const meRow = screen.getByTestId('agent-work-1')
    expect(meRow).toHaveTextContent('양동희')
    expect(within(meRow).getByTestId('agent-work-1-state')).toHaveTextContent(/작업 중 3\/5$/)
    expect(meRow).toHaveTextContent('MCP 헤더 처리 중')
    expect(within(meRow).getByTestId('agent-work-1-last')).toHaveTextContent(/^5분 전$/)
  })

  test('진행 중 AI 작업이 없으면 AI 진행 칸을 그리지 않는다', async () => {
    await open(undefined, [aki])
    expect(screen.getByTestId('issue-reporter')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-work-card')).not.toBeInTheDocument()
  })

  // 답변이 아니라 사용자가 권한을 줘야 하는 상태 — 툴팁 없고 누를 수 없는 배지만.
  test('인증 필요는 인증 필요 배지(툴팁 없음·누를 수 없음)로 보인다', async () => {
    await open([createAgentWork({ worker: aki, state: 'AUTH_REQUIRED', note: 'GitHub 권한이 필요해요' })], [aki])
    const badge = screen.getByTestId('agent-work-9-state')
    expect(badge).toHaveTextContent('인증 필요')
    expect(badge.getAttribute('title') ?? '').toBe('')
    expect(badge.tagName).toBe('SPAN')
    expect(screen.getByTestId('agent-work-9')).toHaveTextContent('GitHub 권한이 필요해요')
  })

  // 아직 보고가 없으니 마지막 보고를 남기지 않는다(null·— 노출 금지).
  test('시작 전(도구 없음) 작업은 시작 전 배지만 보인다', async () => {
    await open([createAgentWork({ worker: aki, state: 'SUBMITTED', tool: null })], [aki])
    const row = screen.getByTestId('agent-work-9')
    expect(screen.getByTestId('agent-work-9-state')).toHaveTextContent(/^시작 전$/)
    expect(row.textContent).not.toMatch(/null|—/)
    expect(screen.queryByTestId('agent-work-9-last')).not.toBeInTheDocument()
  })
})

// WP-450: 다음 회차 대기 — 기준 시각을 2026-10-18 14:30 KST 로 고정해 「내일 09:00」 같은 라벨을 실행 시각과 무관하게 본다.
describe('다음 회차 대기', () => {
  test('예정 시각 한 줄(툴팁에 예정 일시), 예정이 없으면 「다른 작업 뒤 이어서」', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(KST_1430) })
    await open([
      createAgentWork({ worker: aki, state: 'SCHEDULED', note: '다른 작업에 양보했어요', nextRunAt: '2026-10-19T00:00:00Z' }),
      createAgentWork({ worker: human, state: 'SCHEDULED', nextRunAt: null }),
    ])
    expect(screen.getByTestId('agent-work-9-state')).toHaveTextContent(/^다음 회차 대기$/)
    const next = screen.getByTestId('agent-work-9-next-run')
    expect(next).toHaveTextContent(/^내일 09:00 이후 시작$/)
    expect(next).toHaveAttribute('title', '예정 2026-10-19 09:00')
    const humanNext = screen.getByTestId(`agent-work-${human.id}-next-run`)
    expect(humanNext).toHaveTextContent(/^다른 작업 뒤 이어서$/)
    expect(humanNext.getAttribute('title') ?? '').toBe('')
  })

  test('예정 시각이 한참 지났으면(overdue) 「곧 시작」과 경고 툴팁', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(KST_1430) })
    await open([createAgentWork({ worker: aki, state: 'SCHEDULED', nextRunAt: '2026-10-18T01:00:00Z', overdue: true })])
    const next = screen.getByTestId('agent-work-9-next-run')
    expect(next).toHaveTextContent(/^곧 시작$/)
    expect(next).toHaveAttribute('title', '예정 시각이 2시간 넘게 지났어요')
  })
})

describe('답변 필요 → 채팅', () => {
  test('AI 구성원의 「답변 필요」 배지를 누르면 ?chat=1 로 채팅 드로워가 열린다', async () => {
    const { user, location } = await open(twoWorks('A안/B안 중 어느 쪽으로 진행할까요?'))
    expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('agent-work-9-state'))
    await waitFor(() => expect(location()).toMatch(/[?&]chat=1/))
    expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
  })

  // 사람의 답변 필요는 터미널에서 답하므로 채팅을 열지 않는다.
  test('사람의 「답변 필요」 배지는 누를 수 없다', async () => {
    await open([createAgentWork({ worker: human, state: 'INPUT_REQUIRED', note: '터미널 확인 필요' })])
    expect(screen.getByTestId(`agent-work-${human.id}-state`).tagName).toBe('SPAN')
  })
})
