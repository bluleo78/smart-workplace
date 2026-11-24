// 워크플로우 실행 상세 — 그래프 칠하기·머리, 사람 차례 배너, 조치 창, 이동 기록(WP-1991).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { mkModel } from '@/test/kits/projects/workflowRunFixtures'
import { renderScreen } from '@/test/renderScreen'

import { WorkflowRunDetail } from './WorkflowRunDetail'

const base = '/api/v1'
const kim = { id: 3, username: 'kim', name: '김', kind: 'HUMAN' as const }
const park = { id: 4, username: 'park', name: '박', kind: 'HUMAN' as const }
const lee = { id: 5, username: 'lee', name: '이', kind: 'HUMAN' as const }
const visit = (id: number, nodeKey: string, nodeName: string, extra: object = {}) => ({
  id, nodeKey, nodeName, visitNo: 1, status: 'COMPLETED', assignees: [], workflowAssigned: [], outcome: null, outputs: null,
  commentId: null, waitingReason: null, error: null, actor: null, enteredAt: '2026-11-20T01:00:00Z', leftAt: '2026-11-20T02:00:00Z', viaReturn: false, ...extra,
})

/** 시작 → a(작성, 끝남) → b(검토, 지금) 인 실행 상세. */
function detail(status: string, current: object = {}, run: object = {}) {
  return {
    run: {
      runId: 7, workflowId: 42, versionNo: 2, issueId: 70, issueNumber: 70, issueKey: 'WP-70', title: '로그인 개선', status, revision: 3, currentNode: 'b',
      startedBy: kim, startedAt: '2026-11-20T00:00:00Z', endedAt: null, context: {}, ...run,
    },
    nodeRuns: [
      visit(1, 'a', '작성', { actor: kim, outcome: 'done', enteredAt: '2026-11-20T00:00:00Z', leftAt: '2026-11-20T01:00:00Z' }),
      visit(2, 'b', '검토', { status: 'ACTIVE', assignees: [park], workflowAssigned: [lee], enteredAt: '2026-11-20T01:00:00Z', leftAt: null, ...current }),
    ],
    events: [],
    model: mkModel(),
  }
}

const issueView = (revision = 3) => ({
  runId: 7, status: 'WAITING', revision, workflowId: 42, versionNo: 2,
  currentNode: { key: 'b', name: '검토', type: 'human_task', roleKey: null, assignees: [park], enteredAt: '2026-11-20T01:00:00Z', nodeRunStatus: 'ACTIVE', instructions: null },
  outcomes: [{ key: 'approve', to: 'end', requireComment: false, requiredOutputs: [], assigneeRequired: false, candidateAssignees: [] }],
  path: [], remainingNodeKeys: [], context: {},
})

function setup(body: object | (() => object), opts: { canManage?: boolean; canRecover?: boolean; meId?: number } = {}) {
  const gets = { detail: 0 }
  const posts: { url: string; body: Record<string, unknown> }[] = []
  const view = body
  const r = renderScreen(<WorkflowRunDetail runId={7} workflowId={42} projectKey="WP" canManage={opts.canManage ?? false} canRecover={opts.canRecover ?? true} meId={opts.meId ?? 1} />, {
    path: '/projects/WP/workflow?view=runs&run=7',
    handlers: [
      http.get(base + '/workflow-runs/7', () => { gets.detail += 1; return HttpResponse.json(typeof view === 'function' ? (view as () => object)() : view) }),
      http.get(base + '/issues/70/workflow', () => HttpResponse.json(issueView())),
      http.post(base + '/issues/70/workflow/move', async ({ request }) => { posts.push({ url: 'move', body: (await request.json()) as Record<string, unknown> }); return HttpResponse.json(issueView(4)) }),
      http.post(base + '/issues/70/workflow/recover', async ({ request }) => { posts.push({ url: 'recover', body: (await request.json()) as Record<string, unknown> }); return HttpResponse.json(issueView(4)) }),
    ],
  })
  return { ...r, gets, posts }
}

