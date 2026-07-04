import { describe, expect, it } from 'vitest';

import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse } from '@/types/issue';
import type { IssueTypeSummary } from '@/types/issueType';
import type { MilestoneResponse } from '@/types/milestone';

import {
  cyclesToBands,
  defaultScheduleRange,
  filterRenderableDependencies,
  groupTimelineIssues,
  milestonesToMarkers,
} from './timelineData';
import type { TimelineBar } from './timelineTypes';

function issue(overrides: Partial<IssueResponse> = {}): IssueResponse {
  const now = '2026-07-01T00:00:00Z';
  return {
    id: 1,
    projectKey: 'WP',
    number: 1,
    title: '이슈',
    status: 'TODO',
    priority: 'MID',
    dueDate: null,
    startDate: null,
    milestoneId: null,
    reporterId: 1,
    createdAt: now,
    updatedAt: now,
    labels: [],
    attachmentCount: 0,
    type: null,
    assignees: [],
    parent: null,
    childCount: 0,
    childDoneCount: 0,
    blockedBy: [],
    blocks: [],
    blocked: false,
    customFields: [],
    ...overrides,
  };
}

function cycle(overrides: Partial<CycleResponse> = {}): CycleResponse {
  const now = '2026-07-01T00:00:00Z';
  return {
    id: 1,
    projectId: 1,
    name: '사이클 1',
    goal: null,
    startDate: null,
    endDate: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('cyclesToBands', () => {
  it('start/end 둘 다 있는 사이클만 밴드로 변환한다', () => {
    const bands = cyclesToBands([
      cycle({ id: 1, name: '사이클 7', startDate: '2026-07-01', endDate: '2026-07-14' }),
      cycle({ id: 2, name: '기간 없는 사이클', startDate: null, endDate: null }),
      cycle({ id: 3, name: '시작만 있는 사이클', startDate: '2026-07-01', endDate: null }),
    ]);
    expect(bands).toEqual([{ id: 1, name: '사이클 7', startDate: '2026-07-01', endDate: '2026-07-14' }]);
  });
});

describe('milestonesToMarkers', () => {
  it('마일스톤을 마커로 변환한다', () => {
    const milestones: MilestoneResponse[] = [
      { id: 1, projectId: 1, name: 'v1 출시', dueDate: '2026-08-01', description: null, createdAt: '', updatedAt: '' },
    ];
    expect(milestonesToMarkers(milestones)).toEqual([{ id: 1, name: 'v1 출시', dueDate: '2026-08-01' }]);
  });
});

describe('filterRenderableDependencies', () => {
  const bar = (issueNumber: number): TimelineBar => ({
    issueNumber,
    issueKey: `WP-${issueNumber}`,
    title: '이슈',
    start: '2026-07-01',
    due: '2026-07-05',
    status: 'TODO',
  });

  it('양끝 이슈가 모두 막대에 있는 엣지는 통과시킨다', () => {
    const bars = [bar(1), bar(2)];
    expect(
      filterRenderableDependencies([{ fromIssueNumber: 1, toIssueNumber: 2 }], bars),
    ).toEqual([{ fromIssueNumber: 1, toIssueNumber: 2 }]);
  });

  it('한쪽 이슈만 막대에 있는 엣지는 제외한다', () => {
    const bars = [bar(1)];
    expect(filterRenderableDependencies([{ fromIssueNumber: 1, toIssueNumber: 2 }], bars)).toEqual(
      [],
    );
  });

  it('양쪽 모두 막대에 없는 엣지는 제외한다', () => {
    const bars = [bar(3)];
    expect(filterRenderableDependencies([{ fromIssueNumber: 1, toIssueNumber: 2 }], bars)).toEqual(
      [],
    );
  });
});

describe('defaultScheduleRange', () => {
  it('오늘부터 +7일 범위를 반환한다', () => {
    expect(defaultScheduleRange(new Date('2026-07-04T00:00:00Z'))).toEqual({
      startDate: '2026-07-04',
      dueDate: '2026-07-11',
    });
  });
});

// IssueTypeSummary 실제 필드명은 icon (iconName 아님) — src/types/issueType.ts 참조.
const EPIC_TYPE: IssueTypeSummary = { id: 90, name: 'EPIC', colorToken: 'purple', icon: 'Zap' };
const SUBTASK_TYPE: IssueTypeSummary = {
  id: 91,
  name: 'SUBTASK',
  colorToken: 'gray',
  icon: 'CornerDownRight',
};

const parentRef = (number: number, title: string) => ({ number, title, type: EPIC_TYPE });

describe('groupTimelineIssues', () => {
  it('에픽 하위 이슈를 에픽 그룹으로, 에픽 없는 이슈를 no-epic 그룹으로 묶는다', () => {
    const epic = issue({ number: 40, title: '온보딩 개편', type: EPIC_TYPE, childCount: 2, childDoneCount: 1 });
    const child1 = issue({
      number: 41,
      parent: parentRef(40, '온보딩 개편'),
      startDate: '2026-07-01',
      dueDate: '2026-07-05',
      status: 'DONE',
    });
    const child2 = issue({
      number: 42,
      parent: parentRef(40, '온보딩 개편'),
      startDate: '2026-07-03',
      dueDate: '2026-07-10',
    });
    const loose = issue({ number: 18, dueDate: '2026-07-08' });
    const { groups } = groupTimelineIssues([epic, child1, child2, loose]);
    expect(groups.map((g) => g.key)).toEqual(['epic-40', 'no-epic']);
    const g = groups[0];
    expect(g.bars.map((b) => b.issueNumber)).toEqual([41, 42]);
    expect(g.done).toBe(1);
    expect(g.total).toBe(2);
    // 롤업: 하위 min start ~ max due
    expect(g.range).toEqual({ start: '2026-07-01', due: '2026-07-10' });
    expect(groups[1].bars.map((b) => b.issueNumber)).toEqual([18]);
  });

  it('에픽이 필터로 결과에서 빠져도 하위의 parent 요약으로 그룹을 합성한다', () => {
    const child = issue({
      number: 41,
      parent: parentRef(40, '온보딩 개편'),
      dueDate: '2026-07-05',
      status: 'DONE',
    });
    const { groups } = groupTimelineIssues([child]);
    expect(groups[0]).toMatchObject({ key: 'epic-40', title: '온보딩 개편', done: 1, total: 1 });
  });

  it('SUBTASK 는 막대·미정 어디에도 포함하지 않는다', () => {
    const sub = issue({
      number: 50,
      type: SUBTASK_TYPE,
      parent: { number: 41, title: '부모', type: { ...EPIC_TYPE, name: 'TASK' } },
      dueDate: '2026-07-05',
    });
    const { groups, unscheduled } = groupTimelineIssues([sub]);
    expect(groups).toEqual([]);
    expect(unscheduled).toEqual([]);
  });

  it('하위가 전부 일정 미정이면 에픽 자체 날짜로 폴백, 그것도 없으면 range null + 에픽은 미정 목록', () => {
    const epicWithDates = issue({
      number: 40,
      title: 'A',
      type: EPIC_TYPE,
      startDate: '2026-07-01',
      dueDate: '2026-07-20',
      childCount: 1,
    });
    const undatedChild = issue({ number: 41, parent: parentRef(40, 'A') });
    const r1 = groupTimelineIssues([epicWithDates, undatedChild]);
    expect(r1.groups[0].range).toEqual({ start: '2026-07-01', due: '2026-07-20' });
    expect(r1.unscheduled.map((i) => i.number)).toEqual([41]); // 미정 하위는 미정 목록으로

    const epicNoDates = issue({ number: 60, title: 'B', type: EPIC_TYPE, childCount: 1 });
    const undatedChild2 = issue({ number: 61, parent: parentRef(60, 'B') });
    const r2 = groupTimelineIssues([epicNoDates, undatedChild2]);
    expect(r2.groups).toEqual([]); // 그릴 것이 없는 그룹은 간트에서 제외
    expect(r2.unscheduled.map((i) => i.number)).toEqual([60, 61]); // 에픽 자신도 미정 목록
  });

  it('CANCELED 에픽은 하위 포함 전부 제외한다', () => {
    const canceled = issue({ number: 70, type: EPIC_TYPE, status: 'CANCELED', dueDate: '2026-07-30' });
    const child = issue({ number: 71, parent: parentRef(70, '취소 에픽'), dueDate: '2026-07-05' });
    const { groups, unscheduled } = groupTimelineIssues([canceled, child]);
    expect(groups).toEqual([]);
    expect(unscheduled).toEqual([]);
  });

  it('마감일만 있는 에픽 없는 이슈는 no-epic 그룹의 dueOnly 막대', () => {
    const loose = issue({ number: 18, dueDate: '2026-07-08' });
    const { groups } = groupTimelineIssues([loose]);
    expect(groups[0].key).toBe('no-epic');
    expect(groups[0].bars[0].start).toBeNull();
  });

  // splitSchedulable 이관 — 에픽 없는 단독 CANCELED 이슈도 막대·미정 양쪽 모두에서 제외한다.
  it('에픽 없는 CANCELED 이슈는 막대·미정 양쪽 모두에서 제외한다', () => {
    const { groups, unscheduled } = groupTimelineIssues([
      issue({ number: 4, status: 'CANCELED', dueDate: '2026-07-05' }),
      issue({ number: 5, status: 'CANCELED' }),
    ]);
    expect(groups).toEqual([]);
    expect(unscheduled).toEqual([]);
  });
});
