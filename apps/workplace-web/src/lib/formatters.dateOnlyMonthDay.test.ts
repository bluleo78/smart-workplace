import { describe, expect, it } from 'vitest';

import { formatDateOnlyMonthDay } from './formatters';

// WP-380 메모리 기한 표기 — 날짜 전용 값이라 Date 로 파싱하지 않는다(시간대 왜곡 없음). 연도 비교 기준은 KST 오늘.
describe('formatDateOnlyMonthDay', () => {
  const now = new Date('2026-10-14T03:00:00Z');

  it('같은 해면 월·일', () => {
    expect(formatDateOnlyMonthDay('2026-10-24', now)).toBe('10월 24일');
    expect(formatDateOnlyMonthDay('2026-01-05', now)).toBe('1월 5일');
  });

  it('다른 해면 연도까지', () => {
    expect(formatDateOnlyMonthDay('2027-01-05', now)).toBe('2027년 1월 5일');
  });

  it('KST 기준 연도 — UTC 로는 아직 12/31 이어도 KST 1/1 이면 새해', () => {
    expect(formatDateOnlyMonthDay('2027-01-05', new Date('2026-12-31T16:00:00Z'))).toBe('1월 5일');
  });

  it('무효 입력은 빈 문자열', () => {
    expect(formatDateOnlyMonthDay(null, now)).toBe('');
    expect(formatDateOnlyMonthDay('10/24', now)).toBe('');
  });
});
