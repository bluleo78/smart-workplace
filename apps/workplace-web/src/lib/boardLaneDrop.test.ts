// 보드 상태 드롭 규칙(WP-1021) — 놓은 대상이 바꿀 상태 id. 스윔레인은 같은 레인의 다른 상태만, 상태 보드(레인 없음)는 다른 상태 컬럼·카드.
import { describe, expect, it } from 'vitest';

import { boardDropStatusId, type LaneCellDropData, laneCellDropId } from './boardLaneDrop';
import { isCycleDropData, isEpicDropData } from './epicDnd';

// 레인 u-1 의 할 일(1) 카드를 끈다.
const src = { lane: 'u-1', statusId: 1 };
// 드롭 대상 data(over.data.current) — 실제로는 아무 모양이나 온다.
const data = (d: Record<string, unknown>) => d;
const cell = (lane: string, statusId: number): LaneCellDropData => ({ lane, statusId, label: `${lane} · ${statusId}` });

describe('boardDropStatusId — 스윔레인', () => {
  it('같은 레인의 다른 상태 칸이면 그 상태 id', () => {
    expect(boardDropStatusId(src, cell('u-1', 2))).toBe(2);
  });

  it('다른 레인 칸이면 null — 담당자·우선순위를 바꾸지 않는다', () => {
    expect(boardDropStatusId(src, cell('u-2', 2))).toBeNull();
  });

  it('같은 레인의 같은 상태 칸이면 null', () => {
    expect(boardDropStatusId(src, cell('u-1', 1))).toBeNull();
  });

  it('카드 위 — 같은 레인 카드는 그 카드의 상태, 다른 레인 카드는 null', () => {
    // 카드 drop data(IssueDragData)도 lane·statusId 를 싣는다.
    expect(boardDropStatusId(src, data({ lane: 'u-1', statusId: 3, issueNumber: 9 }))).toBe(3);
    expect(boardDropStatusId(src, data({ lane: 'u-2', statusId: 3, issueNumber: 9 }))).toBeNull();
    // 같은 레인·같은 상태 카드 위 — 변화 없음.
    expect(boardDropStatusId(src, { lane: 'u-1', statusId: 1 })).toBeNull();
  });

  it('레인 카드를 레인 없는 상태 컬럼에 놓으면 null', () => {
    expect(boardDropStatusId(src, data({ statusId: 2, label: '진행 중' }))).toBeNull();
  });
});

describe('boardDropStatusId — 상태 보드(레인 없음)', () => {
  const card = { statusId: 1 };
  it('다른 상태 컬럼·카드면 그 상태, 같은 상태면 null', () => {
    expect(boardDropStatusId(card, data({ statusId: 2, label: '진행 중' }))).toBe(2);
    expect(boardDropStatusId(card, data({ statusId: 3, issueNumber: 7 }))).toBe(3);
    expect(boardDropStatusId(card, data({ statusId: 1, label: '할 일' }))).toBeNull();
  });
  it('상태 보드 카드를 레인 칸에 놓으면 null', () => {
    expect(boardDropStatusId(card, cell('u-1', 2))).toBeNull();
  });
});

describe('boardDropStatusId — 상태가 아닌 대상', () => {
  it('출발·대상 없음, 상태 id 없는 대상(에픽·패널 존·사이클 구간)은 null', () => {
    expect(boardDropStatusId(undefined, cell('u-1', 2))).toBeNull();
    expect(boardDropStatusId(src, undefined)).toBeNull();
    expect(boardDropStatusId(src, data({ epic: null }))).toBeNull();
    expect(boardDropStatusId(src, data({ zone: true }))).toBeNull();
    expect(boardDropStatusId({ statusId: 1 }, data({ cycleSection: {} }))).toBeNull();
  });

  it('레인 칸 data 는 에픽·사이클 드롭으로 오인되지 않고, id 는 보드 컬럼 폴백(col-)에 걸린다', () => {
    expect(isEpicDropData(cell('u-1', 2))).toBe(false);
    expect(isCycleDropData(cell('u-1', 2))).toBe(false);
    expect(laneCellDropId('epic-3', 2)).toBe('col-lane-epic-3-2');
  });
});
