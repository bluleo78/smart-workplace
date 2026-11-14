// 사이클 완료 창의 순수 계산 — 다음 사이클 이름·기간 추천, 예정 사이클 정렬, 기본 이동처, 완료 버튼 막기 판정.

import type { CycleResponse } from '../types/cycle';
import { addDays, daysBetween } from './closedRange';
import { CYCLE_NAME_MAX, isCycleDateMissing, isCycleDateRangeInvalid } from './cycleMeta';

// 이름 끝의 숫자를 1 올린다. 자릿수(앞자리 0)는 유지하되 넘치면 늘어난다('S-099'→'S-100').
// 끝에 숫자가 없으면 추천할 수 없으므로 빈 문자열(사용자가 직접 입력).
export function nextCycleName(name: string): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return '';
  const [, prefix, digits] = m;
  // 큰 수도 안전하게 — 문자열 자리올림으로 계산한다.
  const chars = digits.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] === '9') {
      chars[i] = '0';
      i -= 1;
    } else {
      chars[i] = String(Number(chars[i]) + 1);
      break;
    }
  }
  const next = i < 0 ? `1${chars.join('')}` : chars.join('');
  return prefix + next;
}

// 직전 사이클과 같은 길이로 종료일 다음 날부터 시작하는 기간을 추천. 한쪽이라도 없으면 null.
// 날짜 산술은 closedRange 의 UTC 자정 함수를 쓴다 — 로컬 타임존·DST 영향을 받지 않는다.
export function nextCyclePeriod(
  startDate: string | null,
  endDate: string | null,
): { startDate: string; endDate: string } | null {
  if (!startDate || !endDate) return null;
  const nextStart = addDays(endDate, 1);
  return { startDate: nextStart, endDate: addDays(nextStart, daysBetween(startDate, endDate)) };
}

// 예정(PLANNED) 사이클만 시작일 오름차순 — 시작일 없는 것은 뒤, 같으면 id 순.
// 키 순서: 시작일 없음 여부(없으면 뒤) → 시작일('yyyy-MM-dd' 라 문자열 순이 날짜 순) → id.
export function scheduledCyclesByStart(cycles: CycleResponse[]): CycleResponse[] {
  return cycles
    .filter((c) => c.status === 'PLANNED')
    .sort(
      (a, b) =>
        Number(!a.startDate) - Number(!b.startDate) ||
        (a.startDate ?? '').localeCompare(b.startDate ?? '') ||
        a.id - b.id,
    );
}

// 미완료 이슈의 기본 이동처 — 정렬된 예정 목록의 첫 사이클, 없으면 새 사이클.
export function defaultDestination(
  scheduled: CycleResponse[],
): { kind: 'NEW' } | { kind: 'SCHEDULED'; cycleId: number } {
  return scheduled.length > 0 ? { kind: 'SCHEDULED', cycleId: scheduled[0].id } : { kind: 'NEW' };
}

// 새 사이클 이름이 상한을 넘는가 — 서버처럼 앞뒤 공백을 다듬은 길이로 본다.
// 입력 칸 maxLength 는 타이핑만 막고 추천 이름(60자 끝 '9' → 61자)은 막지 못하므로 따로 판정한다.
export function isNewCycleNameTooLong(name: string): boolean {
  return name.trim().length > CYCLE_NAME_MAX;
}

/** 완료 버튼을 막을지 판정할 입력 — 화면 상태를 그대로 옮긴다. */
export interface CompleteBlockedInput {
  /**
   * 진행 집계와 사이클 목록을 모두 받았는가. 집계 전에는 미완료 수를 몰라 「없음」으로 잘못 완료할 수 있고, 목록 전에는 예정 사이클을 몰라
   * 기본 보낼 곳이 「새 사이클」로 잘못 잡힌다.
   */
  dataReady: boolean;
  /** 실제 보낼 곳(미완료 0개면 NONE). */
  destination: 'NEW' | 'SCHEDULED' | 'NONE';
  /** SCHEDULED 일 때 고른 예정 사이클이 목록에 있는가. */
  hasTarget: boolean;
  newName: string;
  newStart: string;
  newEnd: string;
  /** 완료 요청이 나가 있는가. */
  pending: boolean;
}

/**
 * 사이클 완료 창의 「완료」를 막을지 — 화면 판정을 순수 함수로 꺼내 지킨다(apps/workplace-web CLAUDE.md).
 * 데이터(집계·목록)가 다 오기 전, 요청 중, 새 사이클 입력이 비었거나 길거나 기간이 거꾸로일 때, 예정 사이클 대상을 못 찾을 때 막는다.
 */
export function isCompleteBlocked(i: CompleteBlockedInput): boolean {
  if (!i.dataReady || i.pending) return true;
  if (i.destination === 'NEW') {
    return (
      !i.newName.trim() ||
      isNewCycleNameTooLong(i.newName) ||
      isCycleDateMissing(i.newStart, i.newEnd) ||
      isCycleDateRangeInvalid(i.newStart, i.newEnd)
    );
  }
  if (i.destination === 'SCHEDULED') return !i.hasTarget;
  return false;
}
