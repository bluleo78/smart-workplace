// AI 작업 단계 카드의 단계 목록 순수 함수(WP-2160) — 서버가 준 남은 단계·방문 순서·질문 묶기·다시 들어온 단계 표식·시각 메타를 검증한다.
// 픽스처 헬퍼는 이 파일 안에 둔다 — 서버 view(방문은 지금 노드 제외)·정의 모델의 모양을 최소한으로 만든다.
import { expect, test } from 'vitest'

import { buildWorkflowStepRows, durationLabel } from './issueWorkflowSteps'
import type { IssueWorkflowView, WorkflowNodeView, WorkflowPathStep } from './workflow'
import type { WorkflowModel, WorkflowModelNode } from './workflows'

/** 실행 view 칸 — buildWorkflowStepRows 가 받는 Pick 그대로에 기본값을 깐다. */
type StepView = Pick<IssueWorkflowView, 'path' | 'currentNode' | 'status' | 'endedAt' | 'context' | 'remainingNodeKeys'>

const viewOf = (v: Partial<StepView> = {}): StepView => ({
  path: [],
  currentNode: null,
  status: 'RUNNING',
  endedAt: null,
  context: {},
  remainingNodeKeys: [],
  ...v,
})

/** 지금 노드 — type·returnTo 등은 테스트가 준 값으로 바꾼다. */
const curNode = (key: string, extra: Partial<WorkflowNodeView> = {}): WorkflowNodeView => ({
  key,
  name: null,
  type: 'task',
  roleKey: null,
  assignees: [],
  enteredAt: '2026-11-27T01:00:00Z',
  nodeRunStatus: 'ACTIVE',
  instructions: null,
  ...extra,
})

/** path 방문 기록 — 서버처럼 지금 노드의 방문은 여기에 넣지 않는다. name 은 리뷰 ③ 이름 대체용으로만 준다. */
const step = (key: string, enteredAt: string, leftAt: string, name: string | null = null): WorkflowPathStep => ({
  key,
  name,
  outcome: null,
  actor: null,
  enteredAt,
  leftAt,
})

/** 정의 노드 — 본 흐름과 무관한 값은 기본값으로 비운다. */
const node = (key: string, extra: Partial<WorkflowModelNode> = {}): WorkflowModelNode => ({
  key,
  type: 'task',
  use: [],
  requires: [],
  outputs: [],
  outcomes: [],
  conditions: [],
  ...extra,
})

/** 정의 모델 — start 조건(본 흐름 출발 조건)만 따로 준다. */
const modelOf = (nodes: WorkflowModelNode[], start: { to: string }[] = []): WorkflowModel => ({
  schema: 'v1',
  roles: [],
  shared: [],
  nodes,
  start,
  layout: [],
})

// 1·4·5·7 번용: start → dev → (dev_ask 질문 경로 | review) → end — dev → review 본 흐름에 질문 경로가 섞이지 않는다.
const askModel = modelOf(
  [
    node('start', { type: 'start' }),
    node('dev', {
      name: '개발',
      outcomes: [
        { key: 'ask', to: 'dev_ask', requireComment: false },
        { key: 'next', to: 'review', requireComment: false },
      ],
    }),
    node('dev_ask', {
      type: 'human_task',
      name: '개발 질문 답변',
      returnTo: 'dev',
      outcomes: [{ key: 'answered', to: 'dev', requireComment: false }],
    }),
    node('review', { name: '리뷰', outcomes: [{ key: 'done', to: 'end', requireComment: false }] }),
    node('end', { type: 'end', name: '끝' }),
  ],
  [{ to: 'dev' }],
)

// 2·3·6 번용: start → triage → design → dev → (dev_ask | verify_pr) → review → end,
// dev 에서 conditions 로만 닿는 분기 X(죽은 끝) — 방문 순서·남은 흐름·분기 제외를 함께 검증한다.
const flowModel = modelOf(
  [
    node('start', { type: 'start' }),
    node('triage', { name: '분류', outcomes: [{ key: 'to_design', to: 'design', requireComment: false }] }),
    node('design', { name: '설계', outcomes: [{ key: 'to_dev', to: 'dev', requireComment: false }] }),
    node('dev', {
      name: '개발',
      outcomes: [
        { key: 'ask', to: 'dev_ask', requireComment: false },
        { key: 'next', to: 'verify_pr', requireComment: false },
      ],
      conditions: [{ to: 'X' }],
    }),
    node('dev_ask', {
      type: 'human_task',
      name: '개발 질문 답변',
      returnTo: 'dev',
      outcomes: [{ key: 'answered', to: 'dev', requireComment: false }],
    }),
    node('verify_pr', { name: '검증·PR', outcomes: [{ key: 'pass', to: 'review', requireComment: false }] }),
    node('review', { name: '리뷰', outcomes: [{ key: 'approve', to: 'end', requireComment: false }] }),
    node('end', { type: 'end', name: '끝' }),
    node('X', { name: '분기 X' }),
  ],
  [{ to: 'triage' }],
)

