import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  addAskPath,
  addNode,
  autoLayout,
  connectFromFlow,
  connectOutcome,
  moveManyFromDrag,
  moveNode,
  nextOutcomeKey,
  parseMaxVisits,
  parseWorkflowGraph,
  placeNodes,
  readNodeDetail,
  removeNode,
  updateNode,
} from './graphYaml'

/** 설계 §6 축약(정렬용 여분 공백은 yaml 직렬화가 정리하므로 처음부터 두지 않는다) — 주석·흐름 스타일·start 배열을 포함하고 layout 은 없다. */
const FIXTURE = `schema: genia/workflow@1
name: AI 개발 흐름
roles:
  lead: { name: 팀장 }
  planner: { name: 기획자 }
  owner: { name: 확인자 }

nodes:
  start: { type: start }

  # 분류 노드
  triage:
    type: agent_task
    name: 분류
    role: lead
    outcomes:
      ready: { to: dev, assignTo: developer }

  # 개발
  dev:
    type: agent_task
    name: 개발
    role: developer
    instructions: |
      개발한다
    outcomes:
      submitted: { to: plan_ok, assignTo: owner }

  plan_ok:
    type: human_task
    name: 기획 확정
    role: owner
    outcomes:
      approve: { to: dev, assignTo: developer }
      revise: { to: triage, assignTo: planner, requireComment: true }

  done: { type: end }

start:
  - { when: { assigneeRole: lead }, to: triage }
  - { when: { assigneeRole: developer }, to: dev }
`

