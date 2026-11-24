// 내 작업 「내 차례」 탭 — 줄 순서·셀 문구, 패널에서 넘기기, null 생략, 빈 상태(WP-1991).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'

import { MyTurnsTab } from './MyTurnsTab'

const base = '/api/v1'
const kim = { id: 3, username: 'kim', name: '김', kind: 'HUMAN' as const }
const meId = testAuthValue.user!.id
const me = { id: meId, username: 'me', name: '나', kind: 'HUMAN' as const }

const turn = (runId: number, extra: object = {}) => ({
  runId, issueId: runId * 10, issueNumber: runId * 10, issueKey: `WP-${runId * 10}`, title: `제목 ${runId}`, projectId: 1, projectKey: 'WP', workflowId: 42,
  workflowName: '기본 흐름', versionNo: 1, nodeKey: 'review', nodeName: '검토', enteredAt: '2026-11-20T01:00:00Z', handedBy: kim, question: '배포해도 될까요?', ...extra,
})

const issueView = (runId: number) => ({
  runId, status: 'WAITING', revision: 3, workflowId: 42, versionNo: 1,
  currentNode: { key: 'review', name: '검토', type: 'human_task', roleKey: null, assignees: [me], enteredAt: '2026-11-20T01:00:00Z', nodeRunStatus: 'ACTIVE', instructions: null },
  outcomes: [{ key: 'approve', to: 'end', requireComment: false, requiredOutputs: [], assigneeRequired: false, candidateAssignees: [] }],
  path: [], remainingNodeKeys: [], context: {},
})

function setup(responses: object[][]) {
  let n = 0
  const moves: Record<string, unknown>[] = []
  const r = renderScreen(<MyTurnsTab />, {
    path: '/me/tasks/turns',
    handlers: [
      http.get(base + '/me/workflow-turns', () => HttpResponse.json({ items: responses[Math.min(n++, responses.length - 1)] })),
      http.get(base + '/issues/:id/workflow', ({ params }) => HttpResponse.json(issueView(Number(params.id) / 10))),
      http.post(base + '/issues/:id/workflow/move', async ({ request }) => {
        moves.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(issueView(1))
      }),
    ],
  })
  return { ...r, moves }
}

describe('내 차례 탭', () => {
  it('myTurns_tabListsOldestFirst_andMovesFromPanel', async () => {
    const first = turn(1)
    const second = turn(2, { enteredAt: '2026-11-21T01:00:00Z', question: null, handedBy: null, nodeName: null, nodeKey: 'qa' })
    const { user, moves } = setup([[first, second], [second]])
    const rows = await screen.findAllByTestId(/^my-turn-row-/)
    expect(rows.map((x) => x.getAttribute('data-testid'))).toEqual(['my-turn-row-1', 'my-turn-row-2'])
    expect(within(rows[0]).getByText('WP-10')).toBeVisible()
    expect(within(rows[0]).getByText('제목 1')).toBeVisible()
    expect(within(rows[0]).getByText('기본 흐름 · 검토')).toBeVisible()
    expect(within(rows[0]).getByText('배포해도 될까요?')).toBeVisible()
    expect(within(rows[0]).getByRole('link', { name: '열기' })).toHaveAttribute('href', '/projects/WP/issues/10')
    expect(within(rows[1]).getByText('기본 흐름 · qa')).toBeVisible()

    await user.click(within(rows[0]).getByRole('button', { name: /WP-10/ }))
    expect(await screen.findByText('김 님이 넘김')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: 'approve' }))
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() => expect(moves).toHaveLength(1))
    expect(moves[0]).toMatchObject({ fromNode: 'review', outcome: 'approve', expectedRevision: 3 })
    await waitFor(() => expect(screen.queryByTestId('my-turn-row-1')).not.toBeInTheDocument())
    expect(screen.queryByText('김 님이 넘김')).not.toBeInTheDocument()
    expect(screen.getByTestId('my-turn-row-2')).toBeVisible()
  })

  it('myTurns_nullQuestionAndHandedBy_omitted', async () => {
    const { user } = setup([[turn(2, { question: null, handedBy: null })]])
    await user.click(await screen.findByRole('button', { name: /WP-20/ }))
    await screen.findByTestId('my-turn-panel')
    expect(document.body.textContent).not.toContain('null')
    expect(screen.queryByText(/님이 넘김/)).not.toBeInTheDocument()
  })

  it('myTurns_noSelection_silent', async () => {
    setup([[turn(1)]])
    await screen.findByTestId('my-turn-row-1')
    expect(screen.getByTestId('my-turn-status')).toHaveTextContent(/^$/)
  })

  it('myTurns_selectRow_announcesAndLabelsPanel', async () => {
    const { user } = setup([[turn(1)]])
    const row = await screen.findByRole('button', { name: /WP-10/ })
    await user.click(row)
    await waitFor(() => expect(screen.getByTestId('my-turn-status')).toHaveTextContent('WP-10 내 차례 상세를 열었습니다'))
    const region = screen.getByRole('region', { name: 'WP-10 제목 1' })
    expect(within(region).getByRole('heading', { level: 2, name: 'WP-10 제목 1' })).toBeVisible()
    await user.click(row)
    expect(screen.getByTestId('my-turn-status')).toHaveTextContent(/^WP-10 내 차례 상세를 열었습니다$/)
  })

  it('myTurns_empty', async () => {
    setup([[]])
    expect(await screen.findByText('지금 내 차례인 일이 없습니다')).toBeVisible()
    expect(screen.getByText('워크플로우가 나에게 넘긴 일이 여기에 모입니다')).toBeVisible()
  })
})
