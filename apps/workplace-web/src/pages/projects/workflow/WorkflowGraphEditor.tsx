import '@xyflow/react/dist/style.css'

import {
  Background, type Connection, ConnectionMode, type Edge, MarkerType, MiniMap, type Node, type OnNodesChange, Panel, type PanelPosition, ReactFlow,
  ReactFlowProvider, useNodesState, useReactFlow, useViewport,
} from '@xyflow/react'
import { MessageCircleQuestion, Minus, Plus, Undo2 } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/overlay/dropdown-menu'
import { Button } from '@/components/ui/button'
import { isEditableTarget } from '@/lib/escapeOverlay'
import { TOGGLE_ON_CLASS } from '@/lib/selectionStyles'
import { cn } from '@/lib/utils'
import type { WorkflowProblem } from '@/lib/workflows'

import { applyConnection } from './applyConnection'
import {
  type DrawerState, type GraphProblems, type NodeDrawerTab, nodeProblemLevels, problemTab, problemTargetNode,
} from './drawerModel'
import { YamlFixButton } from './DrawerShell'
import { edgeAriaLabel, GRAPH_ARIA_LABEL_CONFIG, GRAPH_ARIA_LABEL_CONFIG_READONLY, GRAPH_EDITOR_ARIA_LABEL, nodeAriaLabel, panelActionFromKeyDown } from './graphA11y'
import { drawnEdge, flowHandles, isShapeNode, nodeSize, routedPoints } from './graphLayout'
import {
  addAskPath, addNodeAtFreeSpot, autoLayout, moveManyFromDrag, type NewNodeType, parseWorkflowGraph, placeNodes, type WorkflowGraph,
} from './graphYaml'
import type { InstructionEditorTarget } from './instructionLock'
import { NodeDrawer } from './NodeDrawer'
import { NodeInstructionEditor } from './NodeInstructionEditor'
import { OverviewDrawer } from './OverviewDrawer'
import { revealOffset } from './viewportReveal'
import { type FlowNodeData, GraphLegend, RoutedEdge, type RoutedEdgeData, WorkflowNodeView } from './WorkflowGraphShapes'

/** 문서에 시작 노드가 없을 때만 「+ 노드」 메뉴 맨 앞에 더하는 항목. */
const START_MENU_ITEM: { type: NewNodeType; label: string } = { type: 'start', label: '시작' }
const NEW_NODE_MENU: { type: NewNodeType; label: string }[] = [
  { type: 'agent_task', label: 'AI 작업' },
  { type: 'human_task', label: '사람 차례' },
  { type: 'decision', label: '분기' },
  { type: 'end', label: '종료' },
]
// 컴포넌트 밖에 두어야 ReactFlow 가 매 렌더마다 노드·간선 종류를 다시 만들지 않는다.
const nodeTypes = { workflow: WorkflowNodeView }
const edgeTypes = { routed: RoutedEdge }
/** 간선 끝 화살표 — 위→아래 흐름의 방향을 보인다. */
const EDGE_MARKER = { type: MarkerType.ArrowClosed, width: 16, height: 16 }
const BACK_EDGE_MARKER = { ...EDGE_MARKER, color: 'var(--warning-text)' }

