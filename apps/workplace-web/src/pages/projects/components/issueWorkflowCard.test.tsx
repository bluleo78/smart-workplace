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
    expect(screen.getByRole('link', { name: '실행 보기 ↗' })).toHaveAttribute('href', '/projects/WP/workflow?view=runs&workflow=3&run=5')
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

// 「조치」 단추와 조치 창(WP-1989·1991) — 멈춘(조치 필요) 실행을 다시 시도·오류 경로·취소·옮기기로 푼다. 창은 실행 상세와 같은 RecoverDialog.
describe('AI 작업 단계 카드 — 조치 창', () => {
  const suspended = {
    ...runningView,
    status: 'SUSPENDED',
    revision: 4,
    currentNode: { ...runningView.currentNode, nodeRunStatus: 'BLOCKED' },
  }
  const running = { ...runningView, status: 'RUNNING', revision: 4, currentNode: { ...runningView.currentNode, nodeRunStatus: 'ACTIVE' } }
  const mkNode = (n: { key: string; name: string; type?: string }, extra: object = {}) => ({
    type: 'task', use: [], requires: [], outputs: [], outcomes: [], conditions: [], ...n, ...extra,
  })
  /** 지금 노드 ask(오류 경로 → triage 가 있거나 없는) + 시작·분류·검증 노드를 가진 모델. */
  const modelWith = (withOnError: boolean) => ({
    ...version,
    model: {
      ...version.model,
      nodes: [
        mkNode({ key: 'start', name: '시작', type: 'start' }),
        mkNode({ key: 'triage', name: '분류' }),
        mkNode({ key: 'ask', name: '구현 질문 답변' }, withOnError ? { onError: { to: 'triage' } } : {}),
        mkNode({ key: 'verify_pr', name: '검증·PR' }),
      ],
    },
  })

  /** 조치 요청 본문을 모으는 핸들러까지 붙여 띄운다. */
  function setup(view: object, props: { isManager?: boolean; canEdit?: boolean; closed?: boolean; withOnError?: boolean } = {}) {
    const recovers: Record<string, unknown>[] = []
    const rendered = renderScreen(card(props), {
      handlers: [
        ...handlers(view, enabledList, http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(modelWith(props.withOnError ?? true)))),
        http.post(`${API}/issues/7/workflow/recover`, async ({ request }) => {
          recovers.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(view)
        }),
      ],
    })
    return { ...rendered, recovers }
  }

  /** 조치 단추는 모델을 읽은 뒤 켜진다. */
  const openDialog = async (user: ReturnType<typeof setup>['user']) => {
    const btn = await screen.findByRole('button', { name: '조치' })
    await waitFor(() => expect(btn).toBeEnabled())
    await user.click(btn)
  }

  // 버전 모델을 못 읽어도(404) 조치는 꺼지지 않는다 — 다시 시도·실행 취소는 보낼 수 있고, 오류 경로·옮기기는 내놓지 않는다.
  test('versionModelFails_retryStillSent_noOnErrorNoMove', async () => {
    const recovers: Record<string, unknown>[] = []
    const { user } = renderScreen(card({ isManager: true }), {
      handlers: [
        ...handlers(suspended, enabledList, http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 }))),
        http.post(`${API}/issues/7/workflow/recover`, async ({ request }) => {
          recovers.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(suspended)
        }),
      ],
    })
    const btn = await screen.findByRole('button', { name: '조치' })
    await waitFor(() => expect(btn).toBeEnabled())
    await user.click(btn)
    expect(screen.getByRole('radio', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '실행 취소' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /오류 경로로 보내기/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '다른 노드로 옮기기' })).not.toBeInTheDocument()
    expect(screen.getByText('단계 목록을 불러오지 못했어요')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'RETRY', expectedRevision: 4 }]))
  })

  test('closedIssue_hidesRecoverMenu', async () => {
    setup(suspended, { closed: true })
    await screen.findByText('조치 필요')
    expect(screen.queryByRole('button', { name: '조치' })).not.toBeInTheDocument()
  })

  test('suspended_nonManager_noMoveTo_retryWithComment', async () => {
    const { user, recovers } = setup(suspended)
    await openDialog(user)
    expect(screen.getByRole('radio', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /오류 경로로 보내기/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '실행 취소' })).toBeInTheDocument()
    // 관리자가 아니면 옮기기는 없다.
    expect(screen.queryByRole('radio', { name: '다른 노드로 옮기기' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: '다시 시도' }))
    await user.type(screen.getByRole('textbox', { name: '남길 말(선택)' }), '다시 해 봅시다')
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'RETRY', expectedRevision: 4, comment: '다시 해 봅시다' }]))
  })

  test('onError_onlyWhenCurrentNodeHasOnError', async () => {
    const { user } = setup(suspended, { withOnError: false })
    await openDialog(user)
    expect(screen.getByRole('radio', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /오류 경로로 보내기/ })).not.toBeInTheDocument()
  })

  test('onError_sendsActionWithoutComment', async () => {
    const { user, recovers } = setup(suspended)
    await openDialog(user)
    // 대상 노드 이름을 함께 보인다.
    await user.click(screen.getByRole('radio', { name: '오류 경로로 보내기 → 분류' }))
    await user.click(screen.getByRole('button', { name: '확인' }))
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
        ...handlers(suspended, enabledList, http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(modelWith(true)))),
        http.post(`${API}/issues/7/workflow/recover`, () => HttpResponse.json({ code: 'WORKFLOW_NO_ON_ERROR', message: '오류 경로가 없어요' }, { status: 422 })),
      ],
    })
    const { user } = rendered
    await openDialog(user)
    await user.type(screen.getByRole('textbox', { name: '남길 말(선택)' }), '메모')
    await user.click(screen.getByRole('button', { name: '확인' }))
    // 실패해도 창과 남길 말이 남고 이유가 창 안에 보인다.
    expect(await screen.findByRole('alert')).toHaveTextContent('오류 경로가 없어요')
    expect(screen.getByRole('textbox', { name: '남길 말(선택)' })).toHaveValue('메모')
  })

  test('manager_moveToNode_excludesCurrentAndStart', async () => {
    const { user, recovers } = setup(suspended, { isManager: true })
    await openDialog(user)
    await user.click(screen.getByRole('radio', { name: '다른 노드로 옮기기' }))
    // 노드를 고르기 전에는 확인할 수 없다. 후보에서 지금 노드(ask)와 start 는 빠진다.
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled()
    const select = screen.getByRole('combobox', { name: '옮길 노드' })
    const names = Array.from(select.querySelectorAll('option')).map((o) => o.textContent)
    expect(names).toEqual(['노드 고르기', '분류', '검증·PR'])
    await user.selectOptions(select, '분류')
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'MOVE_TO', toNode: 'triage', expectedRevision: 4 }]))
  })

  // 창을 연 뒤 쿼리가 새로 고쳐져 revision 이 바뀌어도 창을 열 때의 revision 으로 보낸다.
  test('revisionFrozenAtOpen_whileQueryRefreshes', async () => {
    let view: object = suspended
    const recovers: Record<string, unknown>[] = []
    let gets = 0
    const { user, queryClient } = renderScreen(card(), {
      handlers: [
        http.get(`${API}/issues/7/workflow`, () => { gets += 1; return HttpResponse.json(view) }),
        http.get(`${API}/projects/9/workflows`, () => HttpResponse.json(enabledList)),
        http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(modelWith(true))),
        http.post(`${API}/issues/7/workflow/recover`, async ({ request }) => {
          recovers.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(view)
        }),
      ],
    })
    await openDialog(user)
    // 서버 쪽 revision 이 5 로 올라가고 쿼리가 새로 읽힌다(창은 그대로).
    view = { ...suspended, revision: 5 }
    const before = gets
    await queryClient.invalidateQueries({ queryKey: ['issue-workflow'] })
    await waitFor(() => expect(gets).toBeGreaterThan(before))
    await user.click(screen.getByRole('radio', { name: '다시 시도' }))
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'RETRY', expectedRevision: 4 }]))
  })

  // STALE 이면 창이 닫히고, 다시 열면 새로 읽은 revision 으로 보낸다.
  test('stale_closesDialog_reopenSendsNewRevision', async () => {
    let view: object = suspended
    let stale = true
    let gets = 0
    const recovers: Record<string, unknown>[] = []
    const { user } = renderScreen(card(), {
      handlers: [
        http.get(`${API}/issues/7/workflow`, () => { gets += 1; return HttpResponse.json(view) }),
        http.get(`${API}/projects/9/workflows`, () => HttpResponse.json(enabledList)),
        http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(modelWith(true))),
        http.post(`${API}/issues/7/workflow/recover`, async ({ request }) => {
          recovers.push((await request.json()) as Record<string, unknown>)
          if (stale) {
            stale = false
            view = { ...suspended, revision: 5 }
            return HttpResponse.json({ errors: { code: 'WORKFLOW_STALE' }, message: 'stale' }, { status: 409 })
          }
          return HttpResponse.json(view)
        }),
      ],
    })
    await openDialog(user)
    await user.click(screen.getByRole('radio', { name: '다시 시도' }))
    await user.click(screen.getByRole('button', { name: '확인' }))
    expect(await screen.findByText('그사이 단계가 바뀌었어요. 새로 불러왔어요.')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // 새 revision(5)을 다시 읽은 뒤 다시 연다.
    await waitFor(() => expect(gets).toBeGreaterThan(1))
    await openDialog(user)
    await user.click(screen.getByRole('radio', { name: '다시 시도' }))
    await user.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(recovers).toEqual([{ action: 'RETRY', expectedRevision: 4 }, { action: 'RETRY', expectedRevision: 5 }]))
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
