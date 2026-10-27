// 부모(에픽) 요약 표시 도우미(WP-1038) — 일반 이슈의 부모 에픽은 다른 프로젝트에 있을 수 있어, 부모 키·링크를 자식의 프로젝트 키로
// 만들면 엉뚱한 이슈를 가리킨다. 서버가 실어 주는 parent.projectKey 를 먼저 쓰고(구 응답엔 없어 자식 프로젝트 키로 대신),
// 조회자가 읽을 수 없는 프로젝트의 부모(hidden)는 링크·키 없이 「볼 수 없는 에픽」으로만 보여 준다.

import type { ParentRef } from '../types/issue';
import { formatIssueKey } from './issueKey';

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
  return formatIssueKey(parentProjectKey(parent, childProjectKey), parent.number);
}

/** 부모 상세 경로 — 가려진 부모면 null(링크를 두지 않는다). */
export function parentIssuePath(
  parent: Pick<ParentRef, 'projectKey' | 'number' | 'hidden'>,
  childProjectKey: string,
): string | null {
  if (isHiddenParent(parent)) return null;
  return `/projects/${parentProjectKey(parent, childProjectKey)}/issues/${parent.number}`;
}

/**
 * 부모로 지정할 에픽(WP-1039) — 같은 프로젝트면 projectKey 를 비워도 되고(자식 프로젝트로 본다), 다른 프로젝트 에픽이면 그 키를 싣는다.
 * ParentRef·IssueResponse·관계 찾기 결과가 모두 이 모양을 만족해 그대로 넘길 수 있다.
 */
export type ParentTargetInput = { projectKey?: string | null; number: number };

/**
 * 부모 지정 요청 본문 — 서버(SetParentRequest·CreateIssueRequest)는 같은 프로젝트를 parentNumber, 다른 프로젝트 에픽을 parentKey(예: PLAN-3)로
 * 받는다. 같은 프로젝트를 키로 보내도 서버가 번호로 맞추지만, 기존 요청 모양(parentNumber)을 지켜 하위 태스크 경로와 같은 검증을 타게 한다.
 * null 이면 해제(parentNumber: null).
 */
export function parentRequestBody(
  target: ParentTargetInput | null,
  childProjectKey: string,
): { parentNumber: number | null } | { parentKey: string } {
  if (target == null) return { parentNumber: null };
  const key = target.projectKey ?? childProjectKey;
  return key === childProjectKey ? { parentNumber: target.number } : { parentKey: formatIssueKey(key, target.number) };
}

/**
 * 이슈의 지금 부모가 대상 에픽과 같은가(WP-1039) — 번호만 비교하면 다른 프로젝트 부모 CLA-5 가 이 프로젝트 에픽 #5 와 같다고 본다.
 * 둘 다 없으면 같다(「에픽 없음」). 가려진 부모는 어느 대상과도 같지 않다 — 번호·키가 없어 같은 에픽인지 알 수 없고, 「에픽 없음」도 아니다.
 * 대상의 projectKey 가 없으면(같은 프로젝트 에픽 목록·낙관적 ParentRef) 자식 프로젝트 에픽으로 본다.
 */
export function isSameParent(
  parent: Pick<ParentRef, 'projectKey' | 'number' | 'hidden'> | null | undefined,
  target: ParentTargetInput | null | undefined,
  childProjectKey: string,
): boolean {
  if (parent == null || target == null) return parent == null && target == null;
  if (isHiddenParent(parent)) return false;
  return parentProjectKey(parent, childProjectKey) === (target.projectKey ?? childProjectKey) && parent.number === target.number;
}
