import { describe, expect, it } from 'vitest';

import { CLOSED_ISSUE_STATUSES, hiddenAfterClose } from './closedHiding';

// 종료로 바꾼 이슈가 화면에서 숨겨지는지(WP-606) — 보드·평면 목록은 진행 중 사이클만, 사이클 구간 목록은 예정까지 남긴다.
describe('hiddenAfterClose', () => {
  const active = { id: 1, name: '10월 2주', status: 'ACTIVE' as const };
  const planned = { id: 2, name: '10월 3주', status: 'PLANNED' as const };
  const completed = { id: 3, name: '10월 1주', status: 'COMPLETED' as const };

  it('사이클이 없거나 완료 사이클에만 있으면 숨겨진다', () => {
    expect(hiddenAfterClose([], ['ACTIVE'])).toBe(true);
    expect(hiddenAfterClose([completed], ['ACTIVE'])).toBe(true);
  });

  it('진행 중 사이클에 있으면 남는다', () => {
    expect(hiddenAfterClose([completed, active], ['ACTIVE'])).toBe(false);
  });

  it('예정 사이클은 보드에선 숨겨지고 사이클 구간 목록에선 남는다', () => {
    expect(hiddenAfterClose([planned], ['ACTIVE'])).toBe(true);
    expect(hiddenAfterClose([planned], ['ACTIVE', 'PLANNED'])).toBe(false);
  });

  it('종료 상태는 완료·취소뿐이다', () => {
    expect([...CLOSED_ISSUE_STATUSES]).toEqual(['DONE', 'CANCELED']);
  });
});
