// 이슈 상세 「AI 작업 단계」 카드(WP-1989·WP-2160) — 한 단계 한 줄 타임라인(지나옴·지금·남은), 머리 줄 링크, 질문 대기 상자,
// 시작 조건 안내(WP-2120), 켜지지 않은 프로젝트의 숨김. 계산은 lib/issueWorkflowSteps 가 하므로 여기는 화면 결과만 본다.
// 카드와 레일 그룹(IssueWorkflowGroup)만 renderScreen 으로 띄운다 — 이슈 상세 전체는 필요 없다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

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
/** 정의 노드 — 본 흐름·질문 경로에 쓰는 값만 키로 주고, 나머지 필드는 템플릿과 같이 빈 값으로 깐다. */
const defNode = (n: { key: string; name?: string; type?: string; returnTo?: string; outcomes?: { key: string; to: string }[] }) => ({
  use: [], requires: [], outputs: [], conditions: [],
  ...n,
  type: n.type ?? 'task',
  outcomes: (n.outcomes ?? []).map((o) => ({ ...o, requireComment: false })),
})

/**
 * 본 흐름이 서는 정의 모델(WP-2160) — start → 분류 → 이해·설계 → 개발 → (개발 질문 답변으로 갔다가 돌아옴) | 검증·PR → PR 리뷰 → 끝.
 * 실행 픽스처(runningView)는 그대로 두고 정의만 이렇게 서서, 카드가 행 이름·본 흐름·질문 접기를 읽는다.
 * `ask` 는 지금 단계 픽스처(key 'ask')가 읽는 행 이름용 일반 단계 — 질문 경로(returnTo 없음)라 타임라인에 한 줄로 남는다.
 */
const fullModel = {
  schema: 's', roles: [], shared: [], layout: [],
  start: [{ to: 'triage' }],
  nodes: [
    defNode({ key: 'start', name: '시작', type: 'start' }),
    defNode({ key: 'triage', name: '분류', outcomes: [{ key: 'to_design', to: 'design' }] }),
    defNode({ key: 'design', name: '이해·설계', outcomes: [{ key: 'to_dev', to: 'dev' }] }),
    defNode({ key: 'dev', name: '개발', outcomes: [{ key: 'ask', to: 'dev_ask' }, { key: 'next', to: 'verify_pr' }] }),
    defNode({ key: 'dev_ask', name: '개발 질문 답변', type: 'human_task', returnTo: 'dev', outcomes: [{ key: 'answered', to: 'dev' }] }),
    defNode({ key: 'ask', name: '구현 질문 답변' }),
    defNode({ key: 'verify_pr', name: '검증·PR', outcomes: [{ key: 'pass', to: 'review' }] }),
    defNode({ key: 'review', name: 'PR 리뷰', outcomes: [{ key: 'approve', to: 'end' }] }),
    defNode({ key: 'end', name: '끝', type: 'end' }),
  ],
}
const version = { versionNo: 2, sourceYaml: '', model: fullModel }

// 질문 대기 실행 — 사람 차례(WAITING)의 질문 노드(dev_ask, returnTo dev)가 사람 답만 기다린다. 카드는 원래 단계(개발)로 접어 그린다.
const questionWaitingView = {
  ...runningView,
  currentNode: {
    key: 'dev_ask', name: '개발 질문 답변', type: 'human_task', roleKey: null,
    assignees: [user(9, '대표님', 'HUMAN')], enteredAt: ago(10), nodeRunStatus: 'ACTIVE',
    instructions: null, returnTo: 'dev',
  },
  outcomes: [{ key: 'answered', toNode: 'dev', requiredOutputs: [], requireComment: false, assignTo: null, candidateAssignees: [], assigneeRequired: null }],
  path: [
    { key: 'triage', name: '분류', outcome: 'done', actor: user(2, '팀장AI'), enteredAt: ago(300), leftAt: ago(200) },
    { key: 'design', name: '이해·설계', outcome: 'done', actor: user(3, '개발AI-2'), enteredAt: ago(200), leftAt: ago(40) },
    { key: 'dev', name: '개발', outcome: 'ask', actor: user(3, '개발AI-2'), enteredAt: ago(40), leftAt: ago(10) },
  ],
  context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는 얼마로 할까요?\n기본값은 1024 입니다.' }] },
}

