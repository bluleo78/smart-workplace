import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { nodeSize } from './graphLayout'
import {
  addAskPath,
  addNode,
  addNodeAtFreeSpot,
  autoLayout,
  computeLayout,
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
  type WorkflowGraph,
} from './graphYaml'
import { SPEC } from './specFixture'

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

/** 정렬 공백 픽스처 줄 — 원문 병합에 실패해 전문 재직렬화로 떨어지면 이 줄의 공백이 지워진다(가장 싼 탐지선). */
const CANARY = '  lead:      { name: 팀장,   members: [teamleader@iacloud.kr] }'

/** 줄 단위 diff — 앞·뒤 줄 수가 같을 때 바뀐 줄 쌍만 돌려준다(이슈 완료 기준의 줄 diff). */
const lineDiff = (a: string, b: string): string[][] => {
  const bs = b.split('\n')
  return a
    .split('\n')
    .map((l, i): string[] | null => (l === bs[i] ? null : [l, bs[i]]))
    .filter((x): x is string[] => x !== null)
}

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

  // 좌표가 일부 노드에만 저장된 초안 — 저장 안 된 노드는 자동 배치 자리를 쓴다. 새 노드는 어느 노드와도 겹치면 안 된다
  it('addNodeAtFreeSpot_partialSavedLayout_noOverlapWithAnyNode', () => {
    const partial = FIXTURE + 'layout:\n  start: { x: 500, y: 10 }\n  dev: { x: 20, y: 300 }\n'
    for (const type of ['agent_task', 'decision', 'end'] as const) {
      const r = addNodeAtFreeSpot(partial, type)
      expect(r.key).not.toBe('')
      const g = (parseWorkflowGraph(r.yaml) as { graph: WorkflowGraph }).graph
      const { positions, view } = placeNodes(g)
      const rect = (key: string) => {
        const n = view.nodes.find((v) => v.key === key)!
        const { width, height } = nodeSize(n)
        const p = positions.get(key)!
        return { x1: p.x, y1: p.y, x2: p.x + width, y2: p.y + height }
      }
      const added = rect(r.key)
      for (const n of view.nodes.filter((v) => v.key !== r.key)) {
        const o = rect(n.key)
        const overlap = added.x1 < o.x2 && o.x1 < added.x2 && added.y1 < o.y2 && o.y1 < added.y2
        expect(overlap, `${type} 가 ${n.key} 와 겹침`).toBe(false)
      }
    }
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
    // 키 충돌 — dev_ask 가 다른 노드로 이미 있으면 dev_ask_2 를 쓴다
    const clash = FIXTURE.replace('nodes:\n', 'nodes:\n  dev_ask: { type: end }\n')
    expect(doc(addAskPath(clash, 'dev')).nodes.dev_ask_2.returnTo).toBe('dev')
  })

  it('addAskPath_keepsYamlWhenAskExists', () => {
    const once = addAskPath(FIXTURE, 'dev')
    expect(addAskPath(once, 'dev')).toBe(once)
  })

  // 서버 checkAskPath 와 같은 규칙 — ask.to 가 있는 human_task 를 가리킬 때만 그대로 두고, 깨진 ask 는 다시 채운다
  it.each([
    ['ask.to 가 null', '{ to: null }'],
    ['없는 노드를 가리킴', '{ to: missing_node }'],
    ['human_task 가 아닌 노드를 가리킴', '{ to: triage }'],
  ])('addAskPath_repairsBrokenAsk_%s', (_name, ask) => {
    const y = FIXTURE.replace('      submitted: { to: plan_ok, assignTo: owner }\n', `      submitted: { to: plan_ok, assignTo: owner }\n      ask: ${ask}\n`)
    expect(y).not.toBe(FIXTURE)
    const d = doc(addAskPath(y, 'dev'))
    expect(d.nodes.dev_ask.type).toBe('human_task')
    expect(d.nodes.dev.outcomes.ask.to).toBe('dev_ask')
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
    const real = Object.keys(doc(FIXTURE).nodes)
    for (const k of real) expect(d.layout[k]).toBeDefined()
    // 위→아래 — 시작이 분류보다 위
    expect(d.layout.start.y).toBeLessThan(d.layout.triage.y)
    expect(Object.keys(d.layout).some((k) => k.endsWith('_ask'))).toBe(false)
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
  it('placeNodes_keepsSavedPositionsAndAutoPlacesRest', () => {
    const graphOf = (y: string) => {
      const r = parseWorkflowGraph(y)
      if (!('graph' in r)) throw new Error('parse')
      return r.graph
    }
    const laid = autoLayout(FIXTURE)
    // 좌표를 바꿔 둔 노드는 자동 배치 값이 아니라 쓰여 있는 값을 그대로 쓴다
    const moved = moveNode(laid, 'triage', 7, 9)
    expect(placeNodes(graphOf(moved)).positions.get('triage')).toEqual({ x: 7, y: 9 })
    // 좌표가 없는 노드는 computeLayout 과 같은 자리를 받는다
    const partial = laid.replace(/ {2}triage: \{[^}]*\}\n/, '')
    const g = graphOf(partial)
    expect(placeNodes(g).positions.get('triage')).toEqual(computeLayout(g).get('triage'))
  })

  it('placeNodes_virtualNodesOnlyWhenShowAsk', () => {
    const r = parseWorkflowGraph(`nodes:\n  a: { type: human_task, ask: { role: x } }\nlayout:\n  a: { x: 10, y: 20 }\n`)
    if (!('graph' in r)) throw new Error('parse')
    expect(r.graph.nodes.find((n) => n.virtual)?.virtualParent).toBe('a')
    expect(placeNodes(r.graph, { showAsk: false }).positions.has('a_ask')).toBe(false)
    const { layout } = placeNodes(r.graph, { showAsk: true })
    const a = layout.positions.get('a')
    const ask = layout.positions.get('a_ask')
    const sa = layout.sizes.get('a')
    const sk = layout.sizes.get('a_ask')
    if (!a || !ask || !sa || !sk) throw new Error('missing')
    const overlap = a.x < ask.x + sk.width && ask.x < a.x + sa.width && a.y < ask.y + sk.height && ask.y < a.y + sa.height
    expect(overlap).toBe(false)
  })

  // 숨는 실제 질문 노드는 저장하지 않는다 — 펼친 보기는 저장 좌표를 쓰지 않으므로 접힘 배치에 있는 노드만 담는다
  it('computeLayout_realQuestionNodeOnlyViaAsk_notStored', () => {
    const r = parseWorkflowGraph(
      `nodes:\n  start: { type: start }\n  a:\n    type: agent_task\n    outcomes:\n      ask: { to: q }\n      done: { to: end }\n  q: { type: human_task, returnTo: a }\n  end: { type: end }\nstart:\n  - { to: a }\n`,
    )
    if (!('graph' in r)) throw new Error('parse')
    expect(placeNodes(r.graph, { showAsk: false }).positions.has('q')).toBe(false)
    const pos = computeLayout(r.graph)
    expect(pos.has('q')).toBe(false)
    expect(Number.isInteger(pos.get('a')!.x)).toBe(true)
  })

  it('autoLayout_doesNotStoreHiddenQuestionNodes', () => {
    const out = doc(autoLayout(addAskPath(FIXTURE, 'dev')))
    expect(out.layout.dev_ask).toBeUndefined()
    for (const k of Object.keys(out.nodes).filter((k) => k !== 'dev_ask')) expect(out.layout[k]).toBeDefined()
  })

  it('moveManyFromDrag_createsLayoutWhenMissing', () => {
    const y = FIXTURE
    expect(y).not.toContain('layout:')
    const out = moveManyFromDrag(y, [{ id: 'triage', position: { x: 10.4, y: 20.6 } }])
    expect(doc(out).layout.triage).toEqual({ x: 10, y: 21 })
    const r = parseWorkflowGraph(out)
    if (!('graph' in r)) throw new Error('parse')
    expect(placeNodes(r.graph).positions.get('triage')).toEqual({ x: 10, y: 21 })
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

  // WP-2040 — 원문 병합을 거치면 좌표 한 줄만 바뀐다(정규화 dump 는 정렬 공백을 지워 여러 줄이 흔들린다)
  it('graphYaml_moveNode_layout한줄만바뀐다', () => {
    const out = moveNode(SPEC, 'triage', 260, 40)
    const a = SPEC.split('\n')
    const b = out.split('\n')
    expect(b.length).toBe(a.length)
    const diff = a.map((line, i) => (line === b[i] ? null : [line, b[i]])).filter(Boolean)
    expect(diff).toEqual([['layout: { triage: { x: 200, y: 0 } }      # 그래프 편집기 좌표(선택)',
      'layout: { triage: { x: 260, y: 40 } }      # 그래프 편집기 좌표(선택)']])
    expect(out).toContain('  lead:      { name: 팀장,   members: [teamleader@iacloud.kr] }')
  })

  // WP-2040 — 항목 추가: 기존 노드 블록은 글자 그대로, 추가한 항목만 자리에 끼운다
  it('graphYaml_addNode_기존줄은그대로', () => {
    const r = addNode(SPEC, 'agent_task', { x: 10, y: 20 })
    expect(r.key).toBe('task_1')
    // 기존 노드 블록이 통째로 살아 있다
    expect(r.yaml).toContain('  triage:\n    type: agent_task\n    name: 분류')
    expect(r.yaml).toContain('  lead:      { name: 팀장,')
    // 흐름 맵(layout) 안에 새 좌표가 쉼표로 이어 붙고, 줄 끝 주석까지 원문 그대로다
    expect(r.yaml).toContain('layout: { triage: { x: 200, y: 0 }, task_1: { x: 10, y: 20 } }      # 그래프 편집기 좌표(선택)')
    // 줄은 노드 블록 3줄(key·type·name)만 늘고, layout 은 흐름 한 줄 안의 항목이라 줄 수는 그대로다
    expect(r.yaml.split('\n').length).toBe(SPEC.split('\n').length + 3)
  })

  // WP-2040 — 항목 삭제: 지운 항목 블록만 빠지고, 손대지 않은 칸의 주석·정렬은 남는다
  it('graphYaml_removeNode_지운블록만빠진다', () => {
    const out = removeNode(SPEC, 'plan_ok')
    expect(out).not.toContain('  plan_ok:')
    expect(out).toContain('start:                       # start 노드에서 나가는 자동 연결') // 지우지 않은 칸의 주석 줄은 남는다
    expect(out).toContain('  lead:      { name: 팀장,')
    expect(out).toContain('  dev_ask:                                                 # 질문 경로 — 그래프에 그대로 보인다')
    expect(out).not.toContain('to: plan_ok')
  })

  // WP-2040 — 블록 목록(start) 항목 추가: 이웃 들여쓰기 `- ` 한 줄만 늘고 기존 정렬 줄은 글자 그대로다
  it('graphYaml_start목록에한줄만더해진다', () => {
    const graph = parseWorkflowGraph(SPEC)
    if ('error' in graph) throw new Error(graph.error)
    const out = connectFromFlow(SPEC, graph.graph, { source: 'start', target: 'plan_ok' })
    const added = out.split('\n').filter((l) => !SPEC.split('\n').includes(l))
    expect(added).toEqual(['  - { when: { assigneeRole: owner }, to: plan_ok }'])
    expect(out).toContain('  - { when: { assigneeRole: lead },      to: triage }') // 기존 줄 정렬 유지
  })

  // WP-2040 — 리터럴 블록 지시 값 교체: 지시자 줄은 원문 자리에 남고 내용 줄만 새 값으로 바뀐다
  it('graphYaml_instructions리터럴블록을바꿔도들여쓰기가산다', () => {
    const out = updateNode(SPEC, 'triage', { instructions: '새 지시\n두째 줄' })
    // 실행 결과 확인: 새 값에 끝 개행이 없어 병합은 `|-` 로 쓰고 파싱 값도 끝 개행 없이 돌아온다
    expect(parse(out).nodes.triage.instructions).toBe('새 지시\n두째 줄')
    expect(out).toContain('    instructions: |') // 원문 들여쓰기 자리 유지(값이 바뀌었으니 내용 줄만 바뀐다)
    expect(out).toContain('  lead:      { name: 팀장,')
  })

  // WP-2040 — 블록 목록 가운데 항목 삭제: 지운 항목의 줄만 빠지고 남는 항목의 줄은 글자 그대로다
  it('graphYaml_removeNode_목록가운데항목은그줄만빠진다', () => {
    const out = removeNode(SPEC, 'plan')
    expect(out).toContain('  - { when: { assigneeRole: developer }, to: dev }') // 남는 항목의 줄 원문 그대로
    expect(out).not.toContain('to: plan ')
    expect(out).toContain('  lead:      { name: 팀장,') // 병합 성공(정규화 대체 아님)
    expect(out).toContain('start:                       # start 노드에서 나가는 자동 연결')
  })

  // WP-2040 — 블록 목록 첫 항목 삭제: 남는 항목의 줄은 제자리에서 고치지 않는다
  it('graphYaml_removeNode_목록첫항목을지워도남는줄은원문그대로', () => {
    const out = removeNode(SPEC, 'triage')
    expect(out).toContain('  - { when: { assigneeRole: planner },   to: plan }')
    expect(out).toContain('  - { when: { assigneeRole: developer }, to: dev }')
    expect(out).not.toContain('to: triage')
    expect(out).toContain('  lead:      { name: 팀장,')
  })

  // WP-2040 fix round 1 — 블록 목록 첫 항목의 위 주석은 그 항목과 함께 빠지고,
  // 남는 항목의 위 주석·키 줄의 같은 줄 주석은 살아남는다(주석의 소유 판정)
  it('graphYaml_removeNode_목록첫항목위주석은함께빠지고사이주석은남는다', () => {
    const y = `nodes:
  start: { type: start }
  d:
    type: decision
    conditions:   # 분기 조건
      # 첫 조건 주석
      - { when: { assigneeRole: x }, to: a }
      # 둘 조건 주석
      - { when: { assigneeRole: y },   to: b }
    default: b
  a: { type: end }
  b: { type: end }
`
    const out = removeNode(y, 'a')
    // 첫 항목의 줄과 그 위 주석은 둘 다 빠진다
    expect(out).not.toContain('# 첫 조건 주석')
    expect(out).not.toContain('- { when: { assigneeRole: x }, to: a }')
    // 남는(비첫) 항목의 위 주석과 키 줄 같은 줄 주석은 남는다
    expect(out).toContain('# 둘 조건 주석')
    expect(out).toContain('    conditions:   # 분기 조건')
    // 남는 항목의 줄은 공백까지 원문 그대로(정규화 대체가 아님)
    expect(out).toContain('      - { when: { assigneeRole: y },   to: b }')
    // 파싱 결과도 정확하다
    expect(parse(out).nodes.d.conditions).toEqual([{ when: { assigneeRole: 'y' }, to: 'b' }])
    expect(parse(out).nodes.a).toBeUndefined()
    expect(parse(out).nodes.d.default).toBe('b')
  })

  // WP-2040 — 항목 위 주석 줄: 지운 노드의 것은 그 노드와 함께 빠지고, 남는 노드의 것은 그대로다
  it('graphYaml_removeNode_위주석은함께빠지고남는주석은남는다', () => {
    // C-before 에 항목 위 주석 줄이 없어, 두 경우를 겨우려 주석을 넣어 돌린다
    const y = SPEC.replace('  triage:', '  # 분류 노드\n  triage:').replace('  plan_ok:', '  # 기획 확정\n  plan_ok:')
    const out = removeNode(y, 'plan_ok')
    expect(out).toContain('# 분류 노드')
    expect(out).not.toContain('# 기획 확정')
    expect(out).toContain('  triage:\n    type: agent_task\n    name: 분류')
    expect(out).toContain('  lead:      { name: 팀장,')
  })

  // WP-2040 리뷰 반려 5 — 마지막 노드를 지우면 그 앞 빈 줄이 함께 빠져, 다음 키와의 사이가 빈 줄 하나여야 한다
  // (앞 항목 꼬리에 남으면 앞 빈 줄 + 뒤 빈 줄이 겹쳐 빈 줄 둘이 생긴다)
  it('graphYaml_removeNode_마지막노드를지워도빈줄이하나만남는다', () => {
    const out = removeNode(SPEC, 'done')
    expect(out).toContain('      rework: { to: dev, assignTo: keep, requireComment: true }\n\nstart:')
    expect(out).not.toContain('requireComment: true }\n\n\nstart:')
    expect(parse(out).nodes.done).toBeUndefined()
    expect(parse(out).start.length).toBe(3)
  })

  // WP-2040 Task 5 — 기존 계약: 파싱 오류·fn 거절은 입력을 덮지 않는다
  it('graphYaml_fn이거절하면입력그대로', () => {
    expect(updateNode('a: [', 'x', { name: 'y' })).toBe('a: [') // 파싱 오류 입력
    expect(updateNode(FIXTURE, 'nope', { name: 'y' })).toBe(FIXTURE) // 없는 노드라 fn 이 거절
    // 파싱 오류지만 루트는 맵이라 fn 이 고칠 수도 있는 입력 — 그래도 게이트가 입력을 지킨다
    expect(moveNode('layout: { a: 1', 'triage', 1, 2)).toBe('layout: { a: 1')
    expect(addNode('a: [', 'agent_task')).toEqual({ yaml: 'a: [', key: '' }) // addNode 의 실패 계약도 그대로
  })

  // WP-2040 Task 5 — 병합 불가(null) → 정규화 dump 대체: 빈 문서에는 병합 범위가 없지만 편집 의도는 그대로다
  it('graphYaml_빈문서에편집해도유효하다', () => {
    const out = moveNode('', 'triage', 1, 2)
    expect(parse(out).layout).toEqual({ triage: { x: 1, y: 2 } })
  })

  // WP-2040 Task 5 — 빈 흐름 컨테이너: 좌표·노드를 넣어도 유효한 YAML, 파싱 값도 의도와 같다
  it('graphYaml_빈흐름맵에좌표를넣어도유효하다', () => {
    const out = moveNode('layout: {}\n', 'triage', 1, 2)
    expect(parse(out).layout).toEqual({ triage: { x: 1, y: 2 } })
  })

  it('graphYaml_빈흐름맵에노드를더해도유효하다', () => {
    const r = addNode('nodes: {}\n', 'agent_task', { x: 1, y: 2 })
    const d = parse(r.yaml)
    expect(d.nodes[r.key]).toEqual({ type: 'agent_task', name: '새 AI 작업' })
    expect(d.layout[r.key]).toEqual({ x: 1, y: 2 })
  })

  // WP-2040 Task 5 — 리뷰 포커스 1: 병합 검증이 실패하는 자리에서도 편집 의도와 같은 출력이 나온다
  // (유일한 노드 삭제는 원문 병합이 값을 잃혀 `nodes:`(null)로 만들 수 있다 — editDoc 은 dump 로 대체)
  it('graphYaml_병합검증실패시에도편집의도와같은출력', () => {
    const out = removeNode('nodes:\n  a: { type: end }\n', 'a')
    expect(parse(out)).toEqual({ nodes: {} })
  })

  // WP-2040 Task 6 — 질문 경로 만들기도 원문 병합을 거쳐, 손대지 않은 기존 블록의 정렬·주석이 그대로다
  it('graphYaml_addAskPath_기존블록은원문그대로', () => {
    const out = addAskPath(SPEC, 'dev')
    expect(out).toContain('  lead:      { name: 팀장,   members: [teamleader@iacloud.kr] }')
    expect(out).toContain('  need_plan: { to: plan,  assignTo: planner }    # 넘길 때 담당을 그 역할로 바꿈')
  })

  // WP-2040 Task 6 — 이슈 재현: 노드 하나를 옮기면 diff 는 layout 한 줄뿐이다(줄 단위, 이슈 완료 기준)
  it('graphYaml_이슈재현_노드하나옮기면diff는layout뿐', () => {
    const out = moveNode(SPEC, 'triage', 260, 40)
    expect(out.split('\n').filter((l, i) => l !== SPEC.split('\n')[i])).toHaveLength(1)
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

// WP-2040 최종 리뷰 finding 회귀 — 원문 병합 층(sourcePreserve)의 결함마다 한 건
describe('graphYaml 최종 리뷰(앞 라운드) finding', () => {
  // finding 1 — 블록 맵 첫 키를 지워도 남는 줄의 들여쓰기는 제자리다(접두에 실린 첫 줄 들여쓰기 + 항목 들여쓰기 이중 붙음 방지)
  it('graphYaml_updateNode_결과맵첫항목을지워도남는줄은제자리다', () => {
    const detail = readNodeDetail(SPEC, 'triage')!
    const out = updateNode(SPEC, 'triage', { outcomes: detail.outcomes.filter((o) => o.key !== 'need_plan') })
    expect(out).toContain(CANARY)
    expect(out).not.toContain('need_plan')
    const ready = out.split('\n').find((l) => l.includes('ready:'))
    expect(ready).toBe('      ready:     { to: dev,   assignTo: developer }') // 들여쓰기 6칸·정렬 공백까지 원문 그대로
    expect(parse(out).nodes.triage.outcomes).toEqual({ ready: { to: 'dev', assignTo: 'developer' } })
  })

  // finding 1 — nodes 맵 첫 노드(멀티라인 블록 생존자가 뒤에)를 지워도 전체 dump 로 떨어지지 않는다
  it('graphYaml_removeNode_노드맵첫항목을지워도남는블록은원문그대로', () => {
    const out = removeNode(SPEC, 'start')
    expect(out).toContain(CANARY) // dump 대체면 정렬 공백이 지워진다
    expect(out).toContain('  triage:\n    type: agent_task\n    name: 분류')
    expect(out).not.toContain('  start:   { type: start }')
    expect(parse(out).nodes.start).toBeUndefined()
  })

  // finding 2 — 흐름 목록에서 항목을 빼거나 다른 목록으로 바꿔도 원문 병합이 null 로 떨어지지 않는다(전문 재직렬화 아님)
  it('graphYaml_updateNode_requires흐름목록은그줄만바뀐다', () => {
    const y = SPEC.replace('    role: lead\n', '    role: lead\n    requires: [one, two]\n')
    const del = updateNode(y, 'triage', { requires: ['one'] }) // 항목 하나 제거
    expect(del).toContain(CANARY)
    expect(lineDiff(y, del)).toEqual([['    requires: [one, two]', '    requires: [ one ]']])
    const set = updateNode(y, 'triage', { requires: ['one', 'three'] }) // 다른 목록으로 교체
    expect(set).toContain(CANARY)
    expect(lineDiff(y, set)).toEqual([['    requires: [one, two]', '    requires: [ one, three ]']])
    expect(parse(del).nodes.triage.requires).toEqual(['one'])
    expect(parse(set).nodes.triage.requires).toEqual(['one', 'three'])
  })

  // finding 3 — 새로 끼운 항목도 흐름 표기 그대로 한 줄이다(블록 여러 줄로 흩어지지 않는다)
  it('graphYaml_새로끼운결과와requires는흐름한줄이다', () => {
    const out = connectOutcome(SPEC, 'triage', 'fresh', 'done')
    expect(out).toContain('      fresh: { to: done }') // 이웃 결과(`ready:     { … }`)와 같은 한 줄 표기
    expect(out).toContain(CANARY)
    expect(parse(out).nodes.triage.outcomes.fresh).toEqual({ to: 'done' })
    const r = updateNode(SPEC, 'triage', { requires: ['one'] })
    expect(r).toContain('    requires: [ one ]')
    expect(r).toContain(CANARY)
    expect(parse(r).nodes.triage.requires).toEqual(['one'])
  })
})

// WP-2040 최종 리뷰(마지막 라운드) finding 1~6 — 위 describe 는 앞 라운드 finding 번호를 쓰므로 새로 나눈다
describe('graphYaml 최종 리뷰(마지막 라운드) finding 1~6', () => {
  /** flow 한 줄 outputs 를 항목 위 주석이 달린 블록 맵으로 바꾼 SPEC — 이름 바뀜·추가 시 주석 보존을 겨운다. */
  const SPEC_BLOCK_OUTPUTS = SPEC.replace(
    '    outputs: { planDoc: { type: url, required: true } }   # 나갈 때 꼭 내놓을 값(검증기)',
    '    outputs:\n      # 문서 주소\n      planDoc: { type: url, required: true }\n      # 메모\n      memo: { type: string }',
  )

  // finding 1 — 결과 키 이름만 바꾸면 원문 자리에 키만 바뀐다(정렬 공백 픽스처라 전문 dump 면 canary 가 지워진다)
  it('graphYaml_updateNode_결과키이름만바꿔도정렬공백은남는다', () => {
    const out = updateNode(SPEC, 'plan', { outputs: [{ key: 'planDoc2', type: 'url', required: true }] })
    expect(out).toContain(CANARY)
    const a = SPEC.split('\n')
    const b = out.split('\n')
    expect(b).toHaveLength(a.length)
    const changed = b.filter((l, i) => l !== a[i])
    expect(changed).toHaveLength(1) // diff 는 outputs 줄 하나뿐이다(이슈 완료 기준)
    expect(changed[0]).toContain('outputs: { planDoc2: { type: url, required: true } }')
    expect(changed[0]).toContain('# 나갈 때 꼭 내놓을 값(검증기)') // 줄 끝 주석 간격까지 원문 자리
    expect(parse(out).nodes.plan.outputs).toEqual({ planDoc2: { type: 'url', required: true } })
  })

  // finding 2 — 같은 rename 시나리오를 정렬 공백 픽스처(SPEC)로도 돈다(이전엔 FIXTURE 만 써 dump 경로로도 통과했다)
  it('graphYaml_updateNode_블록형결과맵에서이름바꾸기도원문병합이된다', () => {
    const out = updateNode(SPEC_BLOCK_OUTPUTS, 'plan', { outputs: [
      { key: 'planDoc2', type: 'url', required: true },
      { key: 'memo', type: 'string', required: false },
    ] })
    expect(out).toContain(CANARY)
    expect(out).toContain('      # 문서 주소\n      planDoc2:') // 항목 위 주석은 그 자리에
    expect(out).toContain('      # 메모\n      memo:')
    expect(out).not.toContain('extra')
    expect(parse(out).nodes.plan.outputs).toEqual({
      planDoc2: { type: 'url', required: true },
      memo: { type: 'string' },
    })
  })

  // finding 3 — 이슈 재현 진입점: 여러 노드를 한 번에 끌어도 diff 는 layout 줄 하나뿐이다
  it('graphYaml_이슈재현_여러노드를끌어도diff는layout뿐', () => {
    const out = moveManyFromDrag(SPEC, [
      { id: 'triage', position: { x: 120.4, y: 30.6 } },
      { id: 'plan', position: { x: 400, y: 10 } },
    ])
    expect(out).toContain(CANARY)
    const a = SPEC.split('\n')
    expect(out.split('\n')).toHaveLength(a.length)
    expect(out.split('\n').filter((l, i) => l !== a[i])).toHaveLength(1)
    expect(parse(out).layout).toEqual({ triage: { x: 120, y: 31 }, plan: { x: 400, y: 10 } })
  })

  // finding 3 — 자동 정렬도 layout 줄 하나만 바꾸고 나머지는 원문이다
  it('graphYaml_이슈재현_자동정렬도diff는layout뿐', () => {
    const out = autoLayout(SPEC)
    expect(out).toContain(CANARY)
    const a = SPEC.split('\n')
    expect(out.split('\n')).toHaveLength(a.length)
    expect(out.split('\n').filter((l, i) => l !== a[i])).toHaveLength(1)
    expect(parse(out).layout.triage).toEqual({ x: 240, y: 0 })
    expect(parse(out).layout.plan).toBeDefined() // 모든 노드 좌표가 한 줄 안에 들어간다
  })

  // finding 4 — 같은 편집에서 새로 만든 컨테이너는 자식 flow 표기 그대로 두 줄로 받친다(블록 여러 줄로 흩어지지 않는다)
  it('graphYaml_새로만든결과맵은흐름표기그대로두줄이다', () => {
    const y = SPEC.replace('    outcomes:\n      done: { to: plan_ok, assignTo: owner }\n', '')
    const g = parseWorkflowGraph(y)
    if ('error' in g) throw new Error(g.error)
    const out = connectFromFlow(y, g.graph, { source: 'plan', target: 'dev' })
    expect(out).toContain(CANARY)
    expect(out).toContain('    outcomes:\n      done: { to: dev }') // 3~4 줄로 흩어지지 않는다
    expect(parse(out).nodes.plan.outcomes).toEqual({ done: { to: 'dev' } })
    // ask 도 결과 칸을 새로 만들 때 한 줄로 남는다
    const ask = addAskPath(y, 'plan')
    expect(ask).toContain(CANARY)
    expect(ask).toContain('    outcomes:\n      ask: { to: plan_ask')
    expect(parse(ask).nodes.plan.outcomes.ask.to).toBe('plan_ask')
  })

  // finding 5 — 한 패치에 "키 이름 바꾸기 + 추가" 가 같이 와도 항목 위 주석이 유실되지 않는다
  it('graphYaml_updateNode_이름바꾸기와추가를한번에해도위주석이남는다', () => {
    const out = updateNode(SPEC_BLOCK_OUTPUTS, 'plan', { outputs: [
      { key: 'planDoc2', type: 'url', required: true },
      { key: 'memo', type: 'string', required: false },
      { key: 'extra', type: 'number', required: false },
    ] })
    expect(out).toContain(CANARY)
    expect(out).toContain('      # 문서 주소\n      planDoc2:')
    expect(out).toContain('      # 메모\n      memo:')
    expect(out).toContain('      extra: { type: number }') // 추가 항목은 이웃 6칸에 끼워진다
    expect(parse(out).nodes.plan.outputs).toEqual({
      planDoc2: { type: 'url', required: true },
      memo: { type: 'string' },
      extra: { type: 'number' },
    })
  })
})

// WP-2040 6번 코드 리뷰 — 위 describe 들은 앞 라운드 finding 번호를 쓰므로 새로 나눈다.
// 완료 기준: 그래프 편집 후 layout 관련 줄만 바뀌고 손대지 않은 줄은 글자 그대로다(줄 diff 로 고정).
describe('graphYaml 6번 코드 리뷰', () => {
  // Important 1 — 빈 흐름 맵(layout: {})에 항목을 넣어도 전문 재직렬화로 떨어지지 않는다.
  // (허용 쪽: 원문이 흐름 자리면 추가 결과도 흐름 한 줄 — 계획 Task 5 Step 3 약속.
  //  위 '빈흐름맵에좌표를넣어도유효하다' 단언은 유효성만 봐 이 약속의 공백을 가렸다.)
  it('graphYaml_빈흐름맵layout에좌표넣어도나머지줄은원문이다', () => {
    const y = SPEC.replace('layout: { triage: { x: 200, y: 0 } }      # 그래프 편집기 좌표(선택)',
      'layout: {}      # 그래프 편집기 좌표(선택)')
    const out = moveNode(y, 'triage', 260, 40)
    expect(out).toContain(CANARY) // 정렬 공백 픽스처가 살아있다(전문 dump 면 지워진다)
    const diff = lineDiff(y, out)
    expect(diff).toHaveLength(1) // 바뀐 줄은 layout 하나뿐이다
    expect(diff[0][0]).toBe('layout: {}      # 그래프 편집기 좌표(선택)')
    expect(diff[0][1]).toBe('layout: { triage: { x: 260, y: 40 } }      # 그래프 편집기 좌표(선택)') // 줄 끝 주석 간격까지 원문 자리
    expect(parse(out).layout).toEqual({ triage: { x: 260, y: 40 } })
  })

  // Important 1 — 같은 약속을 outputs: {} 에 값 추가로도 고정한다(리뷰 실측 68 줄 재작성 자리)
  it('graphYaml_빈흐름맵outputs에값더해도나머지줄은원문이다', () => {
    const y = SPEC.replace('    outputs: { planDoc: { type: url, required: true } }   # 나갈 때 꼭 내놓을 값(검증기)',
      '    outputs: {}   # 나갈 때 꼭 내놓을 값(검증기)')
    const out = updateNode(y, 'plan', { outputs: [{ key: 'planDoc', type: 'url', required: true }] })
    expect(out).toContain(CANARY)
    const diff = lineDiff(y, out)
    expect(diff).toHaveLength(1)
    expect(diff[0][0]).toBe('    outputs: {}   # 나갈 때 꼭 내놓을 값(검증기)')
    expect(diff[0][1]).toBe('    outputs: { planDoc: { type: url, required: true } }   # 나갈 때 꼭 내놓을 값(검증기)')
    expect(parse(out).nodes.plan.outputs).toEqual({ planDoc: { type: 'url', required: true } })
  })

  // 재반려 finding 3 — removeNode 가 start 목록을 비게 하면 필수 키 start 를 통째로 지우지 않고
  // `start: []` 로 남긴다(키가 없으면 발행 검증이 거부된다). 나머지 줄은 글자 그대로여야 한다(공백까지 비교)
  it('graphYaml_removeNode_start목록이비면빈목록으로남고나머지줄은원문이다', () => {
    const y = `schema: genia/workflow@1
roles:
  lead:      { name: 팀장,   members: [teamleader@iacloud.kr] }
nodes:
  start:   { type: start }
  a:       { type: end }
  b:       { type: agent_task, name: 남는 노드 }
start:                       # start 노드에서 나가는 자동 연결
  - { when: { assigneeRole: lead },   to: a }
  - { when: { assigneeRole: owner },  to: a }
layout: { b: { x: 3, y: 4 } }      # 그래프 편집기 좌표(선택)
`
    const out = removeNode(y, 'a')
    // 기대값 = 원문에서 항목 두 줄만 빈 목록(`[]`)으로 바꾼 것 — 나머지는 글자 그대로여야 한다
    const expected = y
      .replace('  a:       { type: end }\n', '')
      .replace(
        'start:                       # start 노드에서 나가는 자동 연결\n  - { when: { assigneeRole: lead },   to: a }\n  - { when: { assigneeRole: owner },  to: a }\n',
        'start:                       # start 노드에서 나가는 자동 연결\n  []\n',
      )
    expect(out).toBe(expected)
    expect(out).toContain(CANARY)
    expect(out).toContain('layout: { b: { x: 3, y: 4 } }      # 그래프 편집기 좌표(선택)')
    const d = parse(out)
    expect(d.start).toEqual([]) // 필수 키라 비어도(`start: []`) 칸째 지우지 않는다
    expect(d.nodes.a).toBeUndefined()
    expect(d.nodes.b).toBeDefined()
    expect(d.layout).toEqual({ b: { x: 3, y: 4 } })
  })

  // Minor 3 — CRLF 원문에 새 항목을 넣어도 개행이 섞이지 않는다(bare LF 한 줄이면 편집기·diff 가 갈라 읽는다)
  it('graphYaml_CRLF원문에새줄을넣어도개행이섞이지않는다', () => {
    const y = SPEC.replace(/\n/g, '\r\n')
    const out = updateNode(y, 'triage', { requires: ['one'] })
    expect(out).toContain(CANARY)
    expect(/\n/.test(out.replace(/\r\n/g, ''))).toBe(false) // CRLF 말고 다른 개행이 하나도 없다
    expect(parse(out).nodes.triage.requires).toEqual(['one'])
    // 삽입한 줄 하나만 늘고 나머지는 원문 그대로다(줄 수 비교는 개행이 달라 길이 비교로만)
    expect(out.split('\r\n')).toHaveLength(y.split('\r\n').length + 1)
    expect(out).toContain('    requires: [ one ]\r\n')
  })

  // 재반려 finding 6 — 빈 `nodes: {}` 템플릿에 노드를 넣으면 한 줄에 못 끼우는 블록 값 때문에
  // 병합이 거부돼 전문 정규화 dump 로 떨어졌다(머리 주석·정렬 공백까지 바뀐다)
  it('graphYaml_addNode_빈nodes플로우맵에도노드블록을세우고원문줄은남는다', () => {
    const y = 'schema: genia/workflow@1   # 머리 주석\nnodes: {}   # 비어 있는 노드 맵\n'
    const r = addNode(y, 'agent_task', { x: 0, y: 0 })
    expect(r.key).not.toBe('')
    // 손대지 않은 머리 줄은 글자 그대로, `nodes` 키 줄의 주석은 키 줄에 남고 값은 아래 블록으로 세워진다
    expect(r.yaml).toBe(
      `schema: genia/workflow@1   # 머리 주석\nnodes:   # 비어 있는 노드 맵\n  ${r.key}:\n    type: agent_task\n    name: 새 AI 작업\nlayout:\n  ${r.key}: { x: 0, y: 0 }\n`,
    )
    const d = parse(r.yaml)
    expect(d.nodes[r.key]).toEqual({ type: 'agent_task', name: '새 AI 작업' })
    expect(d.layout).toEqual({ [r.key]: { x: 0, y: 0 } })
  })

  // 재반려 — 같이 고칠 것: 빈 `outcomes: {}` 에 결과를 이어도 한 줄로 남아 dump 로 떨어지지 않는다
  it('graphYaml_updateNode_빈outcomes에결과를이으면흐름으로남는다', () => {
    const y = 'schema: genia/workflow@1\nnodes:\n  a:\n    type: decision\n    outcomes: {}\n  b: { type: end }\n'
    const out = updateNode(y, 'a', {
      outcomes: [{ key: 'done', to: 'b', requireComment: false }],
    })
    expect(out).toContain('    outcomes: { done: { to: b } }') // 한 줄 흐름으로 이어 붙는다(전문 재직렬화 아님)
    expect(out).toContain('  b: { type: end }') // 손대지 않은 줄은 글자 그대로
    expect(parse(out).nodes.a.outcomes).toEqual({ done: { to: 'b' } })
  })
})
