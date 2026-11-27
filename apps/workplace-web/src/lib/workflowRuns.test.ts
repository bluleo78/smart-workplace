import { describe, expect, it } from 'vitest'

import { mkAskModel, mkModel } from '@/test/kits/projects/workflowRunFixtures'

import {
  mentionTokensAsNames,
  nodeDurationsMs,
  paintRun,
  pendingQuestion,
  questionFirstLine,
  runMoveRows,
  runUserNames,
  type WorkflowNodeRun,
  type WorkflowRunDetail,
} from './workflowRuns'

const u = (id: number, name: string) => ({ id, username: name, name })
function visit(id: number, nodeKey: string, enteredAt: string, leftAt: string | null, extra: Partial<WorkflowNodeRun> = {}): WorkflowNodeRun {
  return {
    id, nodeKey, nodeName: null, visitNo: 1, status: leftAt ? 'COMPLETED' : 'ACTIVE', assignees: [], workflowAssigned: [],
    outcome: null, outcomeName: null, outputs: null, commentId: null, waitingReason: null, error: null, actor: null, enteredAt, leftAt, viaReturn: false, ...extra,
  }
}
function detail(nodeRuns: WorkflowNodeRun[], status = 'WAITING', currentNode = 'b'): WorkflowRunDetail {
  return {
    run: { runId: 1, workflowId: 2, versionNo: 1, issueId: 3, issueNumber: 3, issueKey: 'WP-3', title: 't', status: status as never, revision: 1, currentNode,
      startedBy: u(9, '시작자'), startedAt: '2026-01-01T00:00:00Z', endedAt: null, context: {} },
    nodeRuns, events: [], model: mkModel(),
  }
}

