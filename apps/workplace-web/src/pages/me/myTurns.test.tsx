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
  workflowName: '기본 흐름', versionNo: 1, nodeKey: 'review', nodeName: '검토', enteredAt: '2026-11-20T01:00:00Z', handedBy: kim, question: '배포해도 될까요?', asking: false, ...extra,
})

const outcomeView = (key: string) => ({ key, name: key, to: 'end', requireComment: false, requiredOutputs: [], assigneeRequired: false, candidateAssignees: [] })
const issueView = (runId: number, node: object = {}, outcomes: object[] = [outcomeView('approve')]) => ({
  runId, status: 'WAITING', revision: 3, workflowId: 42, versionNo: 1,
  currentNode: { key: 'review', name: '검토', type: 'human_task', roleKey: null, assignees: [me], enteredAt: '2026-11-20T01:00:00Z', nodeRunStatus: 'ACTIVE', instructions: null, ...node },
  outcomes,
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
      // 질문 경로 줄은 지금 노드에 returnTo 가 있다 — 서버 이슈 워크플로우 뷰와 같은 모양.
      // run 5 는 표준 질문 노드(결과 answered 뿐), run 7 은 다른 결과(approve)도 있는 질문 노드다.
      http.get(base + '/issues/:id/workflow', ({ params }) => {
        const runId = Number(params.id) / 10
        if (runId === 5) return HttpResponse.json(issueView(runId, { key: 'work_ask', returnTo: 'work' }, [outcomeView('answered')]))
        if (runId === 7) return HttpResponse.json(issueView(runId, { key: 'work_ask', returnTo: 'work' }, [outcomeView('answered'), outcomeView('approve')]))
        return HttpResponse.json(issueView(runId))
      }),
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
    // WP-2050: 넘겨서 고른 줄이 빠지면 선택이 풀려 안내가 다시 보인다.
    expect(screen.getByTestId('my-turn-empty-detail')).toBeVisible()
  })

  // WP-2093: 질문 대기 줄은 질문 첫 줄과 「챗에서 답하기」(챗이 열린 이슈 링크)를 보이고, 패널에는 결과 단추가 없다.
  it('myTurns_askingRow_showsFirstLineAndChatLink_noOutcomeButtons', async () => {
    const asking = turn(5, { question: '어느 쪽으로 할까요?', asking: true, nodeKey: 'work_ask', nodeName: '질문 답변' })
    const plain = turn(6)
    const { user } = setup([[asking, plain]])
    const rows = await screen.findAllByTestId(/^my-turn-row-/)
    expect(within(rows[0]).getByText('어느 쪽으로 할까요?')).toBeVisible()
    expect(within(rows[0]).getByRole('link', { name: '챗에서 답하기' })).toHaveAttribute('href', '/projects/WP/issues/50?chat=1')
    expect(within(rows[0]).queryByRole('link', { name: '열기' })).not.toBeInTheDocument()
    // 일반 사람 노드 줄은 그대로 「열기」.
    expect(within(rows[1]).getByRole('link', { name: '열기' })).toHaveAttribute('href', '/projects/WP/issues/60')
    expect(within(rows[1]).queryByRole('link', { name: '챗에서 답하기' })).not.toBeInTheDocument()

    await user.click(within(rows[0]).getByRole('button', { name: /WP-50/ }))
    const panel = await screen.findByTestId('my-turn-panel')
    expect(within(panel).getByText('「어느 쪽으로 할까요?」')).toBeVisible()
    expect(within(panel).getByRole('link', { name: '챗에서 답하기' })).toHaveAttribute('href', '/projects/WP/issues/50?chat=1')
    // 배너는 질문 경로 노드를 그리지 않는다 — 결과 단추·넘기기가 없다.
    await new Promise((r) => setTimeout(r, 100))
    expect(within(panel).queryByRole('button', { name: 'answered' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-workflow-banner')).not.toBeInTheDocument()
  })

  // WP-2093 리뷰 후속: 질문 노드에 answered 말고 다른 결과도 있으면 패널 배너는 보이되 answered 단추만 없다(답은 챗으로).
  it('myTurns_askingRowWithOtherOutcomes_bannerWithoutAnswered', async () => {
    const asking = turn(7, { question: '어느 쪽으로 할까요?', asking: true, nodeKey: 'work_ask', nodeName: '질문 답변' })
    const { user } = setup([[asking]])
    await user.click(within(await screen.findByTestId('my-turn-row-7')).getByRole('button', { name: /WP-70/ }))
    const panel = await screen.findByTestId('my-turn-panel')
    expect(await within(panel).findByRole('button', { name: 'approve' })).toBeVisible()
    expect(within(panel).queryByRole('button', { name: 'answered' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: '챗에서 답하기' })).toHaveAttribute('href', '/projects/WP/issues/70?chat=1')
  })

  // WP-2050: 고른 줄이 없으면 오른쪽에 안내를 보이고, 줄을 고르면 안내 대신 패널이 보인다.
  it('myTurns_noSelection_showsDetailHint_untilRowPicked', async () => {
    const { user } = setup([[turn(1)]])
    await screen.findByTestId('my-turn-row-1')
    expect(screen.getByTestId('my-turn-empty-detail')).toHaveTextContent('줄을 고르면 여기에서 넘겨받은 내용을 보고 바로 결과를 고를 수 있습니다.')
    await user.click(screen.getByRole('button', { name: /WP-10/ }))
    expect(await screen.findByTestId('my-turn-panel')).toBeVisible()
    expect(screen.queryByTestId('my-turn-empty-detail')).not.toBeInTheDocument()
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

  // WP-2055 리뷰 후속: 넘긴 뒤 초점은 「고른 줄이 빠짐」 한 경로로만 옮긴다 — 패널 제목을 거쳐 두 번 옮기지 않는다.
  // 리뷰 후속(code-review): 배너는 물러났는데 목록에 줄이 남으면(재조회 지연·실패) 초점이 body 에 남지 않고 패널 제목으로 간다.
  it('myTurns_bannerLeftButRowStays_focusesPanelHeading', async () => {
    let moved = false
    const r = renderScreen(<MyTurnsTab />, {
      path: '/me/tasks/turns',
      handlers: [
        http.get(base + '/me/workflow-turns', () => HttpResponse.json({ items: [turn(1), turn(2)] })),
        http.get(base + '/issues/:id/workflow', ({ params }) => {
          const v = issueView(Number(params.id) / 10)
          return HttpResponse.json(moved ? { ...v, revision: 4, currentNode: { ...v.currentNode, assignees: [kim] } } : v)
        }),
        http.post(base + '/issues/:id/workflow/move', () => {
          moved = true
          return HttpResponse.json(issueView(1))
        }),
      ],
    })
    await r.user.click(within(await screen.findByTestId('my-turn-row-1')).getByRole('button', { name: /WP-10/ }))
    const heading = within(await screen.findByTestId('my-turn-panel')).getByRole('heading', { level: 2 })
    await r.user.click(await screen.findByRole('button', { name: 'approve' }))
    await r.user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() => expect(screen.queryByTestId('issue-workflow-banner')).not.toBeInTheDocument())
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('myTurns_movedRowRemoved_focusMovesOnce_notViaPanelHeading', async () => {
    // 넘긴 뒤 배너 조회(담당이 남으로 바뀜)가 목록 조회보다 먼저 와서 배너가 패널 안에서 먼저 물러나는 순서를 만든다.
    let moved = false
    const r = renderScreen(<MyTurnsTab />, {
      path: '/me/tasks/turns',
      handlers: [
        http.get(base + '/me/workflow-turns', async () => {
          if (!moved) return HttpResponse.json({ items: [turn(1), turn(2)] })
          await new Promise((res) => setTimeout(res, 150))
          return HttpResponse.json({ items: [turn(2)] })
        }),
        http.get(base + '/issues/:id/workflow', ({ params }) => {
          const v = issueView(Number(params.id) / 10)
          return HttpResponse.json(moved ? { ...v, revision: 4, currentNode: { ...v.currentNode, assignees: [kim] } } : v)
        }),
        http.post(base + '/issues/:id/workflow/move', () => {
          moved = true
          return HttpResponse.json(issueView(1))
        }),
      ],
    })
    await r.user.click(within(await screen.findByTestId('my-turn-row-1')).getByRole('button', { name: /WP-10/ }))
    const heading = within(await screen.findByTestId('my-turn-panel')).getByRole('heading', { level: 2 })
    const focused: Element[] = []
    const onFocusIn = (e: FocusEvent) => focused.push(e.target as Element)
    document.addEventListener('focusin', onFocusIn)
    try {
      await r.user.click(await screen.findByRole('button', { name: 'approve' }))
      await r.user.click(screen.getByRole('button', { name: '넘기기' }))
      await waitFor(() => expect(within(screen.getByTestId('my-turn-row-2')).getByRole('button', { name: /WP-20/ })).toHaveFocus())
      // 패널 제목을 거치지 않고 첫 줄로 한 번만 옮겼다.
      expect(focused).not.toContain(heading)
    } finally {
      document.removeEventListener('focusin', onFocusIn)
    }
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
    expect(screen.queryByTestId('my-turn-empty-detail')).not.toBeInTheDocument()
  })
})
