// 이슈 목록을 group 기준(상태/우선순위/담당자)으로 클라이언트에서 묶는 순수 함수 (#58).
// 보드 뷰와 리스트 뷰가 동일한 그룹 결과를 공유한다.

import {
  ISSUE_PRIORITIES,
  type IssueClientGroupBy,
  type IssueGroupBy,
  type IssueGroupCountsResponse,
  type IssuePriority,
  type IssueResponse,
  type IssueStatus,
} from '../types/issue';
import type { ProjectStatus } from '../types/projectStatus';
import { ownLookup } from './ownLookup';

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

/**
 * 이슈 우선순위 → 표시 라벨. 키 순서 = 표시 순서(매우 높음→높음→보통→낮음→매우 낮음, WP-886) — 그룹 버킷 순서가 이 키 순서를 따른다.
 * ISSUE_PRIORITIES 와 같은 순서로 둔다(issueGrouping.test 가 지킨다).
 */
export const ISSUE_PRIORITY_LABEL: Record<IssuePriority, string> = {
  HIGHEST: '매우 높음',
  HIGH: '높음',
  MID: '보통',
  LOW: '낮음',
  LOWEST: '매우 낮음',
};

/**
 * 우선순위 선택지(매우 높음→매우 낮음) — 상세 select·생성 다이얼로그·필터 facet·행 메뉴·모바일 시트가 모두 이 목록을 쓴다(WP-886).
 * 화면마다 따로 적던 목록이 단계 추가 때 어긋나지 않게 한 곳에서 파생한다.
 */
export const ISSUE_PRIORITY_OPTIONS: { value: IssuePriority; label: string }[] = ISSUE_PRIORITIES.map((p) => ({
  value: p,
  label: ISSUE_PRIORITY_LABEL[p],
}));

/**
 * 타입이 없는 값(AI 제안 payload 등)을 5단계 우선순위로 맞춘다(WP-886). 모르는 값(과거·미래 enum)·비문자열은 보통(MID) — 라벨·아이콘 조회가
 * undefined 로 깨지지 않는다. 타입이 IssuePriority 인 서버 응답에는 쓰지 않는다(서버가 5단계를 보장).
 */
export function toIssuePriority(value: unknown): IssuePriority {
  return typeof value === 'string' && (ISSUE_PRIORITIES as readonly string[]).includes(value) ? (value as IssuePriority) : 'MID';
}

/**
 * 우선순위 정렬 순위 — 매우 높음 0 … 매우 낮음 4(작을수록 먼저). 내 작업·개인 체크리스트 정렬이 공유한다(WP-886).
 * 모르는 값(과거·미래 enum)은 {@link toIssuePriority} 처럼 보통(MID) 순위로 본다 — 맨 앞·맨 뒤로 튀지 않게.
 */
export function priorityRank(priority: string): number {
  return ISSUE_PRIORITIES.indexOf(toIssuePriority(priority));
}

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

// 상태 표시 이름 — 프로젝트 상태 이름(응답 statusName, WP-808)이 있으면 그것, 없으면(범주만 아는 곳) 범주 한글 라벨.
// 배지·아이콘 읽기·드래그 스크린리더 안내·AI 화면 컨텍스트가 같은 규칙을 쓴다. 모르는 범주 값은 그대로.
export function statusLabel(status: string, name?: string | null): string {
  return name ?? ownLookup(ISSUE_STATUS_LABEL, status) ?? status;
}

// 우선순위 한글 라벨 — statusLabel 과 같은 규칙. 모르는 값(과거·미래 enum)은 그대로, 프로토타입 키는 ownLookup 으로 거른다.
export function priorityLabel(priority: string): string {
  return ownLookup(ISSUE_PRIORITY_LABEL, priority) ?? priority;
}

// 종료 상태(완료·취소)인지 — 에픽 패널의 종료 배지·드롭 차단 등 종료 판정의 단일 기준.
export function isClosedStatus(status: string): boolean {
  return status === 'DONE' || status === 'CANCELED';
}

// 우선순위 버킷: 매우 높음→매우 낮음 고정 순서(ISSUE_PRIORITY_LABEL 키 순서, WP-886).
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
 *   status 는 statuses(프로젝트 상태, WP-808)를 주면 statusId 버킷(상태 표시 순서, key = statusId 문자열 — 서버
 *   groupBy=statusId 총계의 key 와 같다). 주지 않으면(프로젝트 횡단 화면·상태 목록 로딩 중) 범주 4버킷.
 * - assignee: 존재하는 담당자 버킷만 이름순 + "미지정" 버킷을 마지막에. 다중 담당자
 *   이슈는 각 담당자 그룹에 모두 등장한다.
 */
export function groupIssues(
  issues: IssueResponse[],
  groupBy: IssueClientGroupBy,
  statuses?: readonly ProjectStatus[],
): IssueGroup[] {
  if (groupBy === 'status' && statuses) return groupByProjectStatus(issues, statuses);
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

/**
 * 프로젝트 상태별 버킷(WP-808) — 받은 상태 목록 순서(서버 표시 순서: 범주 → position)대로 빈 버킷까지 만든다.
 * 목록에 없는 statusId(방금 추가돼 상태 목록 캐시가 아직 옛것 등)는 행을 잃지 않게 이슈의 statusName 으로 버킷을 뒤에 덧붙인다.
 */
function groupByProjectStatus(issues: IssueResponse[], statuses: readonly ProjectStatus[]): IssueGroup[] {
  const buckets = new Map<number, IssueGroup>(
    statuses.map((s) => [s.id, { key: String(s.id), label: s.name, issues: [] }]),
  );
  for (const it of issues) {
    let g = buckets.get(it.statusId);
    if (!g) {
      g = { key: String(it.statusId), label: it.statusName, issues: [] };
      buckets.set(it.statusId, g);
    }
    g.issues.push(it);
  }
  return [...buckets.values()];
}

/**
 * 서버 그룹 총계(WP-472)를 groupIssues 의 그룹 key 로 옮긴 맵 — 헤더가 「불러온 행 수」 대신 정확한 수를 쓴다.
 * 상태(범주 또는 statusId, WP-808)·우선순위는 값 그대로, 담당자는 `u-{id}`, 담당자 없음(null)은 `unassigned`.
 */
export function groupCountsByKey(res: IssueGroupCountsResponse | undefined): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const g of res?.groups ?? []) {
    const key = res!.groupBy === 'assignee' ? (g.key == null ? 'unassigned' : `u-${g.key}`) : (g.key ?? '');
    out.set(key, g.count);
  }
  return out;
}
