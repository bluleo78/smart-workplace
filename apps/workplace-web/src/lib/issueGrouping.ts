// 이슈 목록을 group 기준(상태/우선순위/담당자)으로 클라이언트에서 묶는 순수 함수 (#58).
// 보드 뷰와 리스트 뷰가 동일한 그룹 결과를 공유한다.

import type { IssueGroupBy, IssueResponse } from '../types/issue';

// 하나의 그룹 — key 는 React key·data-testid·droppable id 에 사용, label 은 헤더 표시.
export interface IssueGroup {
  key: string;
  label: string;
  issues: IssueResponse[];
}

// 상태 버킷: enum 순서로 고정, 빈 버킷도 항상 노출(칸반 컬럼 관례).
const STATUS_ORDER: { key: string; label: string }[] = [
  { key: 'TODO', label: '할 일' },
  { key: 'IN_PROGRESS', label: '진행 중' },
  { key: 'DONE', label: '완료' },
  { key: 'CANCELED', label: '취소' },
];

// 우선순위 버킷: 높음→보통→낮음 고정 순서.
const PRIORITY_ORDER: { key: string; label: string }[] = [
  { key: 'HIGH', label: '높음' },
  { key: 'MID', label: '보통' },
  { key: 'LOW', label: '낮음' },
];

/**
 * 평탄한 이슈 목록을 그룹 기준으로 묶는다.
 *
 * - status/priority: 고정 버킷 전체를 순서대로 반환(빈 버킷 포함).
 * - assignee: 존재하는 담당자 버킷만 이름순 + "미지정" 버킷을 마지막에. 다중 담당자
 *   이슈는 각 담당자 그룹에 모두 등장한다.
 */
export function groupIssues(
  issues: IssueResponse[],
  groupBy: IssueGroupBy,
): IssueGroup[] {
  if (groupBy === 'status') {
    return STATUS_ORDER.map((s) => ({
      key: s.key,
      label: s.label,
      issues: issues.filter((it) => it.status === s.key),
    }));
  }
  if (groupBy === 'priority') {
    return PRIORITY_ORDER.map((p) => ({
      key: p.key,
      label: p.label,
      issues: issues.filter((it) => it.priority === p.key),
    }));
  }
  // assignee — 동적 버킷.
  const buckets = new Map<string, IssueGroup>();
  const unassigned: IssueResponse[] = [];
  for (const it of issues) {
    if (it.assignees.length === 0) {
      unassigned.push(it);
      continue;
    }
    for (const u of it.assignees) {
      const key = `u-${u.id}`;
      let g = buckets.get(key);
      if (!g) {
        g = { key, label: u.name, issues: [] };
        buckets.set(key, g);
      }
      g.issues.push(it);
    }
  }
  const groups = [...buckets.values()].sort((a, b) =>
    a.label.localeCompare(b.label, 'ko'),
  );
  if (unassigned.length > 0) {
    groups.push({ key: 'unassigned', label: '미지정', issues: unassigned });
  }
  return groups;
}
