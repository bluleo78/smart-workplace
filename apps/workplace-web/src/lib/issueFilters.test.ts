import { describe, expect, it } from 'vitest';

import { filtersToParams, parseFilters, parseGroupBy } from './issueFilters';

const EMPTY = parseFilters(new URLSearchParams());

describe('parseGroupBy', () => {
  it('알려진 group 값만 통과시킨다', () => {
    expect(parseGroupBy(new URLSearchParams('group=status'))).toBe('status');
    expect(parseGroupBy(new URLSearchParams('group=assignee'))).toBe('assignee');
    expect(parseGroupBy(new URLSearchParams('group=priority'))).toBe('priority');
  });

  it('부재/미지값은 null', () => {
    expect(parseGroupBy(new URLSearchParams(''))).toBeNull();
    expect(parseGroupBy(new URLSearchParams('group=bogus'))).toBeNull();
  });
});

describe('filtersToParams - group', () => {
  it('groupBy 가 있으면 group 키를 직렬화한다', () => {
    expect(filtersToParams(EMPTY, 'list', 'assignee').toString()).toBe(
      'group=assignee',
    );
    expect(filtersToParams(EMPTY, 'board', 'priority').toString()).toBe(
      'view=board&group=priority',
    );
  });

  it('groupBy 가 null 이면 group 키를 생략한다', () => {
    expect(filtersToParams(EMPTY, 'list', null).toString()).toBe('');
  });

  it('group 은 필터 직렬화를 통과해 라운드트립된다', () => {
    const params = new URLSearchParams('status=TODO&group=assignee');
    const round = filtersToParams(
      parseFilters(params),
      'list',
      parseGroupBy(params),
    );
    expect(parseGroupBy(round)).toBe('assignee');
    expect(round.get('status')).toBe('TODO');
  });
});
