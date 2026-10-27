// 타임라인 에픽 색(WP-1017) — 간트 에픽 묶음·모바일 아젠다 에픽 머리 행이 에픽마다 정한 색 토큰을 싣는지.
// 에픽 행이 응답에 있으면 그 epicColor(없으면 유형 색), 필터로 에픽이 빠진 합성 묶음은 하위가 실어 온 부모 요약 색(서버가 에픽 색을 싣는다).
import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '@/types/issue';
import type { IssueTypeSummary } from '@/types/issueType';

import { buildAgendaSections, groupTimelineIssues } from './timelineData';

const EPIC: IssueTypeSummary = { id: 9, name: 'EPIC', colorToken: 'PURPLE', icon: 'Zap' };
const TASK: IssueTypeSummary = { id: 1, name: 'TASK', colorToken: 'BLUE', icon: 'Circle' };

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
    type: TASK,
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

const epicRow = (number: number, epicColor: string | null) =>
  issue({ id: number, number, title: `에픽 ${number}`, type: EPIC, epicColor, dueDate: '2026-07-20' });
const child = (number: number, epicNumber: number, parentColor: string) =>
  issue({
    id: number,
    number,
    title: `하위 ${number}`,
    dueDate: '2026-07-10',
    parent: { number: epicNumber, title: `에픽 ${epicNumber}`, type: { ...EPIC, colorToken: parentColor }, status: 'TODO' },
  });

describe('타임라인 에픽 색 (WP-1017)', () => {
  it('간트 묶음 — 에픽 색, 색이 없으면 유형 색, 에픽 행이 빠진 합성 묶음은 하위의 부모 요약 색', () => {
    const { groups } = groupTimelineIssues([
      epicRow(1, 'ORANGE'),
      child(10, 1, 'ORANGE'),
      epicRow(2, null),
      // 에픽 3 은 응답에 없다(필터) — 하위만으로 묶음을 만든다.
      child(30, 3, 'TEAL'),
      issue({ id: 40, number: 40, dueDate: '2026-07-05' }),
    ]);
    const colorOf = (n: number | null) => groups.find((g) => g.epicNumber === n)?.colorToken;
    expect(colorOf(1)).toBe('ORANGE');
    expect(colorOf(2)).toBe('PURPLE');
    expect(colorOf(3)).toBe('TEAL');
    // 에픽 없음 묶음은 색이 없다(막대도 그리지 않는다).
    expect(colorOf(null)).toBeUndefined();
  });

  it('모바일 아젠다 — 에픽 머리 행만 에픽 색을 싣는다', () => {
    const sections = buildAgendaSections([epicRow(1, 'PINK'), child(10, 1, 'PINK'), child(30, 3, 'CYAN')], new Date('2026-07-01T00:00:00'));
    const rows = sections.flatMap((s) => s.rows);
    expect(rows.find((r) => r.kind === 'epic' && r.issueNumber === 1)?.colorToken).toBe('PINK');
    expect(rows.find((r) => r.kind === 'epic' && r.issueNumber === 3)?.colorToken).toBe('CYAN');
    expect(rows.find((r) => r.kind === 'child' && r.issueNumber === 10)?.colorToken).toBeUndefined();
  });
});
