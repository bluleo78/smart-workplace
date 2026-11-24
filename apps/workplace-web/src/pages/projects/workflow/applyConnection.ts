import { toast } from 'sonner'

import { connectFromFlow, type WorkflowGraph } from './graphYaml'

/**
 * 캔버스에서 끈 선을 YAML 에 반영한다.
 * 이을 수 없는 선(refused)은 YAML 을 건드리지 않고 이유만 알림으로 띄우고(조용히 버리면 사용자가 왜 안 되는지 모른다),
 * YAML 이 실제로 바뀐 경우에만 onChange 를 부른다. jsdom 에서 ReactFlow 연결 끌기를 흉내 낼 수 없어 컴포넌트 밖 파일로 꺼내 시험한다.
 */
export function applyConnection(
  yaml: string,
  graph: WorkflowGraph,
  c: { source: string | null; target: string | null },
  onChange: (yaml: string) => void,
): void {
  const { yaml: next, refused } = connectFromFlow(yaml, graph, c)
  if (refused) {
    toast.info(refused)
    return
  }
  if (next !== yaml) onChange(next)
}