/** 테스트용 KST 고정 시각 — 로컬 타임존에 흔들리지 않게 Asia/Seoul 로 계산한 HH:MM(ko-KR 기본은 h12라 h23 고정). */
const kstClock = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

// 2) path [triage, design] + 지금 dev + 서버가 준 남은 단계 → 방문 먼저, 남은 단계는 서버 순서(지금 노드 기준)
test('rows_visitOrderThenRemainingFlow', () => {
  const model = flowModel
  const view = viewOf({
    currentNode: curNode('dev'),
    path: [step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'), step('design', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z')],
    // 서버 WorkflowRunViews.remaining — 지금 노드(dev) 기준 남은 본 흐름(끝 포함).
    remainingNodeKeys: ['verify_pr', 'review', 'end'],
  })
  expect(buildWorkflowStepRows(view, model).map((r) => r.key)).toEqual(['triage', 'design', 'dev', 'verify_pr', 'review', 'end'])
})

// 2-1) 남은 단계는 서버 remainingNodeKeys 만 쓴다(리뷰 ①) — 본 흐름 전체를 다시 그리지 않는다.
//     분기로 나간 실행(지금 노드가 본 흐름 밖)에 안 갈 단계가 남은 단계로 보이지 않는 것이 목적.
test('rows_remainingComesFromServerKeys_notWholeMainFlow', () => {
  const model = flowModel
  const view = viewOf({
    // 지금 노드가 분기 X — 본 흐름(start→triage→…→end)은 닿지 않는 자리다.
    currentNode: curNode('X'),
    path: [step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'), step('design', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z')],
    remainingNodeKeys: [],
  })
  const rows = buildWorkflowStepRows(view, model).map((r) => r.key)
  expect(rows).toEqual(['triage', 'design', 'X'])
  // 남은 단계로 딸라오지 않는다 — 서버가 비워 둔 자리에 본 흐름을 끼워 넣지 않는다.
  expect(rows).not.toContain('review')
  expect(rows).not.toContain('end')
})

