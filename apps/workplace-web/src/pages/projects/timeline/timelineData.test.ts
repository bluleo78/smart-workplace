import { describe, expect, it } from 'vitest';

import type { CycleResponse } from '@/types/cycle';
import type { IssueResponse } from '@/types/issue';
import type { IssueTypeSummary } from '@/types/issueType';
import type { MilestoneResponse } from '@/types/milestone';

import {
  type AgendaSection,
  buildAgendaSections,
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

describe('buildAgendaSections', () => {
  const TODAY = new Date(2026, 9, 15); // 2026-10-15(로컬)
  const keys = (s: AgendaSection[]) => s.map((x) => x.key);
  const nums = (s: AgendaSection) => s.rows.map((r) => r.issueNumber);

  it('기준일(시작일 우선, 없으면 마감일)의 월 섹션을 오름차순으로, 기준일 없는 이슈는 맨 아래 「일정 미정」', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 1, startDate: '2026-11-03', dueDate: '2026-11-10' }),
        issue({ number: 2, dueDate: '2026-09-20' }),
        issue({ number: 3 }),
        // 시작일만 — 간트(마감 필수)와 달리 미정이 아니라 시작 월에 둔다(R3).
        issue({ number: 4, startDate: '2026-10-02' }),
      ],
      TODAY,
    );
    expect(keys(s)).toEqual(['2026-09', '2026-10', '2026-11', 'undated']);
    expect(s.map((x) => x.label)).toEqual(['2026년 9월', '2026년 10월', '2026년 11월', '일정 미정']);
    expect(nums(s[1])).toEqual([4]);
    expect(nums(s[3])).toEqual([3]);
    expect(s[3].rows[0].bar).toBeNull();
    expect(s[3].todayRatio).toBeNull();
  });

  it('같은 월 안은 기준일 오름차순, 같으면 번호 오름차순', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 7, startDate: '2026-10-05' }),
        issue({ number: 5, startDate: '2026-10-05' }),
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
        issue({ number: 9, startDate: '2026-10-03' }),
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

  it('SUBTASK·CANCELED·취소된 에픽의 하위는 제외한다(간트와 같은 규칙)', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 1, dueDate: '2026-10-01' }),
        issue({ number: 2, type: SUBTASK_TYPE, dueDate: '2026-10-02' }),
        issue({ number: 3, status: 'CANCELED', dueDate: '2026-10-03' }),
        issue({ number: 70, type: EPIC_TYPE, status: 'CANCELED', dueDate: '2026-10-04' }),
        issue({ number: 71, parent: parentRef(70, '취소 에픽'), dueDate: '2026-10-05' }),
      ],
      TODAY,
    );
    expect(s.flatMap(nums)).toEqual([1]);
  });

  it('막대 = 섹션 월 안 비율, 월 밖은 0/1 로 잘린다(보이는 최소 폭은 컴포넌트 몫)', () => {
    const s = buildAgendaSections(
      [
        issue({ number: 1, startDate: '2026-10-11', dueDate: '2026-10-20' }),
        issue({ number: 2, startDate: '2026-09-25', dueDate: '2026-10-05' }),
        issue({ number: 3, dueDate: '2026-10-31' }),
        issue({ number: 40, type: EPIC_TYPE, startDate: '2026-10-01' }),
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

  it('빈 입력은 빈 배열', () => {
    expect(buildAgendaSections([], TODAY)).toEqual([]);
  });
});