const doc = (y: string) => parse(y) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('graphYaml', () => {
  it('graphYaml_roundTrip_preservesUntouchedComments', () => {
    const out = updateNode(FIXTURE, 'dev', { instructions: '새 지시' })
    expect(out).toContain('# 분류 노드')
    const block = (s: string) => s.slice(s.indexOf('  triage:'), s.indexOf('  # 개발'))
    expect(block(out)).toBe(block(FIXTURE))
    expect(doc(out).nodes.dev.instructions.trim()).toBe('새 지시')
  })

  it('updateNode_onFlowStyleNode_keepsOtherComments', () => {
    const out = updateNode(FIXTURE, 'done', { name: '끝' })
    expect(doc(out).nodes.done.name).toBe('끝')
    expect(out).toContain('# 개발')
  })

  it('addNode_writesYamlNode', () => {
    const r = addNode(FIXTURE, 'agent_task', { x: 10, y: 20 })
    expect(r.key).toBe('task_1')
    const d = doc(r.yaml)
    expect(d.nodes.task_1).toEqual({ type: 'agent_task', name: '새 AI 작업' })
    expect(d.layout.task_1).toEqual({ x: 10, y: 20 })
  })

  it('addNode_picksFreeKey', () => {
    const a = addNode(FIXTURE, 'agent_task')
    const b = addNode(a.yaml, 'agent_task')
    expect([a.key, b.key]).toEqual(['task_1', 'task_2'])
  })

  it('connectOutcome_writesOutcomeTo', () => {
    const d = doc(connectOutcome(FIXTURE, 'triage', 'ready', 'dev'))
    expect(d.nodes.triage.outcomes.ready.to).toBe('dev')
    const d2 = doc(connectOutcome(FIXTURE, 'triage', 'ready', 'done'))
    expect(d2.nodes.triage.outcomes.ready).toEqual({ to: 'done', assignTo: 'developer' })
    const d3 = doc(connectOutcome(FIXTURE, 'triage', 'fresh', 'done'))
    expect(d3.nodes.triage.outcomes.fresh.to).toBe('done')
  })

  it('nextOutcomeKey', () => {
    expect(nextOutcomeKey(FIXTURE, 'triage')).toBe('done')
    expect(nextOutcomeKey(FIXTURE, 'dev')).toBe('done')
    const y = connectOutcome(FIXTURE, 'triage', 'done', 'done')
    expect(nextOutcomeKey(y, 'triage')).toBe('done_2')
  })

  it('addAskPath_createsHumanNodeAndReturnTo', () => {
    const d = doc(addAskPath(FIXTURE, 'dev'))
    expect(d.nodes.dev_ask).toEqual({
      type: 'human_task',
      name: '개발 질문 답변',
      role: 'owner',
      returnTo: 'dev',
      outcomes: { answered: { to: 'dev', assignTo: 'keep', requireComment: true } },
    })
    expect(d.nodes.dev.outcomes.ask).toEqual({ to: 'dev_ask', assignTo: 'owner', requireComment: true })
  })

  it('addAskPath_expandsShorthandAndAvoidsKeyClash', () => {
    const y = FIXTURE.replace('    role: lead\n    outcomes:', '    role: lead\n    ask: { role: owner }\n    outcomes:')
    const d = doc(addAskPath(y, 'triage'))
    expect(d.nodes.triage.ask).toBeUndefined()
    expect(d.nodes.triage_ask.returnTo).toBe('triage')
    const d2 = doc(addAskPath(addAskPath(FIXTURE, 'dev'), 'dev'))
    expect(d2.nodes.dev_ask_2.returnTo).toBe('dev')
  })

  it('movingNode_updatesLayoutOnly', () => {
    const out = moveNode(FIXTURE, 'dev', 300, 40)
    expect(doc(out).layout.dev).toEqual({ x: 300, y: 40 })
    const head = (s: string) => s.slice(0, s.indexOf('start:\n  - {'))
    expect(head(out)).toBe(head(FIXTURE))
  })

  it('parse_invalidYaml_returnsError', () => {
    const r = parseWorkflowGraph('nodes: [\n')
    expect('error' in r).toBe(true)
    expect(moveNode('nodes: [\n', 'a', 1, 2)).toBe('nodes: [\n')
  })

  it('parse_edges', () => {
    const r = parseWorkflowGraph(FIXTURE)
    if (!('graph' in r)) throw new Error(r.error)
    const { edges } = r.graph
    expect(edges.find((e) => e.kind === 'start' && e.to === 'triage')?.label).toBe('담당=lead')
    expect(edges.find((e) => e.from === 'plan_ok' && e.label === 'revise')?.to).toBe('triage')
    expect(r.graph.roles.map((x) => x.key)).toEqual(['lead', 'planner', 'owner'])

    const small = `nodes:
  start: { type: start }
  a:
    type: agent_task
    name: 작업
    role: x
    ask: { role: owner }
`
    const g = parseWorkflowGraph(small)
    if (!('graph' in g)) throw new Error(g.error)
    const v = g.graph.nodes.find((n) => n.key === 'a_ask')
    expect(v).toMatchObject({ virtual: true, type: 'human_task', name: '작업 질문 답변', role: 'owner' })
    expect(g.graph.edges.some((e) => e.from === 'a' && e.to === 'a_ask' && e.kind === 'ask')).toBe(true)
    expect(g.graph.edges.some((e) => e.from === 'a_ask' && e.to === 'a' && e.kind === 'returnTo')).toBe(true)
  })

  it('readNodeDetail', () => {
    const n = readNodeDetail(FIXTURE, 'plan_ok')
    expect(n?.outcomes.find((o) => o.key === 'revise')).toEqual({ key: 'revise', to: 'triage', assignTo: 'planner', requireComment: true })
    expect(readNodeDetail(FIXTURE, 'nope')).toBeNull()
  })

  it('removeNode', () => {
    const y = removeNode(moveNode(FIXTURE, 'dev', 1, 2), 'dev')
    const d = doc(y)
    expect(d.nodes.dev).toBeUndefined()
    expect(d.layout).toBeUndefined() // 비게 된 layout 칸은 통째로 지운다
    expect(JSON.stringify(d.nodes)).not.toContain('"to":"dev"')
  })

  it('removeNode_withoutLayout_prunesStartAndConditions', () => {
    const y = `nodes:
  start: { type: start }
  a: { type: agent_task }
  d:
    type: decision
    conditions:
      - { when: { assigneeRole: x }, to: a }
      - { when: { assigneeRole: y }, to: end }
    default: a
  end: { type: end }
start:
  - { when: { assigneeRole: x }, to: a }
  - { when: { assigneeRole: y }, to: end }
`
    const out = removeNode(y, 'a')
    const d = doc(out)
    expect(d.nodes.a).toBeUndefined()
    expect(d.start).toEqual([{ when: { assigneeRole: 'y' }, to: 'end' }])
    expect(d.nodes.d.conditions).toEqual([{ when: { assigneeRole: 'y' }, to: 'end' }])
    expect(d.nodes.d.default).toBeUndefined()
    expect(out).not.toContain('layout')
    const f = doc(removeNode(FIXTURE, 'dev'))
    expect(f.nodes.dev).toBeUndefined()
    expect(f.layout).toBeUndefined()
    expect(f.start).toEqual([{ when: { assigneeRole: 'lead' }, to: 'triage' }])
  })

  it('autoLayout', () => {
    const d = doc(autoLayout(FIXTURE))
    expect(d.layout.start.x).toBe(0)
    expect(d.layout.triage.x).toBe(240)
  })

  // 최종 리뷰 3 — 만들기 템플릿의 빈 흐름 맵에 더해도 블록 스타일·블록 리터럴로 쓴다
  it('addNode_intoEmptyFlowMap_switchesToBlockStyle', () => {
    const template = 'schema: genia/workflow@1\nname: "x"\nroles: {}\nnodes: {}\nstart: []\n'
    const a = addNode(template, 'agent_task', { x: 0, y: 0 })
    const b = addNode(a.yaml, 'end', { x: 240, y: 0 })
    const c = connectOutcome(b.yaml, a.key, 'done', b.key)
    const out = updateNode(c, a.key, { instructions: '첫 줄\n둘째 줄' })
    expect(out).toContain('nodes:\n  task_1:\n    type: agent_task')
    expect(out).toContain('    instructions: |-\n      첫 줄\n      둘째 줄')
    expect(out).not.toContain('\\n')
    expect(out).toContain('layout:\n  task_1: { x: 0, y: 0 }')
    expect(doc(out).nodes.task_1.outcomes.done.to).toBe('end_1')
  })

  // 최종 리뷰 4 — 80자를 넘는 따옴표 문자열이 다른 편집 뒤에도 접히지 않는다
  it('moveNode_keepsLongQuotedStringUnfolded', () => {
    const long = '아주 긴 이름 '.repeat(12).trim()
    const y = FIXTURE.replace('    name: 분류\n', `    name: "${long}"\n`)
    const out = moveNode(y, 'dev', 1, 2)
    expect(out).toContain(`    name: "${long}"\n`)
  })

  // 최종 리뷰 5 — 편집 함수는 null·엉뚱한 종류의 칸에서도 던지지 않는다
  it.each(['layout: ~', 'layout:'])('moveNode_nullLayout_%s_writesBlockMap', (line) => {
    const out = moveNode(`${FIXTURE}${line}\n`, 'dev', 5, 6)
    expect(doc(out).layout).toEqual({ dev: { x: 5, y: 6 } })
  })

  it('moveNode_sequenceLayout_returnsInput', () => {
    const y = `${FIXTURE}layout: []\n`
    expect(moveNode(y, 'dev', 5, 6)).toBe(y)
  })

  it('addNode_bareNodes_writesBlockMap', () => {
    const r = addNode('schema: genia/workflow@1\nnodes:\n', 'human_task')
    expect(r.key).toBe('human_1')
    expect(doc(r.yaml).nodes.human_1.type).toBe('human_task')
  })

  it('addNode_sequenceNodes_returnsInput', () => {
    const y = 'nodes: []\n'
    expect(addNode(y, 'agent_task')).toEqual({ yaml: y, key: '' })
  })

  it('connectOutcome_nullOutcomes_writesOutcome', () => {
    const y = 'nodes:\n  a:\n    type: agent_task\n    outcomes:\n  b: { type: end }\n'
    expect(doc(connectOutcome(y, 'a', 'done', 'b')).nodes.a.outcomes).toEqual({ done: { to: 'b' } })
  })

  it('updateNode_nullOutcomes_writesOutcomes', () => {
    const y = 'nodes:\n  a:\n    type: agent_task\n    outcomes:\n  b: { type: end }\n'
    const out = updateNode(y, 'a', { outcomes: [{ key: 'ok', to: 'b', requireComment: false }] })
    expect(doc(out).nodes.a.outcomes).toEqual({ ok: { to: 'b' } })
  })

  it('updateNode_sequenceOutcomes_returnsInput', () => {
    const y = 'nodes:\n  a:\n    type: agent_task\n    outcomes: []\n'
    expect(updateNode(y, 'a', { outcomes: [{ key: 'ok', to: 'a', requireComment: false }] })).toBe(y)
  })

  it('removeNode_nullNodes_returnsInput', () => {
    expect(removeNode('nodes:\n', 'a')).toBe('nodes:\n')
  })

  // 최종 리뷰 9 — ask 줄임 표기의 역할이 먼저다
  it('addAskPath_prefersShorthandRole', () => {
    const y = FIXTURE.replace('    role: lead\n    outcomes:', '    role: lead\n    ask: { role: planner }\n    outcomes:')
    const d = doc(addAskPath(y, 'triage'))
    expect(d.nodes.triage_ask.role).toBe('planner')
    expect(d.nodes.triage.outcomes.ask.assignTo).toBe('planner')
  })

  // 최종 리뷰 10 — 시작 노드로 들어가는 선·자기 자신으로 가는 선은 받지 않는다
  it.each(['start', 'dev'])('connectFromFlow_refusesTarget_%s', (target) => {
    const r = parseWorkflowGraph(FIXTURE)
    if (!('graph' in r)) throw new Error('parse')
    expect(connectFromFlow(FIXTURE, r.graph, { source: 'dev', target })).toBe(FIXTURE)
  })

  // 최종 리뷰 11 — 같은 출발·도착·종류·이름의 선이 둘이어도 id 가 겹치지 않는다
  it('parse_duplicateEdges_haveUniqueIds', () => {
    const r = parseWorkflowGraph('nodes:\n  start: { type: start }\n  b: { type: end }\nstart:\n  - { when: { assigneeRole: x }, to: b }\n  - { when: { assigneeRole: x }, to: b }\n')
    if (!('graph' in r)) throw new Error('parse')
    const ids = r.graph.edges.map((edge) => edge.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  // 최종 리뷰 12 — outputs 를 제자리 갱신해 안쪽 주석과 순서를 지킨다
  it('updateNode_outputs_keepsCommentsAndRenamesInPlace', () => {
    const y = FIXTURE.replace('    instructions: |\n', '    outputs:\n      # 문서 주소\n      planDoc: { type: url, required: true }\n      # 메모\n      memo: { type: string }\n    instructions: |\n')
    const out = updateNode(y, 'dev', { outputs: [
      { key: 'planUrl', type: 'url', required: true },
      { key: 'memo', type: 'string', required: false },
      { key: 'extra', type: 'number', required: false },
    ] })
    expect(out).toContain('      # 문서 주소\n      planUrl:')
    expect(out).toContain('      # 메모\n      memo:')
    expect(Object.keys(doc(out).nodes.dev.outputs)).toEqual(['planUrl', 'memo', 'extra'])
    expect(doc(out).nodes.dev.outputs.extra).toEqual({ type: 'number' })
  })

  // 최종 리뷰 8 — 모든 노드에 좌표가 있으면 있는 좌표를 쓰고, 없는 노드만 자동 정렬 좌표를 받는다
  it('placeNodes_usesAutoLayoutOnlyForNodesWithoutPosition', () => {
    const graphOf = (y: string) => {
      const r = parseWorkflowGraph(y)
      if (!('graph' in r)) throw new Error('parse')
      return r.graph
    }
    const laid = autoLayout(FIXTURE)
    // 좌표를 바꿔 둔 노드는 자동 정렬 값이 아니라 쓰여 있는 값을 그대로 쓴다
    const moved = moveNode(laid, 'triage', 7, 9)
    expect(placeNodes(graphOf(moved)).get('triage')).toEqual({ x: 7, y: 9 })
    const partial = laid.replace(/ {2}triage: \{[^}]*\}\n/, '')
    expect(placeNodes(graphOf(partial)).get('triage')).toEqual({ x: 240, y: 0 })
  })

  it('placeNodes_putsVirtualNodeBelowItsParent', () => {
    const r = parseWorkflowGraph(`nodes:\n  a: { type: human_task, ask: { role: x } }\nlayout:\n  a: { x: 10, y: 20 }\n`)
    if (!('graph' in r)) throw new Error('parse')
    expect(r.graph.nodes.find((n) => n.virtual)?.virtualParent).toBe('a')
    expect(placeNodes(r.graph).get('a_ask')).toEqual({ x: 10, y: 160 })
  })

  // 최종 리뷰 13 — 되돌림 횟수는 1 이상 정수만, 빈칸은 지우기
  it.each([
    ['', null], ['3', 3], [' 2 ', 2], ['0', undefined], ['-1', undefined], ['1.5', undefined], ['abc', undefined],
  ])('parseMaxVisits(%j) → %j', (input, expected) => {
    expect(parseMaxVisits(input)).toBe(expected)
  })

  // 최종 리뷰 15 — 시작 노드도 더할 수 있다(키는 start, 겹치면 start_<n>)
  it('addNode_start_picksStartKey', () => {
    const r = addNode('nodes:\n  a: { type: end }\n', 'start')
    expect(r.key).toBe('start')
    expect(doc(r.yaml).nodes.start).toEqual({ type: 'start' })
    expect(addNode(FIXTURE, 'start').key).toBe('start_1')
  })
})

// 코드 리뷰 지적 회귀
describe('graphYaml 코드 리뷰 지적', () => {
  const graphOf = (y: string) => {
    const r = parseWorkflowGraph(y)
    if (!('graph' in r)) throw new Error('parse')
    return r.graph
  }

  // 1 — start 에서 끌면 start 목록에 when 이 있는 항목을 더한다(스키마상 when 필수, 역할은 도착 노드 role)
  it('connectFromFlow_fromStart_appendsStartEntryWithRole', () => {
    const out = connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'start', target: 'plan_ok' })
    expect(doc(out).start.at(-1)).toEqual({ when: { assigneeRole: 'owner' }, to: 'plan_ok' })
    expect(doc(out).start).toHaveLength(3)
  })

  it('connectFromFlow_fromStart_noRole_usesFirstRoleKey_andCreatesMissingList', () => {
    const y = FIXTURE.replace(/start:\n {2}- .*\n {2}- .*\n/, 'start: []\n')
    const out = connectFromFlow(y, graphOf(y), { source: 'start', target: 'done' })
    expect(doc(out).start).toEqual([{ when: { assigneeRole: 'lead' }, to: 'done' }])
  })

  it('connectFromFlow_fromDecision_setsDefaultOnlyWhenMissing', () => {
    const y = FIXTURE.replace('  done: { type: end }', '  done: { type: end }\n  pick: { type: decision }')
    const out = connectFromFlow(y, graphOf(y), { source: 'pick', target: 'dev' })
    expect(doc(out).nodes.pick.default).toBe('dev')
    expect(connectFromFlow(out, graphOf(out), { source: 'pick', target: 'triage' })).toBe(out)
    expect(connectFromFlow(y, graphOf(y), { source: 'pick', target: 'start' })).toBe(y)
    expect(connectFromFlow(y, graphOf(y), { source: 'pick', target: 'pick' })).toBe(y)
  })

  // 3 — 여러 노드를 한 번에 layout 에 쓴다
  it('moveManyFromDrag_writesEveryNode', () => {
    const out = moveManyFromDrag(FIXTURE, [
      { id: 'dev', position: { x: 1.4, y: 2.6 } },
      { id: 'triage', position: { x: 10, y: 20 } },
    ])
    expect(doc(out).layout).toEqual({ dev: { x: 1, y: 3 }, triage: { x: 10, y: 20 } })
  })

  // 5 — 같은 키의 실제 노드가 있으면 가상 ask 노드를 만들지 않는다
  it('parse_realAskKey_skipsVirtualNode', () => {
    const y = 'nodes:\n  a:\n    type: agent_task\n    ask: { role: r }\n  a_ask: { type: human_task, returnTo: a }\n'
    const g = graphOf(y)
    expect(g.nodes.filter((n) => n.key === 'a_ask')).toHaveLength(1)
    expect(g.nodes.some((n) => n.virtual)).toBe(false)
    expect(g.edges.some((e) => e.kind === 'ask')).toBe(false)
  })

  // 6 — 질문 노드와 출력 조건도 함께 지운다
  it('removeNode_alsoRemovesAskNodeAndContextConditions', () => {
    const y = addAskPath(FIXTURE, 'dev')
    expect(doc(y).nodes.dev_ask).toBeDefined()
    const out = removeNode(y, 'dev')
    expect(doc(out).nodes.dev_ask).toBeUndefined()
    expect(JSON.stringify(doc(out))).not.toContain('dev_ask')
    const c = 'nodes:\n  a: { type: agent_task }\n  d:\n    type: decision\n    conditions:\n      - { when: { context: a.out, equals: x }, to: b }\n      - { when: { context: z.out, equals: x }, to: b }\n  b: { type: end }\n'
    expect(doc(removeNode(c, 'a')).nodes.d.conditions).toEqual([{ when: { context: 'z.out', equals: 'x' }, to: 'b' }])
  })

  // 7 — required 는 true 일 때만 쓴다
  it('updateNode_outputs_writesRequiredOnlyWhenTrue', () => {
    const out = updateNode(FIXTURE, 'dev', { outputs: [{ key: 'a', type: 'string', required: false }, { key: 'b', type: 'string', required: true }] })
    expect(doc(out).nodes.dev.outputs).toEqual({ a: { type: 'string' }, b: { type: 'string', required: true } })
    const out2 = updateNode(out, 'dev', { outputs: [{ key: 'a', type: 'string', required: false }, { key: 'b', type: 'string', required: false }] })
    expect(doc(out2).nodes.dev.outputs.b).toEqual({ type: 'string' })
  })
})
