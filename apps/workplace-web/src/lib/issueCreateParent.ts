// 이슈 생성 시 부모(parentNumber) 결정 — useIssueCreateForm 의 순수 규칙(WP-412 에서 훅 밖으로 분리).

/**
 * 생성 요청에 실을 parentNumber.
 *
 * - SUBTASK: 폼에 입력한 부모 태스크 번호.
 * - 일반 이슈: 모바일 에픽 칩에서 고른 에픽 번호(R8) — 백엔드는 일반 이슈의 부모로 EPIC 만 허용한다.
 * - EPIC: 부모 불가 — 에픽 칩을 골랐다가 유형을 에픽으로 바꿔도 남은 값이 새면 백엔드가 400 을 내므로 보내지 않는다.
 */
export function resolveParentNumber(args: {
  isSubtask: boolean
  isEpic: boolean
  formParentNumber: number | null | undefined
  epicNumber: number | null
}): number | undefined {
  if (args.isSubtask) return args.formParentNumber ?? undefined
  return !args.isEpic && args.epicNumber != null ? args.epicNumber : undefined
}
