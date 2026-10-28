import { addDays, addMonths, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { describe, expect, it } from 'vitest';

import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse, IssueStatus } from '@/types/issue';
import type { IssueTypeSummary } from '@/types/issueType';
import type { MilestoneResponse } from '@/types/milestone';

import {
  type AgendaSection,
  buildAgendaSections,
  clusterLaneGroups,
  cyclesToBands,
  dayCellLabel,
  defaultScheduleRange,
  filterRenderableDependencies,
  formatPeriodSpan,
  ganttAxisBounds,
  groupLaneChipsByDate,
  groupTimelineIssues,
  initialScrollDate,
  isWeekend,
  laneGroupLabelParts,
  milestonesToMarkers,
  parsePeriodParam,
  parseTimelineZoom,
  periodParamToString,
  prepareTimelineIssues,
  resolvePeriod,
  rollupOverlay,
  versionSheetDateLabel,
  versionSheetSections,
  versionsToMarkers,
  weekMonthAdd,
  weekMonthDiff,
  weekMonthEnd,
  weekMonthOf,
  weekMonthStart,
  weeksInWeekMonth,
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
    statusId: 1,
    statusName: '할 일',
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
  it('시작일이 있으면 시작일은 그대로 두고 시작일 +7일을 마감으로만 채운다 (WP-483)', () => {
    expect(defaultScheduleRange(new Date('2026-07-04T00:00:00Z'), '2026-07-20')).toEqual({
      dueDate: '2026-07-27',
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

// status: 부모(에픽) 상태 — 응답에 에픽 행이 없을 때 취소 여부 판단 근거(WP-247). 생략하면 이력 등 상태 없는 payload 와 같다.
const parentRef = (number: number, title: string, status?: IssueStatus) => ({ number, title, type: EPIC_TYPE, ...(status ? { status } : {}) });

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

  it('no-epic 그룹도 에픽 그룹과 동일하게 하위 막대 min-start~max-due 로 range 를 롤업한다 (#662)', () => {
    const loose1 = issue({ number: 33, startDate: '2026-06-20', dueDate: '2026-06-28' });
    const loose2 = issue({ number: 21, startDate: '2026-06-18', dueDate: '2026-06-30' });
    const loose3 = issue({ number: 5, startDate: '2026-06-10', dueDate: '2026-06-19' });
    const { groups } = groupTimelineIssues([loose1, loose2, loose3]);
    const noEpic = groups.find((g) => g.key === 'no-epic');
    // 그룹 행 자체는 하위 어느 이슈와도 무관한 값(예: 27-06-2026/1일)이 아니라
    // 하위 막대의 min-start(06-10) ~ max-due(06-30) 롤업이어야 한다.
    expect(noEpic?.range).toEqual({ start: '2026-06-10', due: '2026-06-30' });
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

  it('미정 에픽 자식은 unscheduled 가 아니라 그룹 undatedChildren 으로 간다 (에픽 자체 날짜 폴백)', () => {
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
    expect(r1.groups[0].undatedChildren.map((k) => k.number)).toEqual([41]);
    expect(r1.unscheduled.map((i) => i.number)).not.toContain(41); // 더 이상 미정 목록으로 보내지 않는다
  });

  it('자식이 전부 미정이고 에픽 자체 날짜도 없으면 그룹은 형성되되 range=null, 자식은 undatedChildren', () => {
    const epicNoDates = issue({ number: 60, title: 'B', type: EPIC_TYPE, childCount: 1 });
    const undatedChild = issue({ number: 61, parent: parentRef(60, 'B') });
    const { groups, unscheduled } = groupTimelineIssues([epicNoDates, undatedChild]);
    const g = groups.find((x) => x.key === 'epic-60');
    expect(g).toBeTruthy(); // 막대는 없어도 그룹 행/펼침은 유지
    expect(g?.range).toBeNull();
    expect(g?.undatedChildren.map((k) => k.number)).toEqual([61]);
    expect(unscheduled.map((i) => i.number)).not.toContain(60);
    expect(unscheduled.map((i) => i.number)).not.toContain(61);
  });

  it('날짜 자식과 미정 자식이 섞이면 bars=날짜자식, undatedChildren=미정자식으로 분리한다', () => {
    const epic = issue({ number: 40, title: 'A', type: EPIC_TYPE, childCount: 2, childDoneCount: 1 });
    const dated = issue({ number: 41, parent: parentRef(40, 'A'), startDate: '2026-07-01', dueDate: '2026-07-05' });
    const undated = issue({ number: 42, parent: parentRef(40, 'A') });
    const { groups, unscheduled } = groupTimelineIssues([epic, dated, undated]);
    const g = groups.find((x) => x.key === 'epic-40')!;
    expect(g.bars.map((b) => b.issueNumber)).toEqual([41]);
    expect(g.undatedChildren.map((k) => k.number)).toEqual([42]);
    expect(unscheduled.map((i) => i.number)).not.toContain(42);
  });

  it('CANCELED 에픽은 숨기고, 남은 할 일·진행 중 하위는 「에픽 없음」으로 옮기며 완료·취소 하위는 숨긴다 (WP-247)', () => {
    const canceled = issue({ number: 70, title: '취소 에픽', type: EPIC_TYPE, status: 'CANCELED', dueDate: '2026-07-30' });
    const open = issue({ number: 71, parent: parentRef(70, '취소 에픽'), dueDate: '2026-07-05' });
    const doing = issue({ number: 72, parent: parentRef(70, '취소 에픽'), status: 'IN_PROGRESS' });
    const done = issue({ number: 73, parent: parentRef(70, '취소 에픽'), status: 'DONE', dueDate: '2026-07-06' });
    const { groups, unscheduled } = groupTimelineIssues([canceled, open, doing, done]);
    expect(groups.map((g) => g.key)).toEqual(['no-epic']);
    expect(groups[0].bars).toEqual([expect.objectContaining({ issueNumber: 71, formerEpicTitle: '취소 에픽' })]);
    expect(unscheduled.map((i) => i.number)).toEqual([72]);
  });

  it('「취소」 상태 필터면 취소 에픽·취소 이슈도 보인다 (WP-247)', () => {
    const canceled = issue({ number: 70, title: '취소 에픽', type: EPIC_TYPE, status: 'CANCELED', startDate: '2026-07-01', dueDate: '2026-07-30' });
    const loose = issue({ number: 5, status: 'CANCELED', dueDate: '2026-07-05' });
    const { groups } = groupTimelineIssues([canceled, loose], { includeCanceled: true });
    expect(groups.map((g) => [g.key, g.status])).toEqual([['epic-70', 'CANCELED'], ['no-epic', null]]);
    expect(groups[1].bars.map((b) => b.issueNumber)).toEqual([5]);
  });

  // WP-248 — 에픽에 기간을 설정하면 날짜 있는 하위가 있어도 막대는 에픽 기간, 하위 롤업은 rollup 으로 분리.
  it('에픽 자체 기간이 있으면 range 는 에픽 기간, rollup 은 하위 롤업 (WP-248)', () => {
    const epic = issue({ number: 40, title: 'A', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-31' });
    const c1 = issue({ number: 41, parent: parentRef(40, 'A'), startDate: '2026-10-06', dueDate: '2026-10-12' });
    const c2 = issue({ number: 42, parent: parentRef(40, 'A'), startDate: '2026-10-27', dueDate: '2026-11-04' });
    const g = groupTimelineIssues([epic, c1, c2]).groups[0];
    expect(g.range).toEqual({ start: '2026-10-01', due: '2026-10-31' });
    expect(g.rollup).toEqual({ start: '2026-10-06', due: '2026-11-04' });
  });

  it('에픽에 마감일만 있으면 range 는 마감일 하루 (WP-248)', () => {
    const epic = issue({ number: 40, title: 'A', type: EPIC_TYPE, dueDate: '2026-10-31' });
    const c1 = issue({ number: 41, parent: parentRef(40, 'A'), startDate: '2026-10-06', dueDate: '2026-10-12' });
    const g = groupTimelineIssues([epic, c1]).groups[0];
    expect(g.range).toEqual({ start: '2026-10-31', due: '2026-10-31' });
    expect(g.rollup).toEqual({ start: '2026-10-06', due: '2026-10-12' });
  });

  it('에픽에 마감일이 없으면 range 는 하위 롤업이고 rollup 은 따로 두지 않는다 (WP-248)', () => {
    // 시작일만 있는 에픽도 기간으로 보지 않는다 — 끝을 알 수 없어 기존처럼 하위 롤업으로 그린다.
    const epic = issue({ number: 40, title: 'A', type: EPIC_TYPE, startDate: '2026-10-01' });
    const c1 = issue({ number: 41, parent: parentRef(40, 'A'), startDate: '2026-10-06', dueDate: '2026-10-12' });
    const g = groupTimelineIssues([epic, c1]).groups[0];
    expect(g.range).toEqual({ start: '2026-10-06', due: '2026-10-12' });
    expect(g.rollup).toBeNull();
  });

  it('에픽 시작일이 마감일보다 늦으면 range 는 마감일 하루로 본다', () => {
    const epic = issue({ number: 40, title: 'A', type: EPIC_TYPE, startDate: '2026-11-05', dueDate: '2026-10-31' });
    const c1 = issue({ number: 41, parent: parentRef(40, 'A'), startDate: '2026-10-06', dueDate: '2026-10-12' });
    expect(groupTimelineIssues([epic, c1]).groups[0].range).toEqual({ start: '2026-10-31', due: '2026-10-31' });
  });

  it('날짜 있는 하위가 없으면 rollup 은 null, no-epic 그룹도 rollup 은 null (WP-248)', () => {
    const epic = issue({ number: 40, title: 'A', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-31' });
    const undated = issue({ number: 41, parent: parentRef(40, 'A') });
    const loose = issue({ number: 18, dueDate: '2026-10-08' });
    const { groups } = groupTimelineIssues([epic, undated, loose]);
    expect(groups.find((g) => g.key === 'epic-40')?.rollup).toBeNull();
    expect(groups.find((g) => g.key === 'no-epic')?.rollup).toBeNull();
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

describe('rollupOverlay', () => {
  // 에픽 막대(10/1~10/31, 31일) 기준 얇은 막대의 위치·폭과 기간 안쪽 구간을 % 로 계산한다 (WP-249).
  const epic = { start: '2026-10-01', due: '2026-10-31' };

  it('하위가 에픽 기간 안이면 안쪽 구간이 얇은 막대 전체(0~100%)', () => {
    const o = rollupOverlay(epic, { start: '2026-10-06', due: '2026-10-12' });
    expect(o.left).toBeCloseTo((5 / 31) * 100);
    expect(o.width).toBeCloseTo((7 / 31) * 100);
    expect(o.inStart).toBe(0);
    expect(o.inEnd).toBe(100);
  });

  it('뒤로 넘치면 안쪽 구간은 에픽 끝까지, 이후는 초과', () => {
    // 10/27~11/4 = 9일 중 10/27~10/31 5일이 안쪽
    const o = rollupOverlay(epic, { start: '2026-10-27', due: '2026-11-04' });
    expect(o.left).toBeCloseTo((26 / 31) * 100);
    expect(o.width).toBeCloseTo((9 / 31) * 100);
    expect(o.inStart).toBe(0);
    expect(o.inEnd).toBeCloseTo((5 / 9) * 100);
  });

  it('앞으로 넘치면 left 가 음수이고 안쪽 구간은 에픽 시작부터', () => {
    // 9/28~10/3 = 6일 중 앞 3일(9/28~9/30)이 초과
    const o = rollupOverlay(epic, { start: '2026-09-28', due: '2026-10-03' });
    expect(o.left).toBeCloseTo((-3 / 31) * 100);
    expect(o.inStart).toBeCloseTo(50);
    expect(o.inEnd).toBe(100);
  });

  it('뒤집힌 롤업(start > due)도 유한한 값을 낸다', () => {
    const o = rollupOverlay(epic, { start: '2026-10-12', due: '2026-10-06' });
    for (const v of Object.values(o)) expect(Number.isFinite(v)).toBe(true);
  });

  it('에픽 기간과 전혀 겹치지 않으면 전 구간 초과(inStart = inEnd)', () => {
    const o = rollupOverlay(epic, { start: '2026-11-03', due: '2026-11-05' });
    expect(o.inStart).toBe(o.inEnd);
  });
});

describe('buildAgendaSections', () => {
  const TODAY = new Date(2026, 9, 15); // 2026-10-15(로컬)
  const keys = (s: AgendaSection[]) => s.map((x) => x.key);
  const nums = (s: AgendaSection) => s.rows.map((r) => r.issueNumber);

  it('기준일(시작일 우선, 없으면 마감일)의 월 섹션을 오름차순으로, 마감일 없는 이슈는 맨 아래 「일정 미정」', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 1, startDate: '2026-11-03', dueDate: '2026-11-10' }),
        issue({ number: 2, dueDate: '2026-09-20' }),
        issue({ number: 3 }),
        // 시작일만 — 간트와 같이 마감일이 있어야 일정이 정해진 것으로 본다(WP-484). 시작일은 행에 그대로 싣는다.
        issue({ number: 4, startDate: '2026-10-02' }),
      ],
      TODAY,
    );
    expect(keys(s)).toEqual(['2026-09', '2026-11', 'undated']);
    expect(s.map((x) => x.label)).toEqual(['2026년 9월', '2026년 11월', '일정 미정']);
    expect(nums(s[2])).toEqual([3, 4]);
    expect(s[2].rows.map((r) => r.bar)).toEqual([null, null]);
    expect(s[2].rows[1]).toMatchObject({ start: '2026-10-02', due: null });
    expect(s[2].todayRatio).toBeNull();
  });

  it('마감일 없는 하위는 에픽 기간·머리 행 날짜에 넣지 않고 막대도 그리지 않는다(간트와 같은 정의, WP-484)', () => {
    const s = buildAgendaSections(
      [
        // 에픽 날짜 없음 — 머리 행은 마감일 있는 하위(81)만으로 롤업한다.
        issue({ number: 80, title: '롤업 에픽', type: EPIC_TYPE }),
        issue({ number: 81, parent: parentRef(80, '롤업 에픽'), startDate: '2026-10-24', dueDate: '2026-11-29' }),
        issue({ number: 82, parent: parentRef(80, '롤업 에픽'), startDate: '2026-10-19' }),
      ],
      TODAY,
    );
    expect(keys(s)).toEqual(['2026-10']);
    expect(s[0].rows[0]).toMatchObject({ issueNumber: 80, start: '2026-10-24', due: '2026-11-29' });
    // 일정 있는 하위 먼저, 시작일만 있는 하위는 뒤 — 막대 없이 시작일만 싣는다.
    expect(s[0].rows.slice(1).map((r) => [r.issueNumber, r.bar === null])).toEqual([
      [81, false],
      [82, true],
    ]);
  });

  it('시작일만 있고 마감일 있는 하위도 없는 에픽은 「일정 미정」', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 90, title: '시작만 에픽', type: EPIC_TYPE, startDate: '2026-10-05' }),
        issue({ number: 91, parent: parentRef(90, '시작만 에픽'), startDate: '2026-10-06' }),
      ],
      TODAY,
    );
    expect(keys(s)).toEqual(['undated']);
    expect(nums(s[0])).toEqual([90, 91]);
  });

  it('같은 월 안은 기준일 오름차순, 같으면 번호 오름차순', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 7, startDate: '2026-10-05', dueDate: '2026-10-09' }),
        issue({ number: 5, startDate: '2026-10-05', dueDate: '2026-10-09' }),
        issue({ number: 6, dueDate: '2026-10-01' }),
      ],
      TODAY,
    );
    expect(nums(s[0])).toEqual([6, 5, 7]);
  });

  it('에픽은 자기 기준일의 월에, 하위는 월이 달라도(미정 포함) 에픽 바로 아래 child 로 묶인다', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 40, title: '결제 개편', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-12-15' }),
        issue({ number: 41, parent: parentRef(40, '결제 개편'), startDate: '2026-11-05', dueDate: '2026-11-20' }),
        issue({ number: 42, parent: parentRef(40, '결제 개편'), dueDate: '2026-10-08' }),
        issue({ number: 43, parent: parentRef(40, '결제 개편') }),
        issue({ number: 9, startDate: '2026-10-03', dueDate: '2026-10-04' }),
      ],
      TODAY,
    );
    expect(keys(s)).toEqual(['2026-10']);
    expect(s[0].rows.map((r) => [r.issueNumber, r.kind])).toEqual([
      [40, 'epic'],
      [42, 'child'],
      [41, 'child'],
      [43, 'child'],
      [9, 'issue'],
    ]);
  });

  it('에픽 기준일이 없으면 하위 중 가장 이른 기준일의 월, 머리 행 날짜·막대는 하위 롤업', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 50, title: '롤업 에픽', type: EPIC_TYPE }),
        issue({ number: 51, parent: parentRef(50, '롤업 에픽'), startDate: '2026-09-25', dueDate: '2026-10-05' }),
        issue({ number: 52, parent: parentRef(50, '롤업 에픽'), dueDate: '2026-11-02' }),
      ],
      TODAY,
    );
    expect(keys(s)).toEqual(['2026-09']);
    const head = s[0].rows[0];
    expect(head).toMatchObject({ issueNumber: 50, kind: 'epic', title: '롤업 에픽', start: '2026-09-25', due: '2026-11-02' });
    expect(head.bar!.left).toBeCloseTo(24 / 30);
    expect(head.bar!.right).toBe(1);
  });

  it('응답에 없는 에픽은 하위의 parent 요약으로 머리 행을 합성한다', () => {
    const s = buildAgendaSections([issue({ number: 61, parent: parentRef(60, '합성 에픽'), dueDate: '2026-10-10' })], TODAY);
    expect(s[0].rows.map((r) => [r.issueNumber, r.kind, r.title])).toEqual([
      [60, 'epic', '합성 에픽'],
      [61, 'child', '이슈'],
    ]);
  });

  it('SUBTASK·CANCELED 는 빼고, 취소된 에픽의 남은 하위는 단독 행으로 남긴다(간트와 같은 규칙)', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 1, dueDate: '2026-10-01' }),
        issue({ number: 2, type: SUBTASK_TYPE, dueDate: '2026-10-02' }),
        issue({ number: 3, status: 'CANCELED', dueDate: '2026-10-03' }),
        issue({ number: 70, title: '취소 에픽', type: EPIC_TYPE, status: 'CANCELED', dueDate: '2026-10-04' }),
        issue({ number: 71, parent: parentRef(70, '취소 에픽'), dueDate: '2026-10-05' }),
      ],
      TODAY,
    );
    expect(s.flatMap(nums)).toEqual([1, 71]);
    expect(s.flatMap((x) => x.rows).find((r) => r.issueNumber === 71)).toMatchObject({ kind: 'issue', formerEpicTitle: '취소 에픽' });
  });

  it('차단 여부를 행에 싣는다 — 에픽·하위·단독 모두, 합성 에픽 머리 행은 false (WP-646)', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 60, title: '에픽', type: EPIC_TYPE, dueDate: '2026-10-10', blocked: true }),
        issue({ number: 61, parent: parentRef(60, '에픽'), dueDate: '2026-10-05', blocked: true }),
        issue({ number: 62, dueDate: '2026-10-06', blocked: true }),
        issue({ number: 63, dueDate: '2026-10-07' }),
        issue({ number: 66, parent: parentRef(65, '응답에 없는 에픽'), dueDate: '2026-10-08', blocked: true }),
      ],
      TODAY,
    );
    const blocked = Object.fromEntries(s.flatMap((x) => x.rows).map((r) => [r.issueNumber, r.blocked]));
    expect(blocked).toEqual({ 60: true, 61: true, 62: true, 63: false, 65: false, 66: true });
  });

  it('막대 = 섹션 월 안 비율, 월 밖은 0/1 로 잘린다(보이는 최소 폭은 컴포넌트 몫)', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 1, startDate: '2026-10-11', dueDate: '2026-10-20' }),
        issue({ number: 2, startDate: '2026-09-25', dueDate: '2026-10-05' }),
        issue({ number: 3, dueDate: '2026-10-31' }),
        issue({ number: 40, type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-31' }),
        issue({ number: 41, parent: parentRef(40, '에픽'), startDate: '2026-11-05', dueDate: '2026-11-20' }),
        issue({ number: 4, startDate: '2026-10-20', dueDate: '2026-10-12' }), // 시작 > 마감(잘못된 데이터) — 뒤집어 그린다
      ],
      TODAY,
    );
    const row = (n: number) => s.flatMap((x) => x.rows).find((r) => r.issueNumber === n)!;
    expect(row(1).bar!.left).toBeCloseTo(10 / 31);
    expect(row(1).bar!.right).toBeCloseTo(20 / 31);
    expect(row(2).bar!.left).toBeCloseTo(24 / 30); // 9월 섹션
    expect(row(2).bar!.right).toBe(1);
    expect(row(3).bar!.left).toBeCloseTo(30 / 31);
    expect(row(3).bar!.right).toBe(1);
    expect(row(41).bar).toEqual({ left: 1, right: 1 }); // 10월 에픽 아래 11월 하위 — 오른쪽 끝으로 잘림
    expect(row(4).bar!.left).toBeCloseTo(11 / 31);
    expect(row(4).bar!.right).toBeCloseTo(20 / 31);
  });

  it('오늘 선 — 오늘이 속한 월 섹션만, 그날의 가운데 비율', () => {
    const s = buildAgendaSections(
      [issue({ number: 1, dueDate: '2026-09-10' }), issue({ number: 2, dueDate: '2026-10-10' })],
      TODAY,
    );
    expect(s[0].todayRatio).toBeNull();
    expect(s[1].todayRatio).toBeCloseTo(14.5 / 31);
  });

  // WP-251 — 에픽 접기·진행률·에픽 기간 vs 하위 실제 범위 구분.
  it('행마다 소속 에픽 번호, 에픽 행엔 진행률', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 40, title: 'E', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-31', childCount: 3, childDoneCount: 1 }),
        issue({ number: 41, parent: parentRef(40, 'E'), dueDate: '2026-10-08' }),
        issue({ number: 9, dueDate: '2026-10-03' }),
        issue({ number: 61, parent: parentRef(60, '합성'), dueDate: '2026-10-10', status: 'DONE' }),
      ],
      TODAY,
    );
    const row = (n: number) => s.flatMap((x) => x.rows).find((r) => r.issueNumber === n)!;
    expect([row(40).groupKey, row(41).groupKey, row(9).groupKey]).toEqual(['epic-40', 'epic-40', null]);
    expect(row(40).progress).toEqual({ done: 1, total: 3 });
    expect(row(60).progress).toEqual({ done: 1, total: 1 }); // 합성 에픽은 보이는 하위 기준
    expect(row(41).progress).toBeNull();
    expect(row(9).progress).toBeNull();
  });

  // WP-688 — 필터로 에픽이 빠져 합성한 에픽도 서버 집계(WP-243)처럼 취소된 하위를 완료로 센다.
  it('합성 에픽 진행률은 완료·취소 하위를 함께 센다', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 71, parent: parentRef(70, '합성'), dueDate: '2026-10-10', status: 'DONE' }),
        issue({ number: 72, parent: parentRef(70, '합성'), dueDate: '2026-10-12', status: 'CANCELED' }),
        issue({ number: 73, parent: parentRef(70, '합성'), dueDate: '2026-10-14', status: 'IN_PROGRESS' }),
      ],
      TODAY,
      { includeCanceled: true }, // 「취소」 상태 필터 — 취소 하위가 화면에 남는 경우
    );
    const epicRow = s.flatMap((x) => x.rows).find((r) => r.issueNumber === 70)!;
    expect(epicRow.progress).toEqual({ done: 2, total: 3 });
  });

  it('에픽 자체 기간이 있으면 rollup = 하위 실제 범위 막대 + 에픽 기간 안쪽 구간(월 비율)', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 40, title: 'E', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-20' }),
        issue({ number: 41, parent: parentRef(40, 'E'), startDate: '2026-10-11', dueDate: '2026-10-25' }),
      ],
      TODAY,
    );
    const head = s[0].rows[0];
    expect(head.bar!.left).toBe(0);
    expect(head.bar!.right).toBeCloseTo(20 / 31);
    expect(head.rollup!.bar.left).toBeCloseTo(10 / 31);
    expect(head.rollup!.bar.right).toBeCloseTo(25 / 31);
    // 안쪽 = 10/11~10/20, 10/21~10/25 는 초과
    expect(head.rollup!.inside!.left).toBeCloseTo(10 / 31);
    expect(head.rollup!.inside!.right).toBeCloseTo(20 / 31);
  });

  it('하위가 에픽 기간과 겹치지 않으면 inside 는 null, 에픽 자체 기간이 없거나 날짜 있는 하위가 없으면 rollup 은 null', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 40, title: 'E', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-05' }),
        issue({ number: 41, parent: parentRef(40, 'E'), dueDate: '2026-10-20' }),
        issue({ number: 50, title: 'R', type: EPIC_TYPE }),
        issue({ number: 51, parent: parentRef(50, 'R'), dueDate: '2026-10-10' }),
        issue({ number: 70, title: 'U', type: EPIC_TYPE, dueDate: '2026-10-12' }),
        issue({ number: 71, parent: parentRef(70, 'U') }),
      ],
      TODAY,
    );
    const row = (n: number) => s.flatMap((x) => x.rows).find((r) => r.issueNumber === n)!;
    expect(row(40).rollup!.inside).toBeNull();
    expect(row(50).rollup).toBeNull();
    expect(row(70).rollup).toBeNull();
    expect(row(41).rollup).toBeNull();
  });

  it('hasChildren·overflow — 하위 유무와 에픽 기간 초과 여부, 시작일만 있는 에픽은 데스크톱처럼 rollup 없음', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 40, title: 'E', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-20' }),
        issue({ number: 41, parent: parentRef(40, 'E'), startDate: '2026-10-11', dueDate: '2026-10-25' }),
        issue({ number: 50, title: 'F', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-31' }),
        issue({ number: 51, parent: parentRef(50, 'F'), dueDate: '2026-10-10' }),
        issue({ number: 60, title: 'S', type: EPIC_TYPE, startDate: '2026-10-02' }),
        issue({ number: 61, parent: parentRef(60, 'S'), dueDate: '2026-10-09' }),
        issue({ number: 70, title: 'N', type: EPIC_TYPE, dueDate: '2026-10-12' }),
      ],
      TODAY,
    );
    const row = (n: number) => s.flatMap((x) => x.rows).find((r) => r.issueNumber === n)!;
    expect([row(40).hasChildren, row(70).hasChildren, row(41).hasChildren]).toEqual([true, false, false]);
    expect(row(40).rollup).toMatchObject({ span: { start: '2026-10-11', due: '2026-10-25' }, overflow: true });
    expect(row(50).rollup!.overflow).toBe(false);
    expect(row(60).rollup).toBeNull();
  });

  it('뒤집힌 하위 구간(시작 > 마감)도 rollup 안쪽 구간을 계산한다', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 40, title: 'E', type: EPIC_TYPE, startDate: '2026-10-01', dueDate: '2026-10-20' }),
        issue({ number: 41, parent: parentRef(40, 'E'), startDate: '2026-10-15', dueDate: '2026-10-05' }),
      ],
      TODAY,
    );
    expect(s[0].rows[0].rollup!.inside).not.toBeNull();
  });

  it('빈 입력은 빈 배열', () => {
    expect(buildAgendaSections([], TODAY)).toEqual([]);
  });
});

