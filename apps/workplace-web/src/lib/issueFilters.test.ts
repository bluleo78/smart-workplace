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

describe('topLevel 기본값 (#168)', () => {
  it('빈 URL 의 topLevel 기본값은 true (보드/목록은 상위 이슈만)', () => {
    expect(parseFilters(new URLSearchParams()).topLevel).toBe(true);
  });

  it('기본(빈) 필터는 빈 문자열로 직렬화된다 (정규형 보존)', () => {
    expect(filtersToParams(EMPTY, 'list', null).toString()).toBe('');
  });

  it('topLevel=false 는 파싱·직렬화 라운드트립된다 (false 일 때만 URL 명시)', () => {
    const f = parseFilters(new URLSearchParams('topLevel=false'));
    expect(f.topLevel).toBe(false);
    expect(filtersToParams(f, 'list', null).toString()).toBe('topLevel=false');
  });
});

describe('milestoneIds 필터 (#620)', () => {
  it('milestoneIds 라운드트립', () => {
    const filters = { ...EMPTY, milestoneIds: [1, 2] };
    const params = filtersToParams(filters, 'list', null);
    expect(params.get('milestone')).toBe('1,2');
    expect(parseFilters(params).milestoneIds).toEqual([1, 2]);
  });
});
