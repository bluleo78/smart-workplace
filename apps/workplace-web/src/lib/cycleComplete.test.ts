// 사이클 완료 계산 함수 테스트 — 다음 이름·기간 추천, 예정 사이클 정렬·기본 이동처, 완료 버튼 막기 판정.
import { describe, expect, it } from 'vitest';

import type { CycleResponse } from '../types/cycle';
import {
  type CompleteBlockedInput,
  defaultDestination,
  isCompleteBlocked,
  isNewCycleNameTooLong,
  nextCycleName,
  nextCyclePeriod,
  scheduledCyclesByStart,
} from './cycleComplete';

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

describe('nextCycleName', () => {
  it.each([
    ['GW-7', 'GW-8'],
    ['GW-9', 'GW-10'],
    ['S-09', 'S-10'],
    ['S-099', 'S-100'],
    ['Sprint 12', 'Sprint 13'],
    ['가을', ''],
    ['7', '8'],
  ])('%s -> %s', (input, expected) => {
    expect(nextCycleName(input)).toBe(expected);
  });
});

describe('nextCyclePeriod', () => {
  it('같은 길이로 다음 날부터 잡는다', () => {
    expect(nextCyclePeriod('2026-11-03', '2026-11-16')).toEqual({
      startDate: '2026-11-17',
      endDate: '2026-11-30',
    });
  });
  it('월 경계를 넘는다', () => {
    expect(nextCyclePeriod('2026-11-20', '2026-12-03')).toEqual({
      startDate: '2026-12-04',
      endDate: '2026-12-17',
    });
  });
  it('한쪽이라도 없으면 null', () => {
    expect(nextCyclePeriod(null, '2026-11-16')).toBeNull();
    expect(nextCyclePeriod('2026-11-03', null)).toBeNull();
  });
});

describe('scheduledCyclesByStart / defaultDestination', () => {
  const cycles = [
    cycle(1, 'PLANNED', '2026-12-15'),
    cycle(2, 'PLANNED', '2026-12-01'),
    cycle(3, 'ACTIVE', '2026-11-01'),
    cycle(4, 'COMPLETED', '2026-10-01'),
    cycle(6, 'PLANNED', null),
    cycle(5, 'PLANNED', null),
  ];
  it('예정만 시작일 오름차순, 시작일 없는 것은 뒤(id 순)', () => {
    expect(scheduledCyclesByStart(cycles).map((c) => c.id)).toEqual([2, 1, 5, 6]);
  });
  it('가장 빠른 예정 사이클을 기본 선택', () => {
    expect(defaultDestination(scheduledCyclesByStart(cycles))).toEqual({
      kind: 'SCHEDULED',
      cycleId: 2,
    });
  });
  it('예정이 없으면 NEW', () => {
    expect(defaultDestination([])).toEqual({ kind: 'NEW' });
  });
});

describe('isNewCycleNameTooLong', () => {
  it('60자까지는 괜찮고 61자는 길다', () => {
    expect(isNewCycleNameTooLong('a'.repeat(60))).toBe(false);
    expect(isNewCycleNameTooLong('a'.repeat(61))).toBe(true);
  });
  it('앞뒤 공백은 다듬은 길이로 본다(서버 정규화와 같다)', () => {
    expect(isNewCycleNameTooLong(`  ${'a'.repeat(60)}  `)).toBe(false);
  });
  it('60자 이름 끝이 9 면 추천 이름이 61자가 된다', () => {
    expect(isNewCycleNameTooLong(nextCycleName(`${'a'.repeat(59)}9`))).toBe(true);
  });
});

describe('isCompleteBlocked', () => {
  // 막히지 않는 기본값 — 데이터가 다 왔고 새 사이클 입력이 올바르다.
  const ok: CompleteBlockedInput = {
    dataReady: true,
    destination: 'NEW',
    hasTarget: false,
    newName: 'GW-8',
    newStart: '2026-11-17',
    newEnd: '2026-11-30',
    pending: false,
  };
  it('입력이 모두 맞으면 막지 않는다', () => {
    expect(isCompleteBlocked(ok)).toBe(false);
    expect(isCompleteBlocked({ ...ok, destination: 'NONE' })).toBe(false);
    expect(isCompleteBlocked({ ...ok, destination: 'SCHEDULED', hasTarget: true })).toBe(false);
  });
  it.each<[string, Partial<CompleteBlockedInput>]>([
    ['집계·목록 전', { dataReady: false }],
    ['NONE 이어도 집계·목록 전', { destination: 'NONE', dataReady: false }],
    ['요청 중', { pending: true }],
    ['NEW 이름 비어 있음', { newName: '   ' }],
    ['NEW 이름 61자', { newName: 'a'.repeat(61) }],
    ['NEW 시작일 없음', { newStart: '' }],
    ['NEW 종료일 없음', { newEnd: '' }],
    ['NEW 기간 거꾸로', { newStart: '2026-11-30', newEnd: '2026-11-17' }],
    ['SCHEDULED 대상 없음', { destination: 'SCHEDULED', hasTarget: false }],
  ])('%s → 막는다', (_, patch) => {
    expect(isCompleteBlocked({ ...ok, ...patch })).toBe(true);
  });
  it('NEW 가 아니면 새 사이클 입력은 보지 않는다', () => {
    expect(isCompleteBlocked({ ...ok, destination: 'NONE', newName: '', newStart: '' })).toBe(false);
  });
});
