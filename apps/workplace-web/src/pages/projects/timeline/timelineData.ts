// 이슈/사이클/마일스톤 응답을 TimelineGantt 가 소비하는 모델로 변환하는 순수 함수 모음.
// 네트워크/상태와 분리해 vitest 로 검증한다.

import { addDays, format } from 'date-fns';

import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse } from '@/types/issue';
import type { MilestoneResponse } from '@/types/milestone';

import type {
  TimelineBar,
  TimelineCycleBand,
  TimelineDependencyEdge,
  TimelineEpicGroup,
  TimelineMilestoneMarker,
} from './timelineTypes';

/** 시작/종료 날짜가 모두 있는 사이클만 밴드로 변환. */
export function cyclesToBands(cycles: CycleResponse[]): TimelineCycleBand[] {
  return cycles
    .filter((c): c is CycleResponse & { startDate: string; endDate: string } =>
      Boolean(c.startDate && c.endDate),
    )
    .map((c) => ({ id: c.id, name: c.name, startDate: c.startDate, endDate: c.endDate }));
}

/** 마일스톤 목록을 간트 마커로 변환. */
export function milestonesToMarkers(milestones: MilestoneResponse[]): TimelineMilestoneMarker[] {
  return milestones.map((m) => ({ id: m.id, name: m.name, dueDate: m.dueDate }));
}

/**
 * 의존 엣지 중 양끝 이슈가 모두 타임라인 막대(bars)에 존재하는 것만 남긴다 —
 * 일정 미정/CANCELED 이슈로의 화살표는 SVAR 가 렌더할 노드가 없어 제외해야 한다.
 */
export function filterRenderableDependencies(
  edges: TimelineDependencyEdge[],
  bars: TimelineBar[],
): TimelineDependencyEdge[] {
  const barIssueNumbers = new Set(bars.map((b) => b.issueNumber));
  return edges.filter(
    (e) => barIssueNumbers.has(e.fromIssueNumber) && barIssueNumbers.has(e.toIssueNumber),
  );
}

/** 일정 미정 이슈를 타임라인에 배치할 때 쓸 기본 기간 — 오늘부터 7일. */
export function defaultScheduleRange(today: Date): { startDate: string; dueDate: string } {
  return {
    startDate: format(today, 'yyyy-MM-dd'),
    dueDate: format(addDays(today, 7), 'yyyy-MM-dd'),
  };
}

const NO_EPIC_KEY = 'no-epic';

/** IssueResponse → TimelineBar 변환 (dueDate 필수 — 호출부가 사전에 필터링). */
function toBar(issue: IssueResponse): TimelineBar {
  return {
    issueNumber: issue.number,
    issueKey: `${issue.projectKey}-${issue.number}`,
    title: issue.title,
    start: issue.startDate,
    due: issue.dueDate!,
    status: issue.status,
  };
}

/**
 * 이슈를 에픽 트리 구조로 그룹핑 (#649).
 * - EPIC 유형 → 그룹 행, 하위 이슈는 parent(EPIC) 기준으로 소속. 에픽 없는 이슈는 no-epic 가상 그룹(맨 뒤).
 * - SUBTASK 는 계획 단위가 아니므로 전면 제외. CANCELED 는 자신 제외 + (에픽이면) 하위 전체 제외.
 * - range: 하위 막대 min start(없으면 due) ~ max due 롤업. 하위 막대가 없으면 에픽 자체 start/due 폴백.
 *   범위를 계산할 수 없는 그룹은 간트에 그릴 것이 없으므로 groups 에서 제외한다(하위 미정 이슈는 unscheduled 로).
 * - 에픽이 필터로 응답에 없어도 하위의 parent 요약으로 그룹을 합성한다(제목/진행률은 보이는 하위 기준).
 */
export function groupTimelineIssues(issues: IssueResponse[]): {
  groups: TimelineEpicGroup[];
  unscheduled: IssueResponse[];
} {
  const canceledEpics = new Set(
    issues.filter((i) => i.type?.name === 'EPIC' && i.status === 'CANCELED').map((i) => i.number),
  );
  // 유효 이슈: SUBTASK/CANCELED/취소 에픽의 하위 제외.
  const active = issues.filter((i) => {
    if (i.type?.name === 'SUBTASK') return false;
    if (i.status === 'CANCELED') return false;
    if (i.parent?.type.name === 'EPIC' && canceledEpics.has(i.parent.number)) return false;
    return true;
  });

  const epics = active.filter((i) => i.type?.name === 'EPIC');
  const epicByNumber = new Map(epics.map((e) => [e.number, e]));
  const children = new Map<number, IssueResponse[]>(); // epicNumber → 하위
  const looseIssues: IssueResponse[] = [];
  for (const issue of active) {
    if (issue.type?.name === 'EPIC') continue;
    if (issue.parent?.type.name === 'EPIC') {
      const list = children.get(issue.parent.number) ?? [];
      list.push(issue);
      children.set(issue.parent.number, list);
    } else {
      looseIssues.push(issue);
    }
  }

  const groups: TimelineEpicGroup[] = [];
  const unscheduled: IssueResponse[] = [];

  // 에픽 그룹 — 응답에 있는 에픽 + 하위만 보이는 합성 에픽을 번호 오름차순으로.
  const epicNumbers = [...new Set([...epicByNumber.keys(), ...children.keys()])].sort((a, b) => a - b);
  for (const num of epicNumbers) {
    if (canceledEpics.has(num)) continue;
    const epic = epicByNumber.get(num) ?? null;
    const kids = children.get(num) ?? [];
    const bars = kids.filter((k) => k.dueDate).map(toBar);
    const undatedKids = kids.filter((k) => !k.dueDate);

    let range: TimelineEpicGroup['range'] = null;
    if (bars.length > 0) {
      const starts = bars.map((b) => b.start ?? b.due);
      const dues = bars.map((b) => b.due);
      range = { start: starts.reduce((a, b) => (a < b ? a : b)), due: dues.reduce((a, b) => (a > b ? a : b)) };
    } else if (epic?.dueDate) {
      range = { start: epic.startDate ?? epic.dueDate, due: epic.dueDate };
    }

    if (range === null) {
      // 그릴 막대가 전혀 없는 에픽 — 에픽 자신(먼저) + 미정 하위 순으로 미정 목록에 보낸다.
      if (epic) unscheduled.push(epic);
      unscheduled.push(...undatedKids);
      continue;
    }
    unscheduled.push(...undatedKids);
    groups.push({
      key: `epic-${num}`,
      epicNumber: num,
      title: epic?.title ?? kids[0]?.parent?.title ?? `#${num}`,
      done: epic ? epic.childDoneCount : kids.filter((k) => k.status === 'DONE').length,
      total: epic ? epic.childCount : kids.length,
      range,
      bars,
    });
  }

  // no-epic 그룹 — 막대 있는 이슈만, 맨 뒤에.
  const looseBars = looseIssues.filter((i) => i.dueDate).map(toBar);
  for (const issue of looseIssues) if (!issue.dueDate) unscheduled.push(issue);
  if (looseBars.length > 0) {
    groups.push({
      key: NO_EPIC_KEY,
      epicNumber: null,
      title: '에픽 없음',
      done: 0,
      total: 0,
      range: null, // no-epic 은 롤업 막대를 그리지 않는다 — 라벨 행만.
      bars: looseBars,
    });
  }

  return { groups, unscheduled };
}
