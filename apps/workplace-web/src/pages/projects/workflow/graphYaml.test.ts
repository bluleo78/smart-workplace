import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  addAskPath,
  addNode,
  autoLayout,
  connectFromFlow,
  connectOutcome,
  countContextRefs,
  moveManyFromDrag,
  moveNode,
  nextOutcomeKey,
  parseMaxVisits,
  parseWorkflowGraph,
  placeNodes,
  readNodeDetail,
  REFUSE_DECISION_DEFAULT,
  REFUSE_FROM_END,
  REFUSE_INTO_START,
  REFUSE_NO_ROLE,
  REFUSE_SELF,
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
    expect(connectFromFlow(FIXTURE, r.graph, { source: 'dev', target }).yaml).toBe(FIXTURE)
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
    const res = connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'start', target: 'plan_ok' })
    expect(res.refused).toBeUndefined()
    const out = res.yaml
    expect(doc(out).start.at(-1)).toEqual({ when: { assigneeRole: 'owner' }, to: 'plan_ok' })
    expect(doc(out).start).toHaveLength(3)
  })

  it('connectFromFlow_fromStart_noRole_usesFirstRoleKey_andCreatesMissingList', () => {
    const y = FIXTURE.replace(/start:\n {2}- .*\n {2}- .*\n/, 'start: []\n')
    const out = connectFromFlow(y, graphOf(y), { source: 'start', target: 'done' }).yaml
    expect(doc(out).start).toEqual([{ when: { assigneeRole: 'lead' }, to: 'done' }])
  })

  it('connectFromFlow_fromDecision_setsDefaultOnlyWhenMissing', () => {
    const y = FIXTURE.replace('  done: { type: end }', '  done: { type: end }\n  pick: { type: decision }')
    const res = connectFromFlow(y, graphOf(y), { source: 'pick', target: 'dev' })
    const out = res.yaml
    expect(res.refused).toBeUndefined()
    expect(doc(out).nodes.pick.default).toBe('dev')
    expect(connectFromFlow(out, graphOf(out), { source: 'pick', target: 'triage' })).toEqual({ yaml: out, refused: REFUSE_DECISION_DEFAULT })
    expect(connectFromFlow(y, graphOf(y), { source: 'pick', target: 'start' }).yaml).toBe(y)
    expect(connectFromFlow(y, graphOf(y), { source: 'pick', target: 'pick' }).yaml).toBe(y)
  })

  // WP-2038 — 받을 수 없는 선은 이유를 함께 돌려준다
  describe('connectFromFlow refusal', () => {
    it('refuses_startWithoutRoles', () => {
      const y = 'schema: genia/workflow@1\nname: x\nroles: {}\nnodes:\n  start: { type: start }\n  a: { type: agent_task }\nstart: []\n'
      expect(connectFromFlow(y, graphOf(y), { source: 'start', target: 'a' })).toEqual({ yaml: y, refused: REFUSE_NO_ROLE })
    })
    it('refuses_decisionWithDefault', () => {
      const y = FIXTURE.replace('  done: { type: end }', '  done: { type: end }\n  pick: { type: decision }')
      const out = connectFromFlow(y, graphOf(y), { source: 'pick', target: 'dev' }).yaml
      expect(connectFromFlow(out, graphOf(out), { source: 'pick', target: 'triage' })).toEqual({ yaml: out, refused: REFUSE_DECISION_DEFAULT })
      // 이미 기본 도착지인 노드로 다시 끈 선은 바뀔 것이 없어 이유 없이 그대로 둔다
      expect(connectFromFlow(out, graphOf(out), { source: 'pick', target: 'dev' })).toEqual({ yaml: out })
    })
    it('decision_emptyDefault_isTreatedAsMissing', () => {
      const y = FIXTURE.replace('  done: { type: end }', '  done: { type: end }\n  pick: { type: decision, default: ~ }')
      const r = connectFromFlow(y, graphOf(y), { source: 'pick', target: 'dev' })
      expect(r.refused).toBeUndefined()
      expect(doc(r.yaml).nodes.pick.default).toBe('dev')
    })
    // 그래프에 선이 없는 형식이 어긋난 default(맵·숫자·빈 글자)도 사람이 적은 값이라 끈 선이 조용히 덮지 않는다(null·없음만 빈 것)
    it('refuses_decisionWithMalformedDefault', () => {
      for (const value of ['{ to: ~ }', '3', "''"]) {
        const y = FIXTURE.replace('  done: { type: end }', `  done: { type: end }\n  pick: { type: decision, default: ${value} }`)
        expect(connectFromFlow(y, graphOf(y), { source: 'pick', target: 'dev' })).toEqual({ yaml: y, refused: REFUSE_DECISION_DEFAULT })
      }
    })
    // 별칭이 null 을 가리키면 `default: ~` 처럼 빈 것이라 끈 선으로 채운다
    it('connects_decisionWithAliasToNullDefault', () => {
      const y = 'x: &none ~\n' + FIXTURE.replace('  done: { type: end }', '  done: { type: end }\n  pick: { type: decision, default: *none }')
      const r = connectFromFlow(y, graphOf(y), { source: 'pick', target: 'dev' })
      expect(r.refused).toBeUndefined()
      expect(doc(r.yaml).nodes.pick.default).toBe('dev')
    })
    it('refuses_intoStart', () => {
      expect(connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'dev', target: 'start' })).toEqual({ yaml: FIXTURE, refused: REFUSE_INTO_START })
    })
    it('refuses_self', () => {
      expect(connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'dev', target: 'dev' })).toEqual({ yaml: FIXTURE, refused: REFUSE_SELF })
    })
    it('refuses_fromEnd', () => {
      expect(connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'done', target: 'dev' })).toEqual({ yaml: FIXTURE, refused: REFUSE_FROM_END })
    })
    // 상수를 불러 쓰는 테스트가 문구 변경을 못 잡으므로 글자 그대로 고정한다
    it('refuseMessages_areExact', () => {
      expect(REFUSE_NO_ROLE).toBe('역할이 없어 시작 조건을 만들 수 없습니다 — YAML 의 roles 에 역할을 먼저 더해 주세요')
      expect(REFUSE_DECISION_DEFAULT).toBe('이 분기에는 이미 기본 도착지가 있습니다 — 바꾸거나 다른 조건을 더하려면 YAML 에서 고쳐 주세요')
      expect(REFUSE_INTO_START).toBe('시작 노드로 들어가는 선은 만들 수 없습니다')
      expect(REFUSE_SELF).toBe('노드를 자기 자신에 이을 수 없습니다')
      expect(REFUSE_FROM_END).toBe('종료 노드에서는 선을 이을 수 없습니다')
    })
    it('unknownNodes_noReason', () => {
      expect(connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'nope', target: 'dev' })).toEqual({ yaml: FIXTURE })
    })
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

  // 리뷰 후속 ① — 시작 노드에서 끌 때 도착 노드의 역할이 roles 에 없으면 첫 역할로 적는다(서버가 없는 역할을 거절한다)
  it('connectFromFlow_start_undeclaredRole_fallsBackToFirstRole', () => {
    // dev 의 role 은 developer 인데 roles 에는 없다
    const out = connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'start', target: 'dev' }).yaml
    expect(doc(out).start.at(-1)).toEqual({ when: { assigneeRole: 'lead' }, to: 'dev' })
    // 선언된 역할이면 그 역할을 쓴다
    const out2 = connectFromFlow(FIXTURE, graphOf(FIXTURE), { source: 'start', target: 'plan_ok' }).yaml
    expect(doc(out2).start.at(-1)).toEqual({ when: { assigneeRole: 'owner' }, to: 'plan_ok' })
  })

  // 리뷰 후속 ② — 문자열이 아닌 결과 키(1:·true:)도 그 쌍을 찾아 고친다(지우거나 겹쳐 붙이지 않는다)
  it('updateNode_outcomes_nonStringKeys_editInPlace', () => {
    const y = 'nodes:\n  a:\n    type: human_task\n    outcomes:\n      1: { to: b, assignTo: r }\n      true: { to: b }\n  b: { type: end }\n  c: { type: end }\n'
    const detail = readNodeDetail(y, 'a')!
    expect(detail.outcomes.map((o) => o.key)).toEqual(['1', 'true'])
    const out = updateNode(y, 'a', { outcomes: detail.outcomes.map((o) => (o.key === '1' ? { ...o, to: 'c' } : o)) })
    expect(out).toContain('1: { to: c, assignTo: r }')
    expect(out.match(/^ {6}1:/gm)).toHaveLength(1)
    expect(out).toContain('true: { to: b }')
    // 하나를 빼면 그 쌍만 지운다
    const out2 = updateNode(y, 'a', { outcomes: detail.outcomes.filter((o) => o.key !== 'true') })
    expect(Object.keys(doc(out2).nodes.a.outcomes)).toEqual(['1'])
  })

  // 리뷰 후속 ③ — 내놓을 값 이름을 바꾸면 분기 조건의 context 를 따라 고치고, 지우면 그 조건을 지운다
  it('updateNode_outputs_renameOrRemove_syncsContextRefs', () => {
    const y = 'nodes:\n  a:\n    type: agent_task\n    outputs:\n      ok: { type: boolean }\n      url: { type: url }\n  d:\n    type: decision\n    conditions:\n      # 통과 여부\n      - { when: { context: a.ok, equals: true }, to: b }\n      - { when: { context: a.url, equals: x }, to: b }\n      - { when: { context: z.ok, equals: true }, to: b }\n    default: b\n  b: { type: end }\n'
    const renamed = updateNode(y, 'a', { outputs: [{ key: 'passed', type: 'boolean', required: false }, { key: 'url', type: 'url', required: false }] })
    expect(doc(renamed).nodes.d.conditions.map((c: { when: { context: string } }) => c.when.context)).toEqual(['a.passed', 'a.url', 'z.ok'])
    expect(renamed).toContain('# 통과 여부')
    const removed = updateNode(y, 'a', { outputs: [{ key: 'ok', type: 'boolean', required: false }] })
    expect(doc(removed).nodes.d.conditions.map((c: { when: { context: string } }) => c.when.context)).toEqual(['a.ok', 'z.ok'])
    const cleared = updateNode(y, 'a', { outputs: [] })
    expect(doc(cleared).nodes.d.conditions.map((c: { when: { context: string } }) => c.when.context)).toEqual(['z.ok'])
    expect(countContextRefs(y, 'a', 'ok')).toBe(1)
    expect(countContextRefs(y, 'a', 'none')).toBe(0)
  })

  // 조건이 모두 빠지면 빈 conditions: [] 를 남기지 않는다
  it('updateNode_outputs_removeLastRef_dropsEmptyConditions', () => {
    const y = 'nodes:\n  a:\n    type: agent_task\n    outputs:\n      ok: { type: boolean }\n  d:\n    type: decision\n    conditions:\n      - { when: { context: a.ok, equals: true }, to: b }\n    default: b\n  b: { type: end }\n'
    const out = updateNode(y, 'a', { outputs: [] })
    expect(doc(out).nodes.d).toEqual({ type: 'decision', default: 'b' })
  })

  // 리뷰 후속 — 정수 꼴 키가 있어도 패널 줄은 문서 순서라, 자리로 가리는 이름 바뀜이 엉뚱한 값을 고치지 않는다
  it('readNodeDetail_outputs_documentOrder_renameHitsRightPair', () => {
    const y = 'nodes:\n  a:\n    type: agent_task\n    outputs:\n      ok: { type: boolean }\n      1: { type: string }\n  d:\n    type: decision\n    conditions:\n      - { when: { context: a.ok, equals: true }, to: b }\n  b: { type: end }\n'
    const detail = readNodeDetail(y, 'a')!
    expect(detail.outputs.map((o) => o.key)).toEqual(['ok', '1'])
    const out = updateNode(y, 'a', { outputs: detail.outputs.map((o) => (o.key === '1' ? { ...o, key: 'x' } : o)) })
    expect(Object.keys(doc(out).nodes.a.outputs)).toEqual(['ok', 'x'])
    expect(doc(out).nodes.d.conditions[0].when.context).toBe('a.ok')
  })
})
