import { describe, expect, it } from 'vitest';

import {
  normalizeIssueQuery,
  normalizeIssueQueryIgnoringView,
  normalizeIssueQueryIgnoringViewAndGroup,
  queriesEqual,
  queriesEqualIgnoringView,
  queryHasNoFilters,
  savedViewHasColumns,
  savedViewMatches,
  savedViewQueryToParams,
  savedViewShowsDisplayChoice,
  savedViewUpdateQuery,
  syncSavedViewColumns,
  withoutColumns,
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

// #773 — "전체" 칩 활성 판정용. group 은 표시 옵션이라 필터가 없으면 그룹만 바꿔도 빈 정규형이어야 한다(WP-412 에서 E2E 이관).
describe('normalizeIssueQueryIgnoringViewAndGroup (#773)', () => {
  it('group·view 만 있으면 빈 정규형("전체" 활성)', () => {
    expect(normalizeIssueQueryIgnoringViewAndGroup('group=status')).toBe('');
    expect(normalizeIssueQueryIgnoringViewAndGroup('group=priority&view=board')).toBe('');
  });

  it('필터가 있으면 group 과 무관하게 비지 않는다', () => {
    expect(normalizeIssueQueryIgnoringViewAndGroup('group=status&status=TODO')).toBe('status=TODO');
  });
});

// 열 구성(cols, WP-270)은 필터 정규형에서 빠진다 — 필터만 보는 비교와 「전체」 판정은 cols 를 무시한다.
// 열까지 보는 저장 뷰 일치(열을 담은 뷰만)는 아래 savedViewMatches 가 따로 맡는다.
describe('필터 정규형 비교는 cols 를 무시한다', () => {
  it('cols 유무·값이 달라도 같은 뷰로 본다', () => {
    expect(queriesEqualIgnoringView('priority=HIGH&group=none', 'priority=HIGH&group=none&cols=reporter')).toBe(true);
    expect(queriesEqualIgnoringView('priority=HIGH&cols=', 'priority=HIGH&cols=due,closed')).toBe(true);
    expect(queriesEqual('status=TODO&cols=due', 'status=TODO')).toBe(true);
  });
  it('cols 만 있는 쿼리는 「전체」(필터 없음) 정규형', () => {
    expect(normalizeIssueQueryIgnoringViewAndGroup('group=cycle&cols=reporter')).toBe('');
  });
  it('저장 뷰를 적용할 때는 cols 를 그대로 URL 에 싣는다', () => {
    expect(savedViewQueryToParams('priority=HIGH&cols=reporter').get('cols')).toBe('reporter');
    expect(savedViewQueryToParams('priority=HIGH').has('cols')).toBe(false);
  });
});

// 열 구성은 고를 때만 저장된 뷰에 담긴다(WP-270 사용자 결정, 스펙 4.7) — cols 를 담은 뷰만 열이 비교·갱신 대상이다.
describe('열을 담은 저장 뷰(cols 옵트인)', () => {
  it('savedViewHasColumns — cols 파라미터가 있으면(빈 값 「모두 끔」 포함) 열을 담은 뷰', () => {
    expect(savedViewHasColumns('priority=HIGH&cols=reporter')).toBe(true);
    expect(savedViewHasColumns('priority=HIGH&cols=')).toBe(true);
    expect(savedViewHasColumns('priority=HIGH')).toBe(false);
  });

  it('withoutColumns — cols 만 빼고 나머지는 그대로', () => {
    expect(withoutColumns('priority=HIGH&group=none&cols=reporter')).toBe('priority=HIGH&group=none');
    expect(withoutColumns('priority=HIGH')).toBe('priority=HIGH');
  });

  it('cols 없는 뷰 — 현재 열이 무엇이든 필터만 같으면 일치', () => {
    expect(savedViewMatches('priority=HIGH&group=none&cols=reporter', 'priority=HIGH&group=none')).toBe(true);
    expect(savedViewMatches('priority=HIGH&group=none&cols=', 'priority=HIGH&group=none')).toBe(true);
    expect(savedViewMatches('priority=MID&group=none&cols=reporter', 'priority=HIGH&group=none')).toBe(false);
  });

  it('cols 를 담은 뷰 — 열 집합까지 같아야 일치(순서·공백 무관)', () => {
    const view = 'priority=HIGH&group=none&cols=assignee,milestone';
    expect(savedViewMatches('priority=HIGH&group=none&cols=assignee,milestone', view)).toBe(true);
    expect(savedViewMatches('priority=HIGH&group=none&cols=milestone,assignee', view)).toBe(true);
    // 열만 달라도 불일치 → 그 뷰가 활성이면 「수정됨」.
    expect(savedViewMatches('priority=HIGH&group=none&cols=assignee,reporter,milestone', view)).toBe(false);
    expect(savedViewMatches('priority=HIGH&group=none&cols=', view)).toBe(false);
    // 현재 쿼리에 cols 가 없으면(열 정보 없음) 열을 담은 뷰와는 일치하지 않는다.
    expect(savedViewMatches('priority=HIGH&group=none', view)).toBe(false);
  });

  it('cols= (모두 끔)을 담은 뷰는 현재도 모두 끔일 때만 일치', () => {
    expect(savedViewMatches('priority=HIGH&cols=', 'priority=HIGH&cols=')).toBe(true);
    expect(savedViewMatches('priority=HIGH&cols=due', 'priority=HIGH&cols=')).toBe(false);
  });

  it('savedViewUpdateQuery — 뷰의 선택을 지킨다: 열을 담은 뷰면 현재 열을 싣고, 아니면 cols 를 뺀다', () => {
    const current = 'priority=MID&group=none&cols=assignee,reporter';
    expect(savedViewUpdateQuery('priority=HIGH&cols=assignee', current)).toBe(current);
    expect(savedViewUpdateQuery('priority=HIGH&cols=', current)).toBe(current);
    expect(savedViewUpdateQuery('priority=HIGH', current)).toBe('priority=MID&group=none');
  });
});

// 뷰를 저장·갱신한 직후 화면을 「그 뷰를 연 상태」 와 같게 — URL cols 를 저장된 뷰에 맞춘다.
describe('syncSavedViewColumns', () => {
  it('열을 담은 뷰면 URL cols 를 뷰의 열로(다른 파라미터 유지)', () => {
    const next = syncSavedViewColumns(new URLSearchParams('priority=HIGH&group=none'), 'priority=HIGH&cols=priority,reporter');
    expect(next.get('cols')).toBe('priority,reporter');
    expect(next.get('priority')).toBe('HIGH');
    expect(next.get('group')).toBe('none');
    expect(syncSavedViewColumns(new URLSearchParams('priority=HIGH'), 'priority=HIGH&cols=').get('cols')).toBe('');
  });
  it('열을 담지 않은 뷰면 URL cols 를 뺀다 — 개인 열로', () => {
    const next = syncSavedViewColumns(new URLSearchParams('priority=HIGH&cols=milestone'), 'priority=HIGH');
    expect(next.has('cols')).toBe(false);
    expect(next.get('priority')).toBe('HIGH');
  });
});

// WP-1238: 정렬은 그룹·열과 같은 보기 선택 — 「전체」(필터 없음) 판정엔 들지 않고, 정렬만 담은 뷰는 주소로 열어도 그 뷰 칩이 켜진다.
describe('정렬(sort·direction)', () => {
  it('정렬만 걸린 쿼리는 필터 없음이다', () => {
    expect(queryHasNoFilters('sort=dueDate&direction=asc')).toBe(true);
  });

  it('정렬만 담은 저장 뷰는 보기 선택을 담은 뷰로 본다', () => {
    expect(savedViewShowsDisplayChoice('group=none&sort=dueDate&direction=asc')).toBe(true);
    // 기본과 같은 정렬(수정일 내림차순)은 정렬 없음 — 보기 선택이 아니다.
    expect(savedViewShowsDisplayChoice('group=none&sort=updatedAt&direction=desc')).toBe(false);
    expect(savedViewShowsDisplayChoice('group=none')).toBe(false);
  });

  it('저장 뷰 비교는 정렬 차이를 본다(그룹과 같다)', () => {
    expect(queriesEqualIgnoringView('sort=dueDate&direction=asc', 'sort=dueDate&direction=desc')).toBe(false);
    expect(queriesEqualIgnoringView('direction=asc&sort=dueDate', 'sort=dueDate&direction=asc')).toBe(true);
  });
});