describe('실행 상세', () => {
  it('runDetail_paintsPassedCurrentUnvisited', async () => {
    setup(detail('WAITING'))
    expect(await screen.findByText(/실행 #7 · 버전 2/)).toBeVisible()
    expect(screen.getByText(/김 시작/)).toBeVisible()
    expect(screen.getByRole('link', { name: '이슈 열기 ↗' })).toHaveAttribute('href', '/projects/WP/issues/70')
    const paint = (key: string) => document.querySelector(`[data-node-key="${key}"]`)!.getAttribute('data-paint')
    expect(paint('a')).toBe('passed')
    expect(paint('b')).toBe('current')
    expect(paint('end')).toBe('unvisited')
  })

  it('waitingBanner_answerMovesRun', async () => {
    const { user, posts, gets } = setup(detail('WAITING'), { meId: 4 })
    await user.click(await screen.findByRole('button', { name: 'approve' }))
    const before = gets.detail
    await user.click(screen.getByRole('button', { name: '넘기기' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].body).toMatchObject({ fromNode: 'b', outcome: 'approve', expectedRevision: 3 })
    await waitFor(() => expect(gets.detail).toBeGreaterThan(before))
  })

  it('waitingBanner_notAssignee_showsQuestionOnly', async () => {
    setup(detail('WAITING', {}, { context: { _qa: [{ answerNode: 'b', question: '배포해도 될까요?', answer: null }] } }), { meId: 1 })
    expect(await screen.findByText('「배포해도 될까요?」')).toBeVisible()
    expect(screen.getByText('담당: 박')).toBeVisible()
    expect(screen.queryByRole('button', { name: '넘기기' })).not.toBeInTheDocument()
  })

  it('suspendedBanner_showsReason', async () => {
    setup(detail('SUSPENDED', { status: 'BLOCKED', error: '빌드가 깨졌습니다' }))
    expect(await screen.findByText('빌드가 깨졌습니다')).toBeVisible()
  })

  it('suspendedBanner_closedFailedVisit_showsItsError', async () => {
    // 연쇄 한도 초과 — 서버가 이미 닫힌 FAILED 방문을 써서 열린 방문이 없다 (WP-1991 리뷰 후속).
    const d = detail('SUSPENDED')
    d.nodeRuns[1] = visit(2, 'b', '검토', { status: 'FAILED', error: '연쇄 한도 초과: 같은 노드를 너무 많이 지났습니다' })
    setup(d)
    expect(await screen.findByText('연쇄 한도 초과: 같은 노드를 너무 많이 지났습니다')).toBeVisible()
    expect(screen.queryByText('멈춘 이유가 기록되지 않았습니다')).toBeNull()
  })

  // 가장 늦은 방문이 정상으로 끝난 앞 회차 방문이면 그 낡은 사유를 이번 멈춤의 이유로 쓰지 않는다 (WP-1991 리뷰 후속).
  it('suspendedBanner_latestVisitCompleted_noStaleReason', async () => {
    const d = detail('SUSPENDED')
    d.nodeRuns[1] = visit(2, 'b', '검토', { status: 'COMPLETED', error: '지난번 사유' })
    setup(d)
    expect(await screen.findByText('멈춘 이유가 기록되지 않았습니다')).toBeVisible()
    expect(screen.queryByText('지난번 사유')).toBeNull()
  })

  // 닫힌 방문으로 대신 찾는 것은 SUSPENDED 일 때뿐이다 — 사람 차례(WAITING)에 지금 노드의 방문이 닫혀 있으면 그 담당을 보이지 않는다.
  it('waitingBanner_closedLatestVisit_showsNoAssignees', async () => {
    const d = detail('WAITING')
    d.nodeRuns[1] = visit(2, 'b', '검토', { status: 'FAILED', assignees: [park] })
    setup(d, { meId: 1 })
    expect(await screen.findByText('담당:')).toBeVisible()
    expect(screen.queryByText('담당: 박')).toBeNull()
  })

  it('suspendedBanner_recoverActions_managerOnlyMoveTo', async () => {
    const first = setup(detail('SUSPENDED', { status: 'BLOCKED', error: 'x' }))
    await first.user.click(await screen.findByRole('button', { name: '조치 고르기' }))
    expect(screen.getByRole('radio', { name: '다시 시도' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /오류 경로로 보내기/ })).toBeVisible()
    expect(screen.getByRole('radio', { name: '실행 취소' })).toBeVisible()
    expect(screen.queryByRole('radio', { name: '다른 노드로 옮기기' })).not.toBeInTheDocument()
    first.unmount()

    const { user, posts } = setup(detail('SUSPENDED', { status: 'BLOCKED', error: 'x' }), { canManage: true })
    await user.click(await screen.findByRole('button', { name: '조치 고르기' }))
    await user.click(screen.getByRole('radio', { name: '다른 노드로 옮기기' }))
    await user.selectOptions(screen.getByRole('combobox', { name: '옮길 노드' }), 'a')
    await user.type(screen.getByRole('textbox', { name: '남길 말(선택)' }), '다시 작성')
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0].body).toEqual({ action: 'MOVE_TO', toNode: 'a', comment: '다시 작성', expectedRevision: 3 })
  })

  // STALE 이면 토스트로 이유를 보이고 상세를 다시 읽은 뒤 창을 닫는다(열린 채면 고정된 revision 으로 계속 STALE).
  it('recover_stale_toastsClosesDialog_refetchesDetail', async () => {
    const { user, gets } = setup(detail('SUSPENDED', { status: 'BLOCKED', error: 'x' }))
    const { server } = await import('@/test/msw/server')
    server.use(http.post(base + '/issues/70/workflow/recover', () => HttpResponse.json({ errors: { code: 'WORKFLOW_STALE' }, message: 'stale' }, { status: 409 })))
    await user.click(await screen.findByRole('button', { name: '조치 고르기' }))
    const before = gets.detail
    await user.click(screen.getByRole('button', { name: '확인' }))
    expect(await screen.findByText('그사이 단계가 바뀌었어요. 새로 불러왔어요.')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(gets.detail).toBeGreaterThan(before))
  })

  it('moveLog_rowsNewestFirst', async () => {
    setup(detail('WAITING'))
    await screen.findByText(/실행 #7/)
    const items = within(screen.getByRole('region', { name: '이동 기록' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('작성 → 검토 · 김 · 결과 「done」')
    expect(items[0]).toHaveTextContent('담당 → 이')
    expect(items[1]).toHaveTextContent('워크플로우 시작 · 김')
  })

  // 서버 조치는 이슈 쓰기 + 프로젝트 구성원이 필요하다 — 구성원이 아니면 단추를 그리지 않는다(이유 문구는 그대로).
  it('suspendedBanner_nonMember_hasNoRecoverButton', async () => {
    setup(detail('SUSPENDED', { status: 'BLOCKED', error: '빌드가 깨졌습니다' }), { canRecover: false })
    expect(await screen.findByText('빌드가 깨졌습니다')).toBeVisible()
    expect(screen.queryByRole('button', { name: '조치 고르기' })).not.toBeInTheDocument()
  })

  it('runOfAnotherWorkflow_showsNoticeInsteadOfDetail', async () => {
    renderScreen(<WorkflowRunDetail runId={7} workflowId={99} projectKey="WP" canManage={false} canRecover meId={1} />, {
      handlers: [http.get(base + '/workflow-runs/7', () => HttpResponse.json(detail('WAITING')))],
    })
    expect(await screen.findByText('이 실행은 다른 워크플로우의 실행입니다')).toBeVisible()
    expect(screen.queryByTestId('run-detail')).not.toBeInTheDocument()
  })

  it('runDetail_404_showsNotFound', async () => {
    renderScreen(<WorkflowRunDetail runId={7} workflowId={42} projectKey="WP" canManage={false} canRecover meId={1} />, {
      handlers: [http.get(base + '/workflow-runs/7', () => HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 }))],
    })
    expect(await screen.findByText('실행을 찾을 수 없습니다')).toBeVisible()
  })
})
