// WP-1238 정렬 전환 규칙 — 열 머리 순환·메뉴 기준/방향 고르기·기본(수정일 내림차순) 정규화·단일 쓰기 경로(withSortParams).
import { describe, expect, it } from 'vitest';

import {
  cycleHeaderSort,
  displayedSort,
  normalizeSort,
  pickSortDirection,
  pickSortKey,
  sortChipLabel,
  withSortParams,
} from './issueSort';

describe('cycleHeaderSort — 열 머리 클릭', () => {
  it('같은 열은 오름차순 → 내림차순 → 기본으로 돈다', () => {
    const asc = cycleHeaderSort(null, 'dueDate');
    expect(asc).toEqual({ key: 'dueDate', direction: 'asc' });
    const desc = cycleHeaderSort(asc, 'dueDate');
    expect(desc).toEqual({ key: 'dueDate', direction: 'desc' });
    expect(cycleHeaderSort(desc, 'dueDate')).toBeNull();
  });

  it('다른 열을 누르면 그 열 오름차순', () => {
    expect(cycleHeaderSort({ key: 'dueDate', direction: 'desc' }, 'status')).toEqual({ key: 'status', direction: 'asc' });
  });

  it('수정일은 내림차순이 기본이라 오름차순 → 기본 두 단계로 돈다', () => {
    const asc = cycleHeaderSort(null, 'updatedAt');
    expect(asc).toEqual({ key: 'updatedAt', direction: 'asc' });
    expect(cycleHeaderSort(asc, 'updatedAt')).toBeNull();
  });
});

describe('메뉴 — 기준·방향 고르기', () => {
  it('기본에서 기준을 고르면 오름차순, 고른 상태면 지금 방향을 지킨다', () => {
    expect(pickSortKey(null, 'priority')).toEqual({ key: 'priority', direction: 'asc' });
    expect(pickSortKey({ key: 'dueDate', direction: 'desc' }, 'priority')).toEqual({ key: 'priority', direction: 'desc' });
  });

  it('기본에서 수정일을 고르거나 내림차순을 골라도 기본 그대로(null)다', () => {
    expect(pickSortKey(null, 'updatedAt')).toBeNull();
    expect(pickSortDirection(null, 'desc')).toBeNull();
    expect(pickSortKey({ key: 'dueDate', direction: 'desc' }, 'updatedAt')).toBeNull();
  });

  it('기본에서 오름차순을 고르면 수정일 오름차순', () => {
    expect(pickSortDirection(null, 'asc')).toEqual({ key: 'updatedAt', direction: 'asc' });
  });

  it('기본 상태의 체크 표시는 수정일·내림차순, 칩은 「정렬」', () => {
    expect(displayedSort(null)).toEqual({ key: 'updatedAt', direction: 'desc' });
    expect(sortChipLabel(null)).toBe('정렬');
    expect(sortChipLabel({ key: 'dueDate', direction: 'asc' })).toBe('정렬: 마감일 ↑');
  });

  it('normalizeSort 는 수정일 내림차순만 null 로 바꾼다', () => {
    expect(normalizeSort({ key: 'updatedAt', direction: 'desc' })).toBeNull();
    expect(normalizeSort({ key: 'updatedAt', direction: 'asc' })).toEqual({ key: 'updatedAt', direction: 'asc' });
  });
});

describe('withSortParams — 정렬 쓰기의 단일 경로', () => {
  it('필터·보기·그룹 원값(none)·열은 두고 정렬만 바꾼 정규형을 만든다', () => {
    const prev = new URLSearchParams('direction=asc&priority=HIGH&view=board&group=none&cols=due&sort=dueDate&boardTab=3');
    const next = withSortParams(prev, { key: 'status', direction: 'desc' });
    expect(next.toString()).toBe('view=board&group=none&priority=HIGH&sort=status&direction=desc&boardTab=3&cols=due');
  });

  it('null·기본과 같은 정렬이면 sort·direction 이 사라진다', () => {
    const prev = new URLSearchParams('priority=HIGH&sort=dueDate&direction=asc');
    expect(withSortParams(prev, null).toString()).toBe('priority=HIGH');
    expect(withSortParams(prev, { key: 'updatedAt', direction: 'desc' }).toString()).toBe('priority=HIGH');
  });

  it('같은 정렬은 원래 쿼리 순서와 무관하게 같은 주소가 된다', () => {
    const s = { key: 'assignee', direction: 'asc' } as const;
    expect(withSortParams(new URLSearchParams('label=3&priority=HIGH'), s).toString())
      .toBe(withSortParams(new URLSearchParams('priority=HIGH&label=3&sort=dueDate'), s).toString());
  });
});
