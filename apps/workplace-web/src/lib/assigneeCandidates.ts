// 담당자 후보(WP-487) — 비활성화(전역 비활성·워크스페이스 정지)된 구성원은 고를 수 없으므로 후보에서 뺀다(서버도 새 지정을 400 으로 거부).
// 다만 이미 담당 중인 비활성 구성원은 남겨 「비활성」 표시와 함께 해제할 수 있게 한다(keepIds).

import { isInactiveUser } from './userStatus';

/** 후보 판정에 필요한 멤버 모양 — 프로젝트 멤버 응답의 active 는 이 워크스페이스 기준(정지 포함). 없으면 활성으로 본다. */
export interface AssigneeCandidateLike {
  userId: number;
  active?: boolean;
}

/** 비활성 구성원인가 — active 가 명시적으로 false 일 때만(판정은 lib/userStatus 하나). */
export const isInactiveMember: (m: AssigneeCandidateLike) => boolean = isInactiveUser;

/** 담당자 후보 — 활성 구성원 + (비활성이어도) keepIds 에 든 사람. 순서는 그대로. 로딩 중(undefined)이면 빈 목록. */
export function assigneeCandidates<T extends AssigneeCandidateLike>(
  members: readonly T[] | undefined,
  keepIds: readonly number[] = [],
): T[] {
  return (members ?? []).filter((m) => !isInactiveMember(m) || keepIds.includes(m.userId));
}