// 3) design 방문 2번 + 지금 design → repeat '2번째', 지난 dev 방문 2번 → '2번', 1번 → null
test('rows_repeatMarker_secondVisitCurrent_andLastAfterPassed', () => {
  const model = flowModel
  // 순서: 분류 → 개발 → 설계 → 개발 → 설계(지금) — dev 는 path 2번, design 은 path 1번 + 지금 = 2번.
  const view = viewOf({
    currentNode: curNode('design'),
    path: [
      step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'),
      step('dev', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z'),
      step('design', '2026-11-27T01:00:00Z', '2026-11-27T01:30:00Z'),
      step('dev', '2026-11-27T01:30:00Z', '2026-11-27T02:00:00Z'),
    ],
  })
  const rows = buildWorkflowStepRows(view, model)
  expect(rows.find((r) => r.key === 'design')!.repeat).toBe('2번째')
  expect(rows.find((r) => r.key === 'design')!.visits).toBe(2)
  expect(rows.find((r) => r.key === 'dev')!.repeat).toBe('2번')
  expect(rows.find((r) => r.key === 'dev')!.visits).toBe(2)
  expect(rows.find((r) => r.key === 'triage')!.repeat).toBe(null)
  expect(rows.find((r) => r.key === 'triage')!.visits).toBe(1)
})

// 4) 지금 dev_ask(returnTo 'dev', type human_task, status WAITING, 결과 answered 만)
test('rows_questionWaiting_foldsIntoOriginalRow', () => {
  const model = askModel
  const waitingView = viewOf({
    status: 'WAITING',
    currentNode: curNode('dev_ask', { type: 'human_task', returnTo: 'dev', enteredAt: '2026-11-27T02:00:00Z' }),
    path: [step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z')],
    context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는 얼마로 할까요?\n기본값은 1024 입니다.' }] },
  })
  const rows = buildWorkflowStepRows(waitingView, model)
  const dev = rows.find((r) => r.key === 'dev')!
  expect(dev.state).toBe('current')
  expect(dev.questionWaiting).toBe(true)
  expect(dev.questionFirstLine).toBe('최대 크기는 얼마로 할까요?')
  expect(rows.some((r) => r.key === 'dev_ask')).toBe(false) // 질문 노드는 줄을 만들지 않는다
})

// 5) path 에 dev_ask 방문 + context._qa answer 있음 → dev 행 questionAnswered 1
test('rows_questionAnswered_countOnOriginalRow', () => {
  const model = askModel
  const view = viewOf({
    currentNode: curNode('dev', { enteredAt: '2026-11-27T03:00:00Z' }),
    path: [step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z'), step('dev_ask', '2026-11-27T02:00:00Z', '2026-11-27T03:00:00Z')],
    context: {
      _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는 얼마로 할까요?', answer: '4096 으로 하세요', answeredBy: 7 }],
    },
  })
  const rows = buildWorkflowStepRows(view, model)
  expect(rows.find((r) => r.key === 'dev')!.questionAnswered).toBe(1)
  expect(rows.some((r) => r.key === 'dev_ask')).toBe(false) // 질문 노드 방문은 줄이 아니라 답변 수로만 남는다
})

// 6) 분기 노드 X(conditions 로만 닿음) — 남은 단계(서버)에 없고 방문도 없음 → 행 없음
test('rows_excludesNeverVisitedBranchNode', () => {
  const model = flowModel
  const view = viewOf({
    currentNode: curNode('dev'),
    path: [step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'), step('design', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z')],
    remainingNodeKeys: ['verify_pr', 'review', 'end'],
  })
  const rows = buildWorkflowStepRows(view, model)
  expect(rows.map((r) => r.key)).not.toContain('X')
  expect(model.nodes.some((n) => n.key === 'X')).toBe(true) // X 는 정의에 실제로 있다
})

// 7) status COMPLETED, endedAt '…T14:32:00Z' → 전 행 passed, 끝 행 timeLabel '23:32'(KST)
test('rows_ended_allPassed_andArrivalTime', () => {
  const model = askModel
  const view = viewOf({
    status: 'COMPLETED',
    endedAt: '2026-11-27T14:32:00Z',
    currentNode: curNode('end', { type: 'end', nodeRunStatus: 'COMPLETED' }),
    path: [step('dev', '2026-11-27T10:00:00Z', '2026-11-27T11:00:00Z'), step('review', '2026-11-27T11:00:00Z', '2026-11-27T12:00:00Z')],
  })
  const rows = buildWorkflowStepRows(view, model)
  expect(rows.every((r) => r.state === 'passed')).toBe(true)
  expect(kstClock('2026-11-27T14:32:00Z')).toBe('23:32')
  expect(rows.find((r) => r.key === 'end')!.timeLabel).toBe(kstClock('2026-11-27T14:32:00Z'))
})

// 8) 정의에서 start·end 노드가 없을 때 → path 고유 키 + 지금 키 + 서버가 준 남은 단계(본 흐름 재계산 없음)
test('rows_emptyModel_fallsBackToPathAndRemaining', () => {
  const model = modelOf([node('a'), node('b'), node('c'), node('d')], [{ to: 'a' }])
  const view = viewOf({
    currentNode: curNode('c'),
    path: [step('a', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'), step('b', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z')],
    remainingNodeKeys: ['d'],
  })
  expect(buildWorkflowStepRows(view, model).map((r) => r.key)).toEqual(['a', 'b', 'c', 'd'])
})

// 10) 질문 대기 접힘 칸은 path 에 원래 단계 방문이 남아 +1 하지 않는다 — visits 1·repeat null,
//     반면 질문이 아닌 지금 단계는 path 가 지금 방문을 빼므로 기존대로 2번째 유지.
test('rows_questionWaiting_noDoubleCountRepeat', () => {
  const model = askModel
  const waitingView = viewOf({
    status: 'WAITING',
    currentNode: curNode('dev_ask', { type: 'human_task', returnTo: 'dev', enteredAt: '2026-11-27T02:00:00Z' }),
    path: [step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z')],
    context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는 얼마로 할까요?' }] },
  })
  const folded = buildWorkflowStepRows(waitingView, model).find((r) => r.key === 'dev')!
  expect(folded.visits).toBe(1)
  expect(folded.repeat).toBe(null)
  expect(folded.state).toBe('current')
  expect(folded.questionWaiting).toBe(true)

  // 질문이 아닌 일반 지금 단계: path 에 dev 1번 + 지금 dev 자체 → 여전히 2번째
  const normalView = viewOf({
    currentNode: curNode('dev', { enteredAt: '2026-11-27T03:00:00Z' }),
    path: [step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z')],
  })
  const normal = buildWorkflowStepRows(normalView, model).find((r) => r.key === 'dev')!
  expect(normal.visits).toBe(2)
  expect(normal.repeat).toBe('2번째')
})

// 11) status CANCELED + endedAt(서버는 취소에도 endedAt 을 넣는다) — 취소 ≠ 완료: 서버는 끝난 실행의 남은 단계를 비워 주므로
//     남은 단계 줄 자체가 없다(WorkflowRunViews.build — isActive 일 때만 remaining). 도달한 줄(triage·design·dev)만 ✓,
//     지금 표식 없음, 끝 행 없음(끝까지 안 간 실행에 「도착」을 붙이면 거짓이다).
test('rows_canceledPartialPath_reachedPassed_noRemainingRows_noArrival', () => {
  const model = flowModel
  const view = viewOf({
    status: 'CANCELED',
    endedAt: '2026-11-27T14:32:00Z',
    currentNode: curNode('dev'),
    path: [step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'), step('design', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z')],
    // 서버 WorkflowRunViews — 끝난 실행은 remaining 비어 있음(WorkflowRunApiTest 의 completed run 단언과 같은 계약).
    remainingNodeKeys: [],
  })
  const rows = buildWorkflowStepRows(view, model)
  const byKey = (k: string) => rows.find((r) => r.key === k)!
  expect(rows.map((r) => r.key)).toEqual(['triage', 'design', 'dev'])
  expect(byKey('triage').state).toBe('passed')
  expect(byKey('design').state).toBe('passed')
  expect(byKey('dev').state).toBe('passed')
  expect(rows.some((r) => r.state === 'current')).toBe(false)
  expect(rows.some((r) => r.key === 'end')).toBe(false) // 도착하지 않은 끝 행을 만들지 않는다
})

// 11-1) 리뷰 ② — 완료 실행에서도 방문하지 않은 남은 단계는 ✓ 가 아니다(정의의 본 흐름을 완료로 밀어 넣으면
//      전부 ✓ 가 되는 것을 막는다). 남은 단계에 path 에 없는 키를 넣어 방문 여부로만 갈리는 것을 못박는다.
test('rows_completed_unvisitedRemainingRow_staysRemaining', () => {
  const model = flowModel
  const view = viewOf({
    status: 'COMPLETED',
    endedAt: '2026-11-27T14:32:00Z',
    currentNode: curNode('end', { type: 'end', nodeRunStatus: 'COMPLETED' }),
    path: [step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'), step('design', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z')],
    remainingNodeKeys: ['verify_pr'], // path 에 없다 — 가지 않은 단계
  })
  const rows = buildWorkflowStepRows(view, model)
  expect(rows.find((r) => r.key === 'verify_pr')!.state).toBe('remaining') // 완료라도 방문 없음 → ✓ 아님
  expect(rows.find((r) => r.key === 'triage')!.state).toBe('passed')
  expect(rows.find((r) => r.key === 'end')!.state).toBe('passed')
  expect(rows.some((r) => r.state === 'current')).toBe(false)
})

// 11-2) 정의 없음(버전 404) + 완료 — 지금 노드 type 이 end 라도 끝 행에 도착 시각이 남는다(완료 기준 3 · 리뷰 ③ 자리).
test('rows_completed_model404_endRowStillHasArrivalTime', () => {
  const view = viewOf({
    status: 'COMPLETED',
    endedAt: '2026-11-27T14:32:00Z',
    currentNode: curNode('end', { type: 'end', nodeRunStatus: 'COMPLETED', name: '끝' }),
    path: [step('dev', '2026-11-27T10:00:00Z', '2026-11-27T11:00:00Z', '개발'), step('review', '2026-11-27T11:00:00Z', '2026-11-27T12:00:00Z', '리뷰')],
    remainingNodeKeys: [],
  })
  // 정의 없음 — model undefined
  const rows = buildWorkflowStepRows(view, undefined)
  const end = rows.find((r) => r.key === 'end')!
  expect(end.isEnd).toBe(true)
  expect(end.timeLabel).toBe(kstClock('2026-11-27T14:32:00Z'))
  expect(end.name).toBe('끝') // 실행 이름으로 떨어진다(리뷰 ③)
})

// 11-2) 이름 대체(리뷰 ③) — 정의에 name 이 없어도(버전 로딩·실패) 실행이 준 이름으로, 그것도 없으면 키.
//       정의 이름이 있으면 실행 이름보다 먼저다(둘 다 다르면 정의가 이긴다).
test('rows_name_fallsBackToRunName_thenKey', () => {
  const model = modelOf([node('a'), node('b'), node('c'), node('d', { name: '정의 이름' })], [{ to: 'a' }])
  const view = viewOf({
    currentNode: curNode('c', { name: '설계' }),
    path: [
      step('a', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z', '분류'),
      step('b', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z', null),
      step('d', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z', '실행 이름'),
    ],
    remainingNodeKeys: [],
  })
  const rows = buildWorkflowStepRows(view, model)
  const nameOf = (k: string) => rows.find((r) => r.key === k)!.name
  expect(nameOf('a')).toBe('분류') // 방문 기록의 실행 이름
  expect(nameOf('b')).toBe('b') // 실행 이름도 없으면 키
  expect(nameOf('c')).toBe('설계') // 지금 노드의 실행 이름
  expect(nameOf('d')).toBe('정의 이름') // 정의 이름이 실행 이름보다 먼저
})

// 12) 질문 노드가 지금인데 askWaiting: false — 접기는 질문 대기와 무관하게 유지돼야 한다:
//     returnTo 행이 current 이고(사람 차례/조치 필요 칩과 행이 어긋나지 않는다), 질문 대기 꾸밈은 꺼지고,
//     visits 는 _ask 키 기준이라 접힌 칸에 중복 +1 이 없고 _ask 행 자체는 없다.
test('rows_askWaitingFalse_foldsQuestionNodeToCurrentRow', () => {
  const model = askModel
  const view = viewOf({
    status: 'WAITING',
    currentNode: curNode('dev_ask', { type: 'human_task', returnTo: 'dev', enteredAt: '2026-11-27T02:00:00Z' }),
    path: [step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z')],
    context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는 얼마로 할까요?' }] },
  })
  const rows = buildWorkflowStepRows(view, model, { askWaiting: false })
  const dev = rows.find((r) => r.key === 'dev')
  expect(dev).toBeDefined()
  expect(dev!.state).toBe('current')
  expect(dev!.questionWaiting).toBe(false)
  expect(dev!.visits).toBe(1)
  expect(dev!.repeat).toBe(null)
  expect(rows.some((r) => r.key === 'dev_ask')).toBe(false)
})

// 13) 서버 실제 계약 — path 의 첫 방문은 시작 노드다(WorkflowRunApiTest: path[0].key = 'start').
//     시작 노드도 한 줄로 남고(첫 행 = 시작 정보), 지금 단계는 그 뒤 줄이므로 시작 표식은 첫 줄에만 붙는다.
test('rows_productionPath_startVisitFirst_currentComesAfter', () => {
  const model = flowModel
  const view = viewOf({
    currentNode: curNode('triage'),
    path: [step('start', '2026-11-27T00:00:00Z', '2026-11-27T00:00:01Z', '시작')],
    remainingNodeKeys: ['design', 'dev', 'verify_pr', 'review', 'end'],
  })
  const rows = buildWorkflowStepRows(view, model)
  expect(rows.map((r) => r.key)).toEqual(['start', 'triage', 'design', 'dev', 'verify_pr', 'review', 'end'])
  expect(rows[0].isStart).toBe(true)
  expect(rows[0].state).toBe('passed') // 시작 노드는 자동으로 지나간다 — 지금일 수 없다
  expect(rows[1].state).toBe('current')
})

// 14) 리뷰 후속 ① — 되돌린 실행: path 에 이미 방문한 단계도 서버가 남은 단계로 주면 ✓ 가 아니라 남음이다.
//     남은 단계 키를 방문 자리에서 빼 뒤로 미루므로 지금 행이 남은 단계보다 앞에 온다(지금 행 순서).
test('rows_rollback_visitedStepIsRemaining_notPassed', () => {
  const model = flowModel
  const view = viewOf({
    currentNode: curNode('design'),
    path: [
      step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'),
      step('design', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z'),
      step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z'),
    ],
    // 서버는 지금 노드(design) 기준 남은 본 흐름 — 이미 지나온 dev 도 다시 남은 단계다(WorkflowRunViews.remaining).
    remainingNodeKeys: ['dev', 'verify_pr', 'review', 'end'],
  })
  const rows = buildWorkflowStepRows(view, model)
  const keys = rows.map((r) => r.key)
  const byKey = (k: string) => rows.find((r) => r.key === k)!
  expect(keys).toEqual(['triage', 'design', 'dev', 'verify_pr', 'review', 'end'])
  expect(byKey('design').state).toBe('current')
  expect(byKey('dev').state).toBe('remaining') // 되돌아온 뒤 dev 는 다시 남은 단계 — 방문했더라도 ✓ 가 아니다
  expect(byKey('triage').state).toBe('passed')
  expect(byKey('verify_pr').state).toBe('remaining')
  // 지금 행이 남은 단계보다 앞에 온다.
  expect(keys.indexOf('design')).toBeLessThan(keys.indexOf('dev'))

  // 남은 단계 키에 path 앞쪽 키가 들어와도(돌아가는 흐름) 지금 행 뒤로 밀린다 — 지금 행 순서.
  const looped = viewOf({
    currentNode: curNode('dev'),
    path: [
      step('triage', '2026-11-27T00:00:00Z', '2026-11-27T00:30:00Z'),
      step('design', '2026-11-27T00:30:00Z', '2026-11-27T01:00:00Z'),
      step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z'),
    ],
    remainingNodeKeys: ['design', 'verify_pr', 'review', 'end'],
  })
  const loopedKeys = buildWorkflowStepRows(looped, model).map((r) => r.key)
  expect(loopedKeys).toEqual(['triage', 'dev', 'design', 'verify_pr', 'review', 'end'])
  expect(loopedKeys.indexOf('dev')).toBeLessThan(loopedKeys.indexOf('design'))
})

// 15) 리뷰 후속 ② — 정의를 못 읽는 동안(버전 로딩·404)에도 질문 노드는 줄을 만들지 않는다:
//     지금 노드 returnTo 로 접힌 칸을 current 로, _qa answerNode 로 방문한 질문 노드 줄을 없앤다.
test('rows_modelUndefined_questionNodeStillFolded', () => {
  // 질문 대기 — 지금이 dev_ask(returnTo dev).
  const waitingView = viewOf({
    status: 'WAITING',
    currentNode: curNode('dev_ask', { type: 'human_task', returnTo: 'dev', enteredAt: '2026-11-27T02:00:00Z' }),
    path: [step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z')],
    context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는 얼마로 할까요?' }] },
  })
  const waiting = buildWorkflowStepRows(waitingView, undefined)
  expect(waiting.some((r) => r.key === 'dev_ask')).toBe(false) // 정의 없어도 질문 노드는 줄을 만들지 않는다
  const dev = waiting.find((r) => r.key === 'dev')!
  expect(dev.state).toBe('current')
  expect(dev.questionWaiting).toBe(true)
  expect(dev.questionFirstLine).toBe('최대 크기는 얼마로 할까요?')

  // 이미 답한 뒤 — 지금은 dev, path 에 dev_ask 방문이 남아 있어도 answerNode 로 접는다.
  const answeredView = viewOf({
    currentNode: curNode('dev', { enteredAt: '2026-11-27T03:00:00Z' }),
    path: [
      step('dev', '2026-11-27T01:00:00Z', '2026-11-27T02:00:00Z'),
      step('dev_ask', '2026-11-27T02:00:00Z', '2026-11-27T03:00:00Z'),
    ],
    context: { _qa: [{ askNode: 'dev', answerNode: 'dev_ask', question: '최대 크기는?', answer: '4096' }] },
  })
  const answered = buildWorkflowStepRows(answeredView, undefined)
  expect(answered.some((r) => r.key === 'dev_ask')).toBe(false)
  expect(answered.find((r) => r.key === 'dev')!.questionAnswered).toBe(1)
})

// 9) 걸린 시간 표시 단위
test('durationLabel_buckets', () => {
  expect(durationLabel('2026-11-27T00:00:00Z', '2026-11-27T00:00:30Z')).toBe('방금')
  expect(durationLabel('2026-11-27T00:00:00Z', '2026-11-27T00:05:00Z')).toBe('5분')
  expect(durationLabel('2026-11-27T00:00:00Z', '2026-11-27T01:30:00Z')).toBe('1시간 30분')
})