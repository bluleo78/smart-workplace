import type { WorkflowModel, WorkflowModelNode } from '@/lib/workflows'

const nodeTypes: Record<string, string> = {
  start: '워크플로우 시작',
  end: '종료',
  decision: '분기',
  agent_task: 'AI 작업 단계',
  human_task: '사람 차례',
}

/** 공개 모델에 이미 들어 있는 전이를 읽는다. 종료 노드에는 이어지는 단계가 없다. */
function outgoingEdges(node: WorkflowModelNode, model: WorkflowModel) {
  const edges = (node.outcomes ?? []).map((outcome) => ({ label: outcome.key, to: outcome.to }))
  const conditions = node.type === 'start' ? model.start : node.conditions
  for (const [index, condition] of (conditions ?? []).entries()) {
    edges.push({ label: `조건 ${index + 1}`, to: condition.to })
  }
  if (node.defaultTo) edges.push({ label: '기본', to: node.defaultTo })
  if (node.onError) edges.push({ label: '오류', to: node.onError.to })
  if (node.returnTo) edges.push({ label: '돌아가기', to: node.returnTo })
  return edges
}

/** 게시 버전의 단계와 이어지는 길을 텍스트로도 읽을 수 있는 그래프. 실행 화면에서도 같은 모델을 쓴다. */
export function WorkflowGraphView({ model, readOnly }: { model: WorkflowModel; readOnly: true }) {
  return (
    <section aria-label="게시된 워크플로우 그래프" data-read-only={readOnly}>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {model.nodes.map((node) => {
          const edges = outgoingEdges(node, model)
          return (
            <li key={node.key} className="min-w-0 rounded-md border bg-card p-3 text-sm">
              <div className="text-xs text-muted-foreground">{nodeTypes[node.type] ?? node.type}</div>
              <h3 className="mt-1 font-medium break-words">{node.name ?? node.key}</h3>
              {node.name && <code className="text-xs break-all text-muted-foreground">{node.key}</code>}
              {edges.length > 0 && (
                <ul className="mt-2 space-y-1 border-t pt-2" aria-label="이어지는 단계">
                  {edges.map((edge, index) => (
                    <li key={index} className="flex gap-2 break-all">
                      <span aria-hidden="true">→</span>
                      <span><span className="text-muted-foreground">{edge.label}</span> <code>{edge.to}</code></span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
