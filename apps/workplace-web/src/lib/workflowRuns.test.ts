import { describe, expect, it } from 'vitest'

import { mkModel } from '@/test/kits/projects/workflowRunFixtures'

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
    outcome: null, outputs: null, commentId: null, waitingReason: null, error: null, actor: null, enteredAt, leftAt, viaReturn: false, ...extra,
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
      visit(2, 'a', '2026-01-01T00:00:01Z', '2026-01-01T00:10:00Z', { nodeName: '작성', outcome: 'done', actor: u(2, '나') }),
      visit(3, 'b', '2026-01-01T00:10:00Z', null, { nodeName: '검토', workflowAssigned: [u(5, '김')] }),
    ]
    const rows = runMoveRows(detail(runs))
    expect(rows).toHaveLength(3)
    expect(rows[0].to).toBe('검토')
    expect(rows[0].from).toBe('작성')
    expect(rows[0].assigned).toEqual(['김'])
    expect(rows[0].actorName).toBe('나')
    expect(rows[0].outcome).toBe('done')
    expect(rows[2].from).toBeNull()
    expect(rows[2].actorName).toBe('시작자')
  })

  // 같은 초 안에서 밀리초 유무가 섞여도(문자열 비교는 「…00Z」 > 「…00.5Z」) 방문 id 순서대로 이어진다.
  it('runMoveRows_mixedMillisSameSecond_ordersByVisitId', () => {
    const runs = [
      visit(1, 'start', '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z'),
      visit(2, 'a', '2026-01-01T00:00:01Z', '2026-01-01T00:00:01.500Z', { nodeName: '작성' }),
      visit(3, 'b', '2026-01-01T00:00:01.500Z', null, { nodeName: '검토' }),
    ]
    const rows = runMoveRows(detail(runs))
    expect(rows.map((r) => r.to)).toEqual(['검토', '작성', 'start'])
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
