// 이슈 생성 시 부모(parentNumber·parentKey) 결정 — useIssueCreateForm 의 순수 규칙(WP-412 에서 훅 밖으로 분리).

import { formatIssueKey } from './issueKey'

/**
 * 모바일 에픽 칩에서 고른 에픽(R8) — 같은 프로젝트 에픽이면 projectKey 없이 번호만, 다른 프로젝트 에픽이면(WP-1039) 키와 제목(칩 글자)을 싣는다.
 */
export interface CreateEpicChoice {
  projectKey?: string
  number: number
  title?: string
}

/**
 * 생성 요청에 실을 부모.
 *
 * - SUBTASK: 폼에 입력한 부모 태스크 번호(같은 프로젝트만).
 * - 일반 이슈: 모바일 에픽 칩에서 고른 에픽(R8) — 백엔드는 일반 이슈의 부모로 EPIC 만 허용한다. 다른 프로젝트 에픽은 parentKey(예: PLAN-3)로
 *   보낸다(WP-1038 — 서버가 그 프로젝트 읽기 권한을 확인한다).
 * - EPIC: 부모 불가 — 에픽 칩을 골랐다가 유형을 에픽으로 바꿔도 남은 값이 새면 백엔드가 400 을 내므로 보내지 않는다.
 *
 * parentNumber 키는 늘 싣는다(없으면 undefined) — 폼 값(data.parentNumber)을 펼친 뒤 덮어써 SUBTASK 가 아닐 때 남은 번호가 새지 않게 한다.
 */
export function resolveCreateParent(args: {
  isSubtask: boolean
  isEpic: boolean
  formParentNumber: number | null | undefined
  epic: CreateEpicChoice | null
  projectKey: string
}): { parentNumber: number | undefined; parentKey?: string } {
  if (args.isSubtask) return { parentNumber: args.formParentNumber ?? undefined }
  if (args.isEpic || args.epic == null) return { parentNumber: undefined }
  const { projectKey, number } = args.epic
  // 같은 프로젝트(키 없음·같은 키)는 번호, 다른 프로젝트 에픽은 키로 — 부모 지정 PATCH(parentRequestBody)와 같은 모양.
  return projectKey == null || projectKey === args.projectKey
    ? { parentNumber: number }
    : { parentNumber: undefined, parentKey: formatIssueKey(projectKey, number) }
}
