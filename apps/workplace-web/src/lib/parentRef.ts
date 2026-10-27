// 부모(에픽) 요약 표시 도우미(WP-1038) — 일반 이슈의 부모 에픽은 다른 프로젝트에 있을 수 있어, 부모 키·링크를 자식의 프로젝트 키로
// 만들면 엉뚱한 이슈를 가리킨다. 서버가 실어 주는 parent.projectKey 를 먼저 쓰고(구 응답엔 없어 자식 프로젝트 키로 대신),
// 조회자가 읽을 수 없는 프로젝트의 부모(hidden)는 링크·키 없이 「볼 수 없는 에픽」으로만 보여 준다.

import type { ParentRef } from '../types/issue';

/** 조회자가 읽을 수 없는 부모(에픽)의 표시 문구. */
export const HIDDEN_PARENT_LABEL = '볼 수 없는 에픽';

/** 서버가 가린 부모인가 — 번호·제목이 없고 존재만 알린다. */
export function isHiddenParent(parent: Pick<ParentRef, 'hidden'> | null | undefined): boolean {
  return parent?.hidden === true;
}

/** 부모 제목 표시 — 가려진 부모면 「볼 수 없는 에픽」. */
export function parentTitleLabel(parent: Pick<ParentRef, 'hidden' | 'title'>): string {
  return isHiddenParent(parent) ? HIDDEN_PARENT_LABEL : parent.title;
}

/** 부모가 속한 프로젝트 키 — 응답의 projectKey, 없으면(같은 프로젝트·구 응답) 자식의 프로젝트 키. */
export function parentProjectKey(parent: Pick<ParentRef, 'projectKey'>, childProjectKey: string): string {
  return parent.projectKey ?? childProjectKey;
}

/** 부모 이슈 키(예: PLAN-3) — 가려진 부모면 null(키를 만들 수 없다). */
export function parentIssueKey(
  parent: Pick<ParentRef, 'projectKey' | 'number' | 'hidden'>,
  childProjectKey: string,
): string | null {
  if (isHiddenParent(parent)) return null;
  return `${parentProjectKey(parent, childProjectKey)}-${parent.number}`;
}

/** 부모 상세 경로 — 가려진 부모면 null(링크를 두지 않는다). */
export function parentIssuePath(
  parent: Pick<ParentRef, 'projectKey' | 'number' | 'hidden'>,
  childProjectKey: string,
): string | null {
  if (isHiddenParent(parent)) return null;
  return `/projects/${parentProjectKey(parent, childProjectKey)}/issues/${parent.number}`;
}
