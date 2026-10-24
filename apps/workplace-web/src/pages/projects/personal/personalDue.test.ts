// formatDueShort·dueClass(WP-412) — 개인 체크리스트 행 마감 표시 규칙 단위 테스트.
import { describe, expect, it } from 'vitest';

import { dueClass, formatDueShort } from './personalDue';

// 2026-06-17 로컬 오후 — 자정이 아닌 시각이어도 날짜 단위로 비교해야 한다.
const NOW = new Date(2026, 5, 17, 15);

describe('formatDueShort', () => {
  it('오늘/내일/어제는 단어로', () => {
    expect(formatDueShort('2026-06-17', NOW)).toBe('오늘');
    expect(formatDueShort('2026-06-18', NOW)).toBe('내일');
    expect(formatDueShort('2026-06-16', NOW)).toBe('어제');
  });

  it('같은 해는 "M월 D일", 다른 해는 「YYYY. M. D」', () => {
    expect(formatDueShort('2026-07-05', NOW)).toBe('7월 5일');
    expect(formatDueShort('2020-01-10', NOW)).toBe('2020. 1. 10');
    expect(formatDueShort('2027-01-05', NOW)).toBe('2027. 1. 5');
  });
});

describe('dueClass', () => {
  it('지남=destructive, 오늘=warning, 이후=muted', () => {
    expect(dueClass('2020-01-10', false, NOW)).toBe('text-destructive');
    expect(dueClass('2026-06-17', false, NOW)).toBe('text-warning');
    expect(dueClass('2026-06-18', false, NOW)).toBe('text-muted-foreground');
  });

  it('완료면 마감이 지났어도 muted', () => {
    expect(dueClass('2020-01-10', true, NOW)).toBe('text-muted-foreground');
  });
});
