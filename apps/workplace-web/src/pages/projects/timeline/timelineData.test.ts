import { describe, expect, it } from 'vitest';

import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse } from '@/types/issue';
import type { MilestoneResponse } from '@/types/milestone';

import {
  cyclesToBands,
  defaultScheduleRange,
  filterRenderableDependencies,
  milestonesToMarkers,
  splitSchedulable,
} from './timelineData';
import type { TimelineBar } from './TimelineGantt';

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

describe('splitSchedulable', () => {
  it('start+due 이슈는 기간 막대로 분류한다', () => {
    const { bars, unscheduled } = splitSchedulable([
      issue({ number: 1, startDate: '2026-07-01', dueDate: '2026-07-05' }),
    ]);
    expect(bars).toEqual([
      { issueNumber: 1, issueKey: 'WP-1', title: '이슈', start: '2026-07-01', due: '2026-07-05', status: 'TODO' },
    ]);
    expect(unscheduled).toEqual([]);
  });

  it('due 만 있는 이슈는 start=null 막대(마감일 포인트)로 분류한다', () => {
    const { bars, unscheduled } = splitSchedulable([issue({ number: 2, dueDate: '2026-07-05' })]);
    expect(bars).toEqual([
      { issueNumber: 2, issueKey: 'WP-2', title: '이슈', start: null, due: '2026-07-05', status: 'TODO' },
    ]);
    expect(unscheduled).toEqual([]);
  });

  it('start·due 둘 다 없는 이슈는 미정으로 분류한다', () => {
    const target = issue({ number: 3 });
    const { bars, unscheduled } = splitSchedulable([target]);
    expect(bars).toEqual([]);
    expect(unscheduled).toEqual([target]);
  });

  it('CANCELED 이슈는 막대·미정 양쪽 모두에서 제외한다', () => {
    const { bars, unscheduled } = splitSchedulable([
      issue({ number: 4, status: 'CANCELED', dueDate: '2026-07-05' }),
      issue({ number: 5, status: 'CANCELED' }),
    ]);
    expect(bars).toEqual([]);
    expect(unscheduled).toEqual([]);
  });
});

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
