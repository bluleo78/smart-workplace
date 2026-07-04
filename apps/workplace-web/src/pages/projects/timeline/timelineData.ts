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
  TimelineMilestoneMarker,
} from './TimelineGantt';

/**
 * 이슈를 일정 있음(막대)/미정으로 분류.
 * CANCELED 이슈는 막대·미정 양쪽 모두에서 제외한다.
 * dueDate 가 있으면 막대(start 는 startDate, 없으면 마감일 포인트로 null),
 * dueDate 가 없으면(startDate 만 있어도) 막대를 그릴 수 없어 미정으로 분류한다.
 */
export function splitSchedulable(issues: IssueResponse[]): {
  bars: TimelineBar[];
  unscheduled: IssueResponse[];
} {
  const bars: TimelineBar[] = [];
  const unscheduled: IssueResponse[] = [];
  for (const issue of issues) {
    if (issue.status === 'CANCELED') continue;
    if (issue.dueDate) {
      bars.push({
        issueNumber: issue.number,
        issueKey: `${issue.projectKey}-${issue.number}`,
        title: issue.title,
        start: issue.startDate,
        due: issue.dueDate,
        status: issue.status,
      });
    } else {
      unscheduled.push(issue);
    }
  }
  return { bars, unscheduled };
}

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
