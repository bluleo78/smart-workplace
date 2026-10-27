// 부모 에픽 묶음(WP-1038·WP-1039) — 이슈 목록 에픽 그룹(groupIssues)과 타임라인(간트·모바일 아젠다)이 같은 키·순서로 에픽을 묶는다.
// 에픽은 다른 프로젝트에 있을 수 있어 (프로젝트 키, 번호)로 묶는다 — PLAN-3 과 WP-3 이 합쳐지지 않게.

import type { ParentRef } from '../types/issue';
import { formatIssueKey } from './issueKey';
import { isHiddenParent, parentProjectKey } from './parentRef';

/** 가려진 에픽(볼 수 없는 에픽) 묶음 키 — 번호·키를 몰라 한 묶음으로 모은다. */
export const HIDDEN_EPIC_GROUP_KEY = 'epic-hidden';

/**
 * 에픽 묶음 키 — 같은 프로젝트 에픽은 예전 그대로 `epic-{번호}`, 다른 프로젝트 에픽은 `epic-{키}-{번호}`.
 * 타임라인 펼침 상태 저장(useTimelineExpanded)도 이 형식을 쓴다.
 */
export const epicGroupKey = (epicNumber: number, epicProjectKey?: string) =>
  `epic-${epicProjectKey ? formatIssueKey(epicProjectKey, epicNumber) : epicNumber}`;

/** 이슈가 묶일 부모 에픽 — 다른 프로젝트 에픽이면 projectKey 를 싣는다(같은 프로젝트면 없음). hidden 이면 가려진 에픽 묶음. */
export interface EpicGroupRef {
  key: string;
  number: number;
  projectKey?: string;
  hidden?: boolean;
}

/** 부모 에픽 → 묶음 참조. 가려진 부모는 한 묶음(HIDDEN_EPIC_GROUP_KEY), 다른 프로젝트 에픽은 그 키와 함께. */
export function epicGroupOf(parent: Pick<ParentRef, 'projectKey' | 'number' | 'hidden'>, childProjectKey: string): EpicGroupRef {
  if (isHiddenParent(parent)) return { key: HIDDEN_EPIC_GROUP_KEY, number: 0, hidden: true };
  const pk = parentProjectKey(parent, childProjectKey);
  const projectKey = pk === childProjectKey ? undefined : pk;
  return { key: epicGroupKey(parent.number, projectKey), number: parent.number, ...(projectKey ? { projectKey } : {}) };
}

/** 묶음 순서 — 같은 프로젝트 에픽(번호순) → 다른 프로젝트 에픽(키·번호순) → 볼 수 없는 에픽. */
export function compareEpicGroups(a: EpicGroupRef, b: EpicGroupRef): number {
  const rank = (r: EpicGroupRef) => (r.hidden ? 2 : r.projectKey ? 1 : 0);
  return rank(a) - rank(b) || (a.projectKey ?? '').localeCompare(b.projectKey ?? '') || a.number - b.number;
}
