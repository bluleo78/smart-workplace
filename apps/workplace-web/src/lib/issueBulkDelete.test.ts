import { describe, expect, it } from 'vitest';

import type { IssueResponse } from '../types/issue';
import { bulkDeleteDescription, countCascadedChildren } from './issueBulkDelete';

// 판정에 쓰는 필드만 채운 이슈 — number·childCount·parent.
function issue(number: number, childCount: number, parentNumber?: number): IssueResponse {
  return {
    number,
    childCount,
    parent: parentNumber == null ? null : { number: parentNumber, title: 'p', type: { id: 1, name: 'TASK' } },
  } as unknown as IssueResponse;
}

describe('countCascadedChildren (WP-482)', () => {
  it('선택한 이슈들의 하위 수를 더한다', () => {
    expect(countCascadedChildren([issue(1, 2), issue(2, 0), issue(3, 1)])).toBe(3);
  });
  it('부모와 함께 선택된 하위는 두 번 세지 않는다', () => {
    expect(countCascadedChildren([issue(1, 2), issue(10, 0, 1)])).toBe(1);
  });
  it('캐시에 없는 이슈는 0 으로 본다', () => {
    expect(countCascadedChildren([undefined, issue(2, 3)])).toBe(3);
  });
});

describe('bulkDeleteDescription (WP-482)', () => {
  it('하위가 있으면 함께 삭제된다고 알린다', () => {
    expect(bulkDeleteDescription(2, 2)).toBe(
      '선택한 2개 태스크를 삭제할까요? 하위 태스크 2개도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
    );
  });
  it('하위가 없으면 기존 문구', () => {
    expect(bulkDeleteDescription(3, 0)).toBe('선택한 3개 태스크를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
  });
});
