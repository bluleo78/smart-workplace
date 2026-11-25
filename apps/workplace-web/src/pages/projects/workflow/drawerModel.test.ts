import { describe, expect, it } from 'vitest'

import type { WorkflowProblem } from '@/lib/workflows'

import { askTarget, instructionPreview, instructionStats, nodeProblemLevels, problemTab, problemTargetNode } from './drawerModel'
import { parseWorkflowGraph } from './graphYaml'

const YAML = `nodes:
  start: { type: start }
  draft:
    type: agent_task
    ask: { role: reviewer }
  done: { type: end }
start:
  - { to: draft }
`

/** 파싱 성공을 단언하고 그래프만 꺼낸다 */
const graphOf = (y: string) => {
  const r = parseWorkflowGraph(y)
  if ('error' in r) throw new Error(r.error)
  return r.graph
}

const problem = (severity: 'ERROR' | 'WARNING', nodeKey: string | null, code = 'X'): WorkflowProblem => ({
  severity,
  code,
  message: 'm',
  line: 1,
  column: 1,
  nodeKey,
})

describe('drawerModel', () => {
  it('instructionStats_countsCharsTablesHeadings', () => {
    const text = '# 목표\n본문\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## 단계\n```\n# 코드\n```'
    expect(instructionStats(text)).toMatchObject({ tables: 1, headings: 2 })
    expect(instructionStats(text).chars).toBe(text.trim().length)
  })

  it('instructionStats_tildeFenceHidesHeadings', () => {
    expect(instructionStats('# 제목\n~~~\n# 주석\n~~~\n## 둘')).toMatchObject({ headings: 2 })
  })

  it('instructionPreview_firstThreeNonEmptyLines', () => {
    expect(instructionPreview('a\n\nb\nc\nd')).toBe('a\nb\nc')
  })

  it('problemTargetNode_hiddenQuestion_returnsHost', () => {
    const graph = graphOf(YAML)
    const virtual = graph.nodes.find((n) => n.virtual)!.key
    expect(problemTargetNode(graph, virtual)).toBe('draft')
    expect(problemTargetNode(graph, 'done')).toBe('done')
    expect(problemTargetNode(graph, null)).toBeNull()
    expect(problemTargetNode(graph, 'nope')).toBeNull()
  })

  it('askTarget_followsAskEdge', () => {
    const graph = graphOf(YAML)
    expect(askTarget(graph, 'draft')?.virtual).toBe(true)
    expect(askTarget(graph, 'done')).toBeNull()
  })

  it('problemTab_mapsCodesToTabWithTheControl', () => {
    // 결과·되돌림 제한을 고치는 컨트롤은 「결과·경로」 탭에 있다
    const at = (code: string, line = 1) => ({ code, line })
    for (const c of ['TASK_OUTCOME_MISSING', 'LOOP_WITHOUT_MAX_VISITS']) expect(problemTab(at(c))).toBe('paths')
    // 사람에게 묻기(질문 경로 추가·묻는 곳)는 「설정」 탭에 있다 — ASK·RETURN 토큰이어도 경로 탭이 아니다
    for (const c of ['ASK_PATH_MISSING', 'RETURN_TO_WITHOUT_ASK']) expect(problemTab(at(c))).toBe('settings')
    for (const c of ['INVALID_NODE', 'NODE_FIELD_NOT_ALLOWED', 'TASK_ROLE_MISSING', 'REF_SHARED_UNKNOWN']) expect(problemTab(at(c))).toBe('settings')
  })

  // 정의 안 된 노드로 가는 to(REF_NODE_UNKNOWN·START_INCOMING) — 결과·조건의 to 는 「결과·경로」, onError 의 to 는 「설정」
  it('problemTab_edgeTargetCodes_splitByOnErrorLine', () => {
    const yaml = [
      'nodes:', // 1
      '  a:', // 2
      '    type: agent_task', // 3
      '    outcomes:', // 4
      '      ok:', // 5
      '        to: nowhere', // 6
      '    onError:', // 7
      '      to: gone', // 8
      '  b:', // 9
      '    onError: { to: gone }', // 10
    ].join('\n')
    for (const code of ['REF_NODE_UNKNOWN', 'START_INCOMING']) {
      expect(problemTab({ code, line: 6 }, yaml)).toBe('paths')
      expect(problemTab({ code, line: 8 }, yaml)).toBe('settings')
      expect(problemTab({ code, line: 10 }, yaml)).toBe('settings')
      // 줄을 못 읽으면 더 흔한 결과·조건 쪽
      expect(problemTab({ code, line: 99 }, yaml)).toBe('paths')
      expect(problemTab({ code, line: 8 })).toBe('paths')
    }
  })

  it('problemTargetNode_showAsk_keepsRealQuestionNode_movesVirtualOnly', () => {
    const real = graphOf(`nodes:
  start: { type: start }
  draft:
    type: agent_task
    outcomes:
      ask: { to: answer }
  answer: { type: human_task, role: owner, returnTo: draft }
  done: { type: end }
start:
  - { to: draft }
`)
    // 접힌 보기: 숨은 질문 노드의 문제는 질문을 낸 노드로 간다
    expect(problemTargetNode(real, 'answer')).toBe('draft')
    // 펼친 보기: 질문 노드가 화면에 있으니 그 노드 자신에게 간다
    expect(problemTargetNode(real, 'answer', true)).toBe('answer')
    // 가상 질문 노드는 펼쳐도 서랍으로 열 수 없어 늘 호스트로 간다
    const graph = graphOf(YAML)
    const virtual = graph.nodes.find((n) => n.virtual)!.key
    expect(problemTargetNode(graph, virtual, true)).toBe('draft')
  })

  it('nodeProblemLevels_showAsk_levelsOnQuestionNodeItself', () => {
    const graph = graphOf(`nodes:
  start: { type: start }
  draft:
    type: agent_task
    outcomes:
      ask: { to: answer }
  answer: { type: human_task, role: owner, returnTo: draft }
  done: { type: end }
start:
  - { to: draft }
`)
    const p = problem('ERROR', 'answer')
    expect([...nodeProblemLevels(graph, [p]).keys()]).toEqual(['draft'])
    expect([...nodeProblemLevels(graph, [p], true).keys()]).toEqual(['answer'])
  })

  it('nodeProblemLevels_errorBeatsWarning', () => {
    const graph = graphOf(YAML)
    const m = nodeProblemLevels(graph, [problem('WARNING', 'done'), problem('ERROR', 'done'), problem('WARNING', 'draft'), problem('ERROR', null)])
    expect(m.get('done')).toBe('ERROR')
    expect(m.get('draft')).toBe('WARNING')
    expect(m.size).toBe(2)
  })
})