describe('workflowRuns', () => {
  it('runDetail_paintsPassedCurrentUnvisited', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'),
      visit(2, 'a', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z'),
      visit(3, 'b', '2026-01-01T00:10:00Z', null),
    ]
    expect(paintRun(detail(runs))).toEqual({ start: 'passed', a: 'passed', b: 'current', end: 'unvisited' })
    const done = paintRun(detail(runs.map((r) => (r.leftAt ? r : { ...r, leftAt: '2026-01-01T00:20:00Z', status: 'COMPLETED' as const })), 'COMPLETED'))
    expect(Object.values(done)).not.toContain('current')
  })

  // WP-2157 리뷰 후속 — 멈춘 실행(조치 필요)의 지금 노드는 「지금」이 아니라 실패로 칠한다
  it('paintRun_suspendedCurrentIsFailed', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'),
      visit(2, 'a', '2026-01-01T00:00:01Z', null, { status: 'BLOCKED' }),
    ]
    expect(paintRun(detail(runs, 'SUSPENDED', 'a'))).toEqual({ start: 'passed', a: 'failed', b: 'unvisited', end: 'unvisited' })
  })

  // WP-2157 리뷰: 방문 상한 초과 등으로 멈췄지만 지금 노드 방문이 실패·차단이 아니면 「지금」 그대로 보인다.
  it('paintRun_suspendedWithoutFailedVisitStaysCurrent', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'),
      visit(2, 'a', '2026-01-01T00:00:01Z', null),
    ]
    expect(paintRun(detail(runs, 'SUSPENDED', 'a')).a).toBe('current')
  })

  it('paintRun_loopAndUnknownNode', () => {
    const runs = [
      visit(1, 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z'),
      visit(2, 'old', '2026-01-01T00:10:00Z', '2026-01-01T00:11:00Z'),
      visit(3, 'a', '2026-01-01T00:11:00Z', '2026-01-01T00:16:00Z'),
    ]
    const d = detail(runs, 'COMPLETED')
    expect(paintRun(d)).not.toHaveProperty('old')
    expect(nodeDurationsMs(d, new Date('2026-02-01T00:00:00Z')).a).toBe(900000)
  })

  // 실패한 방문은 지나옴(체크)이 아니라 failed 로 칠하고, 같은 노드를 뒤에 정상 통과하면 passed 가 이긴다.
  it('paintRun_failedVisitIsNotPassed', () => {
    const runs = [
      visit(1, 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', { status: 'FAILED' }),
      visit(2, 'b', '2026-01-01T00:10:00Z', '2026-01-01T00:11:00Z', { status: 'FAILED' }),
      visit(3, 'b', '2026-01-01T00:11:00Z', '2026-01-01T00:12:00Z'),
    ]
    expect(paintRun(detail(runs, 'COMPLETED'))).toMatchObject({ a: 'failed', b: 'passed' })
  })

  it('runMoveRows_newestFirst_withAssigneeChange', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', { actor: u(1, '가') }),
      visit(2, 'a', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z', { nodeName: '작성', outcome: 'done', outcomeName: 'done', actor: u(2, '나') }),
      visit(3, 'b', '2026-01-01T00:10:00Z', null, { nodeName: '검토', workflowAssigned: [u(5, '김')] }),
    ]
    const rows = runMoveRows(detail(runs))
    expect(rows).toHaveLength(2)
    expect(rows[0].to).toBe('검토')
    expect(rows[0].from).toBe('작성')
    expect(rows[0].assigned).toEqual(['김'])
    expect(rows[0].actorName).toBe('나')
    expect(rows[0].outcome).toBe('done')
    expect(rows[1].from).toBeNull()
    expect(rows[1].actorName).toBe('시작자')
  })

  it('runMoveRows_mergesStartIntoOneRow', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'),
      visit(2, 'work', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z', { nodeName: '작업', outcome: 'ask', actor: u(2, '나') }),
      visit(3, 'work_ask', '2026-01-01T00:10:00Z', null, { nodeName: '질문 답변' }),
    ]
    const d = { ...detail(runs), model: mkAskModel() }
    const rows = runMoveRows(d)
    expect(rows.map((r) => [r.from, r.to])).toEqual([['작업', '질문 답변'], [null, '작업']])
    expect(rows[1].actorName).toBe('시작자')
    expect(rows[1].at).toBe('2026-01-01T00:00:00Z')
  })

  it('runMoveRows_askRowCarriesQuestionFirstLine', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'),
      visit(2, 'work', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z', { nodeName: '작업', outcome: 'ask' }),
      visit(3, 'work_ask', '2026-01-01T00:10:00Z', null, { nodeName: '질문 답변' }),
    ]
    const d = detail(runs)
    d.model = mkAskModel()
    d.run.context = { _qa: [{ answerNode: 'work_ask', question: '장비 카드 배치를 어떻게 할까요?\n1안…' }] }
    const rows = runMoveRows(d)
    expect(rows[0].question).toBe('장비 카드 배치를 어떻게 할까요?')
    expect(rows[1].question).toBeNull()
  })

  // WP-2157 리뷰: 서버가 앞 항목을 잘라 항목이 방문보다 적으면 끝에서 맞춘다 — 최근 방문에 최근 질문, 앞 방문은 null.
  it('runMoveRows_questionPairingAlignsFromEnd', () => {
    const runs = [
      visit(1, 'work', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', { nodeName: '작업', outcome: 'ask' }),
      visit(2, 'work_ask', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z', { nodeName: '질문 답변' }),
      visit(3, 'work', '2026-01-01T00:10:00Z', '2026-01-01T00:11:00Z', { nodeName: '작업', outcome: 'ask' }),
      visit(4, 'work_ask', '2026-01-01T00:11:00Z', null, { nodeName: '질문 답변' }),
    ]
    const d = detail(runs)
    d.model = mkAskModel()
    d.run.context = { _qa: [{ answerNode: 'work_ask', question: '최근 질문' }] }
    const rows = runMoveRows(d)
    expect(rows[0].question).toBe('최근 질문')
    expect(rows.find((r) => r.id === '2')!.question).toBeNull()
  })

  // WP-2157 리뷰: recover MOVE_TO 로 다른 노드(review)에서 질문 단계로 들어온 방문은 _qa 항목이 없다 — 첫 질문 방문만 짝지어진다.
  it('runMoveRows_recoverVisitIntoAskStepGetsNoQuestion', () => {
    const runs = [
      visit(1, 'work', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z', { nodeName: '작업', outcome: 'ask' }),
      visit(2, 'work_ask', '2026-01-01T00:10:00Z', '2026-01-01T00:11:00Z', { nodeName: '질문 답변' }),
      visit(3, 'work', '2026-01-01T00:11:00Z', '2026-01-01T00:12:00Z', { nodeName: '작업' }),
      visit(4, 'review', '2026-01-01T00:12:00Z', '2026-01-01T00:13:00Z', { nodeName: '리뷰' }),
      visit(5, 'work_ask', '2026-01-01T00:13:00Z', null, { nodeName: '질문 답변' }),
    ]
    const d = detail(runs)
    d.model = mkAskModel()
    d.model.nodes.push({ ...d.model.nodes[1], key: 'review', name: '리뷰', outcomes: [] })
    d.run.context = { _qa: [{ answerNode: 'work_ask', question: '첫 질문' }] }
    const rows = runMoveRows(d)
    expect(rows.find((r) => r.id === '2')!.question).toBe('첫 질문')
    expect(rows.find((r) => r.id === '5')!.question).toBeNull()
  })

  // WP-2157 리뷰: 같은 질문 주인 노드에서 결과 없이(recover) 질문 단계로 들어온 방문도 _qa 항목이 없다.
  it('runMoveRows_recoverFromOwnerWithoutOutcomeGetsNoQuestion', () => {
    const runs = [
      visit(1, 'work', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z', { nodeName: '작업', outcome: 'ask' }),
      visit(2, 'work_ask', '2026-01-01T00:10:00Z', '2026-01-01T00:11:00Z', { nodeName: '질문 답변' }),
      visit(3, 'work', '2026-01-01T00:11:00Z', '2026-01-01T00:12:00Z', { nodeName: '작업' }),
      visit(4, 'work_ask', '2026-01-01T00:12:00Z', null, { nodeName: '질문 답변' }),
    ]
    const d = detail(runs)
    d.model = mkAskModel()
    d.run.context = { _qa: [{ answerNode: 'work_ask', question: '첫 질문' }] }
    const rows = runMoveRows(d)
    expect(rows.find((r) => r.id === '2')!.question).toBe('첫 질문')
    expect(rows.find((r) => r.id === '4')!.question).toBeNull()
  })

  it('runMoveRows_onlyStartVisit', () => {
    const rows = runMoveRows(detail([visit(1, 'start', '2026-01-01T00:00:00Z', null, { nodeName: '시작' })]))
    expect(rows).toHaveLength(1)
    expect(rows[0].from).toBeNull()
    expect(rows[0].to).toBe('시작')
  })

  it('runMoveRows_noStartVisit', () => {
    const rows = runMoveRows(detail([
      visit(1, 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', { nodeName: '작성' }),
      visit(2, 'b', '2026-01-01T00:01:00Z', null, { nodeName: '검토' }),
    ]))
    expect(rows).toHaveLength(2)
    expect(rows[1].from).toBeNull()
    expect(rows[1].actorName).toBe('시작자')
  })

  it('runMoveRows_outcome_prefersServerName_thenDefaultName', () => {
    const runs = [
      visit(1, 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', { outcome: 'approve', outcomeName: '승인' }),
      visit(2, 'b', '2026-01-01T00:10:00Z', '2026-01-01T00:20:00Z', { outcome: 'answered', outcomeName: '답변' }),
      visit(3, 'c', '2026-01-01T00:20:00Z', null),
    ]
    const rows = runMoveRows(detail(runs))
    expect(rows.map((r) => r.outcome)).toEqual(['답변', '승인', null])
  })

  // WP-2158 리뷰 후속 — 옛 서버 응답(outcomeName 없음)이어도 결과가 빈칸이 아니라 기본 이름·키로 보인다.
  it('runMoveRows_outcomeNameMissing_fallsBackToDefaultNameOrKey', () => {
    const runs = [
      visit(1, 'a', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z', { outcome: 'approve' }),
      visit(2, 'b', '2026-01-01T00:10:00Z', '2026-01-01T00:20:00Z', { outcome: 'ask', outcomeName: null }),
      visit(3, 'c', '2026-01-01T00:20:00Z', null),
    ]
    // 옛 서버 모양 — 칸 자체가 없다(null 과 따로 본다).
    delete (runs[0] as { outcomeName?: string | null }).outcomeName
    const rows = runMoveRows(detail(runs))
    expect(rows.map((r) => r.outcome)).toEqual(['질문', 'approve', null])
  })

  // 같은 초 안에서 밀리초 유무가 섞여도(문자열 비교는 「…00Z」 > 「…00.5Z」) 방문 id 순서대로 이어진다.
  it('runMoveRows_mixedMillisSameSecond_ordersByVisitId', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'),
      visit(2, 'a', '2026-01-01T00:00:01Z', '2026-01-01T00:00:01.500Z', { nodeName: '작성' }),
      visit(3, 'b', '2026-01-01T00:00:01.500Z', null, { nodeName: '검토' }),
    ]
    const rows = runMoveRows(detail(runs))
    expect(rows.map((r) => r.to)).toEqual(['검토', '작성'])
    expect(rows[0].from).toBe('작성')
  })

  it.each([
    ['\n어느 쪽?\n- A', '어느 쪽?'],
    ['  한 줄  ', '한 줄'],
    ['\r\n  \r\n둘째\r\n셋째', '둘째'],
    ['   \n \n', null],
    ['', null],
    [null, null],
  ])('questionFirstLine_%j', (q, expected) => {
    expect(questionFirstLine(q)).toBe(expected)
  })

  // WP-2093: 질문 원문의 멘션 토큰은 상세에 실린 사람 이름으로, 모르는 id 는 서버와 같은 @사용자.
  it('mentionTokensAsNames_usesRunUsers_unknownAsUser', () => {
    const names = runUserNames({
      run: { startedBy: u(1, '김') } as WorkflowRunDetail['run'],
      nodeRuns: [visit(1, 'a', '2026-11-20T00:00:00Z', null, { assignees: [u(2, '박')], workflowAssigned: [u(3, '이')], actor: u(4, '최') })],
    })
    expect(mentionTokensAsNames('<@2> <@3> 어느 쪽? <@4><@1> <@99>', names)).toBe('@박 @이 어느 쪽? @최@김 @사용자')
    expect(mentionTokensAsNames('토큰 없음', names)).toBe('토큰 없음')
  })

  it('pendingQuestion_lastUnansweredForNode', () => {
    const ctx = { _qa: [
      { answerNode: 'b', question: '앞 질문', answer: '답' },
      { answerNode: 'b', question: '뒤 질문' },
    ] }
    expect(pendingQuestion(ctx, 'b')).toBe('뒤 질문')
    expect(pendingQuestion(ctx, 'a')).toBeNull()
    expect(pendingQuestion({}, 'b')).toBeNull()
  })
})
