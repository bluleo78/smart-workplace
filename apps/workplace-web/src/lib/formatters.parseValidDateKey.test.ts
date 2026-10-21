import { describe, expect, it } from 'vitest';

import { parseValidDateKey } from './formatters';

// WP-725: 해석할 수 없는 날짜 키는 Invalid Date 대신 undefined — 날짜 표시가 format() 에서 터져 화면 전체가 깨지지 않게.
describe('parseValidDateKey', () => {
  it('YYYY-MM-DD 를 로컬 날짜로 읽는다', () => {
    const d = parseValidDateKey('2026-10-21');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(9);
    expect(d?.getDate()).toBe(21);
  });

  it.each(['+10000-01-01', '+999999999-12-31', '-0001-01-01', '2026-02-30', 'abc', ''])(
    '해석할 수 없는 %s 는 undefined',
    (v) => {
      expect(parseValidDateKey(v)).toBeUndefined();
    },
  );

  it('null·undefined 는 undefined', () => {
    expect(parseValidDateKey(null)).toBeUndefined();
    expect(parseValidDateKey(undefined)).toBeUndefined();
  });
});
