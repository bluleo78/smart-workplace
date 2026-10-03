import { describe, expect, it } from 'vitest';

import { resolveBoardTab, swipeDirection } from './boardTabs';

const tab = (status: string, count: number, pending = false) => ({ status, count, pending });
const TEAM = (todo: number, prog: number, progPending = false) => [tab('TODO', todo), tab('IN_PROGRESS', prog, progPending), tab('DONE', 3), tab('CANCELED', 0)];

describe('resolveBoardTab', () => {
  it('URL 값이 보이는 탭이면 그대로', () => {
    expect(resolveBoardTab('DONE', TEAM(1, 1))).toBe('DONE');
  });
  it('URL 값이 없거나 숨겨진 상태면 기본 규칙', () => {
    expect(resolveBoardTab(null, TEAM(1, 2))).toBe('IN_PROGRESS');
    expect(resolveBoardTab('BOGUS', TEAM(1, 2))).toBe('IN_PROGRESS');
    expect(resolveBoardTab('CANCELED', [tab('TODO', 1), tab('DONE', 0)])).toBe('TODO');
  });
  it('진행 중이 비면 할 일, 둘 다 비면 첫 탭', () => {
    expect(resolveBoardTab(null, TEAM(4, 0))).toBe('TODO');
    expect(resolveBoardTab(null, [tab('DONE', 2), tab('TODO', 0), tab('IN_PROGRESS', 0)])).toBe('DONE');
  });
  it('진행 중이 아직 응답 전이면 기다린다(할 일로 튀지 않음)', () => {
    expect(resolveBoardTab(null, TEAM(4, 0, true))).toBe('IN_PROGRESS');
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
