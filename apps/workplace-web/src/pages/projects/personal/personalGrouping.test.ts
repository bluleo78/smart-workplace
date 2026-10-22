// groupChecklist(WP-412) — 개인 체크리스트 섹션 그룹화 규칙 단위 테스트.
// 개인 프로젝트 E2E 가 화면으로 확인하던 규칙(마감 버킷·완료 접힘·취소 숨김·상태 섹션)을 여기로 옮겼다.
import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '@/types/issue';

import { groupChecklist } from './personalGrouping';

function issue(over: Partial<IssueResponse>): IssueResponse {
  return {
    id: 1,
    projectKey: 'PME',
    number: 1,
    title: 't',
    status: 'TODO',
    statusId: 1,
    statusName: '할 일',
    priority: 'MID',
    dueDate: null,
    startDate: null,
    milestoneId: null,
    reporterId: 1,
    createdAt: '2026-06-20T00:00:00Z',
    updatedAt: '2026-06-20T00:00:00Z',
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
    ...over,
  };
}

// 2026-06-17(수) 로컬 정오 — 이번 주 끝은 06-21(일).
const NOW = new Date(2026, 5, 17, 12);
const titlesBySection = (r: ReturnType<typeof groupChecklist>) =>
  Object.fromEntries(r.sections.map((s) => [s.key, s.items.map((i) => i.title)]));

describe('groupChecklist — 마감 기준(그룹 없음)', () => {
  const items = [
    issue({ number: 1, title: '지난작업', dueDate: '2020-01-01' }),
    issue({ number: 2, title: '오늘작업', dueDate: '2026-06-17' }),
    issue({ number: 3, title: '이번주작업', dueDate: '2026-06-21' }),
    issue({ number: 4, title: '미래작업', dueDate: '2999-12-31' }),
    issue({ number: 5, title: '기한없음' }),
    issue({ number: 6, title: '완료작업', status: 'DONE' }),
    issue({ number: 7, title: '취소작업', status: 'CANCELED' }),
  ];

  it('과거=overdue, 오늘=today, 일요일까지=thisWeek, 그 뒤=upcoming, 없음=noDue 순서로 섹션화한다', () => {
    const r = groupChecklist(items, null, NOW);
    expect(r.sections.map((s) => [s.key, s.label])).toEqual([
      ['overdue', '지남'],
      ['today', '오늘'],
      ['thisWeek', '이번 주'],
      ['upcoming', '예정'],
      ['noDue', '기한 없음'],
    ]);
    expect(titlesBySection(r).overdue).toEqual(['지난작업']);
    expect(titlesBySection(r).noDue).toEqual(['기한없음']);
  });

  it('완료는 접힘 목록(collapsedDone)으로 분리하고, 취소는 어디에도 없다', () => {
    const r = groupChecklist(items, null, NOW);
    expect(r.collapsedDone.map((i) => i.title)).toEqual(['완료작업']);
    const all = [...r.sections.flatMap((s) => s.items), ...r.collapsedDone].map((i) => i.title);
    expect(all).not.toContain('취소작업');
  });

  it('섹션 안은 우선순위(높음→낮음) 후 마감일 오름차순이다', () => {
    const r = groupChecklist(
      [
        issue({ title: 'L', priority: 'LOW', dueDate: '2020-01-01' }),
        issue({ title: 'H2', priority: 'HIGH', dueDate: '2020-01-05' }),
        issue({ title: 'H1', priority: 'HIGH', dueDate: '2020-01-02' }),
      ],
      null,
      NOW,
    );
    expect(titlesBySection(r).overdue).toEqual(['H1', 'H2', 'L']);
  });
});

describe('groupChecklist — 상태·우선순위', () => {
  const items = [
    issue({ title: '할일A', status: 'TODO', priority: 'HIGH', dueDate: '2020-01-01' }),
    issue({ title: '진행B', status: 'IN_PROGRESS', priority: 'LOW' }),
    issue({ title: '완료C', status: 'DONE', priority: 'HIGH' }),
    issue({ title: '취소D', status: 'CANCELED', priority: 'HIGH' }),
  ];

  it('상태 그룹은 TODO/IN_PROGRESS/DONE 평탄 섹션 — 완료도 접지 않고, 취소는 섹션이 없다', () => {
    const r = groupChecklist(items, 'status', NOW);
    expect(titlesBySection(r)).toEqual({ TODO: ['할일A'], IN_PROGRESS: ['진행B'], DONE: ['완료C'] });
    expect(r.collapsedDone).toEqual([]);
  });

  it('우선순위 그룹은 높음/보통/낮음 섹션 — 취소는 빠지고 빈 섹션은 생략한다', () => {
    const r = groupChecklist(items, 'priority', NOW);
    expect(r.sections.map((s) => s.label)).toEqual(['높음', '낮음']);
    expect(titlesBySection(r).HIGH).toHaveLength(2);
  });
});
