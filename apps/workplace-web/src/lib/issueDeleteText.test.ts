import { describe, expect, it } from 'vitest';

import { issueDeleteChildrenWarning, issueDeleteEntityName } from './issueDeleteText';

describe('issueDeleteText (WP-469)', () => {
  it('에픽은 「에픽」, 그 밖은 「태스크」', () => {
    expect(issueDeleteEntityName('EPIC')).toBe('에픽');
    expect(issueDeleteEntityName('BUG')).toBe('태스크');
    expect(issueDeleteEntityName(undefined)).toBe('태스크');
  });

  it('에픽은 하위 이슈가 지워지지 않고 에픽 연결만 풀린다고 알린다 (WP-1038)', () => {
    expect(issueDeleteChildrenWarning('EPIC', 2)).toBe(
      '이 에픽에는 하위 이슈가 2개 있습니다. 하위 이슈는 지워지지 않고 에픽 연결만 풀립니다. 이 작업은 되돌릴 수 없습니다.',
    );
    expect(issueDeleteChildrenWarning('EPIC', 2)).not.toContain('함께 삭제');
    expect(issueDeleteChildrenWarning('EPIC', 1, '로그인 개편')).toContain('「로그인 개편」에는 하위 이슈가 1개');
  });

  it('일반 이슈는 기존 문구, 하위가 없으면 null', () => {
    expect(issueDeleteChildrenWarning('TASK', 3)).toBe(
      '이 태스크에는 하위 태스크가 3개 있습니다. 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.',
    );
    expect(issueDeleteChildrenWarning('EPIC', 0)).toBeNull();
  });
});
