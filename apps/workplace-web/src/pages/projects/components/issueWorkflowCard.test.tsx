// 이슈 상세 「AI 작업 단계」 카드(WP-1989) — 지나온·지금·남은 단계, 시작 단추, 켜지지 않은 프로젝트의 숨김.
// 카드와 레일 그룹(IssueWorkflowGroup)만 renderScreen 으로 띄운다 — 이슈 상세 전체는 필요 없다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test, vi } from 'vitest'

import { useIssueWorkflow } from '@/lib/workflow'
import { useProjectWorkflows } from '@/lib/workflows'
import { renderScreen } from '@/test/renderScreen'

import { IssueWorkflowCard, IssueWorkflowGroup } from './IssueWorkflowCard'

const API = '/api/v1'
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()
const user = (id: number, name: string, kind: 'HUMAN' | 'AGENT' = 'AGENT') => ({ id, username: name, name, kind })

const runningView = {
  runId: 5,
  status: 'WAITING',
  revision: 3,
  workflowId: 3,
  versionNo: 2,
  currentNode: {
    key: 'ask', name: '구현 질문 답변', type: 'task', roleKey: null,
    assignees: [user(9, '대표님', 'HUMAN')], enteredAt: ago(40), nodeRunStatus: 'ACTIVE', instructions: null,
  },
  outcomes: [],
  path: [
    { key: 'triage', name: '분류', outcome: 'done', actor: user(2, '팀장AI'), enteredAt: ago(300), leftAt: ago(200) },
    { key: 'design', name: '이해·설계', outcome: 'done', actor: user(3, '개발AI-2'), enteredAt: ago(200), leftAt: ago(40) },
  ],
  remainingNodeKeys: ['verify_pr', 'review', 'end'],
  context: {},
}
const noRun = { ...runningView, runId: null, status: null, workflowId: null, versionNo: null, currentNode: null, path: [], remainingNodeKeys: [] }
const enabledList = [{ id: 3, name: 'AI 개발 흐름', enabled: true, activeVersionNo: 2, draftChanged: false }]
const version = {
  versionNo: 2, sourceYaml: '',
  model: {
    schema: 's', roles: [], shared: [], start: [], layout: [],
    nodes: [
      { key: 'verify_pr', name: '검증·PR' }, { key: 'review', name: 'PR 리뷰' }, { key: 'end', name: '끝' },
    ].map((n) => ({ ...n, type: 'task', use: [], requires: [], outputs: [], outcomes: [], conditions: [] })),
  },
}

function handlers(view: object, list: object = enabledList, versionHandler?: RequestHandler): RequestHandler[] {
  return [
    http.get(`${API}/issues/7/workflow`, () => HttpResponse.json(view)),
    http.get(`${API}/projects/9/workflows`, () => HttpResponse.json(list)),
    versionHandler ?? http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(version)),
  ]
}

const card = (props: { canEdit?: boolean; isManager?: boolean; closed?: boolean; onStart?: () => void } = {}) => (
  <IssueWorkflowCard issueId={7} projectKey="WP" projectId={9} canEdit={props.canEdit ?? true} isManager={props.isManager ?? false} closed={props.closed} onStart={props.onStart ?? (() => {})} />
)

