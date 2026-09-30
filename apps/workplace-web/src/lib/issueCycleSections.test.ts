import { describe, expect, it } from 'vitest';

import type { CycleResponse } from '../types/cycle';
import {
  backlogSectionFilters,
  buildCycleSections,
  countOpenCycles,
  cycleSectionFilters,
  remainingLabel,
} from './issueCycleSections';
import { parseFilters } from './issueFilters';

function cycle(id: number, status: CycleResponse['status'], startDate: string | null): CycleResponse {
  return {
    id,
    projectId: 1,
    name: `C${id}`,
    goal: null,
    startDate,
    endDate: null,
    status,
    createdAt: '',
    updatedAt: '',
  };
}

const EMPTY = parseFilters(new URLSearchParams());

describe('buildCycleSections (#878)', () => {
  const cycles = [
    cycle(1, 'PLANNED', null),
    cycle(2, 'ACTIVE', '2026-09-20'),
    cycle(3, 'COMPLETED', '2026-08-01'),
    cycle(4, 'PLANNED', '2026-10-10'),
    cycle(5, 'ACTIVE', '2026-09-10'),
  ];

  it('진행 중(시작일순) → 예정(시작일순, 미정 마지막) → 백로그, 완료 제외', () => {
    const s = buildCycleSections(cycles, []);
    expect(s.map((x) => x.key)).toEqual(['cycle-5', 'cycle-2', 'cycle-4', 'cycle-1', 'backlog']);
  });

  it('기본 펼침: 진행 중·백로그 펼침, 예정 접힘', () => {
    const s = buildCycleSections(cycles, []);
    expect(s.map((x) => x.defaultExpanded)).toEqual([true, true, false, false, true]);
  });

  it('사이클 필터를 고르면 그 구간만(백로그 숨김), 완료도 표시·펼침', () => {
    const s = buildCycleSections(cycles, [3, 4]);
    expect(s.map((x) => x.key)).toEqual(['cycle-4', 'cycle-3']);
    expect(s.every((x) => x.defaultExpanded)).toBe(true);
  });

  it('countOpenCycles 는 진행 중·예정만 센다', () => {
    expect(countOpenCycles(cycles)).toBe(4);
    expect(countOpenCycles([cycle(9, 'COMPLETED', null)])).toBe(0);
  });
});

describe('구간 필터 — 종료 이슈 스코프 (#876 과 동일 결과)', () => {
  it('사이클 구간: 해당 사이클 + 종료 이슈 포함 + 기본 범위(에픽·SUBTASK 제외)', () => {
    const f = cycleSectionFilters(EMPTY, 7);
    expect(f).toMatchObject({
      cycleIds: [7],
      cycleUnassigned: false,
      hideInactiveClosed: false,
      excludeEpics: true,
      excludeSubtasks: true,
    });
  });

  it('백로그: cycle=null + 기본은 종료 이슈 숨김', () => {
    const f = backlogSectionFilters(EMPTY);
    expect(f).toMatchObject({ cycleIds: [], cycleUnassigned: true, hideInactiveClosed: true });
  });

  it('백로그: 완료 모두 보기·상태 필터를 명시하면 숨기지 않는다', () => {
    expect(backlogSectionFilters({ ...EMPTY, showAllClosed: true }).hideInactiveClosed).toBe(false);
    expect(backlogSectionFilters({ ...EMPTY, statuses: ['DONE'] })).toMatchObject({
      hideInactiveClosed: false,
      statuses: ['DONE'],
    });
  });

  it('사용자 필터(담당자 등)는 모든 구간에 유지된다', () => {
    const user = { ...EMPTY, assigneeIds: [10], q: 'x' };
    expect(cycleSectionFilters(user, 1)).toMatchObject({ assigneeIds: [10], q: 'x' });
    expect(backlogSectionFilters(user)).toMatchObject({ assigneeIds: [10], q: 'x' });
  });
});

describe('remainingLabel', () => {
  const now = new Date(2026, 8, 30, 23, 30); // 로컬 2026-09-30 늦은 밤 — UTC 파싱이면 하루 어긋난다
  it('D-N / D-day / N일 초과', () => {
    expect(remainingLabel('2026-10-03', now)).toEqual({ text: 'D-3', ariaLabel: '종료까지 3일', overdue: false });
    expect(remainingLabel('2026-09-30', now)).toEqual({ text: 'D-day', ariaLabel: '오늘 종료', overdue: false });
    expect(remainingLabel('2026-09-28', now)).toEqual({
      text: '2일 초과',
      ariaLabel: '종료일 2일 초과',
      overdue: true,
    });
    expect(remainingLabel(null, now)).toBeNull();
  });
});