describe('parsePeriodParam / periodParamToString (WP-247)', () => {
  it.each([
    [null, { kind: 'active' }],
    ['active', { kind: 'active' }],
    ['cycle-7', { kind: 'cycle', id: 7 }],
    ['quarter', { kind: 'quarter' }],
    ['rolling', { kind: 'rolling' }],
    ['range:2026-10-01~2026-10-20', { kind: 'range', from: '2026-10-01', to: '2026-10-20' }],
    ['range:2026-10-20~2026-10-01', { kind: 'range', from: '2026-10-01', to: '2026-10-20' }], // 뒤집힘 → 바로잡기
    ['all', { kind: 'all' }],
    ['range:2026-13-01~x', { kind: 'active' }], // 형식 오류
    ['cycle-abc', { kind: 'active' }],
    ['bogus', { kind: 'active' }],
  ])('%s → %o', (raw, expected) => {
    expect(parsePeriodParam(raw)).toEqual(expected);
  });

  it('active 는 URL 에서 빠지고 나머지는 왕복한다', () => {
    expect(periodParamToString({ kind: 'active' })).toBeNull();
    for (const s of ['cycle-7', 'quarter', 'rolling', 'range:2026-10-01~2026-10-20', 'all']) {
      expect(periodParamToString(parsePeriodParam(s))).toBe(s);
    }
  });
});

