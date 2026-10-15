// countOverdue(WP-412) — 이슈 목록 위젯 "마감 초과 M건" 집계 단위 테스트(home-chat-widgets E2E 에서 이관).
import { describe, expect, it } from 'vitest';

import { countOverdue } from './issueOverdue';

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
