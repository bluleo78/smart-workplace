/**
 * 워크플로우 초안 YAML 을 그래프로 읽고, 그래프 편집을 YAML 에 되쓰는 순수 함수 모음.
 *
 * 왜 yaml 의 Document API 인가: 원본이 YAML 문서라 주석·키 순서·흐름 스타일을 지켜야 한다.
 * 편집은 모두 parseDocument → 해당 노드만 고침 → toString 이고, 고치지 않은 부분은 글자 그대로 남는다.
 * 파싱 오류가 있는 문서는 편집 함수가 받은 문자열을 그대로 돌려준다(편집기가 망가진 글을 덮지 않게).
 */
import { Document, isMap, isScalar, isSeq, type Pair, parseDocument, Scalar, YAMLMap, type YAMLSeq } from 'yaml'

import { computeGraphLayout, type GraphLayoutResult, type VisibleGraph, visibleGraph } from './graphLayout'

export type GraphNodeType = 'start' | 'agent_task' | 'human_task' | 'decision' | 'end' | string

export interface GraphNode {
  key: string
  type: GraphNodeType
  name?: string
  role?: string
  position?: { x: number; y: number }
  /** ask 줄임 표기가 그리는 가상 노드(YAML 에는 아직 없다) */
  virtual?: boolean
  /** 가상 노드를 만든 실제 노드의 키 — 배치할 때 부모 아래로 놓는 데 쓴다 */
  virtualParent?: string
  /** decision 의 default 칸에 사람이 적은(null 이 아닌) 값이 있다 — 형식이 어긋나 선으로 그리지 못한 값(`{ to: ~ }`·`3`·`''`)도 든다 */
  hasDefault?: boolean
}

export type GraphEdgeKind = 'outcome' | 'start' | 'condition' | 'default' | 'onError' | 'returnTo' | 'ask'

export interface GraphEdge {
  id: string
  from: string
  to: string
  kind: GraphEdgeKind
  label: string
}

export interface NodeDetail {
  key: string
  type: string
  name?: string
  role?: string
  requires: string[]
  instructions?: string
  use: string[]
  outputs: { key: string; type: string; required: boolean }[]
  outcomes: { key: string; to: string; assignTo?: string; requireComment: boolean }[]
  maxVisits?: number
}

export interface WorkflowGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  roles: { key: string; name?: string }[]
  shared: string[]
}

export type NewNodeType = 'start' | 'agent_task' | 'human_task' | 'decision' | 'end'

export interface NodePatch {
  name?: string | null
  role?: string | null
  requires?: string[]
  instructions?: string | null
  use?: string[]
  outputs?: NodeDetail['outputs']
  outcomes?: NodeDetail['outcomes']
  maxVisits?: number | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/** 지금 문서를 평범한 객체로 읽는다. */
function js(doc: Document): Json {
  return (doc.toJS() ?? {}) as Json
}

/**
 * 고친 문서를 문자열로 쓴다 — 모든 편집 함수가 이 하나를 거친다.
 * lineWidth: 0 이라야 80자를 넘는 긴 문자열(이름·지시)이 여러 줄로 접히지 않아, 그래프 편집 뒤 YAML diff 에
 * 손대지 않은 줄의 접힘 변화가 섞이지 않는다.
 */
function dump(doc: Document): string {
  return doc.toString({ lineWidth: 0 })
}

/**
 * 편집 함수의 공통 틀 — parseDocument → 파싱 오류면 입력 그대로 → fn 이 고침 → dump.
 * fn 이 false 를 돌려주면(고칠 수 없는 모양) 입력을 그대로 돌려준다.
 */
function editDoc(yaml: string, fn: (doc: Document) => boolean | void): string {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0 || fn(doc) === false) return yaml
  return dump(doc)
}

/** path 의 맵이 비어 있으면 칸째 지운다(빈 `layout: {}` 같은 찌꺼기를 남기지 않는다). */
function deleteIfEmptyMap(doc: Document, path: string[]) {
  const m = doc.getIn(path, true)
  if (isMap(m) && m.items.length === 0) doc.deleteIn(path)
}

/** 맵 쌍의 키를 문자열로 읽는다. */
function pairKey(pair: Pair): string {
  return isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
}

/**
 * path 의 맵을 돌려준다 — 편집 함수가 던지지 않게 하는 공용 관문이다.
 * - 칸이 없거나 null(`layout: ~`, 값 없는 `nodes:`)이면 새 블록 맵으로 바꿔 넣는다.
 * - 맵이 아닌 다른 값(`layout: []`, 문자열 등)이면 null — 호출자는 입력을 그대로 돌려준다(사람이 쓴 값을 덮지 않는다).
 * - 비어 있는 흐름 맵(만들기 템플릿의 `nodes: {}`)은 블록 스타일로 바꾼다. 흐름 맵 안에 넣으면 새 노드가 한 줄에 몰리고
 *   여러 줄 지시가 `\n` 이스케이프로 써져 사람이 읽을 수 없기 때문이다.
 */
