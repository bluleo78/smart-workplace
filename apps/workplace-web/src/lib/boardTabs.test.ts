import { describe, expect, it } from 'vitest';

import type { IssueStatus } from '../types/issue';
import { type BoardTabInfo, resolveBoardTab, swipeDirection } from './boardTabs';

const tab = (statusId: number, category: IssueStatus, count: number, pending = false): BoardTabInfo => ({
  statusId,
  category,
  count,
  pending,
});
// 상태 탭 — 할 일(1) · 진행 중(2)·검토 중(5) · 완료(3) · 취소(4).
const TABS = (todo: number, prog: number, review: number, progPending = false) => [
  tab(1, 'TODO', todo),
  tab(2, 'IN_PROGRESS', prog, progPending),
  tab(5, 'IN_PROGRESS', review),
  tab(3, 'DONE', 3),
  tab(4, 'CANCELED', 0),
];

describe('resolveBoardTab', () => {
  it('기본 탭은 진행 중 범주의 첫 상태', () => {
    expect(resolveBoardTab(null, TABS(1, 2, 1))).toBe(2);
  });
  it('진행 중 범주가 모두 비면 할 일 범주의 첫 상태', () => {
    expect(resolveBoardTab(null, TABS(4, 0, 0))).toBe(1);
  });
  it('진행 중·할 일 범주가 모두 비면 첫 탭', () => {
    expect(resolveBoardTab(null, [tab(3, 'DONE', 2), tab(1, 'TODO', 0), tab(2, 'IN_PROGRESS', 0)])).toBe(3);
  });
  it('진행 중이 아직 응답 전이면 기다린다(할 일로 튀지 않음)', () => {
    expect(resolveBoardTab(null, TABS(4, 0, 0, true))).toBe(2);
  });
  it('예전 boardTab=IN_PROGRESS 는 진행 중 범주 첫 탭으로', () => {
    expect(resolveBoardTab('IN_PROGRESS', TABS(1, 0, 0))).toBe(2);
    expect(resolveBoardTab('DONE', TABS(1, 2, 1))).toBe(3);
  });
  it('보이는 statusId URL 값이 이긴다', () => {
    expect(resolveBoardTab('5', TABS(1, 2, 1))).toBe(5);
    expect(resolveBoardTab('4', TABS(1, 2, 1))).toBe(4);
  });
  it('숨겨진(보이지 않는) 상태·범주나 모르는 값이면 기본 규칙', () => {
    expect(resolveBoardTab('99', TABS(1, 2, 1))).toBe(2);
    expect(resolveBoardTab('BOGUS', TABS(1, 2, 1))).toBe(2);
    expect(resolveBoardTab('CANCELED', [tab(1, 'TODO', 1), tab(3, 'DONE', 0)])).toBe(1);
  });
  it('탭이 없으면(상태 목록 로딩 중) 고르지 않는다', () => {
    expect(resolveBoardTab('2', [])).toBeNull();
  });
});

describe('swipeDirection', () => {
  it('왼쪽으로 60px 초과 = 다음, 오른쪽 = 이전', () => {
    expect(swipeDirection(-61, 0)).toBe('next');
    expect(swipeDirection(80, 10)).toBe('prev');
  });
  it('임계 이하이거나 세로가 더 크면 무시', () => {
    expect(swipeDirection(-60, 0)).toBeNull();
    expect(swipeDirection(-90, 120)).toBeNull();
  });
});
