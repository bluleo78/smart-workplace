import { Check, X } from 'lucide-react'
import { useMemo } from 'react'

import { formatDurationMs } from '@/lib/formatters'
import { layoutCompactRunGraph, layoutWorkflowGraph, outgoingEdges } from '@/lib/workflowGraphLayout'
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
  /** 실행 상세용 compact 그리기(WP-2157) — 질문 단계는 곁 표식, 라벨은 되돌아가는 간선에만. */
  compact?: boolean
  /** compact 에서 지금 노드 키 — 질문 단계면 원래 노드 옆에 주황 곁 노드로 그린다. */
  currentNode?: string | null
}

/**
 * 읽기 전용 워크플로우 그래프 — dagre 가 계산한 자리에 노드를 절대 위치 div 로, 간선을 SVG path 로 그린다.
 * 편집 탭의 그래프 보기와 실행 상세·그래프에 모아 보기가 같은 컴포넌트를 쓴다.
 */
export function WorkflowGraphView({ model, readOnly, paint, durations, badges, compact, currentNode }: Props) {
  if (compact) return <CompactGraph model={model} readOnly={readOnly} paint={paint} durations={durations} currentNode={currentNode ?? null} />
  return <FullGraph model={model} readOnly={readOnly} paint={paint} durations={durations} badges={badges} />
}

