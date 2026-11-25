import { describe, expect, it } from 'vitest';

import { projectIssuesPath } from './projectTabPaths';

// 이슈 목록 고정 주소 헬퍼(WP-2085)
describe('projectIssuesPath', () => {
  it('쿼리가 없으면 고정 주소만', () => {
    expect(projectIssuesPath('WP')).toBe('/projects/WP/issues');
  });
  it('빈 쿼리는 붙이지 않는다', () => {
    expect(projectIssuesPath('WP', '')).toBe('/projects/WP/issues');
  });
  it('쿼리를 ? 로 잇는다', () => {
    expect(projectIssuesPath('WP', 'view=list&cycle=3')).toBe('/projects/WP/issues?view=list&cycle=3');
  });
});
