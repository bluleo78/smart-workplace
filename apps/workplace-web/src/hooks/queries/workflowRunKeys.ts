// 워크플로우 실행 조회 캐시 키(WP-1991) — api 를 끌어오지 않는 순수 키 팩토리.
// 왜: 이슈 단위 조치(lib/workflow)가 실행 목록·상세·내 차례를 함께 무효화해야 하는데, 훅 파일끼리 서로 불러오지 않게 키만 분리한다.
export const workflowRunKeys = {
  /** 실행 조회 전체 접두사 — 목록·상세·집계를 한꺼번에 무효화할 때. */
  all: ['workflow-runs'] as const,
  /** 정의 하나의 실행 목록 접두사 — 필터와 무관하게 그 정의의 목록을 모두 무효화할 때(WP-2157). */
  lists: (workflowId: number | undefined) => [...workflowRunKeys.all, 'list', workflowId] as const,
  /** 정의 하나의 실행 목록(필터별). */
  list: (workflowId: number | undefined, filters: unknown) => [...workflowRunKeys.all, 'list', workflowId, filters] as const,
  /** 실행 한 건의 상세. */
  detail: (runId: number | null) => [...workflowRunKeys.all, 'detail', runId] as const,
  /** 노드별 진행 중 실행 수 집계. */
  counts: (workflowId: number | undefined) => [...workflowRunKeys.all, 'counts', workflowId] as const,
  /** 내 작업 「내 차례」 — 실행 조회와 루트가 달라 `me` 아래에 둔다. */
  myTurns: () => ['me', 'workflow-turns'] as const,
}