describe('resolvePeriod (WP-247)', () => {
  const TODAY_P = new Date(2026, 9, 5); // 2026-10-05 로컬
  const gw1 = cycle({ id: 1, name: 'GW-1', status: 'COMPLETED', startDate: '2026-09-17', endDate: '2026-09-30' });
  const gw2 = cycle({ id: 2, name: 'GW-2', status: 'ACTIVE', startDate: '2026-10-01', endDate: '2026-10-14' });
  const gw3 = cycle({ id: 3, name: 'GW-3', status: 'PLANNED', startDate: '2026-10-15', endDate: '2026-10-28' });

  it('활성 사이클 하나 — 그 기간과 이름', () => {
    expect(resolvePeriod({ kind: 'active' }, [gw1, gw2, gw3], TODAY_P)).toEqual({
      from: '2026-10-01', to: '2026-10-14', label: 'GW-2 · 10/1–10/14', fallbackNote: null,
    });
  });

  it('활성 사이클 여럿 — 합친 기간', () => {
    const other = cycle({ id: 4, name: 'B팀', status: 'ACTIVE', startDate: '2026-09-28', endDate: '2026-10-10' });
    expect(resolvePeriod({ kind: 'active' }, [gw2, other], TODAY_P)).toEqual({
      from: '2026-09-28', to: '2026-10-14', label: '활성 사이클 2개 · 9/28–10/14', fallbackNote: null,
    });
  });

  it('날짜 없는 활성 사이클은 없는 것으로 보고 가장 가까운 예정 사이클로 대체', () => {
    const undated = cycle({ id: 5, name: '날짜 없음', status: 'ACTIVE' });
    const later = cycle({ id: 6, name: 'GW-4', status: 'PLANNED', startDate: '2026-11-01', endDate: '2026-11-14' });
    expect(resolvePeriod({ kind: 'active' }, [undated, later, gw3], TODAY_P)).toEqual({
      from: '2026-10-15', to: '2026-10-28', label: 'GW-3 (예정) · 10/15–10/28',
      fallbackNote: '활성 사이클이 없어 가장 가까운 예정 사이클로 봅니다',
    });
  });

  it('오늘 이후 예정 사이클이 없으면 시작일이 오늘에 가장 가까운 예정 사이클', () => {
    const past = cycle({ id: 7, name: '지난 계획', status: 'PLANNED', startDate: '2026-09-20', endDate: '2026-10-03' });
    const older = cycle({ id: 8, name: '더 지난 계획', status: 'PLANNED', startDate: '2026-08-01', endDate: '2026-08-14' });
    expect(resolvePeriod({ kind: 'active' }, [older, past], TODAY_P)?.from).toBe('2026-09-20');
  });

  it('활성·예정 사이클이 없으면 최근 3개월 ~ 향후 6개월', () => {
    expect(resolvePeriod({ kind: 'active' }, [gw1], TODAY_P)).toEqual({
      from: '2026-07-05', to: '2027-04-05', label: '최근 3개월 ~ 향후 6개월',
      fallbackNote: '활성·예정 사이클이 없어 최근 3개월 ~ 향후 6개월로 봅니다',
    });
  });

  it('지정 사이클 — 그 기간, 없거나 날짜가 비면 활성 규칙으로 대체하고 알린다', () => {
    expect(resolvePeriod({ kind: 'cycle', id: 1 }, [gw1, gw2], TODAY_P)).toEqual({
      from: '2026-09-17', to: '2026-09-30', label: 'GW-1 · 9/17–9/30', fallbackNote: null,
    });
    expect(resolvePeriod({ kind: 'cycle', id: 99 }, [gw1, gw2], TODAY_P)).toEqual({
      from: '2026-10-01', to: '2026-10-14', label: 'GW-2 · 10/1–10/14',
      fallbackNote: '선택한 사이클을 찾을 수 없거나 날짜가 없어 활성 사이클 기준으로 봅니다',
    });
  });

  it('이번 분기·직접 지정·전체', () => {
    expect(resolvePeriod({ kind: 'quarter' }, [], TODAY_P)).toEqual({
      from: '2026-10-01', to: '2026-12-31', label: '이번 분기 · 10/1–12/31', fallbackNote: null,
    });
    expect(resolvePeriod({ kind: 'range', from: '2026-10-03', to: '2026-11-02' }, [], TODAY_P)).toEqual({
      from: '2026-10-03', to: '2026-11-02', label: '10/3–11/2', fallbackNote: null,
    });
    expect(resolvePeriod({ kind: 'rolling' }, [], TODAY_P)?.label).toBe('최근 3개월 ~ 향후 6개월');
    expect(resolvePeriod({ kind: 'all' }, [gw2], TODAY_P)).toBeNull();
  });

  it('사이클 조회 실패면 active·cycle 은 rolling 으로 대체하고 이유를 알린다 — 사이클이 필요 없는 기간은 그대로', () => {
    const note = '사이클을 불러오지 못해 최근 3개월 ~ 향후 6개월로 봅니다';
    expect(resolvePeriod({ kind: 'active' }, [], TODAY_P, { cyclesFailed: true })).toEqual({
      from: '2026-07-05', to: '2027-04-05', label: '최근 3개월 ~ 향후 6개월', fallbackNote: note,
    });
    expect(resolvePeriod({ kind: 'cycle', id: 2 }, [gw2], TODAY_P, { cyclesFailed: true })?.fallbackNote).toBe(note);
    expect(resolvePeriod({ kind: 'quarter' }, [], TODAY_P, { cyclesFailed: true })?.fallbackNote).toBeNull();
    expect(resolvePeriod({ kind: 'all' }, [], TODAY_P, { cyclesFailed: true })).toBeNull();
  });

  it('연도가 오늘과 다르면 기간 문구에 연도를 붙인다', () => {
    expect(formatPeriodSpan('2025-12-01', '2026-01-14', TODAY_P)).toBe('2025/12/1–2026/1/14');
    expect(formatPeriodSpan('2026-10-01', '2026-10-14', TODAY_P)).toBe('10/1–10/14');
  });
});

