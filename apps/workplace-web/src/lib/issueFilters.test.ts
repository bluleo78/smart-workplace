import { describe, expect, it } from 'vitest';

import {
  filtersToParams,
  parseFilters,
  parseGroupBy,
  parseGroupParam,
  resolveListGroupBy,
  toClientGroupBy,
  withDefaultIssueScope,
} from './issueFilters';

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

  it('cycle 은 통과, none(그룹 없음 명시)은 null (#878)', () => {
    expect(parseGroupBy(new URLSearchParams('group=cycle'))).toBe('cycle');
    expect(parseGroupBy(new URLSearchParams('group=none'))).toBeNull();
  });
});

describe('parseGroupParam / resolveListGroupBy (#878)', () => {
  it('원값은 none 과 부재를 구분한다', () => {
    expect(parseGroupParam(new URLSearchParams('group=none'))).toBe('none');
    expect(parseGroupParam(new URLSearchParams(''))).toBeNull();
    expect(parseGroupParam(new URLSearchParams('group=bogus'))).toBeNull();
  });

  it('group 부재: 진행 중·예정 사이클이 있으면 cycle, 없으면 그룹 없음, 로딩 중이면 보류', () => {
    expect(resolveListGroupBy(null, 2)).toBe('cycle');
    expect(resolveListGroupBy(null, 0)).toBeNull();
    expect(resolveListGroupBy(null, undefined)).toBeUndefined();
  });

  it('명시값은 사이클 유무와 무관하게 그대로 따른다', () => {
    expect(resolveListGroupBy('none', 3)).toBeNull();
    expect(resolveListGroupBy('assignee', undefined)).toBe('assignee');
    expect(resolveListGroupBy('cycle', 0)).toBe('cycle');
  });

  it('none 은 URL 로 왕복된다', () => {
    expect(filtersToParams(EMPTY, 'list', 'none').toString()).toBe('group=none');
  });

  it('클라이언트 그룹핑은 cycle 을 그룹 없음으로 본다', () => {
    expect(toClientGroupBy('cycle')).toBeNull();
    expect(toClientGroupBy('status')).toBe('status');
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

describe('topLevel (에픽 미할당) (#168, #874)', () => {
  it('빈 URL 의 topLevel 기본값은 false (기본 범위는 withDefaultIssueScope 가 결정)', () => {
    expect(parseFilters(new URLSearchParams()).topLevel).toBe(false);
  });

  it('기본(빈) 필터는 빈 문자열로 직렬화된다 (정규형 보존)', () => {
    expect(filtersToParams(EMPTY, 'list', null).toString()).toBe('');
  });

  it('topLevel=true 는 파싱·직렬화 라운드트립된다 (다른 필터 변경에도 보존)', () => {
    const f = parseFilters(new URLSearchParams('topLevel=true'));
    expect(f.topLevel).toBe(true);
    expect(filtersToParams({ ...f, q: 'x' }, 'list', null).toString()).toBe('q=x&topLevel=true');
  });

  it('구 URL 의 topLevel=false 는 기본값으로 흡수된다', () => {
    const f = parseFilters(new URLSearchParams('topLevel=false'));
    expect(f.topLevel).toBe(false);
    expect(filtersToParams(f, 'list', null).toString()).toBe('');
  });
});

describe('withDefaultIssueScope — 보드·목록 기본 범위 (#874)', () => {
  it('기본: 에픽 제외 + SUBTASK 제외 + 에픽 하위 노출(topLevel 끔)', () => {
    const f = withDefaultIssueScope(parseFilters(new URLSearchParams()));
    expect(f).toMatchObject({ topLevel: false, excludeSubtasks: true, excludeEpics: true });
  });

  it('유형 필터를 명시하면 에픽·SUBTASK 제외를 적용하지 않는다 (해당 유형을 직접 고를 수 있게)', () => {
    const f = withDefaultIssueScope(parseFilters(new URLSearchParams('type=7')));
    expect(f).toMatchObject({ excludeEpics: false, excludeSubtasks: false });
  });

  it('에픽 미할당(topLevel)은 유형 필터에 EPIC 이 있어도 에픽을 제외한다', () => {
    const f = withDefaultIssueScope(parseFilters(new URLSearchParams('topLevel=true&type=6,7')));
    expect(f.excludeEpics).toBe(true);
  });

  it('topLevel=true(에픽 미할당)면 에픽은 제외하고 SUBTASK 제외는 URL 값을 따른다', () => {
    const f = withDefaultIssueScope(parseFilters(new URLSearchParams('topLevel=true')));
    expect(f).toMatchObject({ topLevel: true, excludeSubtasks: false, excludeEpics: true });
  });

  it('excludeEpics 는 URL 로 직렬화되지 않는다 (파생 필드)', () => {
    const f = withDefaultIssueScope(parseFilters(new URLSearchParams()));
    expect(filtersToParams(f, 'list', null).get('excludeEpics')).toBeNull();
  });
});

describe('withDefaultIssueScope — 활성 사이클 밖 종료 이슈 숨김 (#876)', () => {
  it('기본: 숨김 켜짐, URL 에는 직렬화되지 않는다', () => {
    const f = withDefaultIssueScope(parseFilters(new URLSearchParams()));
    expect(f.hideInactiveClosed).toBe(true);
    const p = filtersToParams(f, 'list', null);
    expect(p.get('hideInactiveClosed')).toBeNull();
    expect(p.get('closed')).toBeNull();
  });

  it('closed=all(완료 모두 보기)이면 숨기지 않고 URL 왕복된다', () => {
    const parsed = parseFilters(new URLSearchParams('closed=all'));
    expect(parsed.showAllClosed).toBe(true);
    expect(withDefaultIssueScope(parsed).hideInactiveClosed).toBe(false);
    expect(filtersToParams(parsed, 'board', null).get('closed')).toBe('all');
  });

  it('상태·사이클·마일스톤·부모를 명시하면 그 선택이 우선해 숨기지 않는다', () => {
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('milestone=4'))).hideInactiveClosed).toBe(false);
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('parent=12'))).hideInactiveClosed).toBe(false);
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('status=DONE'))).hideInactiveClosed).toBe(false);
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('cycle=3'))).hideInactiveClosed).toBe(false);
  });
});

describe('excludeSubtasks 필터 (목록 SUBTASK 숨김)', () => {
  it('빈 URL 의 excludeSubtasks 기본값은 false (뷰가 진입 시 주입)', () => {
    expect(parseFilters(new URLSearchParams()).excludeSubtasks).toBe(false);
  });

  it('excludeSubtasks=true 는 파싱·직렬화 라운드트립된다 (true 일 때만 URL 명시)', () => {
    const f = parseFilters(new URLSearchParams('excludeSubtasks=true'));
    expect(f.excludeSubtasks).toBe(true);
    expect(filtersToParams(f, 'list', null).toString()).toBe('excludeSubtasks=true');
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
