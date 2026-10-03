import { describe, expect, it } from 'vitest';

import { currentEpicChoice, nextEpicScope } from './epicScope';

const ALL = { parentNumber: null, topLevel: false };
const UNASSIGNED = { parentNumber: null, topLevel: true };
const EPIC10 = { parentNumber: 10, topLevel: false };

describe('currentEpicChoice', () => {
  it('parent 가 있으면 특정 에픽', () => expect(currentEpicChoice(EPIC10)).toEqual({ kind: 'epic', number: 10 }));
  it('parent 없고 topLevel 이면 미할당', () => expect(currentEpicChoice(UNASSIGNED)).toEqual({ kind: 'unassigned' }));
  it('둘 다 없으면 전체', () => expect(currentEpicChoice(ALL)).toEqual({ kind: 'all' }));
});

describe('nextEpicScope', () => {
  it('전체 → 에픽 선택: parent 설정, 새 queryKey 라 무효화 불필요', () => {
    expect(nextEpicScope(ALL, { kind: 'epic', number: 10 })).toEqual({ parentNumber: 10, topLevel: false, invalidate: false });
  });
  it('같은 에픽 재선택 = 해제(전체 복귀) + 무효화', () => {
    expect(nextEpicScope(EPIC10, { kind: 'epic', number: 10 })).toEqual({ parentNumber: null, topLevel: false, invalidate: true });
  });
  it('미할당 상태에서 에픽 선택 시 미할당은 해제(상호 배타)', () => {
    expect(nextEpicScope(UNASSIGNED, { kind: 'epic', number: 10 })).toEqual({ parentNumber: 10, topLevel: false, invalidate: false });
  });
  it('미할당 토글: 켜기는 무효화 없음, 끄기는 무효화', () => {
    expect(nextEpicScope(ALL, { kind: 'unassigned' })).toEqual({ parentNumber: null, topLevel: true, invalidate: false });
    expect(nextEpicScope(UNASSIGNED, { kind: 'unassigned' })).toEqual({ parentNumber: null, topLevel: false, invalidate: true });
  });
  it('에픽 상태에서 미할당 선택 시 parent 해제', () => {
    expect(nextEpicScope(EPIC10, { kind: 'unassigned' })).toEqual({ parentNumber: null, topLevel: true, invalidate: false });
  });
  it('전체 선택은 항상 둘 다 해제 + 무효화', () => {
    expect(nextEpicScope(EPIC10, { kind: 'all' })).toEqual({ parentNumber: null, topLevel: false, invalidate: true });
  });
});