describe('prepareTimelineIssues — 조회 기간 (WP-247)', () => {
  const P = { from: '2026-10-01', to: '2026-10-14', label: 'GW-2', fallbackNote: null };
  const nums = (xs: { number: number }[]) => xs.map((x) => x.number).sort((a, b) => a - b);

  it('에픽 자체 기간이 겹치면 하위 전부(기간 밖 하위 포함)와 함께 보인다', () => {
    const r = prepareTimelineIssues(
      [
        issue({ number: 40, type: EPIC_TYPE, startDate: '2026-09-20', dueDate: '2026-10-03' }),
        issue({ number: 41, parent: parentRef(40, 'E'), startDate: '2026-09-01', dueDate: '2026-09-05' }),
        issue({ number: 42, parent: parentRef(40, 'E') }),
      ],
      { period: P },
    );
    expect(nums(r)).toEqual([40, 41, 42]);
  });

  it('에픽 기간은 밖이어도 하위 실제 범위가 겹치면 보인다(일정 초과)', () => {
    const r = prepareTimelineIssues(
      [
        issue({ number: 40, type: EPIC_TYPE, startDate: '2026-09-01', dueDate: '2026-09-20' }),
        issue({ number: 41, parent: parentRef(40, 'E'), startDate: '2026-09-15', dueDate: '2026-10-02' }),
      ],
      { period: P },
    );
    expect(nums(r)).toEqual([40, 41]);
  });

  it('겹치지 않는 에픽은 하위와 함께 빠지고, 에픽 없는 이슈는 자기 구간으로 판정한다', () => {
    const r = prepareTimelineIssues(
      [
        issue({ number: 40, type: EPIC_TYPE, startDate: '2026-08-01', dueDate: '2026-08-20' }),
        issue({ number: 41, parent: parentRef(40, 'E'), dueDate: '2026-08-10' }),
        issue({ number: 1, dueDate: '2026-10-14' }), // 끝날 = 기간 끝 → 포함
        issue({ number: 2, startDate: '2026-10-15', dueDate: '2026-10-20' }), // 기간 다음날 시작 → 제외
        issue({ number: 3, startDate: '2026-09-30' }), // 시작일만 — 마감일이 없어 간트에선 「일정 미정」 → 기간과 무관하게 남김
        issue({ number: 4, startDate: '2026-09-01', dueDate: '2026-12-01' }), // 기간을 감쌈 → 포함
      ],
      { period: P },
    );
    expect(nums(r)).toEqual([1, 3, 4]);
  });

  it('날짜 없는 에픽·이슈는 기간과 무관하게 남는다(일정 미정)', () => {
    const r = prepareTimelineIssues(
      [issue({ number: 40, type: EPIC_TYPE }), issue({ number: 41, parent: parentRef(40, 'E') }), issue({ number: 5 })],
      { period: P },
    );
    expect(nums(r)).toEqual([5, 40, 41]);
  });

  it('에픽 기간은 간트 막대와 같은 정의 — 시작일만 있는 에픽은 하위 범위로 판정하고, 하위 날짜도 없으면 남긴다', () => {
    const r = prepareTimelineIssues(
      [
        issue({ number: 40, type: EPIC_TYPE, startDate: '2026-10-03' }), // 막대 없음 → 남김
        issue({ number: 50, type: EPIC_TYPE, startDate: '2026-10-03' }), // 시작일은 기간 안이지만 막대 = 하위 롤업(8월)
        issue({ number: 51, parent: parentRef(50, 'F'), dueDate: '2026-08-05' }),
      ],
      { period: P },
    );
    expect(nums(r)).toEqual([40]);
  });

  it('응답에 에픽이 없는 하위 묶음(합성 그룹)은 하위 범위로 판정한다', () => {
    const r = prepareTimelineIssues(
      [
        issue({ number: 41, parent: parentRef(40, 'E'), dueDate: '2026-10-05' }),
        issue({ number: 51, parent: parentRef(50, 'F'), dueDate: '2026-08-05' }),
      ],
      { period: P },
    );
    expect(nums(r)).toEqual([41]);
  });

  it('취소 에픽에서 옮겨진 하위는 자기 구간으로 판정한다', () => {
    const r = prepareTimelineIssues(
      [
        issue({ number: 70, title: '취소 에픽', type: EPIC_TYPE, status: 'CANCELED', startDate: '2026-10-01', dueDate: '2026-10-10' }),
        issue({ number: 71, parent: parentRef(70, '취소 에픽'), dueDate: '2026-08-01' }),
        issue({ number: 72, parent: parentRef(70, '취소 에픽'), dueDate: '2026-10-02' }),
      ],
      { period: P },
    );
    expect(r.map((i) => [i.number, i.parent, i.formerEpicTitle])).toEqual([[72, null, '취소 에픽']]);
  });

  it('마감일 없는 단독 이슈는 시작일이 기간 밖이어도 남는다 — 간트에선 막대 없이 「일정 미정」', () => {
    const xs = [issue({ number: 3, startDate: '2026-11-20' }), issue({ number: 4, startDate: '2026-11-20', dueDate: '2026-11-25' })];
    expect(nums(prepareTimelineIssues(xs, { period: P }))).toEqual([3]);
    // 간트에서도 일정 미정 섹션으로 간다.
    expect(groupTimelineIssues(xs, { period: P }).unscheduled.map((i) => i.number)).toEqual([3]);
  });

  it('에픽 판정의 하위 범위는 마감일 있는 하위만(간트 rollupRange) — 시작일만 있는 하위는 넣지 않는다', () => {
    const r = prepareTimelineIssues(
      [
        // 에픽 60: 자체 기간 없음. 하위 61 은 시작일만(기간 안), 62 는 8월 마감 → 막대 = 8월 → 빠진다.
        issue({ number: 60, type: EPIC_TYPE }),
        issue({ number: 61, parent: parentRef(60, 'G'), startDate: '2026-10-05' }),
        issue({ number: 62, parent: parentRef(60, 'G'), dueDate: '2026-08-05' }),
        // 에픽 65: 자체 기간 없음 + 하위가 시작일만 → 간트 막대 없음 → 일정 미정처럼 남긴다.
        issue({ number: 65, type: EPIC_TYPE }),
        issue({ number: 66, parent: parentRef(65, 'H'), startDate: '2026-12-01' }),
      ],
      { period: P },
    );
    expect(nums(r)).toEqual([65, 66]);
    // 간트 막대(range)와 거름 판정이 같다 — 에픽 60 의 막대는 8월 하루.
    const g = groupTimelineIssues([issue({ number: 60, type: EPIC_TYPE }), issue({ number: 62, parent: parentRef(60, 'G'), dueDate: '2026-08-05' })]);
    expect(g.groups[0].range).toEqual({ start: '2026-08-05', due: '2026-08-05' });
  });

  it('취소 에픽의 완료·취소 하위 — 「취소」 필터면 취소 에픽 아래 하위로 남고, 아니면 숨는다. 남은 일은 늘 「에픽 없음」', () => {
    const xs = [
      issue({ number: 70, title: '취소 에픽', type: EPIC_TYPE, status: 'CANCELED', startDate: '2026-10-01', dueDate: '2026-10-10' }),
      issue({ number: 71, parent: parentRef(70, '취소 에픽'), status: 'DONE', dueDate: '2026-10-03' }),
      issue({ number: 72, parent: parentRef(70, '취소 에픽'), status: 'CANCELED', dueDate: '2026-10-04' }),
      issue({ number: 73, parent: parentRef(70, '취소 에픽'), status: 'TODO', dueDate: '2026-10-05' }),
    ];
    expect(prepareTimelineIssues(xs).map((i) => [i.number, i.parent?.number ?? null])).toEqual([[73, null]]);
    const withCanceled = prepareTimelineIssues(xs, { includeCanceled: true, period: P });
    expect(withCanceled.map((i) => [i.number, i.parent?.number ?? null])).toEqual([[70, null], [71, 70], [72, 70], [73, null]]);
    // 간트에선 취소 에픽 그룹 아래 완료·취소 하위 막대.
    const epic = groupTimelineIssues(xs, { includeCanceled: true }).groups.find((g) => g.epicNumber === 70)!;
    expect(epic.bars.map((b) => b.issueNumber)).toEqual([71, 72]);
  });

  it('응답에 없는 취소 에픽 — parent.status 로 판단해 남은 일은 「에픽 없음」(← 부모 제목), 완료·취소 하위는 「취소」 필터일 때만 합성 묶음에 남는다', () => {
    // 담당자·라벨 등 필터로 취소 에픽 70 자체는 응답에 없고 하위만 왔다.
    const xs = [
      issue({ number: 71, parent: parentRef(70, '빠진 취소 에픽', 'CANCELED'), status: 'IN_PROGRESS', dueDate: '2026-10-03' }),
      issue({ number: 72, parent: parentRef(70, '빠진 취소 에픽', 'CANCELED'), status: 'DONE', dueDate: '2026-10-04' }),
      issue({ number: 73, parent: parentRef(70, '빠진 취소 에픽', 'CANCELED'), status: 'CANCELED', dueDate: '2026-10-05' }),
    ];
    expect(prepareTimelineIssues(xs).map((i) => [i.number, i.parent, i.formerEpicTitle])).toEqual([[71, null, '빠진 취소 에픽']]);
    // 간트에서도 「에픽 없음」 그룹의 막대로 옮겨진다.
    const { groups } = groupTimelineIssues(xs);
    expect(groups.map((g) => g.key)).toEqual(['no-epic']);
    expect(groups[0].bars).toEqual([expect.objectContaining({ issueNumber: 71, formerEpicTitle: '빠진 취소 에픽' })]);
    // 「취소」 필터면 완료·취소 하위는 부모 요약으로 합성한 취소 에픽 묶음 아래 그대로 남는다.
    const withCanceled = prepareTimelineIssues(xs, { includeCanceled: true });
    expect(withCanceled.map((i) => [i.number, i.parent?.number ?? null])).toEqual([[71, null], [72, 70], [73, 70]]);
  });

  it('응답에 없는 에픽이 취소가 아니면(parent.status TODO·상태 없음) 하위는 그 에픽 묶음에 남는다', () => {
    const r = prepareTimelineIssues([
      issue({ number: 81, parent: parentRef(80, '열린 에픽', 'TODO'), status: 'TODO' }),
      issue({ number: 82, parent: parentRef(80, '열린 에픽'), status: 'DONE' }),
    ]);
    expect(r.map((i) => [i.number, i.parent?.number ?? null, i.formerEpicTitle])).toEqual([[81, 80, undefined], [82, 80, undefined]]);
  });

  it('period 가 없으면 거르지 않는다', () => {
    const xs = [issue({ number: 1, dueDate: '2020-01-01' })];
    expect(nums(prepareTimelineIssues(xs))).toEqual([1]);
    expect(nums(prepareTimelineIssues(xs, { period: null }))).toEqual([1]);
  });
});

