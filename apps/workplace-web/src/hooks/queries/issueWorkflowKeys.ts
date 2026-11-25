// 이슈 워크플로우 실행 캐시 키(WP-1989) — api·axios 를 끌어오지 않는 순수 키 팩토리.
// 왜: SSE 무효화 규칙(lib/resourceInvalidation)도 같은 키를 써야 하는데, 훅 파일(lib/workflow)을 불러오면 api 가 딸려 온다.
export const issueWorkflowKeys = {
  /** 모든 이슈의 워크플로우 실행 접두사 — 어느 이슈인지 모를 때 통째로 무효화한다. */
  all: ['issue-workflow'] as const,
  /** 이슈 하나의 실행 조회. */
  detail: (issueId: number) => [...issueWorkflowKeys.all, issueId] as const,
  /** 담당 미리보기(assign-preview, WP-2120) 접두사 — 실행 조회와 다른 루트라 실행 무효화가 미리보기 POST 를 다시 부르지 않는다. */
  previewAll: ['issue-workflow-preview'] as const,
  /** 이슈 하나의 미리보기 — 뒤에 판정 방식·담당 id 를 붙여 쓴다. 담당 변경 때 이 접두사로 지운다. */
  preview: (issueId: number) => [...issueWorkflowKeys.previewAll, issueId] as const,
}
