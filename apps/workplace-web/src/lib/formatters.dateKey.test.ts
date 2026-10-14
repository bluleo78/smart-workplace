import { describe, expect, it } from 'vitest';

import { formatDateKey, parseDateKey } from './formatters';

// WP-380 날짜 키(YYYY-MM-DD) ↔ 로컬 날짜 — 메모리 기한 달력·날짜 시트가 함께 쓴다. 시각을 다른 시간대로 옮기지 않는다.
describe('parseDateKey / formatDateKey', () => {
  it('키를 그 날짜의 로컬 자정으로 읽는다', () => {
    const d = parseDateKey('2026-10-24');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 24, 0]);
  });

  it('로컬 날짜를 키로 쓰고, 읽은 키를 다시 쓰면 그대로다', () => {
    expect(formatDateKey(new Date(2026, 1, 3, 23, 59))).toBe('2026-02-03');
    expect(formatDateKey(parseDateKey('2026-12-31'))).toBe('2026-12-31');
  });
});
