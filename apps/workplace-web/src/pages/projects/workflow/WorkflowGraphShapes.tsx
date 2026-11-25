// 워크플로우 편집 그래프의 그림 조각(WP-2089) — 노드 모양(카드·마름모·원), dagre 꺾임점을 따르는 간선, 범례.
// 왜 따로 두나: 편집기 본체(WorkflowGraphEditor)는 상태·편집을, 이 파일은 그리기만 맡아 둘 다 읽기 쉽게 하려는 것이다.
import {
  BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath, Handle, type Node, type NodeProps, Position,
  useInternalNode,
} from '@xyflow/react'
import { MessageCircle } from 'lucide-react'

import { cn, directionParticle } from '@/lib/utils'

import { nodeActorLabel } from './graphA11y'
import { CARD_HEIGHT, CARD_WIDTH, isAtLayoutPosition, isShapeNode, nodeSize, SHAPE_LABEL_GAP, SHAPE_SIZE } from './graphLayout'
import type { GraphNode } from './graphYaml'
import { NodeKindIcon } from './NodePanel'

/** 💬 아이콘의 툴팁 — 질문 경로를 접었을 때 이 단계에서 사람에게 물을 수 있음을 알린다. */
export const ASK_TIP = '사람에게 묻기 가능 — 확인자가 답하면 이 단계로 돌아옴'
/** 공통 오류 처리 노드에 다는 표식 — 그 노드로 가는 오류 선을 다 그리지 않는 대신 붙인다. */
export const COMMON_RECOVERY_BADGE = '↺ 모든 단계에서'

export interface FlowNodeData extends Record<string, unknown> {
  node: GraphNode
  roleName?: string
  /** ask 경로가 있는 노드 — 접힌 동안 카드 오른쪽 위에 💬 를 단다 */
  askHost: boolean
  /** 공통 오류 처리 목적지(view.commonErrorTo) — 「↺ 모든 단계에서」 표식 */
  commonRecovery: boolean
  /** 이 노드에 걸린 가장 센 검사 결과(WP-2091) — 오른쪽 위 「!」 배지. 없으면 배지를 달지 않는다 */
  problem?: 'ERROR' | 'WARNING'
}

/**
 * 검사 결과 배지(WP-2091) — 오류는 빨간, 경고는 노란 「!」. 뜻은 노드 접근 이름(「, 오류 있음」)이 전하므로 배지 자체는 aria-hidden.
 * 자리(absolute 위치)는 부르는 쪽이 className 으로 준다 — 카드는 💬 왼쪽, 도형은 도형 오른쪽 위.
 */
function ProblemBadge({ level, className }: { level: 'ERROR' | 'WARNING'; className: string }) {
  return (
    <span
      data-problem-badge
      aria-hidden="true"
      className={cn(
        'absolute flex size-4 items-center justify-center rounded-full text-[11px] leading-none font-bold',
        level === 'ERROR' ? 'bg-destructive text-destructive-foreground' : 'bg-warning text-warning-foreground',
        className,
      )}
    >!</span>
  )
}

/** 마름모 안쪽 정사각형 한 변 — 45° 돌렸을 때 대각선이 SHAPE_SIZE 가 되게 해 dagre 에 넣은 상자를 넘지 않는다. */
const DIAMOND_SIDE = Math.round(SHAPE_SIZE / Math.SQRT2)
/** 마름모·원의 손잡이는 상자 가운데가 아니라 도형 가운데(x) 에 둔다 — 이름이 오른쪽에 붙어 상자가 넓기 때문이다. */
const SHAPE_HANDLE_STYLE = { left: SHAPE_SIZE / 2 }

/**
 * 네 변(위·아래·왼쪽·오른쪽)마다 손잡이(s-*)가 자리마다 하나씩만 있다 — 같은 자리에 들어옴(t-*)을 겹치면 느슨한 연결 모드에서
 * 가장 가까운 손잡이를 고를 때 그쪽이 잡혀 놓기가 거절된다(WP-2089). 선의 도착 끝도 s-* 를 targetHandle 로 쓴다.
 * 즉 s-* 한 id 가 느슨한 연결 모드에서 source·target 양쪽 손잡이로 쓰이므로 이름을 바꾸지 않는다.
 * 이 컴포넌트는 아래 s-bottom 은 빼고 나머지 3개를 그린다.
 * 저장된 좌표 때문에 두 노드가 옆에 놓였을 때 선이 옆면으로 이어지게 한다. id·자리는 graphLayout.flowHandles 와 같아야 한다.
 * shape 면 오른쪽 손잡이를 상자 오른쪽 끝이 아니라 도형 오른쪽 변(SHAPE_SIZE)에 둔다.
 */
