import { describe, expect, it } from 'vitest';

import { HIDDEN_PARENT_LABEL, isHiddenParent, parentIssueKey, parentIssuePath, parentProjectKey } from './parentRef';

// WP-1038 부모(에픽)는 다른 프로젝트에 있을 수 있다 — 키·경로는 부모의 프로젝트 키로, 가려진 부모는 키·경로 없음.
describe('parentRef', () => {
  it('부모의 projectKey 를 먼저, 없으면 자식 프로젝트 키를 쓴다', () => {
    expect(parentProjectKey({ projectKey: 'PLAN' }, 'WP')).toBe('PLAN');
    expect(parentProjectKey({ projectKey: null }, 'WP')).toBe('WP');
    expect(parentProjectKey({}, 'WP')).toBe('WP');
    expect(parentIssueKey({ number: 3, projectKey: 'PLAN' }, 'WP')).toBe('PLAN-3');
    expect(parentIssuePath({ number: 3 }, 'WP')).toBe('/projects/WP/issues/3');
  });

  it('가려진 부모는 키·경로가 없다', () => {
    const hidden = { number: 0, hidden: true };
    expect(isHiddenParent(hidden)).toBe(true);
    expect(parentIssueKey(hidden, 'WP')).toBeNull();
    expect(parentIssuePath(hidden, 'WP')).toBeNull();
    expect(HIDDEN_PARENT_LABEL).toBe('볼 수 없는 에픽');
  });
});