function mapAt(doc: Document, path: string[]): YAMLMap | null {
  if (doc.contents === null || (isScalar(doc.contents) && doc.contents.value == null)) doc.contents = blockMap(doc)
  if (!isMap(doc.contents)) return null
  let cur: YAMLMap = doc.contents
  for (const seg of path) {
    let next: unknown = cur.get(seg, true)
    if (next === undefined || next === null || (isScalar(next) && next.value == null)) {
      next = blockMap(doc)
      cur.set(seg, next)
    }
    if (!isMap(next)) return null
    if (next.flow && next.items.length === 0) next.flow = false
    cur = next
  }
  return cur
}

/** 빈 블록 맵 노드. */
function blockMap(doc: Document): YAMLMap {
  const m = doc.createNode({}) as YAMLMap
  m.flow = false
  return m
}

/** 흐름 스타일(`{ x: 1, y: 2 }`)의 작은 맵 노드를 만든다 — 좌표·결과 한 줄 표기용. */
function flowMap(doc: Document, value: Record<string, unknown>): YAMLMap {
  const n = doc.createNode(value) as YAMLMap
  n.flow = true
  return n
}

/** 문자열 칸 값 — 여러 줄이면 블록 리터럴(`|`)로 써서 사람이 읽기 쉽게 둔다. */
function textNode(doc: Document, text: string): Scalar {
  const s = doc.createNode(text) as Scalar
  if (text.includes('\n')) s.type = Scalar.BLOCK_LITERAL
  return s
}

/** 노드 이름·역할 같은 평범한 필드 읽기. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function edgeId(from: string, to: string, kind: GraphEdgeKind, label: string): string {
  return `${from}->${to}:${kind}:${label}`
}

/** 같은 id 가 이미 있으면 뒤에 #2, #3… 을 붙여 유일하게 만든다 — ReactFlow 는 id 가 겹치는 선을 하나만 그린다. */
function uniqueId(used: Map<string, number>, id: string): string {
  const n = (used.get(id) ?? 0) + 1
  used.set(id, n)
  return n === 1 ? id : `${id}#${n}`
}

/** YAML 을 그래프(노드·선·역할·공용 지시 이름)로 읽는다. 파싱 오류면 error. */
export function parseWorkflowGraph(yaml: string): { graph: WorkflowGraph } | { error: string } {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return { error: doc.errors[0].message }
  return { graph: readGraph(doc) }
}

/** 이미 파싱한 문서에서 그래프를 읽는다 — 문서를 또 파싱하지 않으려고 편집 함수도 이걸 쓴다. */
function readGraph(doc: Document): WorkflowGraph {
  const root = js(doc)
  const rawNodes: Record<string, Json> = isPlain(root.nodes) ? root.nodes : {}
  const layout: Record<string, Json> = isPlain(root.layout) ? root.layout : {}

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const used = new Map<string, number>()
  const add = (from: string, to: unknown, kind: GraphEdgeKind, label: string) => {
    if (typeof to === 'string' && to) edges.push({ id: uniqueId(used, edgeId(from, to, kind, label)), from, to, kind, label })
  }

  for (const [key, raw] of Object.entries(rawNodes)) {
    const n: Json = isPlain(raw) ? raw : {}
    const pos = layout[key]
    nodes.push({
      key,
      type: str(n.type) ?? '',
      name: str(n.name),
      role: str(n.role),
      ...(isPlain(pos) && typeof pos.x === 'number' && typeof pos.y === 'number'
        ? { position: { x: pos.x, y: pos.y } }
        : {}),
      // 별칭은 js() 가 풀어 둔다 — 별칭이 null 이면 `default: ~` 처럼 빈 것이다
      ...(n.default != null ? { hasDefault: true } : {}),
    })
    // 선택 이동 — 결과 키가 ask 면 질문 경로 선
    if (isPlain(n.outcomes)) {
      for (const [ok, o] of Object.entries(n.outcomes as Record<string, Json>)) {
        add(key, isPlain(o) ? o.to : undefined, ok === 'ask' ? 'ask' : 'outcome', ok)
      }
    }
    // decision 의 자동 이동
    if (Array.isArray(n.conditions)) {
      n.conditions.forEach((c: Json, i: number) => add(key, isPlain(c) ? c.to : undefined, 'condition', `조건 ${i + 1}`))
    }
    add(key, typeof n.default === 'string' ? n.default : isPlain(n.default) ? n.default.to : undefined, 'default', '기본')
    if (isPlain(n.onError)) add(key, n.onError.to, 'onError', '오류')
    add(key, n.returnTo, 'returnTo', '돌아가기')
    // ask 줄임 표기 — 펼친 형태가 될 가상 노드와 두 선을 그려 준다
    // 같은 키의 실제 노드가 이미 있으면 가상 노드·선을 만들지 않는다(키가 겹쳐 실제 노드가 가려진다)
    if (isPlain(n.ask) && !(isPlain(n.outcomes) && 'ask' in n.outcomes) && !(`${key}_ask` in rawNodes)) {
      const vKey = `${key}_ask`
      nodes.push({
        key: vKey,
        type: 'human_task',
        name: `${str(n.name) ?? key} 질문 답변`,
        role: str(n.ask.role),
        virtual: true,
        virtualParent: key,
      })
      add(key, vKey, 'ask', 'ask')
      add(vKey, key, 'returnTo', '돌아가기')
    }
  }

  // 최상위 start 목록은 start 노드에서 나가는 선
  const startKey = nodes.find((n) => n.type === 'start')?.key ?? 'start'
  if (Array.isArray(root.start)) {
    root.start.forEach((c: Json, i: number) => {
      const role = isPlain(c) && isPlain(c.when) ? str(c.when.assigneeRole) : undefined
      add(startKey, isPlain(c) ? c.to : undefined, 'start', role ? `담당=${role}` : `조건 ${i + 1}`)
    })
  }

  const roles = isPlain(root.roles)
    ? Object.entries(root.roles as Record<string, Json>).map(([key, r]) => ({ key, name: isPlain(r) ? str(r.name) : undefined }))
    : []
  const shared = isPlain(root.shared) ? Object.keys(root.shared) : []
  return { nodes, edges, roles, shared }
}