// 개발 → 질문 → 답변 → 개발로 돌아온 실행 — 질문 노드 방문은 path 에 남지만 카드엔 「개발」 행 하나로 접힌다(방문 2 → '2번째').
const answeredView = {
  ...runningView,
  currentNode: {
    key: 'dev', name: '개발', type: 'task', roleKey: null,
    assignees: [user(4, '팀원', 'HUMAN')], enteredAt: ago(5), nodeRunStatus: 'ACTIVE', instructions: null,
  },
  path: [
    { key: 'triage', name: '분류', outcome: 'done', actor: user(2, '팀장AI'), enteredAt: ago(300), leftAt: ago(200) },
    { key: 'design', name: '이해·설계', outcome: 'done', actor: user(3, '개발AI-2'), enteredAt: ago(200), leftAt: ago(120) },
    { key: 'dev', name: '개발', outcome: 'ask', actor: user(3, '개발AI-2'), enteredAt: ago(120), leftAt: ago(60) },
    { key: 'dev_ask', name: '개발 질문 답변', outcome: 'answered', actor: user(9, '대표님', 'HUMAN'), enteredAt: ago(60), leftAt: ago(5) },
  ],
  context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는 얼마로 할까요?', answer: '4096 으로 하세요', answeredBy: 9 }] },
}

// 완료 실행 — 본 흐름 전 단계를 지나 끝에 도착했다. 각 행이 ✓ 와 시간 메타를 가진다.
// 서버는 끝난 실행의 currentNode 를 끝 노드로 주고 남은 단계는 비운다(WorkflowRunViews — 리뷰 ② 근거).
const completedView = {
  ...runningView,
  status: 'COMPLETED',
  endedAt: ago(5),
  currentNode: { key: 'end', name: '끝', type: 'end', roleKey: null, assignees: [], enteredAt: ago(5), nodeRunStatus: 'COMPLETED', instructions: null },
  outcomes: [],
  path: [
    { key: 'triage', name: '분류', outcome: 'done', actor: user(2, '팀장AI'), enteredAt: ago(300), leftAt: ago(240) },
    { key: 'design', name: '이해·설계', outcome: 'done', actor: user(3, '개발AI-2'), enteredAt: ago(240), leftAt: ago(180) },
    { key: 'dev', name: '개발', outcome: 'next', actor: user(3, '개발AI-2'), enteredAt: ago(180), leftAt: ago(60) },
    { key: 'verify_pr', name: '검증·PR', outcome: 'pass', actor: user(3, '개발AI-2'), enteredAt: ago(60), leftAt: ago(30) },
    { key: 'review', name: 'PR 리뷰', outcome: 'approve', actor: user(2, '팀장AI'), enteredAt: ago(30), leftAt: ago(5) },
  ],
  remainingNodeKeys: [],
}

/** 실행 상세(시작자·시각) — 카드의 첫 행 시작 메타가 이 요청을 한다. noRun 은 runId 가 없어 요청하지 않는다. */
const runHandler = http.get(`${API}/workflow-runs/5`, () => HttpResponse.json({
  run: { runId: 5, startedBy: user(1, '시작자', 'HUMAN'), startedAt: ago(300), status: 'WAITING' },
  nodeRuns: [], events: [], model: fullModel,
}))

/** 조회 3개 — 이슈 워크플로우·프로젝트 정의·버전. 실행 상세·담당 미리보기 응답은 상황에 맞게 곁들인다. */
function queryHandlers(view: object, list: object = enabledList, versionHandler?: RequestHandler): RequestHandler[] {
  return [
    http.get(`${API}/issues/7/workflow`, () => HttpResponse.json(view)),
    http.get(`${API}/projects/9/workflows`, () => HttpResponse.json(list)),
    versionHandler ?? http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json(version)),
  ]
}

