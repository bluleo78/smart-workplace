// 평행 간선 묶기(WP-2048·WP-2063) — 실행 그래프(workflowGraphLayout)와 편집 그래프(graphYaml)가 같은 규칙으로
// 같은 (출발, 도착) 간선을 한 선·한 라벨로 합치게 하는 순수 함수. 규칙이 한 곳에 있어야 두 화면의 라벨이 어긋나지 않는다.

/** 합친 라벨의 구분자 — 가운뎃점 앞뒤 공백. */
export const PARALLEL_EDGE_LABEL_SEPARATOR = ' · '

/** 같은 출발·도착 간선 묶음 — members 는 처음 나온 순서 그대로다. */
export interface ParallelEdgeGroup<T> {
  from: string
  to: string
  members: T[]
}

/**
 * 간선을 (출발, 도착) 쌍으로 묶는다. 처음 나온 순서를 유지하고, 반대 방향(A→B 와 B→A)은 다른 묶음이다.
 * 걸러 낼 간선(끝 노드가 그려지지 않는 것 등)은 호출하는 쪽이 먼저 뺀다.
 */
export function groupByEndpoints<T extends { from: string; to: string }>(edges: Iterable<T>): ParallelEdgeGroup<T>[] {
  const groups = new Map<string, ParallelEdgeGroup<T>>()
  for (const e of edges) {
    // NUL 은 노드 키에 나올 수 없어 두 키를 이어도 다른 쌍과 겹치지 않는다
    const key = `${e.from}\u0000${e.to}`
    let group = groups.get(key)
    if (!group) {
      group = { from: e.from, to: e.to, members: [] }
      groups.set(key, group)
    }
    group.members.push(e)
  }
  return [...groups.values()]
}

/** 묶음의 라벨들을 구분자로 잇는다. */
export function joinEdgeLabels(labels: string[]): string {
  return labels.join(PARALLEL_EDGE_LABEL_SEPARATOR)
}