function FullGraph({ model, readOnly, paint, durations, badges }: Omit<Props, 'compact' | 'currentNode'>) {
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

/**
 * compact 실행 그래프(WP-2157) — 본 흐름은 한 줄, 질문 단계는 원래 노드 옆 점선 표식(지금 노드면 주황 곁 노드).
 * 노드는 이름(+지나옴 ✓·실패 ×)과 머문 시간만 보이고 종류 줄·정방향 라벨은 없다. 좁은 칸이라 가로로 넘치면 스크롤.
 */
function CompactGraph({ model, readOnly, paint, durations, currentNode }: Omit<Props, 'compact' | 'currentNode' | 'badges'> & { currentNode: string | null }) {
  const layout = useMemo(() => layoutCompactRunGraph(model, currentNode), [model, currentNode])
  const byKey = new Map(model.nodes.map((n) => [n.key, n]))
  // 지금 질문 곁 노드와 원래 노드를 잇는 짧은 선(WP-2157) — 곁 노드가 없으면 null.
  const askCurrent = layout.askCurrent
  const askOwner = askCurrent ? layout.nodes.find((n) => n.key === askCurrent.owner)! : null
  return (
    <section aria-label="게시된 워크플로우 그래프" data-read-only={readOnly} className="overflow-x-auto">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        <svg className="absolute inset-0 text-muted-foreground" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            <marker id="wf-arrow-c" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
            <marker id="wf-arrow-c-ok" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" className="fill-success" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => {
            if (e.points.length < 2) return null
            // 지나온 노드에서 지나온·지금 노드로 가는 간선은 초록으로 — 어디까지 왔는지 선으로도 읽힌다.
            const ok = paint?.[e.from] === 'passed' && (paint?.[e.to] === 'passed' || paint?.[e.to] === 'current')
            return (
              <path
                key={i}
                d={e.points.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')}
                fill="none"
                className={ok ? 'text-success' : undefined}
                stroke="currentColor"
                strokeWidth={1.25}
                markerEnd={ok ? 'url(#wf-arrow-c-ok)' : 'url(#wf-arrow-c)'}
              />
            )
          })}
          {askCurrent && askOwner && (
            <line x1={askOwner.x + askOwner.width} y1={askOwner.y + askOwner.height / 2} x2={askCurrent.x} y2={askCurrent.y + askCurrent.height / 2} stroke="currentColor" strokeWidth={1.25} />
          )}
        </svg>
        {layout.backLabels.map((l) => (
          <div
            key={`${l.from}>${l.to}`}
            data-testid="graph-back-label"
            className="absolute truncate text-right text-[11px] leading-4 text-muted-foreground"
            style={{ left: l.x, top: l.y, width: l.width, height: l.height }}
          >
            {l.text}
          </div>
        ))}
        {layout.askMarkers.map((m) => {
          // WP-2157: 질문 표식도 본 노드와 같은 칠하기를 따른다 — 지나옴 ✓·실패 ×·안 감은 흐리게(칠하기가 없으면 기본 모양).
          const state = paint?.[m.askKey]
          const tone = state === 'failed' ? 'border-destructive/60' : state === 'unvisited' ? 'opacity-50' : ''
          return (
            <div
              key={m.askKey}
              data-testid="graph-ask-marker"
              data-paint={state}
              className={`absolute flex items-center justify-center gap-1 truncate rounded-full border border-dashed px-2 text-xs text-muted-foreground ${tone}`}
              style={{ left: m.x, top: m.y, width: m.width, height: m.height }}
            >
              {state === 'passed' && <Check className="size-3 shrink-0" aria-label="지나온 노드" />}
              {state === 'failed' && <X className="size-3 shrink-0 text-destructive" aria-label="실패한 노드" />}
              <span className="truncate">{m.text}</span>
            </div>
          )
        })}
        <ul className="m-0 list-none p-0" role="list">
          {layout.nodes.map((n) => {
            const node = byKey.get(n.key)!
            const state = paint?.[n.key]
            const dur = durations?.[n.key]
            // 지금 노드 링 — 사람 차례는 주황, 그 밖은 기본 색.
            const cls = state === 'current'
              ? `bg-card ring-2 ${node.type === 'human_task' ? 'ring-warning' : 'ring-primary'}`
              : paintClass[state ?? 'none']
            return (
              <li
                key={n.key}
                role="listitem"
                data-node-key={n.key}
                data-paint={state}
                className={`absolute overflow-hidden rounded-md border px-2 py-1 text-xs ${cls}`}
                style={{ left: n.x, top: n.y, width: n.width, height: n.height }}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm font-medium" title={node.key}>{node.name ?? node.key}</span>
                  {state === 'passed' && <Check className="ml-auto size-3 shrink-0 text-muted-foreground" aria-label="지나온 노드" />}
                  {state === 'failed' && <X className="ml-auto size-3 shrink-0 text-destructive" aria-label="실패한 노드" />}
                </div>
                {dur != null && <div className="text-muted-foreground">{formatDurationMs(dur)}</div>}
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
          {layout.askCurrent && (() => {
            const ask = layout.askCurrent
            // WP-2157: 곁 노드도 칠하기를 따른다 — 멈춘(SUSPENDED) 실행이 질문 단계에 있으면 failed 라 「지금」 주황이 아니다. 칠하기가 없으면 지금(주황).
            const state = paint?.[ask.askKey] ?? 'current'
            const cls = state === 'current'
              ? 'border-warning bg-warning-subtle ring-2 ring-warning'
              : paintClass[state]
            return (
              <li
                role="listitem"
                data-node-key={ask.askKey}
                data-paint={state}
                className={`absolute overflow-hidden rounded-md border px-2 py-1 text-xs ${cls}`}
                style={{ left: ask.x, top: ask.y, width: ask.width, height: ask.height }}
              >
                <div className="flex items-center gap-1">
                  <span className={`truncate text-sm font-medium ${state === 'current' ? 'text-warning-text' : ''}`}>{byKey.get(ask.askKey)?.name ?? ask.askKey}</span>
                  {state === 'passed' && <Check className="ml-auto size-3 shrink-0 text-muted-foreground" aria-label="지나온 노드" />}
                  {state === 'failed' && <X className="ml-auto size-3 shrink-0 text-destructive" aria-label="실패한 노드" />}
                </div>
                <div className="truncate text-muted-foreground">
                  {/* 머문 시간(WP-2157 I2) — 지금 노드와 같은 형식. 값이 없으면 결과 문구로 대체한다(이름 없는 단계의 제목은 키라 「사람 차례」가 겹치지 않는다). */}
                  {/* 지금 질문 대기가 아니면(실패·지나옴) 「사람 차례」를 붙이지 않는다 — 빨간 실패 칠과 어긋나지 않게(WP-2157 리뷰 후속). */}
                  {durations?.[ask.askKey] != null ? formatDurationMs(durations[ask.askKey]) : state === 'current' ? `${ask.outcome} → 사람 차례` : ask.outcome}
                </div>
              </li>
            )
          })()}
        </ul>
      </div>
    </section>
  )
}
