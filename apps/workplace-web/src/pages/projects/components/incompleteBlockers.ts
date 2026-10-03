// 완료 전환 확인용 선행 이슈 판정 — 컴포넌트 파일(IssueStatusSelect)에서 분리(react-refresh: 컴포넌트 파일은 컴포넌트만 export).
import type { IssueLinkSummary } from '../../../types/issue';

// 미완료 선행 이슈만 고른다 — DONE/CANCELED 가 아니면 아직 진행 중(#826 헤더 배지와 동일 기준).
export function incompleteBlockers(blockedBy: IssueLinkSummary[]): IssueLinkSummary[] {
  return blockedBy.filter((l) => l.status !== 'DONE' && l.status !== 'CANCELED');
}