describe('AI 작업 단계 카드', () => {
  test('closedIssue_noRun_hidesStartButton', async () => {
    renderScreen(card({ closed: true }), { path: '/projects/WP/issues/1', handlers: handlers(noRun, enabledList) })
    expect(await screen.findByText('아직 워크플로우가 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '워크플로우 시작' })).not.toBeInTheDocument()
  })

  test('card_showsPassedCurrentRemaining', async () => {
    renderScreen(card(), { path: '/projects/WP/issues/1', handlers: handlers(runningView) })
    expect(await screen.findByText('✓ 분류')).toBeInTheDocument()
    expect(screen.getByText('✓ 이해·설계')).toBeInTheDocument()
    // 지난 단계 줄에 그 단계의 행위자 이름이 함께 보인다(「✓ 이름」은 따로 span).
    expect(screen.getByText('✓ 분류').closest('li')).toHaveTextContent('팀장AI')
    expect(screen.getByText('✓ 이해·설계').closest('li')).toHaveTextContent('개발AI-2')
    expect(screen.getByText('● 구현 질문 답변')).toBeInTheDocument()
    expect(screen.getByText(/40분째/)).toBeInTheDocument()
    expect(await screen.findByText('검증·PR → PR 리뷰 → 끝')).toBeInTheDocument()
    expect(screen.getByText('AI 개발 흐름 v2')).toBeInTheDocument()
    expect(screen.getByText('사람 차례')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '실행 보기 ↗' })).toHaveAttribute('href', '/projects/WP/workflow')
  })

  test('enteredAtSecondsAgo_showsJustNowWithoutSuffix', async () => {
    const view = { ...runningView, currentNode: { ...runningView.currentNode, enteredAt: new Date(Date.now() - 5000).toISOString() } }
    renderScreen(card(), { handlers: handlers(view) })
    expect(await screen.findByText(/방금/)).toHaveTextContent(/방금$/)
    expect(screen.queryByText(/방금째/)).not.toBeInTheDocument()
  })

  test('noRun_showsStartButton', async () => {
    const onStart = vi.fn()
    const view = renderScreen(card({ onStart }), { handlers: handlers(noRun) })
    expect(await screen.findByText('아직 워크플로우가 없어요.')).toBeInTheDocument()
    await view.user.click(screen.getByRole('button', { name: '워크플로우 시작' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  test('noRun_withoutEditPermission_hasNoStartButton', async () => {
    renderScreen(card({ canEdit: false }), { handlers: handlers(noRun) })
    expect(await screen.findByText('아직 워크플로우가 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '워크플로우 시작' })).not.toBeInTheDocument()
  })

  test('disabledProject_noCardNoStartOption', async () => {
    let called = 0
    const hs: RequestHandler[] = [
      http.get(`${API}/issues/7/workflow`, () => { called++; return HttpResponse.json(noRun) }),
      http.get(`${API}/projects/9/workflows`, () => { called++; return HttpResponse.json([]) }),
    ]
    // 같은 QueryClient 의 두 조회가 성공 상태로 반영됐는지 보는 탐침 — 응답이 상태에 닿은 뒤에야 부재를 단언해 거짓 통과를 막는다.
    function Probe() {
      const view = useIssueWorkflow(7)
      const list = useProjectWorkflows(9)
      return view.isSuccess && list.isSuccess ? <p>조회 반영됨</p> : null
    }
    renderScreen(
      <>
        <IssueWorkflowGroup issueId={7} projectKey="WP" projectId={9} canEdit isManager={false} onStart={() => {}} />
        <Probe />
      </>,
      { handlers: hs },
    )
    // 두 조회가 모두 화면 상태에 반영된 뒤에도 그룹·카드·시작 단추가 없다.
    expect(await screen.findByText('조회 반영됨')).toBeInTheDocument()
    expect(called).toBe(2)
    expect(screen.queryByText('AI 작업 단계')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-workflow-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '워크플로우 시작' })).not.toBeInTheDocument()
  })

  test('enabledProject_groupShowsTitle', async () => {
    renderScreen(
      <IssueWorkflowGroup issueId={7} projectKey="WP" projectId={9} canEdit isManager={false} onStart={() => {}} />,
      { handlers: handlers(noRun) },
    )
    expect(await screen.findByText('AI 작업 단계')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '워크플로우 시작' })).toBeInTheDocument()
  })

  test('endedRun_showsDoneAndStartAgain', async () => {
    renderScreen(card(), {
      handlers: handlers({ ...runningView, status: 'COMPLETED', currentNode: null, outcomes: [], remainingNodeKeys: [] }),
    })
    expect(await screen.findByText('완료')).toBeInTheDocument()
    expect(screen.getByText('✓ 분류')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '워크플로우 시작' })).toBeInTheDocument()
  })

  test('remaining_fallsBackToKeys', async () => {
    renderScreen(card(), {
      handlers: handlers(runningView, enabledList, http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json({}, { status: 404 }))),
    })
    expect(await screen.findByText('verify_pr → review → end')).toBeInTheDocument()
  })
})

