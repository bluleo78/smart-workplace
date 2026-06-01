import { describe, expect, it } from 'vitest';

import { normalizeIssueQuery, queriesEqual } from './savedViewQuery';

describe('normalizeIssueQuery', () => {
  it('키 순서가 달라도 같은 정규형', () => {
    expect(normalizeIssueQuery('priority=HIGH&status=TODO')).toBe(
      normalizeIssueQuery('status=TODO&priority=HIGH'),
    );
  });

  it('알 수 없는 파라미터는 제거된다', () => {
    expect(normalizeIssueQuery('status=TODO&bogus=1')).toBe('status=TODO');
  });

  it('빈 쿼리는 빈 문자열', () => {
    expect(normalizeIssueQuery('')).toBe('');
  });
});

describe('queriesEqual', () => {
  it('정규형이 같으면 true', () => {
    expect(
      queriesEqual('status=TODO&priority=HIGH', 'priority=HIGH&status=TODO'),
    ).toBe(true);
  });
  it('다르면 false', () => {
    expect(queriesEqual('status=TODO', 'status=DONE')).toBe(false);
  });
});