function SideHandles({ shape = false }: { shape?: boolean }) {
  const x = shape ? SHAPE_HANDLE_STYLE : undefined
  const right = shape ? { left: SHAPE_SIZE, right: 'auto', transform: 'translate(-50%, -50%)' } : undefined
  return (
    <>
      <Handle id="s-top" type="source" position={Position.Top} style={x} />
      <Handle id="s-left" type="source" position={Position.Left} />
      <Handle id="s-right" type="source" position={Position.Right} style={right} />
    </>
  )
}

/** 작업 노드 카드 — 종류 아이콘·이름(잘림)·담당 줄. 크기는 CARD_WIDTH×CARD_HEIGHT 로 고정해 배치 계산과 같게 한다. */
function NodeCard({ data, selected }: { data: FlowNodeData; selected: boolean }) {
  const { node, roleName, askHost, commonRecovery, problem } = data
  // 오른쪽 위에 얹는 표식 수(💬·「!」) — 이름 줄이 그 밑으로 들어가지 않게 그만큼 비운다
  const marks = (askHost ? 1 : 0) + (problem ? 1 : 0)
  // 담당 줄은 접근 이름(nodeAriaLabel)과 같은 함수로 만들어 화면 글자와 스크린리더 이름이 어긋나지 않게 한다(WP-2052)
  const actor = nodeActorLabel(node, roleName)
  return (
    <div
      data-shape="card"
      style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
      className={`relative flex flex-col justify-center rounded-md border bg-card px-3 text-sm ${node.virtual ? 'border-dashed' : ''} ${selected ? 'ring-2 ring-ring' : ''}`}
    >
      <SideHandles />
      {/* 긴 글자를 자르는 overflow-hidden 은 글자 줄을 감싼 안쪽에만 둔다 — 손잡이를 가진 바깥 상자에 두면 바깥 절반이 잘린다 */}
      <div className="flex min-w-0 flex-col justify-center overflow-hidden">
        <div className={cn('flex min-w-0 items-center gap-2 font-medium', marks === 1 && 'pr-5', marks === 2 && 'pr-10')}>
          <NodeKindIcon type={node.type} />
          <span className="truncate">{node.name ?? node.key}</span>
        </div>
        {(actor || commonRecovery) && (
          <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {actor && <span className="truncate">{actor}</span>}
            {commonRecovery && (
              <span className="ml-auto shrink-0 rounded-sm bg-muted px-1 text-[11px] text-foreground">{COMMON_RECOVERY_BADGE}</span>
            )}
          </div>
        )}
      </div>
      {askHost && (
        // 아이콘만 있으면 읽히지 않으므로 감싼 span 에 이름(aria-label)과 툴팁(title)을 둘 다 단다
        <span role="img" aria-label={ASK_TIP} title={ASK_TIP} className="absolute top-1.5 right-1.5 text-info">
          <MessageCircle className="size-3.5" aria-hidden="true" />
        </span>
      )}
      {/* 💬 와 겹치지 않게 💬 가 있으면 그 왼쪽에 둔다 */}
      {problem && <ProblemBadge level={problem} className={askHost ? 'top-1.5 right-6' : 'top-1.5 right-1.5'} />}
      <Handle id="s-bottom" type="source" position={Position.Bottom} />
    </div>
  )
}

/** 분기(마름모)·시작·끝(원) — 도형 오른쪽에 이름을 붙인다. 바깥 상자는 nodeSize 와 같다. */
function NodeShape({ data, selected }: { data: FlowNodeData; selected: boolean }) {
  const { node, commonRecovery, problem } = data
  const size = nodeSize(node)
  // 도형 오른쪽 위 모서리에 걸친 배지(WP-2091) — 도형 상자(SHAPE_SIZE)를 기준으로 둔다
  const badge = problem ? <ProblemBadge level={problem} className="-top-1 -right-1" /> : null
  const ring = selected ? 'ring-2 ring-ring' : ''
  let shape
  if (node.type === 'decision') {
    shape = (
      <div data-shape="diamond" className="relative flex shrink-0 items-center justify-center" style={{ width: SHAPE_SIZE, height: SHAPE_SIZE }}>
        <div className={`flex rotate-45 items-center justify-center border bg-card ${ring}`} style={{ width: DIAMOND_SIDE, height: DIAMOND_SIDE }}>
          <NodeKindIcon type={node.type} className="size-3 shrink-0 -rotate-45 text-muted-foreground" />
        </div>
        {badge}
      </div>
    )
  } else {
    // 시작은 성공색, 끝은 굵은 파괴색 테두리 — 흐름의 처음과 끝을 모양만으로 가른다
    const border = node.type === 'start' ? 'border-2 border-success' : 'border-[3px] border-destructive'
    shape = (
      <div
        data-shape="circle"
        className={`relative shrink-0 rounded-full bg-card ${border} ${ring}`}
        style={{ width: SHAPE_SIZE, height: SHAPE_SIZE }}
      >{badge}</div>
    )
  }
  return (
    <div className="flex items-center" style={{ width: size.width, height: size.height, gap: SHAPE_LABEL_GAP }}>
      <SideHandles shape />
      {shape}
      <span className="min-w-0 truncate text-xs font-medium" title={commonRecovery ? COMMON_RECOVERY_BADGE : undefined}>
        {node.name ?? node.key}
      </span>
      <Handle id="s-bottom" type="source" position={Position.Bottom} style={SHAPE_HANDLE_STYLE} />
    </div>
  )
}

