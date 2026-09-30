// 이슈 목록 「사이클」 그룹(#878) — Jira 백로그처럼 진행 중 → 예정 → 백로그 구간으로 나눠 보여주는 순수 로직.
// 구간 순서·기본 펼침, 구간별 검색 필터(종료 이슈 스코프 포함), 남은 일수 표기를 컴포넌트와 분리해 단위 테스트한다.

import type { CycleResponse } from '../types/cycle';
import type { IssueFilters } from '../types/issue';
import { withDefaultIssueScope } from './issueFilters';
import { daysUntilLocalDate } from './myTasks';

/** 구간 — 사이클 하나, 또는 백로그(진행 중·예정 사이클 밖). */
export type CycleSectionDef =
  | { kind: 'cycle'; key: string; cycle: CycleResponse; defaultExpanded: boolean }
  | { kind: 'backlog'; key: 'backlog'; defaultExpanded: boolean };

// 진행 중·예정 사이클 수 — 목록 기본 그룹을 사이클로 할지 판정(완료 사이클만 있으면 보여줄 구간이 백로그뿐이라 제외).
export function countOpenCycles(cycles: CycleResponse[]): number {
  return cycles.filter((c) => c.status === 'ACTIVE' || c.status === 'PLANNED').length;
}

// 시작일 오름차순 — null(미정)은 맨 뒤, 같으면 id 순으로 안정 정렬. yyyy-MM-dd 문자열은 사전순=날짜순.
function byStartDateAsc(a: CycleResponse, b: CycleResponse): number {
  if (a.startDate !== b.startDate) {
    if (a.startDate == null) return 1;
    if (b.startDate == null) return -1;
    return a.startDate < b.startDate ? -1 : 1;
  }
  return a.id - b.id;
}

// 상태 순서 — 진행 중 → 예정 → 완료(완료는 사용자가 사이클 필터로 직접 고른 경우에만 나온다).
const STATUS_RANK: Record<string, number> = { ACTIVE: 0, PLANNED: 1, COMPLETED: 2 };

/**
 * 표시할 구간 목록.
 * - 사이클 필터 미선택: 진행 중(시작일순) → 예정(시작일순, 미정 마지막) → 백로그. 완료 사이클은 표시하지 않는다.
 * - 사이클 필터 선택: 고른 사이클 구간만(백로그 숨김). 명시 선택이라 완료 사이클도 보이고, 모두 기본 펼침.
 * 기본 펼침: 진행 중·백로그 펼침, 예정 접힘(접힌 구간은 요청하지 않아 첫 화면 요청 수를 줄인다).
 */
export function buildCycleSections(
  cycles: CycleResponse[],
  selectedCycleIds: number[],
): CycleSectionDef[] {
  const explicit = selectedCycleIds.length > 0;
  const visible = explicit
    ? cycles.filter((c) => selectedCycleIds.includes(c.id))
    : cycles.filter((c) => c.status !== 'COMPLETED');
  const sorted = [...visible].sort(
    (a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || byStartDateAsc(a, b),
  );
  const sections: CycleSectionDef[] = sorted.map((cycle) => ({
    kind: 'cycle',
    key: `cycle-${cycle.id}`,
    cycle,
    defaultExpanded: explicit || cycle.status !== 'PLANNED',
  }));
  if (!explicit) sections.push({ kind: 'backlog', key: 'backlog', defaultExpanded: true });
  return sections;
}

/**
 * 사이클 구간 검색 필터 — 현재 필터(검색·담당자·라벨 등) + 해당 사이클.
 * 종료 이슈는 숨기지 않는다: 진행 중 구간은 평면 목록 기본 스코프(#876)도 활성 사이클의 완료 이슈를 남기고,
 * 예정·완료 구간은 소속 전체가 대상이다. (cycleIds 지정이 withDefaultIssueScope 에서 이미 숨김을 해제하지만,
 * 그 우연에 기대지 않고 명시한다.)
 */
export function cycleSectionFilters(filters: IssueFilters, cycleId: number): IssueFilters {
  return {
    ...withDefaultIssueScope(filters),
    cycleIds: [cycleId],
    cycleUnassigned: false,
    hideInactiveClosed: false,
  };
}

/**
 * 백로그 구간 검색 필터 — 현재 필터 + cycle=null(진행 중·예정 사이클에 연결되지 않은 이슈. 완료 사이클에만 남은
 * 이슈도 포함 — 끝난 스프린트의 미완료 이슈가 백로그로 돌아오는 Jira 관례).
 * 종료 이슈 숨김은 사용자 필터만으로 계산한 기본 스코프 값을 그대로 쓴다 — cycleUnassigned 를 넣은 뒤 다시 계산하면
 * overridesClosedHiding 이 숨김을 풀어 완료 이슈가 백로그에 쌓인다. 결과적으로 평면 목록과 같은 규칙:
 * 기본은 미종료만, 「완료 모두 보기」·상태 필터 등을 명시하면 그 의사를 따른다.
 */
export function backlogSectionFilters(filters: IssueFilters): IssueFilters {
  return { ...withDefaultIssueScope(filters), cycleIds: [], cycleUnassigned: true };
}

// 진행 중 사이클 남은 일수 — 로컬 날짜 기준(D-N / 오늘=D-day / 지나면 "N일 초과" 경고). UTC 파싱 금지.
// ariaLabel — "D-3" 같은 약어는 스크린리더가 뜻을 전하지 못해 풀어 쓴 문장을 함께 준다.
export function remainingLabel(
  endDate: string | null,
  now: Date,
): { text: string; ariaLabel: string; overdue: boolean } | null {
  if (!endDate) return null;
  const days = daysUntilLocalDate(endDate, now);
  if (days > 0) return { text: `D-${days}`, ariaLabel: `종료까지 ${days}일`, overdue: false };
  if (days === 0) return { text: 'D-day', ariaLabel: '오늘 종료', overdue: false };
  return { text: `${-days}일 초과`, ariaLabel: `종료일 ${-days}일 초과`, overdue: true };
}