describe('initialScrollDate (WP-486)', () => {
  const TODAY = new Date(2026, 9, 19); // 2026-10-19(로컬)
  const period = (from: string, to: string) => ({ from, to, label: '', fallbackNote: null });

  it('기간이 없으면(전체) 오늘 −7일', () => {
    expect(initialScrollDate(null, TODAY)).toBe('2026-10-12');
  });
  it('오늘을 포함한 긴 기간이면 오늘 −7일', () => {
    expect(initialScrollDate(period('2026-07-19', '2027-04-19'), TODAY)).toBe('2026-10-12');
  });
  it('오늘 직전에 시작한 기간이면 기간 시작', () => {
    expect(initialScrollDate(period('2026-10-16', '2026-10-29'), TODAY)).toBe('2026-10-16');
  });
  it('오늘을 포함하지 않는 기간이면 기간 시작', () => {
    expect(initialScrollDate(period('2026-11-01', '2026-11-14'), TODAY)).toBe('2026-11-01');
    expect(initialScrollDate(period('2026-07-01', '2026-07-14'), TODAY)).toBe('2026-07-01');
  });
});

// WP-595 — 아주 긴 이슈 하나가 간트 축을 200년으로 늘리지 않게 조회 기간 앞뒤로 자른다.
describe('ganttAxisBounds', () => {
  const d = (s: string) => new Date(`${s}T00:00:00`);
  const today = d('2026-10-20');
  const period = { from: '2026-07-20', to: '2027-04-20' };

  it('막대 범위가 조회 기간 앞뒤 12개월 안이면 null(SVAR 자동 범위 그대로)', () => {
    expect(ganttAxisBounds(d('2026-01-01'), d('2027-12-31'), period, today)).toBeNull();
  });

  it('넘으면 조회 기간 앞뒤 12개월로 자르고 월 경계에 맞춘다', () => {
    expect(ganttAxisBounds(d('1900-01-01'), d('2100-01-01'), period, today)).toEqual({
      start: d('2025-07-01'),
      end: d('2028-05-01'),
    });
  });

  it('한쪽만 넘으면 그쪽만 자른다(안쪽 끝도 월 경계로)', () => {
    expect(ganttAxisBounds(d('2026-09-10'), d('9999-12-31'), period, today)).toEqual({
      start: d('2026-09-01'),
      end: d('2028-05-01'),
    });
  });

  it('기간 「전체」(null)면 오늘 앞뒤 5년이 기준', () => {
    expect(ganttAxisBounds(d('2024-01-01'), d('2027-01-01'), null, today)).toBeNull();
    expect(ganttAxisBounds(d('1900-01-01'), d('2099-12-31'), null, today)).toEqual({
      start: d('2021-10-01'),
      end: d('2031-11-01'),
    });
  });

  it('막대가 없으면 null', () => {
    expect(ganttAxisBounds(null, null, period, today)).toBeNull();
  });
});