// 「⋯ 조치」 메뉴(WP-1989) — 멈춘(조치 필요) 실행을 다시 시도·오류 경로·취소·옮기기로 푼다.
describe('AI 작업 단계 카드 — 조치 메뉴', () => {
  const suspended = {
    ...runningView,
    status: 'SUSPENDED',
    revision: 4,
    currentNode: { ...runningView.currentNode, nodeRunStatus: 'BLOCKED' },
  }
  const running = { ...runningView, status: 'RUNNING', revision: 4, currentNode: { ...runningView.currentNode, nodeRunStatus: 'ACTIVE' } }
  const versionWithTriage = {
    ...version,
    model: {
      ...version.model,
      nodes: [{ key: 'triage', name: '분류' }, { key: 'verify_pr', name: '검증·PR' }].map((n) => ({
        ...n, type: 'task', use: [], requires: [], outputs: [], outcomes: [], conditions: [],
      })),
    },
  }

  /** 조치 요청 본문을 모으는 핸들러까지 붙여 띄운다. */
  function setup(view: object, props: { isManager?: boolean; canEdit?: boolean; closed?: boolean } = {}) {
    const recovers: Record<string, unknown>[] = []
    const rendered = renderScreen(card(props), {
      handlers: [
        ...handlers(view, enabledList, http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(versionWithTriage))),
        http.post(`${API}/issues/7/workflow/recover`, async ({ request }) => {
          recovers.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(view)
        }),
      ],
    })
    return { ...rendered, recovers }
  }

  test('closedIssue_hidesRecoverMenu', async () => {
    setup(suspended, { closed: true })
    await screen.findByText('조치 필요')
    expect(screen.queryByRole('button', { name: '조치' })).not.toBeInTheDocument()
  })

  test('suspended_showsRecoverMenu_retryWithComment', async () => {
    const { user, recovers } = setup(suspended)
    await user.click(await screen.findByRole('button', { name: '조치' }))
    expect(screen.getByRole('menuitem', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '오류 경로로 보내기' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '실행 취소' })).toBeInTheDocument()
    // 관리자가 아니면 옮기기는 없다.
    expect(screen.queryByRole('menuitem', { name: '다른 노드로 옮기기' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: '다시 시도' }))
    await user.type(await screen.findByRole('textbox', { name: '남길 말(선택)' }), '다시 해 봅시다')
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'RETRY', expectedRevision: 4, comment: '다시 해 봅시다' }]))
  })

  test('retryWithoutComment_omitsComment', async () => {
    const { user, recovers } = setup(suspended)
    await user.click(await screen.findByRole('button', { name: '조치' }))
    await user.click(screen.getByRole('menuitem', { name: '오류 경로로 보내기' }))
    await user.click(await screen.findByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'ON_ERROR', expectedRevision: 4 }]))
  })

  // 서버는 멈춘 실행에만 조치를 받는다(WORKFLOW_NOT_SUSPENDED) — 실행 중이면 조치 단추가 없다.
  test('running_hasNoRecoverButton', async () => {
    setup(running, { isManager: true })
    await screen.findByText('● 구현 질문 답변')
    expect(screen.queryByRole('button', { name: '조치' })).not.toBeInTheDocument()
  })

  test('nonStaleError_keepsDialogAndComment', async () => {
    const rendered = renderScreen(card(), {
      handlers: [
        ...handlers(suspended, enabledList, http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(versionWithTriage))),
        http.post(`${API}/issues/7/workflow/recover`, () => HttpResponse.json({ code: 'WORKFLOW_NO_ON_ERROR', message: '오류 경로가 없어요' }, { status: 422 })),
      ],
    })
    const { user } = rendered
    await user.click(await screen.findByRole('button', { name: '조치' }))
    await user.click(screen.getByRole('menuitem', { name: '오류 경로로 보내기' }))
    await user.type(await screen.findByRole('textbox', { name: '남길 말(선택)' }), '메모')
    await user.click(screen.getByRole('button', { name: '확인' }))
    // 실패해도 창과 남길 말이 남는다.
    await waitFor(() => expect(screen.getByRole('button', { name: '확인' })).toBeEnabled())
    expect(screen.getByRole('textbox', { name: '남길 말(선택)' })).toHaveValue('메모')
  })

  test('manager_moveToNode_picksModelNode', async () => {
    const { user, recovers } = setup(suspended, { isManager: true })
    await user.click(await screen.findByRole('button', { name: '조치' }))
    await user.click(screen.getByRole('menuitem', { name: '다른 노드로 옮기기' }))
    // 노드를 고르기 전에는 확인할 수 없다.
    expect(await screen.findByRole('button', { name: '확인' })).toBeDisabled()
    await user.click(await screen.findByRole('radio', { name: '분류' }))
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'MOVE_TO', toNode: 'triage', expectedRevision: 4 }]))
  })

  test('waitingOrEnded_orNoEdit_hasNoMenu', async () => {
    renderScreen(card(), { handlers: handlers(runningView) })
    await screen.findByText('● 구현 질문 답변')
    expect(screen.queryByRole('button', { name: '조치' })).not.toBeInTheDocument()
  })

  test('suspended_withoutEditPermission_hasNoMenu', async () => {
    setup(suspended, { canEdit: false })
    await screen.findByText('● 구현 질문 답변')
    expect(screen.queryByRole('button', { name: '조치' })).not.toBeInTheDocument()
  })
})
