// countOverdue(WP-412)·isOverdue(WP-649) — 마감 초과 판정 단위 테스트(home-chat-widgets E2E 에서 이관).
import { describe, expect, it } from 'vitest';

import { countOverdue, isOverdue } from './issueOverdue';

// 2026-06-17 로컬 오후.
const NOW = new Date(2026, 5, 17, 15);

describe('countOverdue (#519)', () => {
  it('지난 마감 + 미완료만 센다 — 완료·취소·마감 없음·미래는 제외', () => {
    expect(
      countOverdue(
        [
          { status: 'IN_PROGRESS', dueDate: '2020-01-01' },
          { status: 'TODO', dueDate: '2026-06-16' },
          { status: 'DONE', dueDate: '2020-01-01' },
          { status: 'CANCELED', dueDate: '2020-01-01' },
          { status: 'TODO', dueDate: null },
          { status: 'TODO', dueDate: '2026-06-20' },
        ],
        NOW,
      ),
    ).toBe(2);
  });

  it('오늘 마감은 아직 초과가 아니다', () => {
    expect(countOverdue([{ status: 'TODO', dueDate: '2026-06-17' }], NOW)).toBe(0);
  });
});

describe('isOverdue (WP-649)', () => {
  it('미완료 + 마감일이 오늘보다 앞이면 true — 오늘·미래·마감 없음·완료·취소는 false', () => {
    expect(isOverdue({ status: 'TODO', dueDate: '2026-06-16' }, NOW)).toBe(true);
    expect(isOverdue({ status: 'IN_PROGRESS', dueDate: '2020-01-01' }, NOW)).toBe(true);
    expect(isOverdue({ status: 'TODO', dueDate: '2026-06-17' }, NOW)).toBe(false);
    expect(isOverdue({ status: 'TODO', dueDate: '2026-06-20' }, NOW)).toBe(false);
    expect(isOverdue({ status: 'TODO', dueDate: null }, NOW)).toBe(false);
    expect(isOverdue({ status: 'DONE', dueDate: '2020-01-01' }, NOW)).toBe(false);
    expect(isOverdue({ status: 'CANCELED', dueDate: '2020-01-01' }, NOW)).toBe(false);
  });
});