// WP-605 — 주 보기 위쪽 월 칸을 주 경계에 맞춘 「주 단위 달」로 그린다. 한 주는 그 달이 4일 이상 차지하는 달(주 시작+3일의 달) 소속.
describe('주 단위 달(weekMonth)', () => {
  const d = (s: string) => parseISO(s)
  const ymd = (x: Date) => format(x, 'yyyy-MM-dd')

  it('목요일에 시작하는 달 — 1일이 든 주는 앞달 소속, 경계는 4일이 든 주의 일요일', () => {
    // 2026-10-01 은 목요일: 9/27~10/3 주는 10월이 3일뿐이라 9월
    expect(ymd(weekMonthOf(d('2026-10-01')))).toBe('2026-09-01')
    expect(ymd(weekMonthStart(d('2026-10-01')))).toBe('2026-08-30')
    expect(ymd(weekMonthOf(d('2026-10-20')))).toBe('2026-10-01')
    expect(ymd(weekMonthStart(d('2026-10-20')))).toBe('2026-10-04')
  })

  it('일·월·금요일에 시작하는 달의 경계', () => {
    expect(ymd(weekMonthStart(d('2026-11-01')))).toBe('2026-11-01') // 일요일 시작 — 그날이 경계
    expect(ymd(weekMonthStart(d('2026-06-01')))).toBe('2026-05-31') // 월요일 시작 — 6월이 6일 차지
    expect(ymd(weekMonthOf(d('2026-05-31')))).toBe('2026-06-01')
    expect(ymd(weekMonthOf(d('2026-05-02')))).toBe('2026-04-01') // 금요일 시작 — 4/26~5/2 주는 4월
    expect(ymd(weekMonthStart(d('2026-05-03')))).toBe('2026-05-03')
  })

  it('12월→1월 경계와 더하기·끝·차이', () => {
    expect(ymd(weekMonthOf(d('2027-01-01')))).toBe('2026-12-01')
    expect(ymd(weekMonthAdd(d('2026-11-29'), 1))).toBe('2027-01-03')
    // 달 중간에서 더하면 달 시작에서 떨어진 거리를 유지 — 월말에 「다음 경계」가 주보다 가까워 보이지 않게
    expect(ymd(weekMonthAdd(d('2026-10-30'), 1))).toBe('2026-11-27')
    expect(weekMonthAdd(d('2026-10-30'), 1).getTime()).toBeGreaterThan(addDays(d('2026-10-30'), 7).getTime())
    expect(weekMonthEnd(d('2026-10-20')).getTime()).toBe(d('2026-11-01').getTime() - 1)
    expect(weekMonthEnd(d('2026-10-04')).getTime()).toBe(d('2026-11-01').getTime() - 1)
    expect(weekMonthDiff(d('2027-01-10'), d('2026-10-20'))).toBe(3)
    expect(weeksInWeekMonth(d('2026-10-20'))).toBe(4) // 10/4~10/31
    expect(weeksInWeekMonth(d('2026-08-30'))).toBe(5) // 8/30~10/3 (9월)
  })

  it('60개월 — 달마다 한 칸, 빈틈·겹침 없이 일요일 경계로 이어진다', () => {
    let cur = weekMonthStart(d('2024-01-15'))
    let weeks = 0
    const first = cur
    for (let i = 0; i < 60; i++) {
      const next = weekMonthAdd(cur, 1)
      expect(cur.getDay()).toBe(0)
      expect(ymd(weekMonthOf(cur))).toBe(format(addMonths(d('2024-01-01'), i), 'yyyy-MM-dd'))
      expect([28, 35]).toContain(differenceInCalendarDays(next, cur))
      expect(weekMonthStart(addDays(next, -1)).getTime()).toBe(cur.getTime())
      weeks += weeksInWeekMonth(cur)
      cur = next
    }
    expect(weeks * 7).toBe(differenceInCalendarDays(cur, first))
  })
})

