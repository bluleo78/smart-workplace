import { describe, expect, it } from 'vitest';

import {
  normalizeIssueQuery,
  normalizeIssueQueryIgnoringView,
  queriesEqual,
  queriesEqualIgnoringView,
  savedViewQueryToParams,
} from './savedViewQuery';

describe('normalizeIssueQuery', () => {
  it('키 순서가 달라도 같은 정규형', () => {
    expect(normalizeIssueQuery('priority=HIGH&status=TODO')).toBe(
      normalizeIssueQuery('status=TODO&priority=HIGH'),
    );
  });

  // group 부재는 저장 뷰 해석상 '그룹 없음'이라 정규형에 group=none 이 명시된다(#878).
  it('알 수 없는 파라미터는 제거된다', () => {
    expect(normalizeIssueQuery('status=TODO&bogus=1')).toBe('group=none&status=TODO');
  });

  it('빈 쿼리는 그룹 없음만 남는다', () => {
    expect(normalizeIssueQuery('')).toBe('group=none');
  });

  it('group 부재와 group=none 은 같은 정규형 (사이클 기본 그룹 도입 전 저장 뷰 하위호환, #878)', () => {
    expect(queriesEqual('status=TODO', 'group=none&status=TODO')).toBe(true);
    expect(queriesEqual('status=TODO', 'group=cycle&status=TODO')).toBe(false);
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

// #599 — view(list/board) 를 제외한 비교. 리스트/보드 전환이 저장뷰 쿼리와 우연히
// 일치하는 것을 막기 위한 함수들.
describe('normalizeIssueQueryIgnoringView', () => {
  it('view=board 만 있는 쿼리는 빈 쿼리와 같은 정규형이 된다', () => {
    expect(normalizeIssueQueryIgnoringView('view=board')).toBe(normalizeIssueQueryIgnoringView(''));
  });

  it('view 외 필터는 그대로 유지된다', () => {
    expect(normalizeIssueQueryIgnoringView('view=board&priority=HIGH')).toBe(
      normalizeIssueQueryIgnoringView('priority=HIGH'),
    );
  });
});

describe('queriesEqualIgnoringView', () => {
  it('view 만 다르면 동등하다고 판단한다', () => {
    expect(queriesEqualIgnoringView('view=board&priority=HIGH', 'priority=HIGH')).toBe(true);
  });

  it('필터 없이 view 만 있는 쿼리는 빈 쿼리와 동등하다고 판단한다 — 호출부에서 별도 가드 필요', () => {
    expect(queriesEqualIgnoringView('view=board', '')).toBe(true);
  });

  it('필터가 다르면 view 무관하게 다르다고 판단한다', () => {
    expect(queriesEqualIgnoringView('view=board&status=TODO', 'view=board&status=DONE')).toBe(false);
  });
});

describe('savedViewQueryToParams (#878)', () => {
  it('group 이 없는 저장 뷰는 group=none 을 명시해 적용한다', () => {
    const p = savedViewQueryToParams('status=TODO');
    expect(p.get('group')).toBe('none');
    expect(p.get('status')).toBe('TODO');
  });

  it('group 이 있으면 그대로 둔다', () => {
    expect(savedViewQueryToParams('group=cycle').get('group')).toBe('cycle');
    expect(savedViewQueryToParams('group=assignee').get('group')).toBe('assignee');
  });
});