/** ReactFlow 가 캔버스 조작에 쓰는 키 — 패널 단추에서 눌러도 이동·삭제로 읽히지 않게 막는다(그 밖의 키는 앱 전역 단축키로 올려 보낸다) */
const FLOW_KEYS = new Set([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Delete', 'Backspace'])
function stopFlowKeys(event: KeyboardEvent<HTMLElement>) {
  if (FLOW_KEYS.has(event.key)) event.stopPropagation()
}

/**
 * 캔버스 위에 떠 있는 도구 패널 — 카드 배경·테두리로 얹혀도 읽히게 하고, ReactFlow 키(Space·화살표·Delete/Backspace)만 올리지 않는다
 * (단추의 Space 가 이동 켜짐으로 읽히지 않게). 위치·testid·추가 class 만 받는다.
 */
function FloatingPanel({ position, testId, className, children }: {
  position: PanelPosition
  testId: string
  className?: string
  children: ReactNode
}) {
  return (
    <Panel position={position} data-testid={testId} onKeyDown={stopFlowKeys} className={cn('flex items-center gap-1 rounded-md border bg-card p-1 shadow-sm', className)}>
      {children}
    </Panel>
  )
}

/** 확대·축소·맞춤 단추와 현재 배율. ReactFlow 안(Provider 아래)에서만 쓸 수 있다. 읽기 전용이어도 보기 조작이라 켜 둔다. */
function ZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { zoom } = useViewport()
  // 좁은 캔버스(@3xl 미만)에서는 왼쪽 위 도구와 겹치지 않게 오른쪽 아래로 내린다. keydown 은 ReactFlow 로 올리지 않는다(단추의 Space 가 이동 켜짐으로 읽히지 않게)
  return (
    <FloatingPanel position="top-right" testId="workflow-graph-zoom" className="text-xs !top-auto !bottom-0 @3xl:!top-0 @3xl:!bottom-auto">
      <Button type="button" variant="ghost" size="icon-xs" aria-label="축소" onClick={() => void zoomOut()}><Minus /></Button>
      <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="확대" onClick={() => void zoomIn()}><Plus /></Button>
      <Button type="button" variant="ghost" size="xs" onClick={() => void fitView({ duration: 200 })}>맞춤</Button>
    </FloatingPanel>
  )
}

/**
 * 그래프 편집 화면의 본체 — ReactFlow 캔버스 위에 떠 있는 도구(+ 노드·자동 정렬·실행 취소·질문 경로, 배율·맞춤)·미니맵·범례와,
 * 캔버스 옆 서랍(노드 설정 또는 워크플로우 개요, WP-2091). 검사 결과는 노드 「!」 배지와 개요 서랍의 「검사 결과」 탭으로 보인다.
 * 노드·선은 매번 graph(YAML 을 읽은 것)에서 만들고, 끌기·연결·추가는 graphYaml 함수로 YAML 을 고쳐 onChange 로 올린다.
 * 서랍 상태(drawer)는 부모가 든다 — 탭 머리 검사 배지도 같은 서랍을 열어야 하기 때문이다.
 * 지역 상태는 드래그 중 좌표·질문 경로 펼침·자동 정렬 실행 취소 기억뿐이다 — 원본을 둘로 들지 않으려는 것이다.
 */
function Canvas({ yaml, readOnly, onChange, graph, drawer, onDrawerChange, problems, onOpenYaml, onOpenInstructions, workflowId }: {
  yaml: string
  readOnly: boolean
  onChange: (yaml: string) => void
  graph: WorkflowGraph
  drawer: DrawerState
  onDrawerChange: (drawer: DrawerState) => void
  problems: GraphProblems
  onOpenYaml: () => void
  /** 노드 서랍 「지시 편집 ⤢」 — 창은 서랍 밖(WorkflowGraphEditor)이 띄운다 */
  onOpenInstructions: (target: InstructionEditorTarget) => void
  /** 노드 서랍 「최근 실행」 조회용 정의 id */
  workflowId: number
}) {
  // 노드 서랍이 열려 있으면 그 노드가 캔버스에서도 선택 표시된다(선택의 원본은 서랍 상태 하나)
  const nodeDrawer = drawer?.kind === 'node' ? drawer : null
  const selected = nodeDrawer?.key ?? null
  // 「+ 노드」로 방금 더한 노드가 화면에 들어올 때까지 기다리는 키 — 비면 더 옮길 것이 없어 멈춘다.
  const [pendingReveal, setPendingReveal] = useState<string | null>(null)
  const flow = useReactFlow()
  // 캔버스 컨테이너 자체의 화면 사각형을 재기 위한 ref — 노드와 캔버스를 같은 기준으로 비교한다.
  const canvasRef = useRef<HTMLDivElement>(null)
  const roleNames = useMemo(() => new Map(graph.roles.map((r) => [r.key, r.name ?? r.key])), [graph.roles])
  // 노드별 가장 센 검사 등급 — 숨은 질문 노드의 문제는 그 질문을 낸 노드에 단다(WP-2091)
  // 질문 경로(ask) 펼침 여부 — 보기만 바꾸는 지역 상태라 읽기 전용이어도 켤 수 있다(기본은 접힘).
  const [showAsk, setShowAsk] = useState(false)
  // 펼치면 질문 노드가 화면에 있으니 그 노드 자신에게 단다(접힌 동안만 호스트로 옮긴다)
  const problemLevels = useMemo(() => nodeProblemLevels(graph, problems.problems, showAsk), [graph, problems.problems, showAsk])
  // 「자동 정렬」 직전·직후 YAML — 지금 YAML 이 직후와 같은 동안만 「실행 취소」를 보인다(다른 편집이 끼면 덮지 않게).
  const [undoLayout, setUndoLayout] = useState<{ before: string; after: string } | null>(null)
  const placed = useMemo(() => placeNodes(graph, { showAsk }), [graph, showAsk])
  const { positions, layout, view } = placed
  // 화면에 그리는 노드는 보이는 것(view.nodes)뿐이다 — 접혀 숨은 질문 노드는 positions 에도 없다.
  // width·height 를 배치 계산의 nodeSize 와 같게 주어 그려진 상자가 겹침 검사의 상자와 똑같게 한다.
  const derivedNodes: Node<FlowNodeData>[] = useMemo(() => view.nodes.map((n) => {
    const size = nodeSize(n)
    const roleName = n.role ? roleNames.get(n.role) ?? n.role : undefined
    const problem = problemLevels.get(n.key)
    return {
      id: n.key,
      type: 'workflow',
      position: positions.get(n.key) ?? { x: 0, y: 0 },
      width: size.width,
      height: size.height,
      handles: flowHandles(n),
      data: {
        node: n,
        roleName,
        askHost: !showAsk && view.askHosts.has(n.key),
        commonRecovery: n.key === view.commonErrorTo,
        problem,
      },
      // 스크린리더용 한국어 이름(표시 이름, 담당) — React Flow 기본은 영어 안내라 직접 준다(WP-2052). 검사 결과가 있으면 끝에 붙인다(WP-2091)
      ariaLabel: nodeAriaLabel(n, roleName, problem),
      selected: n.key === selected,
      // 가상 노드만 막고, 나머지는 undefined 로 두어 ReactFlow 의 nodesDraggable·nodesConnectable(readOnly)을 따르게 한다
      // 질문 경로를 펼친 보기는 보기 전용 배치라 끌어 옮길 수 없다(끌면 접힘 배치 좌표를 덮어쓴다)
      draggable: n.virtual || showAsk ? false : undefined,
      connectable: n.virtual ? false : undefined,
    }
  }), [view, positions, roleNames, selected, showAsk, problemLevels])
  // 드래그 중 노드가 커서를 따라오려면 ReactFlow 가 바뀐 좌표를 들고 있어야 한다(v12 의 제어 노드는 onNodesChange 가 적용해야 움직인다).
  // YAML 에서 만든 노드가 바뀌면 지역 상태를 다시 맞춘다 — 드래그가 끝나면 moveManyFromDrag 가 YAML 을 고쳐 같은 좌표로 수렴한다.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(derivedNodes)
  useEffect(() => { setNodes(derivedNodes) }, [derivedNodes, setNodes])
  // 노드를 캔버스 안에 들이는 시야 이동 — 지금 캔버스 크기 기준으로 그 노드 상자를 재서 벗어난 만큼만 옮긴다(effect 와 크기 변화 뒤 재맞춤이 함께 쓴다)
  const applyReveal = useCallback((key: string) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasRect = canvas.getBoundingClientRect()
    const bounds = flow.getNodesBounds([key])
    // 화면 좌표는 두 점 다 flowToScreenPosition 으로 받아야 한다 — bounds 는 그래프 단위라 배율이 1 이 아니면
    // 크기에 배율이 빠져 모자란 만큼만 옮기고 노드 오른쪽이 캔버스 밖에 남는다(WP-2039, 배율 2 에서 142px 부족).
    const topLeft = flow.flowToScreenPosition({ x: bounds.x, y: bounds.y })
    const bottomRight = flow.flowToScreenPosition({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
    const nodeRect = { left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y }
    const { dx, dy } = revealOffset(canvasRect, nodeRect)
    if (dx !== 0 || dy !== 0) {
      const { x, y, zoom } = flow.getViewport()
      void flow.setViewport({ x: x + dx, y: y + dy, zoom }, { duration: 250 })
    }
  }, [flow])
  // 서랍을 연 직후 크기 변화에서 다시 맞출 노드와 그 마감 시각
  const lateReveal = useRef<{ key: string } | null>(null)
  // 「+ 노드」로 더한 노드가 보이지 않으면 최소한만큼 시야를 옮긴다 — ReactFlow 의 fitView 는 처음 그릴 때 한 번뿐이라 그 뒤로는 화면을 따라가지 않는다.
  // 노드 크기는 nodeSize 로 미리 주므로(측정을 기다리지 않는다) useNodesInitialized 게이트를 쓰지 않는다 — 크기를 준 노드는
  // ReactFlow 가 「측정 완료」로 치지 않아 그 값이 끝내 false 에 머물러 시야가 영영 옮겨지지 않았다(WP-2089).
  useEffect(() => {
    if (!pendingReveal) return
    const node = derivedNodes.find((n) => n.id === pendingReveal)
    const canvas = canvasRef.current
    // yaml·derivedNodes 어디에도 없으면 끝내 안 오는 노드다(추가가 실제로 실패했거나 이미 지워진 경우) — 영구 대기를 막기 위해 비운다.
    if (!node || !canvas) { setPendingReveal(null); return }
    // 같은 커밋의 효과 시점에는 새 노드가 아직 스토어에 없다 — nodes 상태 동기(setNodes)와 StoreUpdater 가 effects 에서
    // 뒤에야 채우기 때문이다. 지역 상태 nodes 가 바뀌어 다시 그려진 뒤에는(자식 ReactFlow 의 동기 효과가 먼저 돈다) 스토어에 있다.
    const stored = flow.getInternalNode(pendingReveal)
    if (!stored) return // 스토어에 들어올 때까지 — 소진하지 말고 기다린다
    // 크기가 없으면 원점 기준으로 헛이동하므로 기다린다(크기는 노드에 미리 준 width·height 또는 측정값).
    if (!(stored.measured?.width || stored.width) || !(stored.measured?.height || stored.height)) return
    applyReveal(pendingReveal)
    // 스토어·측정 상태를 확인한 뒤에야 소진할 수 있어 렌더·핸들러로 옮길 수 없다 — 계산이 끝난 이 시점에서만 비운다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 영구 대기를 막는 소진(pendingReveal 비움)은 effect 안에서만 가능하다.
    setPendingReveal(null)
  }, [pendingReveal, derivedNodes, nodes, flow, applyReveal])
  // 서랍이 열리며 캔버스 크기가 한 번 더 바뀌는 때(좁은 폭에서 서랍이 아래로 쌓이며 캔버스가 줄거나, 서랍 본문이 늦게 차 높이가 자라는 때, AI 옆 패널 폭 반영)를 따라간다.
  // 위 effect 는 서랍을 그린 커밋 직후 한 번만 도는데 ResizeObserver·flex 재배치는 그 뒤에 와서, 그때 맞춘 시야가 줄어든 캔버스 밖(아래쪽에 반쯤 걸림)이 된다.
  // 그래서 서랍을 연 직후 짧은 동안 캔버스 크기가 바뀔 때마다 그 노드를 다시 최소한만큼 맞춘다(openNode 가 건 마감 타이머가 지나면 멈춘다 — 사용자가 일부러 화면을 옮긴 것을 되돌리지 않게).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const late = lateReveal.current
      if (!late) return
      if (flow.getInternalNode(late.key)) applyReveal(late.key)
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [flow, applyReveal])
  // 간선은 배치 결과(평행 간선을 합치고 숨길 선을 뺀 것)를 그대로 쓴다. 배치 때 양 끝 자리를 실어 옮겼는지 판정하게 한다.
  // 선 이름용 「노드 키 → 표시 이름」 맵(WP-2052)
  const nodeNames = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n.name ?? n.key])), [graph.nodes])
  const edges: Edge<RoutedEdgeData>[] = useMemo(() => {
    const shapeKeys = new Set(view.nodes.filter(isShapeNode).map((n) => n.key))
    // 출발·도착 쌍마다 ask 가 아닌 선이 있는지 — 선마다 view.edges 를 훑지 않도록 미리 모은다
    const pairKey = (from: string, to: string) => `${from}\u0000${to}`
    const nonAskPairs = new Set(view.edges.filter((x) => x.kind !== 'ask').map((x) => pairKey(x.from, x.to)))
    return layout.edges.map((e) => {
      // 되돌림·점선·손잡이는 그린 자리로 한 번에 정한다(양 끝이 배치 자리를 벗어났으면 두 노드 가운데 y 로 가른다)
      const { back, dashed, sourceHandle, targetHandle } = drawnEdge(e, positions, layout)
      // 합친 묶음이 모두 질문 경로 선이면 접근 이름을 「(질문)」으로 읽는다 — 묶음에는 종류가 없어 원래 간선에서 본다
      const askOnly = !nonAskPairs.has(pairKey(e.from, e.to))
      return {
      id: e.id,
      source: e.from,
      target: e.to,
      type: 'routed',
      sourceHandle,
      targetHandle,
      // 스크린리더용 한국어 이름(출발 → 도착, WP-2052)
      ariaLabel: edgeAriaLabel({ id: e.id, from: e.from, to: e.to, label: e.label, kind: askOnly ? 'ask' : 'outcome' }, nodeNames),
      // 되돌림 선은 화살촉도 선과 같은 글자 강도 색으로 — 기본 화살촉(회색)이면 선과 따로 보인다
      markerEnd: back ? BACK_EDGE_MARKER : EDGE_MARKER,
      data: {
        label: e.label, points: routedPoints(e, layout, shapeKeys), labelPos: e.labelPos, back, dashed,
        fromAt: layout.positions.get(e.from), toAt: layout.positions.get(e.to),
      },
      }
    })
  }, [layout, view, nodeNames, positions])
  const commonRecoveryName = view.commonErrorTo
    ? (graph.nodes.find((n) => n.key === view.commonErrorTo)?.name ?? view.commonErrorTo)
    : null
  const canUndoLayout = undoLayout !== null && undoLayout.before !== undoLayout.after && yaml === undoLayout.after
  // YAML 에 실제로 있는 노드의 키(가상 노드 제외)
  const realKeys = useMemo(() => new Set(graph.nodes.filter((n) => !n.virtual).map((n) => n.key)), [graph])
  // 서랍을 바꾼 뒤 포커스를 둘 곳 — 서랍이 바뀌면(effect 로 옮긴다) 옛 서랍 안에 있던 포커스가 body 로 떨어지기 때문이다.
  // 'drawer' = 새 서랍 영역(개요↔노드로 바뀔 때), { node } = 서랍을 닫은 뒤 그 노드(없거나 지워졌으면 캔버스).
  const pendingFocus = useRef<'drawer' | { node: string | null } | null>(null)
  // 서랍은 캔버스의 flex 형제라 부모(캔버스 둘레)에서 찾는다.
  function drawerAside(): HTMLElement | null {
    return canvasRef.current?.parentElement?.querySelector<HTMLElement>(':scope > aside') ?? null
  }
  /**
   * 서랍을 바꾸는 단 하나의 길(WP-2091) — 포커스 되돌릴 곳을 정해 두고 부모에 알린다. 노드 클릭·「+ 노드」·검사 결과 행·빈 곳 클릭·닫기가 모두 거친다.
   * 닫을 때: 열린 서랍이 없으면 할 일이 없다 — 복귀 자리를 남기면 다시 그려지지 않아 소모되지 않고,
   *   다음 편집(끌기·자동 정렬)으로 다시 그려질 때 포커스를 캔버스로 빼앗는다.
   * 개요↔노드로 바꿀 때: 포커스가 옛 서랍 안에 있었을 때만 새 서랍으로 옮긴다.
   */
  function changeDrawer(next: DrawerState) {
    if (next === null) {
      if (drawer === null) return
      pendingFocus.current = { node: nodeDrawer?.key ?? null }
    } else if (drawer !== null && drawer.kind !== next.kind && drawerAside()?.contains(document.activeElement)) {
      pendingFocus.current = 'drawer'
    }
    onDrawerChange(next)
  }
  function closeDrawer() { changeDrawer(null) }
  // 서랍이 열리거나 종류가 바뀔 때(빈 캔버스 클릭·헤더 검사 배지) 포커스가 서랍·캔버스 밖(body·배지)에 있으면 서랍으로 옮긴다.
  // 안 옮기면 Esc 가 캔버스 onKeyDown·서랍 onKeyDown 어디에도 닿지 않아 열자마자는 Esc 로 닫히지 않는다(WP-2091 라이브 검증).
  // 포커스가 이미 캔버스·서랍 안(노드 클릭 등)이면 건드리지 않는다. 마운트 때 이미 열려 있던 서랍(보기 전환 복귀)은 포커스를 뺏지 않는다.
  const prevDrawerKind = useRef(drawer?.kind ?? null)
  useEffect(() => {
    const kind = drawer?.kind ?? null
    const was = prevDrawerKind.current
    prevDrawerKind.current = kind
    // 닫힘·같은 종류 유지(탭 바꿈·노드 바꿈)면 건드리지 않는다. 노드 서랍 → 개요(빈 캔버스 클릭)는 포커스가 body 로 빠지므로 여기서 잡는다
    if (kind === null || kind === was) return
    const aside = drawerAside()
    const active = document.activeElement
    if (!aside || (active && (aside.contains(active) || canvasRef.current?.contains(active)))) return
    aside.focus()
  }, [drawer])
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    if (target === 'drawer') {
      if (drawer === null) return
      pendingFocus.current = null
      drawerAside()?.focus()
      return
    }
    if (drawer !== null) return
    pendingFocus.current = null
    const canvas = canvasRef.current
    if (!canvas) return
    // 서랍에서 노드를 지웠으면 그 요소는 곧 사라지므로(스토어 동기는 뒤에 온다) 문서에 남은 노드일 때만 그 노드로 돌아간다
    const nodeEl = target.node === null || !realKeys.has(target.node) ? undefined
      : Array.from(canvas.querySelectorAll<HTMLElement>('.react-flow__node')).find((el) => el.getAttribute('data-id') === target.node)
    ;(nodeEl ?? canvas.querySelector<HTMLElement>('.react-flow'))?.focus()
  }, [drawer, realKeys])
  /**
   * 노드 서랍을 연다(WP-2091) — 노드 클릭·Enter/Space·「+ 노드」·검사 결과 행이 함께 쓴다. 서랍이 같은 커밋에 그려져 캔버스가 줄어드므로
   * 줄어든 캔버스 기준으로 그 노드가 보이게 시야를 옮긴다(「+ 노드」의 pendingReveal effect 를 그대로 쓴다).
   */
  function openNode(key: string, tab: NodeDrawerTab = 'settings') {
    changeDrawer({ kind: 'node', key, tab })
    setPendingReveal(key)
    lateReveal.current = { key }
    // 마감 — 지나면 사용자가 일부러 옮긴 화면을 되돌리지 않도록 멈춘다
    window.setTimeout(() => { if (lateReveal.current?.key === key) lateReveal.current = null }, 800)
  }
  // 검사 결과 행 — 가리키는 노드(숨어 있는 질문 노드면 질문을 낸 노드)를 문제에 맞는 탭으로 연다. 질문 경로는 펼치지 않는다(호스트를 고른다).
  // 노드를 못 찾으면(문서 수준 문제·지워진 키) YAML 보기에서 고치게 넘긴다.
  function selectProblem(problem: WorkflowProblem) {
    const key = problemTargetNode(graph, problem.nodeKey, showAsk)
    if (key !== null && realKeys.has(key) && positions.has(key)) openNode(key, problemTab(problem, yaml))
    else onOpenYaml()
  }
  // 편집 패널은 마우스 클릭(onNodeClick)과 키보드 Enter·Space 로만 연다. onSelectionChange 로 열지 않는 까닭: React Flow 는
  // 드래그를 시작할 때도 노드를 선택하므로, 선택 변경을 패널 열기로 받으면 노드를 끌기만 해도 패널이 열린다(마우스 동작을 바꾸면 안 된다).
  // 노드 wrapper 의 keydown 은 ReactFlow 루트로 버블링되므로 여기서 받아 눌린 곳의 노드(data-id)를 찾는다.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const nodeId = target.closest('.react-flow__node')?.getAttribute('data-id') ?? null
    // Esc 는 캔버스 어디에서 눌렀든(노드 위·빈 곳) 열린 서랍을 닫는다(WP-2091) — React Flow 가 노드 위 Esc 로 선택을 풀므로 서랍도 닫아 둘이 어긋나지 않게 한다.
    // 포털로 뜬 메뉴(+ 노드)의 Esc 는 React 트리로는 여기까지 올라오지만 DOM 으로는 캔버스 밖이라 거른다 — 메뉴만 닫히고 서랍은 남게.
    // 서랍을 실제로 닫을 때만 막는다 — 안 막으면 앱 전역 Esc 가 AI 패널까지 함께 닫는다(서랍이 없으면 그대로 두어 AI 패널이 닫히게)
    // 입력 칸(편집기 포함) 안의 Esc 는 그 칸의 몫이라 서랍을 닫지 않는다(DrawerShell 과 같은 규칙).
    // 서랍은 캔버스 밖 형제라 서랍 안 입력은 이미 contains 로 걸러진다 — 이 가드는 캔버스 안(ReactFlow 아래)의 편집 요소용이라 둔다.
    if (e.key === 'Escape' && drawer !== null && !e.defaultPrevented && !isEditableTarget(target) && canvasRef.current?.contains(target)) {
      e.preventDefault()
      closeDrawer()
      return
    }
    const action = panelActionFromKeyDown(e.key, nodeId, realKeys)
    // 닫는 키(close)는 위에서 처리했다 — 여기는 열기·기본 동작 막기만
    if (!action || 'close' in action) return
    // Space 의 기본 동작(페이지 스크롤)을 막는다 — 노드를 고르는 키로 쓰기 때문이다
    e.preventDefault()
    if ('open' in action) openNode(action.open)
  }
  // 노드 자리를 YAML 에 쓰는 곳은 여기 한 곳이다. React Flow 는 마우스 드래그가 끝날 때와 키보드(화살표)로 옮길 때 모두
  // onNodesChange 로 position 변경(dragging:false)을 보낸다 — 키보드 이동은 onNodeDragStop 을 부르지 않으므로 거기서 쓰면
  // 다시 그릴 때 노드가 제자리로 되돌아간다. 여러 노드를 함께 끌었으면 모두의 자리를 한 번에 쓴다.
  // v13 의 변경 묶음은 배열이 아니라 Changeset 이라 getByType 으로 position 변경만 꺼낸다
  const handleNodesChange: OnNodesChange<Node<FlowNodeData>> = (changes) => {
    onNodesChange(changes)
    // 질문 경로를 펼친 보기는 보기 전용 배치라 그 좌표를 저장하지 않는다
    if (readOnly || showAsk) return
    const moved = changes.getByType('position')
      .filter((c) => c.dragging === false && c.position && realKeys.has(c.id))
      .map((c) => ({ id: c.id, position: c.position! }))
    if (moved.length === 0) return
    const next = moveManyFromDrag(yaml, moved)
    if (next !== yaml) onChange(next)
  }
  // 지워진 노드(YAML 쪽 편집·삭제)를 가리키는 서랍은 그리지 않는다.
  // 질문 경로를 접어 화면에서 사라진 노드도 서랍을 닫는다 — 보이지 않는 노드를 고치는 서랍이 남지 않게.
  const panelKey = selected && realKeys.has(selected) && positions.has(selected) ? selected : null
  // 그런 서랍 상태는 부모에게서도 비운다(WP-2091) — 남겨 두면 같은 키의 노드가 다시 생길 때 저절로 열린다.
  // 부모 상태라 렌더 중에 바꿀 수 없어 effect 에서 비운다(그 사이 한 번은 위 panelKey 가 서랍을 숨긴다).
  const staleNodeDrawer = nodeDrawer !== null && panelKey === null
  useEffect(() => {
    if (staleNodeDrawer) onDrawerChange(null)
  }, [staleNodeDrawer, onDrawerChange])
  // 시작 노드가 없는 초안(만들기 템플릿 등)은 시작 노드를 그래프에서 더할 수 있어야 한다
  const menu = graph.nodes.some((n) => n.type === 'start') ? NEW_NODE_MENU : [START_MENU_ITEM, ...NEW_NODE_MENU]

  function onConnect(c: Connection) {
    if (readOnly) return
    applyConnection(yaml, graph, c, onChange)
  }

  return (
    // @container — 아래 행·패널의 @3xl 판정 기준은 여기(뷰포트가 아니라 편집기 폭)다. YAML 모드와 같은 규약.
    <div className="@container flex h-full min-h-0 min-w-0 flex-col rounded-md border">
      {/* 좁으면 세로로 쌓아 캔버스 폭을 지키고, @3xl 이상에서만 YAML 모드와 같은 옆으로 배치 */}
      <div className="flex min-h-0 flex-1 flex-col @3xl:flex-row">
        {/* ReactFlow 가 쓰는 `.react-flow` 는 `height: 100%` 이라 부모 높이가 확정(definite)이 아니면 0 으로 풀려 캔버스가 통째로 사라진다.
            세로 쌓기(main 축 = 높이)에서 `flex-1`(flex-basis 0%) 은 부모 높이가 불확정일 때 내용 기준이 되어 그렇게 되므로,
            좁을 때는 `flex-auto`(basis auto → h-[24rem])로 높이를 확정해 두고 부모가 더 크면 늘어난다.
            가로 배치(@3xl)에서는 높이가 교차 축이라 `h-full`(부모를 채움)로 확정하고 폭만 flex-1. min-h 는 눌리지 않게 하는 안전판. */}
        <div ref={canvasRef} className="relative h-[24rem] min-h-[24rem] min-w-0 flex-auto @3xl:h-full @3xl:flex-1" data-testid="workflow-graph-canvas">
          <ReactFlow
            nodes={nodes}
            onNodesChange={handleNodesChange}
            edges={edges}
            aria-label={GRAPH_EDITOR_ARIA_LABEL}
            ariaLabelConfig={readOnly ? GRAPH_ARIA_LABEL_CONFIG_READONLY : GRAPH_ARIA_LABEL_CONFIG}
            onKeyDown={onKeyDown}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            connectionMode={ConnectionMode.Loose}
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => { if (realKeys.has(node.id)) openNode(node.id) }}
            // 빈 곳을 누르면 워크플로우 개요 서랍(검사 결과 탭)으로 바뀐다(WP-2091) — 노드 밖의 정보(검사·역할·시작 조건)를 보는 자리
            onPaneClick={() => changeDrawer({ kind: 'overview', tab: 'problems' })}
            onConnect={onConnect}
          >
            <Background />
            {/* 저장·게시 중(readOnly)에도 도구는 자리를 지키고 꺼진 채 보인다 — 사라졌다 나타나며 화면이 흔들리지 않게 */}
            <FloatingPanel position="top-left" testId="workflow-graph-tools" className="max-w-[calc(100%-1.5rem)] flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={readOnly}><Button type="button" variant="outline" size="sm" disabled={readOnly}>+ 노드</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {menu.map((item) => (
                    <DropdownMenuItem
                      key={item.type}
                      onSelect={() => {
                        // 좌표를 정해 두면 새 노드가 겹쳐 그려지지 않는다 — 저장·자동 배치 자리를 모두 피한 빈 자리(가장 아래 노드 밑, 가장 왼쪽 x)에 놓는다.
                        const added = addNodeAtFreeSpot(yaml, item.type)
                        onChange(added.yaml)
                        // addNode 가 실패하면(yaml·layout 없음 등) 새 키가 없다 — 앞서 기다리던 노드도 그 시점에 대체된 것이므로
                        // 측정되지 못한 채 계속 기다리는 pendingReveal 을 남기지 않기 위해 통째로 비운다.
                        if (added.key) openNode(added.key)
                        else setPendingReveal(null)
                      }}
                    >{item.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={readOnly}
                onClick={() => {
                  const after = autoLayout(yaml)
                  // 이미 정렬된 상태에서 또 누르면 before===after 가 되어 실행 취소가 사라지므로 원래 before 를 지킨다
                  setUndoLayout((prev) => ({ before: yaml === prev?.after ? prev.before : yaml, after }))
                  onChange(after)
                }}
              >자동 정렬</Button>
              {canUndoLayout && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={readOnly}
                  onClick={() => {
                    onChange(undoLayout.before)
                    setUndoLayout(null)
                  }}
                ><Undo2 aria-hidden="true" />실행 취소</Button>
              )}
              {/* 켜짐은 디자인 시스템 「토글 켜짐」 클래스로 보인다 — aria-pressed 만으로는 색·테두리 변화가 없어 켠 상태를 알기 어렵다 */}
              <Button type="button" variant="outline" size="sm" aria-pressed={showAsk} className={cn(showAsk && TOGGLE_ON_CLASS)} onClick={() => setShowAsk((v) => !v)}><MessageCircleQuestion aria-hidden="true" />질문 경로</Button>
            </FloatingPanel>
            <ZoomControls />
            {/* 미니맵은 넓은 캔버스(@3xl 이상)의 오른쪽 아래 — 범례(왼쪽 아래)와 겹치지 않게 범례 폭을 미니맵만큼 줄여 둔다. 좁으면 숨긴다 */}
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              ariaLabel="미니맵"
              className="!hidden !rounded-md !border !bg-card !shadow-sm @3xl:!block"
              nodeColor="var(--muted-foreground)"
              maskColor="color-mix(in oklab, var(--background) 70%, transparent)"
            />
          </ReactFlow>
          <GraphLegend commonRecoveryName={commonRecoveryName} />
        </div>
        {/* 서랍은 화면 고정이 아니라 캔버스의 flex 형제 — 캔버스를 밀어 줄이고, 좁으면 아래로 쌓인다(WP-2091) */}
        {panelKey && nodeDrawer && (
          <NodeDrawer
            key={panelKey}
            yaml={yaml}
            graph={graph}
            nodeKey={panelKey}
            tab={nodeDrawer.tab}
            onTabChange={(tab) => onDrawerChange({ kind: 'node', key: panelKey, tab })}
            readOnly={readOnly}
            onChange={onChange}
            onClose={closeDrawer}
            onOpenYaml={onOpenYaml}
            onOpenInstructions={onOpenInstructions}
            workflowId={workflowId}
          />
        )}
        {drawer?.kind === 'overview' && (
          <OverviewDrawer
            yaml={yaml}
            graph={graph}
            tab={drawer.tab}
            onTabChange={(tab) => onDrawerChange({ kind: 'overview', tab })}
            problems={problems}
            readOnly={readOnly}
            onSelectProblem={selectProblem}
            onAddAskPath={(nodeKey) => onChange(addAskPath(yaml, nodeKey))}
            onOpenYaml={onOpenYaml}
            onClose={closeDrawer}
          />
        )}
      </div>
    </div>
  )
}