function handlers(view: object, list: object = enabledList, versionHandler?: RequestHandler): RequestHandler[] {
  return [
    ...queryHandlers(view, list, versionHandler),
    runHandler,
    // 담당 미리보기(WP-2120) — 기본은 지금 담당으로는 시작하지 않는 응답.
    http.post(`${API}/issues/7/workflow/assign-preview`, () => HttpResponse.json({ start: null, blocked: null, active: false, startRoles: ['developer'] })),
  ]
}

/** 미리보기 요청 본문을 모으면서 「역할 2개」 응답을 돌려주는 핸들러 — 시작 조건 문구 테스트가 쓴다. */
const collectingPreview = (bodies: unknown[]) =>
  http.post(`${API}/issues/7/workflow/assign-preview`, async ({ request }) => {
    bodies.push(await request.json())
    return HttpResponse.json({ start: null, blocked: null, active: false, startRoles: ['developer', 'reviewer'] })
  })

const card = (props: { canEdit?: boolean; isManager?: boolean; closed?: boolean; assigneeIds?: number[] } = {}) => (
  <IssueWorkflowCard issueId={7} projectKey="WP" projectId={9} issueNumber={7} canEdit={props.canEdit ?? true} isManager={props.isManager ?? false} closed={props.closed} assigneeIds={props.assigneeIds ?? [4]} />
)

