// 보고자 후보(WP-944) — 보고자는 사람(HUMAN)만 될 수 있고, 비활성 구성원은 고를 수 없으며(서버가 400), 지금 보고자는 다시 고를 필요가 없다.
import { isInactiveMember } from './assigneeCandidates';

/** 후보 판정에 필요한 멤버 모양 — 프로젝트 멤버 응답과 같다. */
export interface ReporterCandidateLike {
  userId: number;
  kind: string;
  active?: boolean;
}

/** 보고자 후보 — 활성 사람 구성원 중 지금 보고자를 뺀 목록. 순서는 그대로, 로딩 중(undefined)이면 빈 목록. */
export function reporterCandidates<T extends ReporterCandidateLike>(
  members: readonly T[] | undefined,
  currentReporterId: number | null | undefined,
): T[] {
  return (members ?? []).filter(
    (m) => m.kind !== 'AGENT' && !isInactiveMember(m) && m.userId !== currentReporterId,
  );
}
