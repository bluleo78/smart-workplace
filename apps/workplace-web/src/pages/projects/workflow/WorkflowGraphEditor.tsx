import '@xyflow/react/dist/style.css'

import {
  Background, type Connection, type Edge, Handle, type Node, type NodeProps, type OnNodesChange, Position, ReactFlow,
  ReactFlowProvider, useNodesState, useReactFlow, useViewport,
} from '@xyflow/react'
import { Minus, Plus } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import type { WorkflowProblem } from '@/lib/workflows'

import { applyConnection } from './applyConnection'
import { edgeAriaLabel, GRAPH_ARIA_LABEL_CONFIG, GRAPH_ARIA_LABEL_CONFIG_READONLY, GRAPH_EDITOR_ARIA_LABEL, nodeActorLabel, nodeAriaLabel, panelActionFromKeyDown } from './graphA11y'
import {
  addAskPath, addNode, autoLayout, type GraphEdge, type GraphNode, moveManyFromDrag, type NewNodeType,
  parseWorkflowGraph, placeNodes, type WorkflowGraph,
} from './graphYaml'
import { NodeKindIcon, NodePanel } from './NodePanel'

interface FlowNodeData extends Record<string, unknown> {
  node: GraphNode
  roleName?: string
}

/** 문서에 시작 노드가 없을 때만 「+ 노드」 메뉴 맨 앞에 더하는 항목. */
const START_MENU_ITEM: { type: NewNodeType; label: string } = { type: 'start', label: '시작' }
const NEW_NODE_MENU: { type: NewNodeType; label: string }[] = [
  { type: 'agent_task', label: 'AI 작업' },
  { type: 'human_task', label: '사람 차례' },
  { type: 'decision', label: '분기' },
  { type: 'end', label: '종료' },
]
/** 점선으로 그리는 선 — 오류·되돌림·질문 경로는 정상 흐름과 구분한다. */
const DASHED_KINDS = new Set(['onError', 'returnTo', 'ask'])