/** ReactFlow 사용자 정의 노드 — 종류에 따라 카드·마름모·원을 고른다. */
export function WorkflowNodeView({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  if (isShapeNode(data.node)) return <NodeShape data={data} selected={selected} />
  return <NodeCard data={data} selected={selected} />
}

export interface RoutedEdgeData extends Record<string, unknown> {
  label: string
  /** 그릴 점(양 끝 포함) — dagre 꺾임점을 routedPoints 로 도형 끝만 다듬은 것 */
  points: { x: number; y: number }[]
  /** dagre 라벨 중심(라벨이 없으면 null) */
  labelPos: { x: number; y: number } | null
  back: boolean
  dashed: boolean
  /** 배치를 계산할 때 양 끝 노드의 자리 — 지금 자리와 같아야 dagre 경로를 쓴다 */
  fromAt?: { x: number; y: number }
  toAt?: { x: number; y: number }
}

/**
 * 간선 — 양 끝 노드가 배치 계산 때 자리 그대로면 dagre 꺾임점을 잇고 라벨을 dagre 가 비워 둔 자리에 둔다.
 * 한쪽이라도 옮겨졌으면(끌기 중·저장 좌표) 그 점들이 노드를 뚫으므로 기본 smoothstep 경로·중간 라벨로 그린다.
 * 지금 자리는 ReactFlow 의 sourceX/Y(손잡이 좌표)가 아니라 스토어의 노드 position 으로 본다 — 배치 결과와 같은 기준(왼쪽 위)이다.
 */
export function RoutedEdge(props: EdgeProps<Edge<RoutedEdgeData, 'routed'>>) {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props
  const from = useInternalNode(source)
  const to = useInternalNode(target)
  const routed = !!data && data.points.length >= 2
    && isAtLayoutPosition(from?.position, data.fromAt) && isAtLayoutPosition(to?.position, data.toAt)

  let path: string
  let labelAt: { x: number; y: number } | null
  if (routed) {
    // 점은 routedPoints 로 다듬은 dagre 점 그대로다 — 손잡이 좌표로 바꿔 끼우면 되돌림 선이 양 끝 노드를 가로지른다
    path = `M ${data.points.map((p) => `${p.x},${p.y}`).join(' L ')}`
    labelAt = data.labelPos
  } else {
    const [d, lx, ly] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    path = d
    labelAt = { x: lx, y: ly }
  }
  const back = data?.back ?? false
  const label = data?.label ?? ''
  const style = {
    ...(data?.dashed ? { strokeDasharray: '5 4' } : {}),
    ...(back ? { stroke: 'var(--warning-text)' } : {}),
  }
  return (
    <>
      <g data-back={back ? 'true' : 'false'}>
        <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      </g>
      {label && labelAt && (
        <EdgeLabelRenderer>
          <div
            data-back={back ? 'true' : 'false'}
            className={`nodrag nopan pointer-events-none absolute rounded-sm bg-background px-1 text-xs ${back ? 'text-warning-text' : 'text-muted-foreground'}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/** 캔버스 왼쪽 아래 범례 — 선 모양의 뜻과, 공통 오류 처리 노드가 있으면 그 안내 한 줄. */
export function GraphLegend({ commonRecoveryName }: { commonRecoveryName: string | null }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-11rem)] @3xl:max-w-[calc(100%-15rem)] flex-col gap-1 rounded-md border bg-card px-2 py-1.5 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1">
          <svg width="20" height="6" aria-hidden="true"><line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="1.5" /></svg>
          진행
        </span>
        <span className="flex items-center gap-1">
          <svg width="20" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="20" y2="3" stroke="var(--warning-text)" strokeWidth="1.5" strokeDasharray="5 4" />
          </svg>
          되돌림
        </span>
        <span className="flex items-center gap-1">
          <svg width="20" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="20" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="5 4" />
          </svg>
          질문·오류
        </span>
      </div>
      {commonRecoveryName && <p>막힌 단계는 실행 조치에서 「{commonRecoveryName}」{directionParticle(commonRecoveryName.trim())} 되돌릴 수 있음</p>}
    </div>
  )
}