describe('AI 작업 단계 카드', () => {
  test('closedIssue_noRun_hidesStartButton', async () => {
    renderScreen(card({ closed: true }), { path: '/projects/WP/issues/1', handlers: handlers(noRun, enabledList) })
    expect(await screen.findByText('아직 워크플로우가 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '워크플로우 시작' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('workflow-start-condition')).not.toBeInTheDocument()
  })

  test('card_showsPassedCurrentRemaining', async () => {
    renderScreen(card(), { path: '/projects/WP/issues/1', handlers: handlers(runningView) })
    // 지나온 단계는 이름 행으로 한 줄씩 — 첫 행은 시작자(실행 상세), 둘째 행은 그 방문의 행위자.
    const triage = (await screen.findByText('분류')).closest('li')
    expect(triage).not.toBeNull()
    await waitFor(() => expect(triage).toHaveTextContent('시작자'))
    const design = (await screen.findByText('이해·설계')).closest('li')
    expect(design).not.toBeNull()
    expect(design).toHaveTextContent('개발AI-2')
    // 지금 단계 이름과 머문 시간(「째」).
    expect(screen.getByText('구현 질문 답변')).toBeInTheDocument()
    expect(screen.getByText(/40분째/)).toBeInTheDocument()
    // 남은 단계는 각각 한 줄씩(옛 「검증·PR → PR 리뷰 → 끝」 한 줄 대신).
    expect(screen.getByText('검증·PR')).toBeInTheDocument()
    expect(screen.getByText('PR 리뷰')).toBeInTheDocument()
    expect(screen.getByText('끝')).toBeInTheDocument()
    expect(screen.getByText('AI 개발 흐름')).toBeInTheDocument()
    expect(screen.getByText('사람 차례')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '자세히 ›' })).toHaveAttribute('href', '/projects/WP/workflow?view=runs&workflow=3&run=5')
  })

  // 디자인 시스템 07 §7.2 — 에이전트 주체는 Bot 아이콘 하나, 글자 배지·이모지로 대체하지 않는다.
  // 시작 행의 주체는 늘 시작자라 실행 상세 startedBy 의 kind 가 실려야 한다(이름·시각만 넘기면 Bot 표식이 사라진다, WP-2160 코드 리뷰).
  test('에이전트 주체는 Bot 아이콘 하나 — 시작 행에 글자 배지 없음', async () => {
    // 시작자만 에이전트로 바꾼 실행 상세 — 나머지 핸들러는 그대로 쓴다(공용 픽스처는 다른 테스트에 그대로 둔다).
    const agentStartRun = http.get(`${API}/workflow-runs/5`, () => HttpResponse.json({
      run: { runId: 5, startedBy: user(1, '시작자AI'), startedAt: ago(300), status: 'WAITING' },
      nodeRuns: [], events: [], model: fullModel,
    }))
    const hs = handlers(runningView).map((h) => (h === runHandler ? agentStartRun : h))
    renderScreen(card(), { path: '/projects/WP/issues/1', handlers: hs })
    const startRow = (await screen.findByText('분류')).closest('li')
    expect(startRow).not.toBeNull()
    // 시작자·시각은 실행 상세 조회에서 온다 — 행 이름은 실행 이름으로도 바로 나오므로(리뷰 ③) 기다려 받아 단언한다.
    // 그 행 안에 Bot 아이콘 하나가 있고(에이전트 시작자), 글자 배지는 없다.
    await waitFor(() => expect(startRow!.querySelector('svg.lucide-bot')).toBeInTheDocument())
    expect(startRow).not.toHaveTextContent('에이전트')
    // 시작자 이름 메타는 그대로 보인다 — 표식이 글자로 바뀐 게 아니라 아이콘이 곁에 붙은 것.
    await waitFor(() => expect(startRow).toHaveTextContent('시작자AI'))
  })

  // 사람 차례 칩은 배너·실행 목록과 같은 경고색이어야 한다(WP-2049) — 예전엔 info 파랑.
  test('statusChip_waitingUsesWarningTone', async () => {
    renderScreen(card(), { path: '/projects/WP/issues/1', handlers: handlers(runningView) })
    const chip = await screen.findByText('사람 차례')
    expect(chip).toHaveClass('bg-warning-subtle', 'text-warning-text')
    expect(chip).not.toHaveClass('text-info-text')
  })

  test('enteredAtSecondsAgo_showsJustNowWithoutSuffix', async () => {
    const view = { ...runningView, currentNode: { ...runningView.currentNode, enteredAt: new Date(Date.now() - 5000).toISOString() } }
    renderScreen(card(), { handlers: handlers(view) })
    expect(await screen.findByText(/방금/)).toHaveTextContent(/방금$/)
    expect(screen.queryByText(/방금째/)).not.toBeInTheDocument()
  })

  // 리뷰 ④ — 실행이 막 시작돼 첫 줄이 지금 단계이면 메타가 「시작 n분째」 — 시작 표식이 없으면
  // 첫 줄이 지금 단계인지 지난 줄인지 읽히지 않는다. 이때 담당 이름은 시작 표식 자리에 함께 두지 않는다(표식이 목적이므로).
  test('card_firstRowCurrent_startElapsedMeta_noAssigneeNames', async () => {
    const view = {
      ...runningView,
      currentNode: {
        key: 'triage', name: '분류', type: 'task', roleKey: null,
        assignees: [user(2, '팀장AI')], enteredAt: ago(5), nodeRunStatus: 'ACTIVE', instructions: null,
      },
      path: [],
      remainingNodeKeys: ['design', 'dev', 'verify_pr', 'review', 'end'],
    }
    renderScreen(card(), { handlers: handlers(view) })
    const row = (await screen.findByText('분류')).closest('li')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent(/시작 5분째/)
    expect(row).not.toHaveTextContent('팀장AI')
  })

  // 리뷰 ④ 둘째 갈래 — 시작자를 아직 못 읽을 때(실행 상세 조회 실패) 첫 줄 메타는 「시작 HH:MM」뿐이다 —
  // 시간만으로도 첫 줄임이 읽히고, 담당 이름은 시작 표식 자리에 함께 두지 않는다.
  test('card_startRow_withoutRunDetail_startClockOnly', async () => {
    renderScreen(card(), {
      handlers: [
        ...queryHandlers(runningView),
        http.post(`${API}/issues/7/workflow/assign-preview`, () => HttpResponse.json({ start: null, blocked: null, active: false, startRoles: ['developer'] })),
        http.get(`${API}/workflow-runs/5`, () => HttpResponse.json({ message: 'x' }, { status: 500 })),
      ],
    })
    const row = (await screen.findByText('분류')).closest('li')
    expect(row).not.toBeNull()
    const meta = () => row!.querySelector('div.text-xs')
    await waitFor(() => expect(meta()?.textContent ?? '').toMatch(/^시작 \d{2}:\d{2}$/))
    expect(meta()?.textContent ?? '').not.toContain('시작자')
  })

  // 서버 실제 계약 — path 첫 방문은 시작 노드다(WorkflowRunApiTest: path[0] = 'start').
  // 시작 노드가 첫 줄이 되어 시작자·시각을 지니고, 지금 단계는 그 뒤 줄이라 시작 표식(「시작 n분째」)은 붙지 않는다.
  test('card_productionPath_startVisitFirst_startMetaOnRow0', async () => {
    const view = {
      ...runningView,
      path: [
        { key: 'start', name: '시작', outcome: 'go', actor: null, enteredAt: ago(300), leftAt: ago(300) },
        ...runningView.path,
      ],
    }
    renderScreen(card(), { handlers: handlers(view) })
    const startRow = (await screen.findByText('시작')).closest('li')
    expect(startRow).not.toBeNull()
    await waitFor(() => expect(startRow).toHaveTextContent('시작자'))
    expect(startRow).toHaveTextContent(/\d{2}:\d{2}/)
    // 지금 단계(구현 질문 답변)는 첫 줄이 아니므로 시작 표식 없이 담당 · 머문 시간이다.
    const current = screen.getByText('구현 질문 답변').closest('li')
    expect(current).toHaveTextContent(/40분째/)
    expect(current).not.toHaveTextContent(/시작 40분째/)
  })

  test('workflowCard_noRun_showsStartCondition_noStartButton', async () => {
    const bodies: unknown[] = []
    renderScreen(card({ assigneeIds: [9, 4] }), { handlers: [...queryHandlers(noRun), collectingPreview(bodies)] })
    expect(await screen.findByText('아직 워크플로우가 없어요.')).toBeInTheDocument()
    expect(await screen.findByText('이 담당으로는 시작하지 않아요 · 시작 조건: developer, reviewer 역할')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '워크플로우 시작' })).not.toBeInTheDocument()
    // 카드는 지금 담당 기준(current)·정렬한 id 로 묻는다(WP-2120 코드 리뷰).
    expect(bodies).toEqual([{ userIds: [4, 9], current: true }])
  })

  test('workflowCard_manager_showsOpenWorkflowLink', async () => {
    renderScreen(card({ isManager: true }), { handlers: handlers(noRun) })
    expect(await screen.findByRole('link', { name: '워크플로우 열기' })).toHaveAttribute('href', '/projects/WP/workflow')
  })

  test('workflowCard_nonManager_noOpenWorkflowLink', async () => {
    renderScreen(card(), { handlers: handlers(noRun) })
    await screen.findByText('이 담당으로는 시작하지 않아요 · 시작 조건: developer 역할')
    expect(screen.queryByRole('link', { name: '워크플로우 열기' })).not.toBeInTheDocument()
  })

  test('workflowCard_noAssignees_showsAssignHintWithStartRoles', async () => {
    // 리뷰 후속(PR #1861) — 담당이 없어도 시작 조건 역할을 붙여 누구를 넣어야 시작되는지 알린다. 역할은 빈 담당 미리보기로 받는다.
    const bodies: unknown[] = []
    renderScreen(card({ assigneeIds: [] }), { handlers: [...queryHandlers(noRun), collectingPreview(bodies)] })
    expect(await screen.findByText('담당을 지정하면 워크플로우가 시작돼요 · 시작 조건: developer, reviewer 역할')).toBeInTheDocument()
    expect(bodies).toEqual([{ userIds: [], current: true }])
  })

  test('workflowCard_noAssignees_previewFails_showsBaseHint', async () => {
    // 미리보기가 실패해도(5xx) 역할 없이 기본 안내는 보인다.
    renderScreen(card({ assigneeIds: [] }), {
      handlers: [
        ...queryHandlers(noRun),
        http.post(`${API}/issues/7/workflow/assign-preview`, () => HttpResponse.json({ message: 'x' }, { status: 500 })),
      ],
    })
    expect(await screen.findByText('담당을 지정하면 워크플로우가 시작돼요')).toBeInTheDocument()
  })

  test('workflowCard_wouldStartNow_noConditionLine', async () => {
    renderScreen(card(), {
      handlers: [
        ...queryHandlers(noRun),
        http.post(`${API}/issues/7/workflow/assign-preview`, () => HttpResponse.json({ start: { workflowId: 3, workflowName: 'AI 개발 흐름', stageName: '개발' }, blocked: null, active: false, startRoles: ['developer'] })),
      ],
    })
    await screen.findByText('아직 워크플로우가 없어요.')
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByTestId('workflow-start-condition')).not.toBeInTheDocument()
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
        <IssueWorkflowGroup issueId={7} projectKey="WP" projectId={9} issueNumber={7} canEdit isManager={false} assigneeIds={[]} />
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
      <IssueWorkflowGroup issueId={7} projectKey="WP" projectId={9} issueNumber={7} canEdit isManager={false} assigneeIds={[]} />,
      { handlers: handlers(noRun) },
    )
    expect(await screen.findByText('AI 작업 단계')).toBeInTheDocument()
    expect(await screen.findByTestId('issue-workflow-card')).toBeInTheDocument()
  })

  test('workflowCard_endedRun_noStartButton', async () => {
    renderScreen(card(), {
      handlers: handlers({ ...runningView, status: 'COMPLETED', currentNode: null, outcomes: [], remainingNodeKeys: [] }),
    })
    expect(await screen.findByText('완료')).toBeInTheDocument()
    expect(await screen.findByText('분류')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '워크플로우 시작' })).not.toBeInTheDocument()
    expect(await screen.findByText(/이 담당으로는 시작하지 않아요/)).toBeInTheDocument()
  })

  test('remaining_fallsBackToKeys', async () => {
    renderScreen(card(), {
      handlers: handlers(runningView, enabledList, http.get(`${API}/workflows/3/versions/2`, () => HttpResponse.json({}, { status: 404 }))),
    })
    // 정의를 못 읽으면 남은 단계 이름 대신 키 그대로 한 줄씩 보인다.
    expect(await screen.findByText('verify_pr')).toBeInTheDocument()
    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.getByText('end')).toBeInTheDocument()
  })

  // 개발 → 질문 → 답변 → 개발으로 돌아온 실행: 「개발」 행은 하나뿐이고 그 행에 다시 온 표식과 답변 수가 보인다.
  test('card_devRowOnlyOnce_withRepeatAndAnsweredCount', async () => {
    renderScreen(card(), { handlers: handlers(answeredView) })
    const devRows = await screen.findAllByText('개발')
    expect(devRows).toHaveLength(1)
    const row = devRows[0].closest('li')
    expect(row).not.toBeNull()
    expect(row).toHaveTextContent('2번째')
    expect(row).toHaveTextContent('질문 1건 · 답변함')
  })

  // 질문 대기 실행: 개발 행의 점은 warning 색이고 메타에 「질문 대기」, 그 아래 질문 첫 줄과 이슈 챗 링크가 보인다.
  test('card_questionWaiting_warningRowAndChatBox', async () => {
    renderScreen(card(), { handlers: handlers(questionWaitingView) })
    const meta = await screen.findByText(/질문 대기/)
    expect(meta).toHaveClass('text-warning-text')
    const row = meta.closest('li')
    expect(row).not.toBeNull()
    expect(row!.querySelector('.bg-warning')).toBeInTheDocument()
    expect(row).toHaveTextContent('최대 크기는 얼마로 할까요?')
    expect(within(row!).getByRole('link', { name: '챗에서 답하기' })).toHaveAttribute('href', '/projects/WP/issues/7?chat=1')
  })

  // 질문 대기가 아니어도(질문 노드 결과에 answered 가 아닌 것이 섞임) — 칩은 그대로 사람 차례이고,
  // 질문 노드는 원래 단계로 접혀 「개발」 행이 지금 단계로 남아야 한다. 「질문 대기」 메타·챗 상자·질문 노드 행은 나오지 않는다.
  test('card_askWaitingFalse_devRowStillCurrent_noAskMeta', async () => {
    const view = {
      ...questionWaitingView,
      outcomes: [
        ...questionWaitingView.outcomes,
        { key: 'skip', toNode: 'dev', requiredOutputs: [], requireComment: false, assignTo: null, candidateAssignees: [], assigneeRequired: null },
      ],
    }
    renderScreen(card(), { handlers: handlers(view) })
    expect(await screen.findByText('사람 차례')).toBeInTheDocument()
    const dev = (await screen.findByText('개발')).closest('li')
    expect(dev).not.toBeNull()
    // 지금 단계 표식 — 지난 줄의 ✓ 대신 warning 색 점과 머문 시간(「째」)이 그 행에 남는다.
    expect(dev!.querySelector('.text-success')).toBeNull()
    expect(dev!.querySelector('.bg-warning')).toBeInTheDocument()
    expect(dev).toHaveTextContent(/째/)
    expect(screen.queryByText('질문 대기')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '챗에서 답하기' })).not.toBeInTheDocument()
    expect(screen.queryByText('개발 질문 답변')).not.toBeInTheDocument()
  })

  // 완료 실행: 본 흐름 전 행이 ✓(success)와 시간 메타를 갖고, 끝 행 메타에 도착 시각(HH:MM)이 있다.
  test('card_completed_allChecksWithTimes', async () => {
    renderScreen(card(), { handlers: handlers(completedView) })
    for (const name of ['분류', '이해·설계', '개발', '검증·PR', 'PR 리뷰', '끝']) {
      const row = (await screen.findByText(name)).closest('li')
      expect(row).not.toBeNull()
      expect(row!.querySelector('.text-success')).toBeInTheDocument()
      const meta = row!.querySelector('div.text-xs')
      expect(meta?.textContent ?? '').toMatch(/\d{2}:\d{2}|\d+분|\d+시간/)
    }
    const endRow = (await screen.findByText('끝')).closest('li')
    expect(endRow).toHaveTextContent(/도착 \d{2}:\d{2}/)
  })

  // 머리 줄 — 정의 이름·상태 칩·상세 링크(↗ 와 버전 표기 없음).
  test('card_header_detailLink_noArrow_noVersion', async () => {
    renderScreen(card(), { handlers: handlers(runningView) })
    expect(await screen.findByText('AI 개발 흐름')).toBeInTheDocument()
    expect(screen.getByText('사람 차례')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '자세히 ›' })).toHaveAttribute('href', '/projects/WP/workflow?view=runs&workflow=3&run=5')
    expect(screen.queryByText(/실행 보기/)).not.toBeInTheDocument()
    expect(screen.queryByText(/↗/)).not.toBeInTheDocument()
    expect(screen.queryByText(/v\d+/)).not.toBeInTheDocument()
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
    await screen.findByText('구현 질문 답변')
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
        // 카드의 실행 상세 조회(시작자·시각) — 빠뜨리면 핸들러 없는 요청으로 테스트가 깨진다.
        runHandler,
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
        // 카드의 실행 상세 조회(시작자·시각) — 빠뜨리면 핸들러 없는 요청으로 테스트가 깨진다.
        runHandler,
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
    await screen.findByText('구현 질문 답변')
    expect(screen.queryByRole('button', { name: '조치' })).not.toBeInTheDocument()
  })

  test('suspended_withoutEditPermission_hasNoMenu', async () => {
    setup(suspended, { canEdit: false })
    await screen.findByText('구현 질문 답변')
    expect(screen.queryByRole('button', { name: '조치' })).not.toBeInTheDocument()
  })
})