describe('일 보기(WP-889)', () => {
  it('저장해 둔 보기 단위를 읽고, 없거나 모르는 값이면 주 보기', () => {
    expect(parseTimelineZoom('day')).toBe('day');
    expect(parseTimelineZoom('month')).toBe('month');
    expect(parseTimelineZoom(null)).toBe('week');
    expect(parseTimelineZoom('year')).toBe('week');
  });

  it('날짜 칸 라벨은 「날짜 요일」, 주말은 토·일만', () => {
    expect(dayCellLabel(parseISO('2026-07-08'))).toBe('8 수');
    expect(dayCellLabel(parseISO('2026-07-12'))).toBe('12 일');
    expect(isWeekend(parseISO('2026-07-11'))).toBe(true);
    expect(isWeekend(parseISO('2026-07-12'))).toBe(true);
    expect(isWeekend(parseISO('2026-07-13'))).toBe(false);
  });
});

// WP-888: 버전 출시일 ▲ 마커 — 출시일이 있는 미출시·출시됨만, 날짜순.
describe('versionsToMarkers', () => {
  const v = (id: number, name: string, status: 'UNRELEASED' | 'RELEASED' | 'ARCHIVED', releaseDate: string | null) => ({
    id,
    name,
    status,
    releaseDate,
  });

  it('날짜 없는 버전과 보관된 버전은 뺀다', () => {
    const markers = versionsToMarkers([
      v(1, '날짜 없음', 'UNRELEASED', null),
      v(2, '보관', 'ARCHIVED', '2026-01-10'),
      v(3, '출시됨', 'RELEASED', '2026-03-01'),
      v(4, '미출시', 'UNRELEASED', '2026-02-01'),
    ]);
    expect(markers).toEqual([
      { id: 4, name: '미출시', date: '2026-02-01', status: 'UNRELEASED' },
      { id: 3, name: '출시됨', date: '2026-03-01', status: 'RELEASED' },
    ]);
  });

  it('표시할 버전이 없으면 빈 배열(레인을 그리지 않는다)', () => {
    expect(versionsToMarkers([])).toEqual([]);
    expect(versionsToMarkers([v(1, 'x', 'ARCHIVED', '2026-01-01'), v(2, 'y', 'UNRELEASED', null)])).toEqual([]);
  });
});

describe('groupLaneChipsByDate (WP-1027)', () => {
  it('같은 날짜는 한 묶음으로, 순서는 입력(날짜순) 그대로 둔다', () => {
    const items = [
      { id: 1, date: '2026-10-20' },
      { id: 2, date: '2026-10-27' },
      { id: 3, date: '2026-10-27' },
      { id: 4, date: '2026-10-28' },
    ];
    expect(groupLaneChipsByDate(items, (i) => i.date)).toEqual([
      { date: '2026-10-20', items: [items[0]] },
      { date: '2026-10-27', items: [items[1], items[2]] },
      { date: '2026-10-28', items: [items[3]] },
    ]);
  });

  it('빈 목록은 빈 묶음', () => {
    expect(groupLaneChipsByDate([], () => '')).toEqual([]);
  });
});

describe('모바일 버전 시트 (WP-1070)', () => {
  const v = (id: number, date: string, status: 'RELEASED' | 'UNRELEASED') => ({ id, name: `v${id}`, date, status });

  it('예정(미출시)은 가까운 날짜부터, 출시됨은 최신부터 — 입력은 날짜 오름차순', () => {
    const { upcoming, released } = versionSheetSections([
      v(1, '2026-10-01', 'RELEASED'),
      v(2, '2026-10-10', 'UNRELEASED'),
      v(3, '2026-10-12', 'RELEASED'),
      v(4, '2026-10-12', 'RELEASED'),
      v(5, '2026-11-01', 'UNRELEASED'),
    ]);
    expect(upcoming.map((x) => x.id)).toEqual([2, 5]);
    expect(released.map((x) => x.id)).toEqual([4, 3, 1]);
  });

  it('날짜 — 오늘·어제는 말로, 그 밖은 월·일(올해가 아니면 연도까지)', () => {
    const now = new Date(2026, 9, 15, 12);
    expect(versionSheetDateLabel('2026-10-15', now)).toBe('오늘');
    expect(versionSheetDateLabel('2026-10-14', now)).toBe('어제');
    expect(versionSheetDateLabel('2026-10-13', now)).toBe('10월 13일');
    expect(versionSheetDateLabel('2026-11-01', now)).toBe('11월 1일');
    expect(versionSheetDateLabel('2025-12-31', now)).toBe('2025년 12월 31일');
  });
});

describe('clusterLaneGroups (WP-1047)', () => {
  // 운영처럼 매일 나간 릴리스 — 10/18·10/27 은 같은 날 여럿, 10/19·10/24 는 없다.
  const dates = ['10-17', '10-18', '10-18', '10-20', '10-21', '10-22', '10-23', '10-25', '10-26', '10-27', '10-27', '10-28'];
  const groups = groupLaneChipsByDate(
    dates.map((d, i) => ({ id: i + 1, date: `2026-${d}` })),
    (item) => item.date,
  );
  const ranges = (pxPerDay: number) =>
    clusterLaneGroups(groups, pxPerDay, 96).map((c) => `${c.firstDate.slice(5)}~${c.date.slice(5)}`);

  it('일 보기(하루 44px)에서는 묶음 범위가 칩 폭을 넘지 않게 2~3일씩 끊는다 — 매일 릴리스가 칩 하나로 뭉치지 않는다', () => {
    expect(ranges(44)).toEqual(['10-17~10-18', '10-20~10-22', '10-23~10-25', '10-26~10-28']);
  });

  it('주 보기(하루 약 14px)에서는 칩이 서는 날짜끼리도 가까워 한 묶음으로 합친다', () => {
    expect(ranges(100 / 7)).toEqual(['10-17~10-28']);
  });

  // 다음 릴리스가 몇 주 뒤면, 가까운 앞 칩과 붙은 끝 묶음이 그 먼 날짜까지 받아 칩이 먼 날짜에 섰다 — 앞 묶음에 합쳐야 한다.
  it('다음 날짜가 멀면 앞 칩과 가까운 묶음은 먼 날짜를 받지 않고 앞 묶음에 합친다', () => {
    const withFar = groupLaneChipsByDate(
      [...dates, '11-20'].map((d, i) => ({ id: i + 1, date: `2026-${d}` })),
      (item) => item.date,
    );
    const at = clusterLaneGroups(withFar, 100 / 7, 96).map((c) => `${c.firstDate.slice(5)}~${c.date.slice(5)}`);
    expect(at).toEqual(['10-17~10-28', '11-20~11-20']);
  });

  it('칩이 서는 날짜(묶음의 가장 늦은 날짜)끼리는 늘 칩 폭 이상 떨어진다 — 밀어내기 없이 제자리에 선다', () => {
    for (const pxPerDay of [44, 30, 20, 100 / 7, 100 / 30]) {
      const anchors = clusterLaneGroups(groups, pxPerDay, 96).map((c) => Date.parse(c.date) / 86_400_000);
      anchors.slice(1).forEach((day, k) => expect((day - anchors[k]) * pxPerDay).toBeGreaterThanOrEqual(96));
    }
  });

  it('묶음은 항목을 날짜순으로 모두 담는다 — 마지막이 칩 이름(가장 최신)이다', () => {
    const [week] = clusterLaneGroups(groups, 100 / 7, 96);
    expect(week.items.map((item) => item.id)).toEqual(dates.map((_, i) => i + 1));
  });

  // 리뷰 지적 — 칩 날짜를 직전 칩 날짜와만 비교해 합치면 고르지 않은 날짜에서 합치기가 끝없이 이어져 일 보기에서도 몇 주가 칩 하나가 됐다.
  it('고르지 않은 날짜에서도 묶음이 끝없이 이어지지 않고, 칩 날짜끼리는 칩 폭 이상 떨어진다', () => {
    // 하루 1px 로 두면 날짜 차가 곧 px — 0·90·100·180·196·260·400·480 일.
    const at = [0, 90, 100, 180, 196, 260, 400, 480].map((d, i) => ({ id: i + 1, date: format(addDays(parseISO('2026-01-01'), d), 'yyyy-MM-dd') }));
    const clusters = clusterLaneGroups(groupLaneChipsByDate(at, (item) => item.date), 1, 96);
    expect(clusters.map((c) => c.items.map((item) => item.id))).toEqual([[1, 2], [3, 4, 5], [6, 7, 8]]);
    const anchors = clusters.map((c) => parseISO(c.date).getTime() / 86_400_000);
    anchors.slice(1).forEach((day, k) => expect(day - anchors[k]).toBeGreaterThanOrEqual(96));
  });
});