/** 노드 한 장 — 종류 아이콘, 이름, 담당(AI·사람 + 역할 이름). 가상 노드는 점선 테두리. */
function WorkflowNodeCard({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { node, roleName } = data
  // 담당 줄은 접근 이름(nodeAriaLabel)과 같은 함수로 만들어 화면 글자와 스크린리더 이름이 어긋나지 않게 한다
  const actor = nodeActorLabel(node, roleName)
  return (
    <div
      className={`min-w-36 rounded-md border bg-card px-3 py-2 text-sm ${node.virtual ? 'border-dashed' : ''} ${selected ? 'ring-2 ring-ring' : ''}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 font-medium">
        <NodeKindIcon type={node.type} />
        <span>{node.name ?? node.key}</span>
      </div>
      {actor && <div className="mt-1 text-xs text-muted-foreground">{actor}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
// 컴포넌트 밖에 두어야 ReactFlow 가 매 렌더마다 노드를 다시 만들지 않는다.
const nodeTypes = { workflow: WorkflowNodeCard }

/**
 * 그래프 선을 ReactFlow 선으로 바꾼다. 양 끝 노드가 그려지는 것(keys)만 남긴다 — 없는 노드를 가리키는 선(YAML 의 오타 등)을
 * 넘기면 ReactFlow 가 경고를 내고 그리지 못한다. 오류·되돌림·질문 경로는 점선으로 정상 흐름과 구분한다.
 */
function toFlowEdges(edges: GraphEdge[], names: Map<string, string>): Edge[] {
  return edges
    .filter((e) => names.has(e.from) && names.has(e.to))
    .map((e) => ({
      id: e.id, source: e.from, target: e.to, label: e.label, type: 'smoothstep',
      // 스크린리더용 한국어 이름(출발 → 도착)
      ariaLabel: edgeAriaLabel(e, names),
      style: DASHED_KINDS.has(e.kind) ? { strokeDasharray: '5 4' } : undefined,
    }))
}

/** 확대·축소 단추와 현재 배율. ReactFlow 안(Provider 아래)에서만 쓸 수 있다. */
function ZoomControls() {
  const { zoomIn, zoomOut } = useReactFlow()
  const { zoom } = useViewport()
  return (
    <div className="absolute right-3 bottom-3 z-10 flex items-center gap-1 rounded-md border bg-card p-1 text-xs">
      <Button type="button" variant="ghost" size="icon-xs" aria-label="축소" onClick={() => void zoomOut()}><Minus /></Button>
      <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="확대" onClick={() => void zoomIn()}><Plus /></Button>
    </div>
  )
}

/** 캔버스 아래 경고 줄 — 첫 문제와 빠른 해결 단추. 문제가 없으면 그리지 않는다. */
function WarningBar({ yaml, problems, onChange, onOpenYaml }: {
  yaml: string; problems: WorkflowProblem[]; onChange: (yaml: string) => void; onOpenYaml: () => void
}) {
  if (problems.length === 0) return null
  const errors = problems.filter((p) => p.severity === 'ERROR').length
  const warnings = problems.length - errors
  // 오류가 하나라도 있으면 첫 오류를, 아니면 첫 문제를 보인다
  const shown = problems.find((p) => p.severity === 'ERROR') ?? problems[0]
  const askProblem = problems.find((p) => p.code === 'ASK_PATH_MISSING' && p.nodeKey)
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-t bg-warning-subtle px-3 py-2 text-sm">
      <strong>{errors > 0 ? `오류 ${errors} · 경고 ${warnings}` : `⚠ 경고 ${warnings}`}</strong>
      <span className="min-w-0 flex-1">{shown.message}</span>
      {askProblem?.nodeKey && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange(addAskPath(yaml, askProblem.nodeKey!))}>질문 경로 추가</Button>
      )}
      {errors > 0 && <Button type="button" variant="outline" size="sm" onClick={onOpenYaml}>YAML 오류 확인</Button>}
    </div>
  )
}


/**
 * 그래프 편집 화면의 본체 — 도구 줄(+ 노드·자동 정렬), ReactFlow 캔버스, 고른 노드의 편집 패널, 경고 줄.
 * 노드·선은 매번 graph(YAML 을 읽은 것)에서 만들고, 끌기·연결·추가는 graphYaml 함수로 YAML 을 고쳐 onChange 로 올린다.
 * 지역 상태는 고른 노드와 드래그 중 좌표뿐이다 — 원본을 둘로 들지 않으려는 것이다.
 */
function Canvas({ yaml, problems, readOnly, onChange, onOpenYaml, graph }: {
  yaml: string
  problems: WorkflowProblem[]
  readOnly: boolean
  onChange: (yaml: string) => void
  onOpenYaml: () => void
  graph: WorkflowGraph
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const roleNames = useMemo(() => new Map(graph.roles.map((r) => [r.key, r.name ?? r.key])), [graph.roles])
  const positions = useMemo(() => placeNodes(graph), [graph])
  const derivedNodes: Node<FlowNodeData>[] = useMemo(() => graph.nodes.map((n) => {
    const roleName = n.role ? roleNames.get(n.role) ?? n.role : undefined
    return {
    id: n.key,
    type: 'workflow',
    position: positions.get(n.key) ?? { x: 0, y: 0 },
    data: { node: n, roleName },
    // 스크린리더용 한국어 이름(표시 이름, 담당) — React Flow 기본은 영어 안내라 직접 준다
    ariaLabel: nodeAriaLabel(n, roleName),
    selected: n.key === selected,
    // 가상 노드만 막고, 나머지는 undefined 로 두어 ReactFlow 의 nodesDraggable·nodesConnectable(readOnly)을 따르게 한다
    draggable: n.virtual ? false : undefined,
    connectable: n.virtual ? false : undefined,
    }
  }), [graph.nodes, positions, roleNames, selected])
  // 드래그 중 노드가 커서를 따라오려면 ReactFlow 가 바뀐 좌표를 들고 있어야 한다(v12 의 제어 노드는 onNodesChange 가 적용해야 움직인다).
  // YAML 에서 만든 노드가 바뀌면 지역 상태를 다시 맞춘다 — 드래그가 끝나면 moveManyFromDrag 가 YAML 을 고쳐 같은 좌표로 수렴한다.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(derivedNodes)
  useEffect(() => { setNodes(derivedNodes) }, [derivedNodes, setNodes])
  // 선 이름용 「노드 키 → 표시 이름」 맵 — 렌더마다 새로 만들지 않는다
  const nodeNames = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n.name ?? n.key])), [graph.nodes])
  const edges = useMemo(() => toFlowEdges(graph.edges, nodeNames), [graph.edges, nodeNames])
  // YAML 에 실제로 있는 노드의 키(가상 노드 제외)
  const realKeys = useMemo(() => new Set(graph.nodes.filter((n) => !n.virtual).map((n) => n.key)), [graph])
  // 편집 패널은 마우스 클릭(onNodeClick)과 키보드 Enter·Space 로만 연다. onSelectionChange 로 열지 않는 까닭: React Flow 는
  // 드래그를 시작할 때도 노드를 선택하므로, 선택 변경을 패널 열기로 받으면 노드를 끌기만 해도 패널이 열린다(마우스 동작을 바꾸면 안 된다).
  // 노드 wrapper 의 keydown 은 ReactFlow 루트로 버블링되므로 여기서 받아 눌린 곳의 노드(data-id)를 찾는다.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const nodeId = target.closest('.react-flow__node')?.getAttribute('data-id') ?? null
    const action = panelActionFromKeyDown(e.key, nodeId, realKeys)
    if (!action) return
    if ('open' in action) {
      // Space 의 기본 동작(페이지 스크롤)을 막는다 — 노드를 고르는 키로 쓰기 때문이다
      e.preventDefault()
      setSelected(action.open)
    } else {
      // React Flow 가 Esc 로 선택을 풀므로 패널도 닫아 둘이 어긋나지 않게 한다
      setSelected(null)
    }
  }
  // 노드 자리를 YAML 에 쓰는 곳은 여기 한 곳이다. React Flow 는 마우스 드래그가 끝날 때와 키보드(화살표)로 옮길 때 모두
  // onNodesChange 로 position 변경(dragging:false)을 보낸다 — 키보드 이동은 onNodeDragStop 을 부르지 않으므로 거기서 쓰면
  // 다시 그릴 때 노드가 제자리로 되돌아간다. 여러 노드를 함께 끌었으면 모두의 자리를 한 번에 쓴다.
  // v13 의 변경 묶음은 배열이 아니라 Changeset 이라 getByType 으로 position 변경만 꺼낸다
  const handleNodesChange: OnNodesChange<Node<FlowNodeData>> = (changes) => {
    onNodesChange(changes)
    if (readOnly) return
    const moved = changes.getByType('position')
      .filter((c) => c.dragging === false && c.position && realKeys.has(c.id))
      .map((c) => ({ id: c.id, position: c.position! }))
    if (moved.length === 0) return
    const next = moveManyFromDrag(yaml, moved)
    if (next !== yaml) onChange(next)
  }
  // 지워진 노드를 가리키는 선택은 패널이 스스로 비어 있으므로 여기서 걸러 둔다.
  const panelKey = selected && realKeys.has(selected) ? selected : null
  // 시작 노드가 없는 초안(만들기 템플릿 등)은 시작 노드를 그래프에서 더할 수 있어야 한다
  const menu = graph.nodes.some((n) => n.type === 'start') ? NEW_NODE_MENU : [START_MENU_ITEM, ...NEW_NODE_MENU]

  function onConnect(c: Connection) {
    if (readOnly) return
    applyConnection(yaml, graph, c, onChange)
  }

  return (
    // @container — 아래 행·패널의 @3xl 판정 기준은 여기(뷰포트가 아니라 편집기 폭)다. YAML 모드와 같은 규약.
    <div className="@container flex min-w-0 flex-col rounded-md border">
      {/* 저장·게시 중(readOnly)에도 도구 줄은 자리를 지키고 꺼진 채 보인다 — 사라졌다 나타나며 화면이 흔들리지 않게 */}
      <div className="flex items-center gap-2 border-b p-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={readOnly}><Button type="button" variant="outline" size="sm" disabled={readOnly}>+ 노드</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {menu.map((item) => (
              <DropdownMenuItem
                key={item.type}
                onSelect={() => {
                  // 좌표를 정해 두면 새 노드가 겹쳐 그려지지 않는다 — 가장 오른쪽 바깥에 놓는다.
                  const xs = [...positions.values()].map((p) => p.x)
                  const added = addNode(yaml, item.type, { x: (xs.length ? Math.max(...xs) : -240) + 240, y: 0 })
                  onChange(added.yaml)
                  setSelected(added.key)
                }}
              >{item.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => onChange(autoLayout(yaml))}>자동 정렬</Button>
      </div>
      {/* 좁으면 세로로 쌓아 캔버스 폭을 지키고, @3xl 이상에서만 YAML 모드와 같은 옆으로 배치 */}
      <div className="flex min-h-96 flex-col @3xl:flex-row">
        {/* 캔버스 높이는 늘 28rem 으로 확정해 둔다 — ReactFlow 가 쓰는 `.react-flow` 는 `height: 100%` 이라
            부모 높이가 확정(definite)이 아니면 0 으로 풀려 캔버스가 통째로 사라진다.
            세로 쌓기(main 축 = 높이)에서 `flex-1`(flex-basis 0%) 을 쓰면 부모 높이가 내용 기준이 되어 그렇게 되므로,
            가로 배치일 때만(폭이 main 축) flex-1 을 건다. min-h 는 눌리지 않게 하는 안전판. */}
        <div className="relative h-[28rem] min-h-[28rem] min-w-0 @3xl:flex-1" data-testid="workflow-graph-canvas">
          <ReactFlow
            nodes={nodes}
            onNodesChange={handleNodesChange}
            edges={edges}
            aria-label={GRAPH_EDITOR_ARIA_LABEL}
            ariaLabelConfig={readOnly ? GRAPH_ARIA_LABEL_CONFIG_READONLY : GRAPH_ARIA_LABEL_CONFIG}
            onKeyDown={onKeyDown}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => { if (realKeys.has(node.id)) setSelected(node.id) }}
            onPaneClick={() => setSelected(null)}
            onConnect={onConnect}
          >
            <Background />
            <ZoomControls />
          </ReactFlow>
        </div>
        {panelKey && (
          <NodePanel key={panelKey} yaml={yaml} graph={graph} nodeKey={panelKey} readOnly={readOnly} onChange={onChange} onClose={() => setSelected(null)} />
        )}
      </div>
      <WarningBar yaml={yaml} problems={problems} onChange={onChange} onOpenYaml={onOpenYaml} />
    </div>
  )
}

/**
 * 워크플로우 초안을 그래프로 보고 고치는 편집기. 그래프의 모든 편집은 graphYaml 함수로 YAML 문자열을 고쳐
 * onChange 로 올릴 뿐이다 — 원본은 언제나 YAML 이다.
 */
export function WorkflowGraphEditor({ yaml, problems, readOnly, onChange, onOpenYaml }: {
  yaml: string
  problems: WorkflowProblem[]
  readOnly: boolean
  onChange: (yaml: string) => void
  onOpenYaml: () => void
}) {
  const parsed = useMemo(() => parseWorkflowGraph(yaml), [yaml])
  if (!('graph' in parsed)) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
        <p>YAML 에 문법 오류가 있어 그래프로 볼 수 없습니다.</p>
        <Button type="button" variant="outline" size="sm" onClick={onOpenYaml}>YAML 에서 고치기</Button>
      </div>
    )
  }
  return (
    <ReactFlowProvider>
      <Canvas yaml={yaml} problems={problems} readOnly={readOnly} onChange={onChange} onOpenYaml={onOpenYaml} graph={parsed.graph} />
    </ReactFlowProvider>
  )
}
