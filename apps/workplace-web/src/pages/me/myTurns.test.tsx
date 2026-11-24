// 내 작업 「내 차례」 탭 — 줄 순서·셀 문구, 패널에서 넘기기, null 생략, 빈 상태(WP-1991).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MY_WORKFLOW_TURNS_REFETCH_MS } from '@/hooks/queries/useWorkflowRuns'
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

// 응답 항목이 숫자면 그 상태 코드로 실패시킨다(주기 조회 실패 재현, WP-2042).
function setup(responses: (object[] | number)[]) {
  let n = 0
  const moves: Record<string, unknown>[] = []
  const r = renderScreen(<><input aria-label="바깥 입력" /><MyTurnsTab /></>, {
    path: '/me/tasks/turns',
    handlers: [
      http.get(base + '/me/workflow-turns', () => {
        const next = responses[Math.min(n++, responses.length - 1)]
        return typeof next === 'number' ? HttpResponse.json({ message: 'fail' }, { status: next }) : HttpResponse.json({ items: next })
      }),
      http.get(base + '/issues/:id/workflow', ({ params }) => HttpResponse.json(issueView(Number(params.id) / 10))),
      http.post(base + '/issues/:id/workflow/move', async ({ request }) => {
        moves.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(issueView(1))
      }),
    ],
  })
  // 내 차례 조회가 몇 번 갔는지 — 주기 조회가 실제로 돌았는지 단언한다(WP-2042 리뷰 후속).
  return { ...r, moves, turnCalls: () => n }
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

  // 남이 넘긴 차례는 이 화면이 모르는 변화 — 열어 둔 채로 주기 조회가 새 행을 가져온다(WP-2042).
  // 주기 조회(WP-2042) — 가짜 타이머로 30초를 흘려 다시 읽기를 본다.
  describe('주기 조회', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('myTurns_newTurnAppearsWithin30s_withoutReload', async () => {
      setup([[turn(1)], [turn(1), turn(2)]])
      await screen.findByTestId('my-turn-row-1')
      expect(screen.queryByTestId('my-turn-row-2')).not.toBeInTheDocument()
      await vi.advanceTimersByTimeAsync(MY_WORKFLOW_TURNS_REFETCH_MS)
      expect(await screen.findByTestId('my-turn-row-2')).toBeVisible()
    })

    // 백그라운드 주기 조회가 한 번 실패해도 이미 받은 목록은 그대로 둔다 — v5 는 옛 data 를 두고 status 만 error 로 바꾼다.
    it('myTurns_backgroundRefetchFails_keepsList', async () => {
      const { turnCalls } = setup([[turn(1)], 500])
      await screen.findByTestId('my-turn-row-1')
      expect(turnCalls()).toBe(1)
      await vi.advanceTimersByTimeAsync(MY_WORKFLOW_TURNS_REFETCH_MS)
      // 주기 조회(두 번째 요청 — 500)가 실제로 간 뒤에 목록 유지를 본다. 안 가면 여기서 실패한다.
      await waitFor(() => expect(turnCalls()).toBeGreaterThanOrEqual(2))
      await vi.advanceTimersByTimeAsync(1000)
      expect(screen.getByTestId('my-turn-row-1')).toBeVisible()
      expect(screen.queryByText('내 차례를 불러오지 못했습니다')).not.toBeInTheDocument()
    })
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

  // WP-2055 — 넘겨서 줄이 빠지면 초점이 body 로 떨어지지 않는다.
  it('myTurns_movedRowRemoved_focusesFirstRow', async () => {
    const { user } = setup([[turn(1), turn(2)], [turn(2)]])
    await user.click(within(await screen.findByTestId('my-turn-row-1')).getByRole('button', { name: /WP-10/ }))
    await user.click(await screen.findByRole('button', { name: 'approve' }))
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() => expect(screen.queryByTestId('my-turn-row-1')).not.toBeInTheDocument())
    await waitFor(() => expect(within(screen.getByTestId('my-turn-row-2')).getByRole('button', { name: /WP-20/ })).toHaveFocus())
  })

  it('myTurns_lastRowMoved_focusesEmptyTitle', async () => {
    const { user } = setup([[turn(1)], []])
    await user.click(await screen.findByRole('button', { name: /WP-10/ }))
    await user.click(await screen.findByRole('button', { name: 'approve' }))
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    const title = await screen.findByText('지금 내 차례인 일이 없습니다')
    await waitFor(() => expect(title.closest('[tabindex="-1"]')).toHaveFocus())
  })

  // 남이 옮겨 고른 줄이 빠져도(주기 재조회) 사용자가 바깥 입력에 있으면 초점을 뺏지 않는다.
  it('myTurns_selectedRowRemovedByOthers_keepsOutsideFocus', async () => {
    const { user, queryClient } = setup([[turn(1), turn(2)], [turn(2)]])
    await user.click(await screen.findByRole('button', { name: /WP-10/ }))
    await screen.findByTestId('my-turn-panel')
    const input = screen.getByRole('textbox', { name: '바깥 입력' })
    input.focus()
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => expect(screen.queryByTestId('my-turn-row-1')).not.toBeInTheDocument())
    expect(input).toHaveFocus()
  })

  // 목록 안 다른 줄에 있는 사용자도 남이 옮겨 고른 줄이 빠졌다고 첫 줄로 끌려가지 않는다.
  it('myTurns_selectedRowRemovedByOthers_keepsOtherRowFocus', async () => {
    const { user, queryClient } = setup([[turn(1), turn(2), turn(3)], [turn(2), turn(3)]])
    await user.click(await screen.findByRole('button', { name: /WP-10/ }))
    await screen.findByTestId('my-turn-panel')
    const row3 = within(screen.getByTestId('my-turn-row-3')).getByRole('button', { name: /WP-30/ })
    row3.focus()
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => expect(screen.queryByTestId('my-turn-row-1')).not.toBeInTheDocument())
    expect(row3).toHaveFocus()
  })

  it('myTurns_otherRowRemoved_doesNotMoveFocus', async () => {
    const { queryClient } = setup([[turn(1), turn(2)], [turn(2)]])
    await screen.findByTestId('my-turn-row-1')
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => expect(screen.queryByTestId('my-turn-row-1')).not.toBeInTheDocument())
    expect(document.body).toHaveFocus()
  })

  it('myTurns_empty', async () => {
    setup([[]])
    expect(await screen.findByText('지금 내 차례인 일이 없습니다')).toBeVisible()
    expect(screen.getByText('워크플로우가 나에게 넘긴 일이 여기에 모입니다')).toBeVisible()
  })
})
