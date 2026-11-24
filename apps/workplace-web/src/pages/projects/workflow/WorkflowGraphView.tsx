import { Check, X } from 'lucide-react'
import { useMemo } from 'react'

import { formatDurationMs } from '@/lib/formatters'
import { layoutWorkflowGraph, outgoingEdges } from '@/lib/workflowGraphLayout'
import type { NodePaint } from '@/lib/workflowRuns'
import type { WorkflowModel } from '@/lib/workflows'

const nodeTypes: Record<string, string> = {
  start: '워크플로우 시작',
  end: '종료',
  decision: '분기',
  agent_task: 'AI 작업 단계',
  human_task: '사람 차례',
}

/** 칠하기별 노드 모양 — 시맨틱 토큰만 쓴다. 안 간 노드는 흐리게, 지금 노드는 강조 링. */
const paintClass: Record<NodePaint | 'none', string> = {
  none: 'bg-card',
  passed: 'bg-card',
  failed: 'bg-card border-destructive/60',
  current: 'bg-card ring-2 ring-primary',
  unvisited: 'bg-card opacity-50',
}

interface Props {
  model: WorkflowModel
  readOnly: true
  /** 노드 키 → 지나옴·지금·안 감. 없으면 칠하지 않는다(정의 보기). */
  paint?: Record<string, NodePaint>
  /** 노드 키 → 머문 시간(ms). */
  durations?: Record<string, number>
  /** 노드 키 → 진행 중 실행 수(그래프에 모아 보기). 0·없음은 배지를 그리지 않는다. */
  badges?: Record<string, number>
}

/**
 * 읽기 전용 워크플로우 그래프 — dagre 가 계산한 자리에 노드를 절대 위치 div 로, 간선을 SVG path 로 그린다.
 * 편집 탭의 그래프 보기와 실행 상세·그래프에 모아 보기가 같은 컴포넌트를 쓴다.
 */
export function WorkflowGraphView({ model, readOnly, paint, durations, badges }: Props) {
  // dagre 레이아웃은 비싸다 — 상세가 분 단위 now 로 다시 그려도 모델이 같으면 다시 계산하지 않는다.
  const layout = useMemo(() => layoutWorkflowGraph(model), [model])
  const byKey = new Map(model.nodes.map((n) => [n.key, n]))
  return (
    <section aria-label="게시된 워크플로우 그래프" data-read-only={readOnly} className="overflow-auto">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg className="absolute inset-0 text-muted-foreground" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            <marker id="wf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => {
            if (e.points.length < 2) return null
            const mid = e.points[Math.floor(e.points.length / 2)]
            return (
              <g key={i}>
                <path
                  d={e.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.25}
                  markerEnd="url(#wf-arrow)"
                />
                <text x={mid.x + 4} y={mid.y - 3} fontSize={10} fill="currentColor">
                  {e.label}
                </text>
              </g>
            )
          })}
        </svg>
        <ul className="m-0 list-none p-0" role="list">
          {layout.nodes.map((n) => {
            const node = byKey.get(n.key)!
            const state = paint?.[n.key]
            const badge = badges?.[n.key] ?? 0
            const dur = durations?.[n.key]
            return (
              <li
                key={n.key}
                role="listitem"
                data-node-key={n.key}
                data-paint={state}
                className={`absolute overflow-hidden rounded-md border px-2 py-1 text-xs ${paintClass[state ?? 'none']}`}
                style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
              >
                <div className="flex items-center gap-1 text-muted-foreground">
                  <span className="truncate">{nodeTypes[node.type] ?? node.type}</span>
                  {state === 'passed' && <Check className="ml-auto size-3 shrink-0" aria-label="지나온 노드" />}
                  {state === 'failed' && <X className="ml-auto size-3 shrink-0 text-destructive" aria-label="실패한 노드" />}
                </div>
                <div className="truncate text-sm font-medium" title={node.key}>
                  {node.name ?? node.key}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {dur != null && <span>{formatDurationMs(dur)}</span>}
                  {badge > 0 && <span className="ml-auto rounded bg-primary px-1 text-primary-foreground">진행 중 {badge}</span>}
                </div>
                {/* 보조기기용 — SVG 간선은 aria-hidden 이라 같은 정보를 글로도 준다(예전 텍스트 그래프와 같은 내용). */}
                <ul className="sr-only" aria-label="이어지는 단계">
                  {outgoingEdges(node, model).map((edge, i) => (
                    <li key={i}>
                      {edge.label} → {byKey.get(edge.to)?.name ?? edge.to}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
