// 이슈 목록을 group 기준(상태/우선순위/담당자)으로 클라이언트에서 묶는 순수 함수 (#58).
// 보드 뷰와 리스트 뷰가 동일한 그룹 결과를 공유한다.

import type { IssueClientGroupBy, IssueGroupBy, IssuePriority, IssueResponse, IssueStatus } from '../types/issue';

// 하나의 그룹 — key 는 React key·data-testid·droppable id 에 사용, label 은 헤더 표시.
export interface IssueGroup {
  key: string;
  label: string;
  issues: IssueResponse[];
}

/** 이슈 상태 → 표시 라벨. 상태 아이콘(IssueStatusIcon)·보드/리스트 그룹 헤더·드래그 스크린리더 안내·AI 화면 컨텍스트(WP-54)가 같은 문구를 쓰도록 공용으로 둔다. */
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  CANCELED: '취소',
};

/** 이슈 우선순위 → 표시 라벨(높음→보통→낮음 순서로 정의 — 그룹 버킷 순서가 이 키 순서를 따른다). */
export const ISSUE_PRIORITY_LABEL: Record<IssuePriority, string> = {
  HIGH: '높음',
  MID: '보통',
  LOW: '낮음',
};

/** 우선순위 선택지(높음→보통→낮음) — 모바일 우선순위 시트(상세·생성)가 공유한다. */
export const ISSUE_PRIORITY_OPTIONS = (Object.keys(ISSUE_PRIORITY_LABEL) as IssuePriority[]).map((p) => ({
  value: p,
  label: ISSUE_PRIORITY_LABEL[p],
}));

/**
 * 그룹 기준 → 표시 라벨. 필터 바의 그룹 선택 옵션과 AI 화면 컨텍스트가 공유한다.
 * 키 순서 = 필터 바 옵션 순서. cycle(#878)은 서버 구간 그룹이라 groupIssues 대상은 아니지만 라벨은 함께 둔다.
 */
export const ISSUE_GROUP_BY_LABEL: Record<IssueGroupBy, string> = {
  cycle: '사이클',
  status: '상태',
  assignee: '담당자',
  priority: '우선순위',
  epic: '에픽',
};

// 라벨 맵 → 순서 고정 버킷 목록(객체 키 삽입 순서 = 버킷 순서).
const toOrder = (labels: Record<string, string>) => Object.entries(labels).map(([key, label]) => ({ key, label }));

// 상태 버킷: enum 순서로 고정, 빈 버킷도 항상 노출(칸반 컬럼 관례).
const STATUS_ORDER: { key: string; label: string }[] = toOrder(ISSUE_STATUS_LABEL);

// 상태 전체 목록(정의 순서) — 시트·드롭다운 등 선택지를 라벨 맵 하나에서 파생한다.
export const ISSUE_STATUSES = Object.keys(ISSUE_STATUS_LABEL) as IssueStatus[];

// 상태 한글 라벨 — 버킷 밖에서 상태명을 읽을 때(드래그 스크린리더 안내 등). 모르는 값은 그대로.
export function statusLabel(status: string): string {
  return Object.hasOwn(ISSUE_STATUS_LABEL, status) ? ISSUE_STATUS_LABEL[status as IssueStatus] : status;
}

// 우선순위 버킷: 높음→보통→낮음 고정 순서.
const PRIORITY_ORDER: { key: string; label: string }[] = toOrder(ISSUE_PRIORITY_LABEL);

// 부모가 에픽인지 — 에픽은 별도 플래그가 없고 유형 이름이 'EPIC' 인 이슈다(useProjectEpics 와 같은 기준).
// SUBTASK 의 부모(STORY 등)는 에픽이 아니므로 그룹·행 메타의 ◆ 에픽 표시에서 제외한다.
export function isEpicParent(issue: IssueResponse): boolean {
  return issue.parent?.type.name === 'EPIC';
}

/**
 * 평탄한 이슈 목록을 그룹 기준으로 묶는다.
 *
 * - status/priority: 고정 버킷 전체를 순서대로 반환(빈 버킷 포함).
 * - assignee: 존재하는 담당자 버킷만 이름순 + "미지정" 버킷을 마지막에. 다중 담당자
 *   이슈는 각 담당자 그룹에 모두 등장한다.
 */
export function groupIssues(
  issues: IssueResponse[],
  groupBy: IssueClientGroupBy,
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
  // epic — 에픽 번호 오름차순 버킷, 에픽이 아닌 부모·부모 없음은 마지막 「에픽 없음」.
  // 개수는 로드된 행 기준(무한 스크롤로 증가) — 상태/우선순위 그룹과 같은 방식(별도 집계 API 없음).
  if (groupBy === 'epic') {
    const byEpic = new Map<number, IssueGroup>();
    const none: IssueResponse[] = [];
    for (const it of issues) {
      if (!it.parent || !isEpicParent(it)) {
        none.push(it);
        continue;
      }
      let g = byEpic.get(it.parent.number);
      if (!g) {
        g = { key: `epic-${it.parent.number}`, label: it.parent.title, issues: [] };
        byEpic.set(it.parent.number, g);
      }
      g.issues.push(it);
    }
    const groups = [...byEpic.entries()].sort(([a], [b]) => a - b).map(([, g]) => g);
    if (none.length > 0) groups.push({ key: 'no-epic', label: '에픽 없음', issues: none });
    return groups;
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