/**
 * 워크플로우 초안을 그래프로 보고 고치는 편집기. 그래프의 모든 편집은 graphYaml 함수로 YAML 문자열을 고쳐
 * onChange 로 올릴 뿐이다 — 원본은 언제나 YAML 이다.
 */
export function WorkflowGraphEditor({ yaml, parsed, readOnly, onChange, onOpenYaml, drawer, onDrawerChange, problems, workflowId }: {
  yaml: string
  /** yaml 을 부모가 이미 읽은 결과 — 부모(탭 머리 배지 판정)와 같은 파싱을 한 번만 하려고 받는다 */
  parsed: ReturnType<typeof parseWorkflowGraph>
  readOnly: boolean
  onChange: (yaml: string) => void
  /** YAML 보기로 넘어간다 — 문법 오류 안내·개요 서랍의 「YAML 에서 고치기」·노드 없는 검사 결과 행이 쓴다 */
  onOpenYaml: () => void
  /** 열린 서랍(노드 설정·워크플로우 개요, WP-2091) — 탭 머리 검사 배지도 열 수 있게 부모가 든다 */
  drawer: DrawerState
  onDrawerChange: (drawer: DrawerState) => void
  /** 탭 머리 배지와 같은 검사 결과 — 개요 서랍 「검사 결과」 탭과 노드 「!」 배지 */
  problems: GraphProblems
  /** 이 워크플로우 정의 id — 노드 서랍 「최근 실행」이 실행을 조회하는 데 쓴다 */
  workflowId: number
}) {
  // 지시 편집 창(WP-2092)을 연 노드 — 서랍 안이 아니라 여기서 든다. 창이 열린 사이 노드 키가 바뀌거나 YAML 이 깨지면
  // 서랍(과 문법 오류면 캔버스 전체)이 사라지는데, 창과 고치던 글은 남아야 하기 때문이다(문법 오류 안내 쪽에도 같이 그린다)
  const [instructionTarget, setInstructionTarget] = useState<InstructionEditorTarget | null>(null)
  const instructionEditor = instructionTarget && (
    <NodeInstructionEditor yaml={yaml} syntaxError={!('graph' in parsed)} target={instructionTarget} readOnly={readOnly} onChange={onChange} onClose={() => setInstructionTarget(null)} />
  )
  // 창은 두 갈래 모두 같은 자리(조각의 둘째 자식)에 둔다 — 갈래마다 다른 부모 아래 그리면 YAML 이 깨지는 순간 창이 다시 마운트돼 고치던 글이 사라진다
  return (
    <>
      {'graph' in parsed ? (
        <ReactFlowProvider>
          <Canvas
            yaml={yaml}
            readOnly={readOnly}
            onChange={onChange}
            graph={parsed.graph}
            drawer={drawer}
            onDrawerChange={onDrawerChange}
            problems={problems}
            onOpenYaml={onOpenYaml}
            onOpenInstructions={setInstructionTarget}
            workflowId={workflowId}
          />
        </ReactFlowProvider>
      ) : (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
          <p>YAML 에 문법 오류가 있어 그래프로 볼 수 없습니다.</p>
          <YamlFixButton onClick={onOpenYaml} />
        </div>
      )}
      {instructionEditor}
    </>
  )
}