function isPlain(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 한 노드의 편집 폼용 상세. 없는 노드면 null. */
export function readNodeDetail(yaml: string, key: string): NodeDetail | null {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return null
  const n = js(doc).nodes?.[key]
  if (!isPlain(n)) return null
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  // 내놓을 값·결과는 문서의 쌍 순서대로 읽는다 — Object.entries 는 `1:` 같은 정수 꼴 키를 앞으로 당겨,
  // 패널의 줄 순서와 문서 순서가 어긋나면 자리로 이름 바뀜을 가리는 applyOutputs 가 엉뚱한 값을 고친다
  const ordered = (field: 'outputs' | 'outcomes'): [string, Json][] => {
    const m = doc.getIn(['nodes', key, field], true)
    const values: Record<string, Json> = isPlain(n[field]) ? n[field] : {}
    return isMap(m) ? (m.items as Pair[]).map((p) => [pairKey(p), values[pairKey(p)]]) : []
  }
  return {
    key,
    type: str(n.type) ?? '',
    name: str(n.name),
    role: str(n.role),
    requires: strs(n.requires),
    instructions: str(n.instructions),
    use: strs(n.use),
    outputs: ordered('outputs').map(([k, o]) => ({
      key: k,
      type: isPlain(o) ? (str(o.type) ?? 'string') : 'string',
      required: isPlain(o) ? o.required === true : false,
    })),
    outcomes: ordered('outcomes').map(([k, o]) => ({
      key: k,
      to: isPlain(o) ? (str(o.to) ?? '') : '',
      ...(isPlain(o) && str(o.assignTo) ? { assignTo: str(o.assignTo) } : {}),
      requireComment: isPlain(o) && o.requireComment === true,
    })),
    maxVisits: typeof n.maxVisits === 'number' ? n.maxVisits : undefined,
  }
}

/** 새 노드 키 — 접두 + _n, n 은 1 부터 비어 있는 첫 값. */
function freeKey(existing: Set<string>, prefix: string): string {
  let n = 1
  while (existing.has(`${prefix}_${n}`)) n++
  return `${prefix}_${n}`
}

const NEW_NODE: Record<NewNodeType, { prefix: string; name?: string }> = {
  start: { prefix: 'start' },
  agent_task: { prefix: 'task', name: '새 AI 작업' },
  human_task: { prefix: 'human', name: '새 사람 차례' },
  decision: { prefix: 'decision', name: '분기' },
  end: { prefix: 'end' },
}

/** 노드를 하나 더한다. at 이 있으면 layout 에 좌표도 쓴다. */
export function addNode(yaml: string, type: NewNodeType, at?: { x: number; y: number }): { yaml: string; key: string } {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return { yaml, key: '' }
  const nodes = mapAt(doc, ['nodes'])
  if (!nodes) return { yaml, key: '' }
  const keys = new Set(nodes.items.map(pairKey))
  const spec = NEW_NODE[type]
  // 시작 노드는 관례대로 'start' 를 먼저 쓰고, 이미 있으면 start_<n>
  const key = type === 'start' && !keys.has('start') ? 'start' : freeKey(keys, spec.prefix)
  if (at) {
    const layout = mapAt(doc, ['layout'])
    if (!layout) return { yaml, key: '' }
    layout.set(key, flowMap(doc, { x: at.x, y: at.y }))
  }
  nodes.set(key, doc.createNode(spec.name ? { type, name: spec.name } : { type }))
  return { yaml: dump(doc), key }
}

/** 결과를 to 로 잇는다. 이미 있는 결과면 to 만 바꿔 assignTo 등은 둔다. */
export function connectOutcome(yaml: string, from: string, outcomeKey: string, to: string): string {
  return editDoc(yaml, (doc) => {
    if (!doc.hasIn(['nodes', from])) return false
    const outcomes = mapAt(doc, ['nodes', from, 'outcomes'])
    if (!outcomes) return false
    const cur = outcomes.get(outcomeKey, true)
    if (isMap(cur)) cur.set('to', to)
    else outcomes.set(outcomeKey, flowMap(doc, { to }))
  })
}

/** 다음 새 결과 키 — 'done', 겹치면 'done_2'… */
export function nextOutcomeKey(yaml: string, from: string): string {
  const doc = parseDocument(yaml)
  const o = doc.errors.length > 0 ? undefined : js(doc).nodes?.[from]?.outcomes
  const used = new Set(isPlain(o) ? Object.keys(o) : [])
  if (!used.has('done')) return 'done'
  let n = 2
  while (used.has(`done_${n}`)) n++
  return `done_${n}`
}

/** 질문 경로 추가 — 사람이 답하는 human_task 와 ask 결과·returnTo 를 펼친 형태로 만든다. */
export function addAskPath(yaml: string, nodeKey: string): string {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return yaml
  const nodes: Record<string, Json> = js(doc).nodes ?? {}
  const node = nodes[nodeKey]
  if (!isPlain(node)) return yaml
  const human = Object.values(nodes).find((n) => isPlain(n) && n.type === 'human_task' && str(n.role))
  // ask 줄임 표기에 역할이 적혀 있으면 사람이 정한 그 역할이 먼저다
  const role = (isPlain(node.ask) ? str(node.ask.role) : undefined) ?? (human ? str(human.role) : undefined) ?? str(node.role)
  let newKey = `${nodeKey}_ask`
  for (let i = 2; newKey in nodes; i++) newKey = `${nodeKey}_ask_${i}`

  const nodeMap = mapAt(doc, ['nodes', nodeKey])
  const outcomes = mapAt(doc, ['nodes', nodeKey, 'outcomes'])
  if (!nodeMap || !outcomes) return yaml
  doc.setIn(
    ['nodes', newKey],
    doc.createNode({
      type: 'human_task',
      name: `${str(node.name) ?? nodeKey} 질문 답변`,
      ...(role ? { role } : {}),
      returnTo: nodeKey,
      outcomes: { answered: { to: nodeKey, assignTo: 'keep', requireComment: true } },
    }),
  )
  outcomes.set('ask', flowMap(doc, { to: newKey, ...(role ? { assignTo: role } : {}), requireComment: true }))
  nodeMap.delete('ask')
  const layout = doc.getIn(['layout'], true)
  const pos = js(doc).layout?.[nodeKey]
  if (isMap(layout) && isPlain(pos) && typeof pos.x === 'number' && typeof pos.y === 'number') {
    layout.set(newKey, flowMap(doc, { x: pos.x, y: pos.y + 140 }))
  }
  return dump(doc)
}

/** layout 의 좌표만 바꾼다. */
export function moveNode(yaml: string, key: string, x: number, y: number): string {
  return editDoc(yaml, (doc) => {
    const layout = mapAt(doc, ['layout'])
    if (!layout) return false
    layout.set(key, flowMap(doc, { x, y }))
  })
}

/** 값이 비었으면 칸을 지우고, 아니면 쓴다. */
function setOrDelete(doc: Document, path: string[], value: unknown, empty: boolean, make?: () => unknown) {
  if (empty) doc.deleteIn(path)
  else doc.setIn(path, make ? make() : value)
}

/** 노드의 칸을 patch 로 고친다. null·빈 배열은 그 칸을 지운다. 손대지 않은 칸·노드는 그대로. */
export function updateNode(yaml: string, key: string, patch: NodePatch): string {
  return editDoc(yaml, (doc) => applyPatch(doc, key, patch))
}

/** updateNode 의 본체 — 문서를 제자리에서 고치고, 고칠 수 없는 모양이면 false. */
function applyPatch(doc: Document, key: string, patch: NodePatch): boolean {
  if (!doc.hasIn(['nodes', key])) return false
  // 노드 자리가 맵이 아니면(목록·문자열) 고치지 않는다 — null 이면 빈 맵으로 채운다
  if (!mapAt(doc, ['nodes', key])) return false
  const p = (f: string) => ['nodes', key, f]
  const text = (f: 'name' | 'role' | 'instructions') => {
    const v = patch[f]
    if (v === undefined) return
    setOrDelete(doc, p(f), v, v === null || v === '', () => (f === 'instructions' ? textNode(doc, v as string) : v))
  }
  text('name')
  text('role')
  text('instructions')
  for (const f of ['requires', 'use'] as const) {
    const v = patch[f]
    if (v !== undefined) setOrDelete(doc, p(f), v, v.length === 0, () => flowSeq(doc, v))
  }
  if (patch.maxVisits !== undefined) setOrDelete(doc, p('maxVisits'), patch.maxVisits, patch.maxVisits === null)
  if (patch.outputs !== undefined && !applyOutputs(doc, key, patch.outputs)) return false
  if (patch.outcomes !== undefined && !applyOutcomes(doc, key, patch.outcomes)) return false
  return true
}

function flowSeq(doc: Document, items: string[]) {
  const s = doc.createNode(items) as { flow?: boolean }
  s.flow = true
  return s
}

/**
 * outputs 를 제자리 갱신 — applyOutcomes 와 같은 원칙으로 있던 값의 쌍(과 그 주석)을 그대로 쓴다.
 * 패치 순서를 따르고, 같은 자리의 값이 패치에 없는 키면 이름이 바뀐 것으로 보고 키만 고친다(자리·주석 유지).
 * 맵이 아닌 outputs 면 false.
 */
function applyOutputs(doc: Document, key: string, outputs: NodeDetail['outputs']): boolean {
  const path = ['nodes', key, 'outputs']
  const existing = doc.getIn(path, true)
  const oldKeys = isMap(existing) ? (existing.items as Pair[]).map(pairKey) : []
  if (outputs.length === 0) {
    doc.deleteIn(path)
    syncContextRefs(doc, key, new Map(), oldKeys)
    return true
  }
  const m = mapAt(doc, path)
  if (!m) return false
  const wanted = new Set(outputs.map((o) => o.key))
  const old = [...m.items] as Pair[]
  // 이름이 바뀐 값(옛 키 → 새 키) — 분기 조건의 when.context 를 따라 고친다
  const renames = new Map<string, string>()
  m.items = outputs.map((o, i) => {
    let pair = old.find((x) => pairKey(x) === o.key)
    const renamed = old[i]
    if (!pair && renamed && !wanted.has(pairKey(renamed))) {
      pair = renamed
      renames.set(pairKey(renamed), o.key)
      if (isScalar(pair.key)) pair.key.value = o.key
      else pair.key = doc.createNode(o.key)
    }
    // required 는 true 일 때만 쓰고 false 면 칸을 지운다(required: false 를 새로 만들지 않는다)
    const spec = { type: o.type, ...(o.required ? { required: true } : {}) }
    if (!pair) return doc.createPair(o.key, flowMap(doc, spec))
    if (isMap(pair.value)) {
      pair.value.set('type', o.type)
      if (o.required) pair.value.set('required', true)
      else pair.value.delete('required')
    } else pair.value = flowMap(doc, spec)
    return pair
  })
  syncContextRefs(doc, key, renames, oldKeys.filter((k) => !wanted.has(k) && !renames.has(k)))
  return true
}

/**
 * 내놓을 값의 이름을 바꾸거나 지웠을 때 분기 조건(`nodes.*.conditions[].when.context`)의 참조를 맞춘다.
 * 참조는 `<노드>.<값>` 꼴이라 그대로 두면 서버가 REF_CONTEXT_UNKNOWN 으로 거절하고, 실행 때는 조건이 조용히 default 로 빠진다.
 * - 이름 바뀜: 참조를 새 이름으로 고친다(조건·주석·자리는 그대로).
 * - 지움: 그 값을 보던 조건을 지운다 — removeNode 가 노드를 지울 때 그 노드 출력을 보던 조건을 지우는 것과 같은 규칙이다.
 *   조건이 모두 빠지면 conditions 칸째 지운다. 몇 개를 지우는지는 패널이 countContextRefs 로 미리 세어 알린다.
 */
function syncContextRefs(doc: Document, nodeKey: string, renames: Map<string, string>, removed: string[]) {
  if (renames.size === 0 && removed.length === 0) return
  const gone = new Set(removed)
  forEachContextRef(doc, nodeKey, (output, item, conditions, i) => {
    if (gone.has(output)) conditions.delete(i)
    else if (renames.has(output)) item.setIn(['when', 'context'], contextRef(nodeKey, renames.get(output)!))
  })
}

/** 분기 조건이 노드의 값을 가리키는 꼴 `<노드>.<값>` — 서버 checkContext 와 같은 표기. */
function contextRef(nodeKey: string, output: string): string {
  return `${nodeKey}.${output}`
}

/**
 * 모든 분기 조건 중 nodeKey 의 값을 보는 것(`when.context` 가 `<nodeKey>.<값>`)마다 fn(값 이름, 조건, 조건 목록, 자리)을 부른다.
 * 뒤에서부터 돌아 fn 이 그 조건을 지워도 된다. 조건이 모두 빠진 목록은 칸째 지워 빈 `conditions: []` 를 남기지 않는다
 * (분기는 default 로만 간다). 노드 키에는 점이 없어 첫 점 뒤가 값 이름이다.
 */
function forEachContextRef(doc: Document, nodeKey: string, fn: (output: string, item: YAMLMap, conditions: YAMLSeq, index: number) => void) {
  const nodes = doc.getIn(['nodes'], true)
  if (!isMap(nodes)) return
  const prefix = contextRef(nodeKey, '')
  for (const pair of nodes.items as Pair[]) {
    if (!isMap(pair.value)) continue
    const conditions = pair.value.get('conditions', true)
    if (!isSeq(conditions)) continue
    const before = conditions.items.length
    for (let i = conditions.items.length - 1; i >= 0; i--) {
      const item = conditions.items[i]
      if (!isMap(item)) continue
      const ctx = item.getIn(['when', 'context'])
      if (typeof ctx === 'string' && ctx.startsWith(prefix)) fn(ctx.slice(prefix.length), item, conditions, i)
    }
    if (before > 0 && conditions.items.length === 0) pair.value.delete('conditions')
  }
}

/** 노드의 내놓을 값 하나를 보는 분기 조건 수 — 값을 지우기 전에 함께 지워질 조건을 알리는 데 쓴다. */
export function countContextRefs(yaml: string, nodeKey: string, outputKey: string): number {
  const doc = parseDocument(yaml)
  if (doc.errors.length > 0) return 0
  let n = 0
  forEachContextRef(doc, nodeKey, (output) => {
    if (output === outputKey) n++
  })
  return n
}

/**
 * outcomes 를 제자리 갱신 — 있던 결과는 순서·주석을 두고 필드만, 빠진 결과는 지우고, 새 결과는 뒤에 붙인다.
 * outcomes 가 맵이 아니면(목록 등) false — 호출자가 입력을 그대로 돌려준다.
 */
function applyOutcomes(doc: Document, key: string, outcomes: NodeDetail['outcomes']): boolean {
  const base = ['nodes', key, 'outcomes']
  if (outcomes.length === 0) {
    doc.deleteIn(base)
    return true
  }
  const cur = mapAt(doc, base)
  if (!cur) return false
  const keep = new Set(outcomes.map((o) => o.key))
  // 결과 키를 쌍(Pair)으로 찾는다 — `1:`·`true:` 처럼 문자열이 아닌 키는 cur.get('1') 로 찾을 수 없어,
  // 문자열로 찾으면 있던 결과를 지우거나 같은 키를 하나 더 붙이게 된다. readNodeDetail 은 키를 문자열로 넘긴다.
  cur.items = (cur.items as Pair[]).filter((pair) => keep.has(pairKey(pair)))
  for (const o of outcomes) {
    const pair = (cur.items as Pair[]).find((x) => pairKey(x) === o.key)
    const existing = pair?.value
    if (!pair || !isMap(existing)) {
      const value = flowMap(doc, { to: o.to, ...(o.assignTo ? { assignTo: o.assignTo } : {}), ...(o.requireComment ? { requireComment: true } : {}) })
      // 맵이 아닌 값(`done: ~` 등)이 있던 결과는 그 쌍의 값만 바꿔 자리·키를 지킨다
      if (pair) pair.value = value
      else cur.items.push(doc.createPair(o.key, value))
      continue
    }
    existing.set('to', o.to)
    if (o.assignTo) existing.set('assignTo', o.assignTo)
    else existing.delete('assignTo')
    if (o.requireComment) existing.set('requireComment', true)
    else existing.delete('requireComment')
  }
  return true
}

/**
 * 노드와 그 layout, 그 노드로 가는 연결(outcomes·onError·returnTo·start·conditions)을 지운다.
 * addAskPath 가 만든 `<키>_ask` 질문 노드(returnTo 가 지운 노드)와 분기 조건 중 `<키>.` 출력을 보는 것도 함께 지운다.
 */
export function removeNode(yaml: string, key: string): string {
  return editDoc(yaml, (doc) => {
    // 지울 노드가 없으면(nodes 가 null·목록인 경우 포함) 그대로 — deleteIn 은 맵이 아닌 칸을 지나가면 던진다
    if (!doc.hasIn(['nodes', key])) return false
    removeFromDoc(doc, key)
  })
}

/** removeNode 의 본체 — 질문 노드를 재귀로 지우려고 문서를 받아 제자리에서 고친다. */
function removeFromDoc(doc: Document, key: string) {
  // 지우기 전에 이 노드의 질문 노드(addAskPath 가 만든 것)를 찾아 둔다
  const before: Record<string, Json> = js(doc).nodes ?? {}
  const askKey = `${key}_ask`
  const ask = before[askKey]
  const removeAsk = isPlain(ask) && ask.type === 'human_task' && ask.returnTo === key
  doc.deleteIn(['nodes', key])
  // layout 이 없거나 맵이 아니면 건드리지 않고, 비게 되면 빈 `layout: {}` 을 남기지 않고 칸째 지운다
  const layout = doc.getIn(['layout'], true)
  if (isMap(layout)) {
    layout.delete(key)
    deleteIfEmptyMap(doc, ['layout'])
  }
  const nodes: Record<string, Json> = js(doc).nodes ?? {}
  for (const [nk, n] of Object.entries(nodes)) {
    if (!isPlain(n)) continue
    if (isPlain(n.outcomes)) {
      for (const [ok, o] of Object.entries(n.outcomes as Record<string, Json>)) {
        if (isPlain(o) && o.to === key) doc.deleteIn(['nodes', nk, 'outcomes', ok])
      }
      deleteIfEmptyMap(doc, ['nodes', nk, 'outcomes'])
    }
    if (isPlain(n.onError) && n.onError.to === key) doc.deleteIn(['nodes', nk, 'onError'])
    if (n.returnTo === key) doc.deleteIn(['nodes', nk, 'returnTo'])
    if (n.default === key || (isPlain(n.default) && n.default.to === key)) doc.deleteIn(['nodes', nk, 'default'])
    pruneList(doc, ['nodes', nk, 'conditions'], key, true)
  }
  pruneList(doc, ['start'], key)
  if (removeAsk && doc.hasIn(['nodes', askKey])) removeFromDoc(doc, askKey)
}

/** {when, to} 목록(YAMLSeq)에서 to 가 key 인 항목을 뒤에서부터 지운다. byContext 면 when.context 가 `<key>.` 로 시작하는 항목도 지운다. */
function pruneList(doc: Document, path: string[], key: string, byContext = false) {
  const seq = doc.getIn(path, true)
  if (!isSeq(seq)) return
  for (let i = seq.items.length - 1; i >= 0; i--) {
    const item = seq.items[i]
    if (!isMap(item)) continue
    const ctx = byContext ? (item.getIn(['when', 'context']) as unknown) : undefined
    if (item.get('to') === key || (typeof ctx === 'string' && ctx.startsWith(`${key}.`))) seq.delete(i)
  }
}

/**
 * 접힘 상태 배치(dagre 위→아래)를 정수 좌표로 돌려준다 — YAML layout 에 저장되는 기준이다.
 * 실제(가상 아님) 노드 중 접힘 배치에 있는 노드만 담는다. 숨은 질문 노드는 저장하지 않는다 — 펼친 보기는 저장 좌표를 쓰지 않는다.
 * 이미 읽은 그래프만 보는 순수 계산이라 문서를 파싱·직렬화하지 않는다.
 */
export function computeLayout(graph: WorkflowGraph): Map<string, { x: number; y: number }> {
  const collapsed = computeGraphLayout(visibleGraph(graph, { showAsk: false })).positions
  const out = new Map<string, { x: number; y: number }>()
  for (const n of graph.nodes) {
    if (n.virtual) continue
    const p = collapsed.get(n.key)
    if (p) out.set(n.key, { x: Math.round(p.x), y: Math.round(p.y) })
  }
  return out
}

/** computeLayout 결과로 layout 을 통째로 다시 쓴다. 문서는 한 번만 파싱한다. */
export function autoLayout(yaml: string): string {
  return editDoc(yaml, (doc) => {
    // 최상위가 맵이 아니면 layout 을 쓸 자리가 없다
    if (!isMap(doc.contents)) return false
    const positions = computeLayout(readGraph(doc))
    doc.deleteIn(['layout'])
    for (const [k, p] of positions) doc.setIn(['layout', k], flowMap(doc, p))
  })
}

/** 선 끌기 결과 — yaml 은 (바뀌었든 아니든) 다음 문서, refused 는 받지 못한 이유(사용자에게 보일 문구)다. */
export interface ConnectResult {
  yaml: string
  refused?: string
}

/** 거절 이유 문구 — 편집기가 토스트로 보여 준다. */
export const REFUSE_NO_ROLE = '역할이 없어 시작 조건을 만들 수 없습니다 — YAML 의 roles 에 역할을 먼저 더해 주세요'
export const REFUSE_DECISION_DEFAULT = '이 분기에는 이미 기본 도착지가 있습니다 — 바꾸거나 다른 조건을 더하려면 YAML 에서 고쳐 주세요'
export const REFUSE_INTO_START = '시작 노드로 들어가는 선은 만들 수 없습니다'
export const REFUSE_SELF = '노드를 자기 자신에 이을 수 없습니다'
export const REFUSE_FROM_END = '종료 노드에서는 선을 이을 수 없습니다'

/**
 * 선 끌기 결과를 YAML 로 옮긴다. 받을 수 없는 선이면 yaml 은 그대로 두고, 사용자가 알 만한 이유가 있으면 refused 에 담는다
 * (노드가 없거나 가상 노드·이을 수 없는 종류처럼 사용자가 의도했다고 보기 어려운 경우는 이유 없이 그대로 돌려준다).
 * - agent_task/human_task: 새 결과를 잇는다.
 * - start: 최상위 start 목록에 { when: { assigneeRole }, to } 를 덧붙인다(스키마상 start 항목의 when 은 필수라
 *   when 없이 쓸 수 없다 — 역할은 도착 노드의 role 이 roles 에 선언돼 있으면 그것, 아니면(없거나 선언 안 된 역할) 첫 역할 키.
 *   역할이 하나도 없으면 NO_ROLE 로 거절한다).
 * - decision: default 가 없을 때만 default 를 정한다(있으면 DECISION_DEFAULT 로 거절 — 사람이 정한 값을 지킨다).
 */
export function connectFromFlow(yaml: string, graph: WorkflowGraph, c: { source: string | null; target: string | null }): ConnectResult {
  const from = graph.nodes.find((n) => n.key === c.source)
  if (!from || from.virtual) return { yaml }
  if (from.type === 'end') return { yaml, refused: REFUSE_FROM_END }
  if (!['agent_task', 'human_task', 'start', 'decision'].includes(from.type)) return { yaml }
  // 도착은 YAML 에 있는 노드여야 하고, 시작 노드로 들어가는 선·자기 자신으로 가는 선은 받지 않는다
  const to = graph.nodes.find((n) => n.key === c.target)
  if (!to || to.virtual) return { yaml }
  if (to.type === 'start') return { yaml, refused: REFUSE_INTO_START }
  if (to.key === from.key) return { yaml, refused: REFUSE_SELF }
  if (from.type === 'start') {
    // 도착 노드의 역할이 roles 에 선언된 것일 때만 쓴다 — 없는 역할을 적으면 서버가 시작 조건을 거절한다(REF_ROLE_UNKNOWN)
    const role = to.role && graph.roles.some((r) => r.key === to.role) ? to.role : graph.roles[0]?.key
    return role ? { yaml: appendStartEntry(yaml, role, to.key) } : { yaml, refused: REFUSE_NO_ROLE }
  }
  if (from.type === 'decision') {
    // 이미 정한 기본 도착지가 있으면 거절한다 — 단 같은 도착지로 다시 끈 선은 바랄 것이 이미 있는 상태라 조용히 둔다.
    // 판정은 읽은 그래프로 한다(편집 결과가 같은지로 보면 다른 실패도 「이미 있음」으로 오인한다).
    // 선으로 그리지 못한 형식이 어긋난 default 도 사람이 적은 값이라 hasDefault 로 함께 거절한다 — 비었다고 보는 것은 칸이 없거나 null 일 때뿐이다
    const current = graph.edges.find((e) => e.from === from.key && e.kind === 'default')
    if (current?.to === to.key) return { yaml }
    if (from.hasDefault) return { yaml, refused: REFUSE_DECISION_DEFAULT }
    return { yaml: setDecisionDefault(yaml, from.key, to.key) }
  }
  return { yaml: connectOutcome(yaml, from.key, nextOutcomeKey(yaml, from.key), to.key) }
}

/** 최상위 start 목록 끝에 { when: { assigneeRole }, to } 를 더한다. 목록이 없거나 비어 있으면 블록 목록으로 새로 만든다. */
function appendStartEntry(yaml: string, role: string, to: string): string {
  return editDoc(yaml, (doc) => {
    if (!isMap(doc.contents)) return false
    const entry = doc.createNode({ when: { assigneeRole: role }, to }) as YAMLMap
    entry.flow = true
    const cur = doc.contents.get('start', true)
    if (isSeq(cur) && cur.items.length > 0) {
      cur.add(entry)
      return
    }
    // 목록이 아닌 값은 사람이 쓴 것이라 덮지 않는다(없음·null·빈 목록만 새로 만든다)
    if (cur != null && !isSeq(cur) && !(isScalar(cur) && cur.value == null)) return false
    const seq = doc.createNode([]) as YAMLSeq
    seq.flow = false
    seq.add(entry)
    doc.set('start', seq)
  })
}

/** decision 노드에 default 도착지를 정한다(덮어쓴다 — 이미 정한 값이 있는지는 connectFromFlow 가 먼저 본다). */
function setDecisionDefault(yaml: string, key: string, to: string): string {
  return editDoc(yaml, (doc) => {
    if (!doc.hasIn(['nodes', key])) return false
    const node = mapAt(doc, ['nodes', key])
    // 이미 있는 default 의 판정·거절은 부르는 쪽(connectFromFlow)이 읽은 그래프(default 선·hasDefault)로 한다 — 같은 판정을 두 곳에 두지 않는다
    if (!node) return false
    node.set('default', to)
  })
}

/** 드래그가 끝난 여러 노드의 자리를 한 번에 정수 좌표로 layout 에 쓴다. */
export function moveManyFromDrag(yaml: string, nodes: { id: string; position: { x: number; y: number } }[]): string {
  return editDoc(yaml, (doc) => {
    const layout = mapAt(doc, ['layout'])
    if (!layout) return false
    for (const n of nodes) layout.set(n.id, flowMap(doc, { x: Math.round(n.position.x), y: Math.round(n.position.y) }))
  })
}

/**
 * 그래프 편집기가 그릴 좌표와 배치 결과 — 저장된 layout 이 있는 실제 노드는 그 자리를, 없는 노드와 가상 노드는 새 배치 자리를 쓴다(질문 경로를 펼친 보기는 모두 새 배치 자리).
 * 문서는 바꾸지 않는다. view·layout 은 간선 그리기가 같은 배치를 쓰도록 함께 돌려준다.
 */
export function placeNodes(
  graph: WorkflowGraph,
  opts: { showAsk?: boolean } = {},
): { positions: Map<string, { x: number; y: number }>; layout: GraphLayoutResult; view: VisibleGraph } {
  const view = visibleGraph(graph, { showAsk: opts.showAsk ?? false })
  const layout = computeGraphLayout(view)
  const positions = new Map<string, { x: number; y: number }>()
  for (const n of view.nodes) {
    // 질문 경로를 펼친 보기는 보기 전용 배치다 — 저장 좌표는 접힘 배치 기준이라 펼친 질문 노드와 겹치므로 모든 노드에 펼침 배치 자리를 쓴다
    const saved = n.virtual || opts.showAsk ? undefined : n.position
    positions.set(n.key, saved ?? layout.positions.get(n.key) ?? { x: 0, y: 0 })
  }
  return { positions, layout, view }
}

/** 되돌림 횟수 입력 → 패치 값. 빈칸은 지우기(null), 1 이상 정수만 받고 그 밖은 무시(undefined). */
export function parseMaxVisits(input: string): number | null | undefined {
  if (input.trim() === '') return null
  if (!/^\d+$/.test(input.trim())) return undefined
  const n = Number(input.trim())
  return n >= 1 ? n : undefined
}