describe('laneGroupLabelParts (WP-1027)', () => {
  it('하나는 이름만, 여럿은 늘 마지막 이름과 나머지 개수', () => {
    expect(laneGroupLabelParts(['v0.9.23'])).toEqual({ name: 'v0.9.23', rest: '' });
    expect(laneGroupLabelParts(['v0.9.23', 'v0.9.25'])).toEqual({ name: 'v0.9.25', rest: '+1' });
    expect(laneGroupLabelParts(['v0.9.23', 'v0.9.24', 'v0.9.25'])).toEqual({ name: 'v0.9.25', rest: '+2' });
  });
});

describe('레인 마커 이름 순서 (WP-1027)', () => {
  it('같은 날 이름은 숫자를 값으로 비교해 v0.9.9 가 v0.9.10 앞에 온다 — 묶음 칩 대표(마지막)가 새 버전이 되게', () => {
    const versions = [
      { id: 1, name: 'v0.9.10', releaseDate: '2026-10-27', status: 'RELEASED' as const },
      { id: 2, name: 'v0.9.9', releaseDate: '2026-10-27', status: 'RELEASED' as const },
    ];
    expect(versionsToMarkers(versions).map((v) => v.name)).toEqual(['v0.9.9', 'v0.9.10']);
  });

  it('마일스톤도 마감일 → 이름(숫자 값) → id 순으로 준다', () => {
    const m = (id: number, name: string, dueDate: string): MilestoneResponse => ({ id, projectId: 1, name, dueDate, description: null, createdAt: '', updatedAt: '' });
    expect(milestonesToMarkers([m(1, '2차 점검', '2026-08-02'), m(2, '10차 점검', '2026-08-01'), m(3, '9차 점검', '2026-08-01')]).map((x) => x.id)).toEqual([3, 2, 1]);
  });
});

// WP-1039 다른 프로젝트 에픽 부모 — 같은 번호의 이 프로젝트 에픽과 합치지 않고 (키, 번호) 묶음으로, 제목에 키를 붙인다.
describe('타임라인 — 다른 프로젝트 에픽 묶음 (WP-1039)', () => {
  const crossRef = (number: number, title: string, projectKey: string, status?: IssueStatus) => ({ ...parentRef(number, title, status), projectKey });

  it('간트: 이 프로젝트 에픽 #40 과 PLAN-40 하위를 따로 묶고, 다른 프로젝트 묶음은 뒤에 키와 함께 둔다', () => {
    const own = issue({ number: 40, title: '이 프로젝트 에픽', type: EPIC_TYPE });
    const ownKid = issue({ number: 41, parent: parentRef(40, '이 프로젝트 에픽'), dueDate: '2026-07-05' });
    const crossKid = issue({ number: 42, parent: crossRef(40, '기획 에픽', 'PLAN'), dueDate: '2026-07-08', status: 'DONE' });
    const crossKid2 = issue({ number: 43, parent: crossRef(40, '기획 에픽', 'PLAN') });
    // 가려진 부모는 묶을 에픽을 알 수 없어 「에픽 없음」으로.
    const hiddenKid = issue({ number: 44, parent: { number: 0, title: null as never, type: null as never, hidden: true }, dueDate: '2026-07-09' });
    const { groups } = groupTimelineIssues([own, ownKid, crossKid, crossKid2, hiddenKid]);
    expect(groups.map((g) => [g.key, g.epicNumber, g.epicProjectKey, g.title])).toEqual([
      ['epic-40', 40, undefined, '이 프로젝트 에픽'],
      ['epic-PLAN-40', 40, 'PLAN', 'PLAN-40 기획 에픽'],
      ['no-epic', null, undefined, '에픽 없음'],
    ]);
    const cross = groups[1];
    expect(cross.bars.map((b) => b.issueNumber)).toEqual([42]);
    expect(cross.undatedChildren.map((i) => i.number)).toEqual([43]);
    // 다른 프로젝트 에픽은 응답에 없어 보이는 하위 기준 진행률.
    expect([cross.done, cross.total]).toEqual([1, 2]);
    expect(groups[0].bars.map((b) => b.issueNumber)).toEqual([41]);
    expect(groups[2].bars.map((b) => b.issueNumber)).toEqual([44]);
  });

  it('조회 기간 거름도 다른 프로젝트 묶음 단위로 — 묶음 롤업이 기간에 걸치면 하위가 함께 남는다', () => {
    const period = { from: '2026-10-01', to: '2026-10-31', label: '10월', fallbackNote: null };
    const kept = prepareTimelineIssues(
      [
        issue({ number: 1, parent: crossRef(7, '기획', 'PLAN'), dueDate: '2026-10-10' }),
        issue({ number: 2, parent: crossRef(7, '기획', 'PLAN') }),
        // 같은 번호의 이 프로젝트 에픽 묶음은 기간 밖이라 빠진다 — 다른 프로젝트 묶음에 끌려 남지 않는다.
        issue({ number: 3, parent: parentRef(7, '이 프로젝트'), dueDate: '2026-08-10' }),
      ],
      { period },
    );
    expect(kept.map((i) => i.number)).toEqual([1, 2]);
  });

  it('취소된 다른 프로젝트 에픽의 할 일 하위는 「에픽 없음」으로 옮기고 원래 에픽 제목을 싣는다', () => {
    const kept = prepareTimelineIssues([issue({ number: 5, parent: crossRef(7, '취소된 기획', 'PLAN', 'CANCELED') })]);
    expect(kept[0]).toMatchObject({ number: 5, parent: null, formerEpicTitle: '취소된 기획' });
  });

  it('아젠다: 다른 프로젝트 에픽 머리 행은 projectKey·묶음 키를 싣고, 하위는 그 묶음 키로 접힌다', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 40, title: '이 프로젝트', type: EPIC_TYPE, dueDate: '2026-10-20' }),
        issue({ number: 41, parent: parentRef(40, '이 프로젝트'), dueDate: '2026-10-05' }),
        issue({ number: 42, parent: crossRef(40, '기획 에픽', 'PLAN'), dueDate: '2026-10-08' }),
      ],
      new Date(2026, 9, 15),
    );
    const rows = s.flatMap((x) => x.rows).map((r) => [r.kind, r.issueNumber, r.groupKey, r.projectKey, r.title]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ['epic', 40, 'epic-40', undefined, '이 프로젝트'],
        ['child', 41, 'epic-40', undefined, '이슈'],
        ['epic', 40, 'epic-PLAN-40', 'PLAN', 'PLAN-40 기획 에픽'],
        ['child', 42, 'epic-PLAN-40', undefined, '이슈'],
      ]),
    );
    expect(rows).toHaveLength(4);
  });
});
