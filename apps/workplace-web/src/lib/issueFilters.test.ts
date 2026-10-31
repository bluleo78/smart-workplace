import { describe, expect, it } from 'vitest';

import {
  carrySort,
  carryViewOptions,
  filterOnlyKey,
  filtersToParams,
  overridesClosedHiding,
  parseFilters,
  parseGroupBy,
  parseGroupParam,
  resolveListGroupBy,
  toClientGroupBy,
  withDefaultIssueScope,
  withoutSort,
} from './issueFilters';

const EMPTY = parseFilters(new URLSearchParams());

// WP-886: 우선순위 URL 토큰은 5단계만 통과하고 모르는 토큰(URGENT 등)은 버린다.
describe('parseFilters — 우선순위 5단계', () => {
  it('HIGHEST·LOWEST 를 포함한 5단계를 읽고 모르는 값은 버린다', () => {
    const f = parseFilters(new URLSearchParams('priority=HIGHEST,LOWEST,URGENT,MID'));
    expect(f.priorities).toEqual(['HIGHEST', 'LOWEST', 'MID']);
    expect(filtersToParams(f, 'list', null).get('priority')).toBe('HIGHEST,LOWEST,MID');
  });
});

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

  it('상태·사이클·마일스톤을 명시하면 그 선택이 우선해 숨기지 않는다', () => {
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('milestone=4'))).hideInactiveClosed).toBe(false);
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('status=DONE'))).hideInactiveClosed).toBe(false);
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('cycle=3'))).hideInactiveClosed).toBe(false);
  });

  it('에픽 선택(parent)은 숨김을 풀지 않고 「완료 모두 보기」를 따른다(WP-390)', () => {
    const epic = parseFilters(new URLSearchParams('parent=12'));
    expect(overridesClosedHiding(epic)).toBe(false);
    expect(withDefaultIssueScope(epic).hideInactiveClosed).toBe(true);
    expect(withDefaultIssueScope(parseFilters(new URLSearchParams('parent=12&closed=all'))).hideInactiveClosed).toBe(false);
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

describe('carryViewOptions', () => {
  it('보드 뷰면 이전 boardTab 을 이어 붙인다', () => {
    const next = carryViewOptions(new URLSearchParams('view=board&q=x'), new URLSearchParams('view=board&boardTab=3'));
    expect(next.get('boardTab')).toBe('3');
    expect(next.get('q')).toBe('x');
  });
  it('목록 뷰로 바뀌면 버린다, 이전에 없으면 그대로', () => {
    expect(carryViewOptions(new URLSearchParams('q=x'), new URLSearchParams('view=board&boardTab=3')).has('boardTab')).toBe(false);
    expect(carryViewOptions(new URLSearchParams('view=board'), new URLSearchParams('view=board')).has('boardTab')).toBe(false);
  });
});

// WP-808 — 「상태」(프로젝트 상태 id, statusId)와 「상태 범주」(기존 status)를 따로 둔다.
describe('statusIds(상태) 와 statuses(상태 범주) 분리 (WP-808)', () => {
  it('parseFilters: statusId=12,abc,13 → statusIds [12,13]', () => {
    expect(parseFilters(new URLSearchParams('statusId=12,abc,13')).statusIds).toEqual([12, 13]);
  });
  it('parseFilters: status=IN_PROGRESS 는 statuses 로 그대로(상태 범주)', () => {
    const f = parseFilters(new URLSearchParams('status=IN_PROGRESS'));
    expect(f.statuses).toEqual(['IN_PROGRESS']);
    expect(f.statusIds).toEqual([]);
  });
  it('filtersToParams: statusIds 를 statusId CSV 로 쓴다', () => {
    const p = filtersToParams({ ...EMPTY, statusIds: [12, 13], statuses: ['DONE'] }, 'list', null);
    expect(p.get('statusId')).toBe('12,13');
    expect(p.get('status')).toBe('DONE');
    expect(parseFilters(p).statusIds).toEqual([12, 13]);
  });
  it('overridesClosedHiding: statusIds 만 있어도 true', () => {
    expect(overridesClosedHiding({ ...EMPTY, statusIds: [12] })).toBe(true);
    expect(overridesClosedHiding(EMPTY)).toBe(false);
  });
});

// WP-858: id·날짜 토큰은 서버가 받는 값만 — 1.5·1e20 같은 값이 서버로 가 400 → 「검색 결과 없음」으로 보이던 문제.
describe('parseFilters — id 토큰 정수 검사', () => {
  it('소수·안전 정수 범위를 넘는 값·지수 표기는 버리고 양의 정수만 남긴다', () => {
    const f = parseFilters(
      new URLSearchParams(
        'label=1.5,3,99999999999999999999&cycle=2.0,4&milestone=1e3,5&type=0.5,6&assignee=7.1,8,null&parent=9.5',
      ),
    );
    expect(f.labelIds).toEqual([3]);
    expect(f.cycleIds).toEqual([4]);
    expect(f.milestoneIds).toEqual([5]);
    expect(f.typeIds).toEqual([6]);
    expect(f.assigneeIds).toEqual([8]);
    expect(f.includeUnassigned).toBe(true);
    expect(f.parentNumber).toBeNull();
  });

  it('양의 정수 parent 는 받고, 서버 int 범위를 넘으면 버린다', () => {
    expect(parseFilters(new URLSearchParams('parent=12')).parentNumber).toBe(12);
    expect(parseFilters(new URLSearchParams('parent=2147483647')).parentNumber).toBe(2147483647);
    expect(parseFilters(new URLSearchParams('parent=3000000000')).parentNumber).toBeNull();
  });

  it('마감 범위는 실제로 있는 yyyy-MM-dd 만 받는다', () => {
    const ok = parseFilters(new URLSearchParams('dueFrom=2026-02-28&dueTo=2028-02-29'));
    expect(ok.dueFrom).toBe('2026-02-28');
    expect(ok.dueTo).toBe('2028-02-29');
    const bad = parseFilters(new URLSearchParams('dueFrom=2026-13-99&dueTo=tomorrow'));
    expect(bad.dueFrom).toBeNull();
    expect(bad.dueTo).toBeNull();
    expect(parseFilters(new URLSearchParams('dueFrom=2026-02-30')).dueFrom).toBeNull();
  });
});

describe('closedIn 완료일 기간 (WP-873)', () => {
  it('URL 왕복 — 프리셋·직접 지정 토큰 모두 보존된다', () => {
    for (const token of ['last-week', '2026-10-12~2026-10-18']) {
      const parsed = parseFilters(new URLSearchParams({ closedIn: token }));
      expect(parsed.closedIn).toBe(token);
      expect(filtersToParams(parsed, 'list', null).get('closedIn')).toBe(token);
    }
  });

  it('없으면 null 이고 URL 에도 싣지 않는다', () => {
    expect(EMPTY.closedIn).toBeNull();
    expect(filtersToParams(EMPTY, 'list', null).has('closedIn')).toBe(false);
  });

  it('잘못된 토큰(모르는 값·없는 날짜·from>to)은 버려 필터 없음과 같다', () => {
    for (const bad of ['yesterday', '2026-13-01~2026-13-02', '2026-10-18~2026-10-12']) {
      expect(parseFilters(new URLSearchParams({ closedIn: bad })).closedIn).toBeNull();
    }
  });

  it('「완료 모두 보기」(closed=all)와 별개 키다', () => {
    const parsed = parseFilters(new URLSearchParams('closed=all'));
    expect(parsed.closedIn).toBeNull();
    expect(parsed.showAllClosed).toBe(true);
  });

  it('완료일 기간을 고르면 종료 이슈 숨김(#876)이 풀린다', () => {
    expect(overridesClosedHiding({ ...EMPTY, closedIn: 'last-week' })).toBe(true);
    expect(withDefaultIssueScope({ ...EMPTY, closedIn: 'last-week' }).hideInactiveClosed).toBe(false);
    expect(overridesClosedHiding(EMPTY)).toBe(false);
  });
});

describe('carryViewOptions — 열 구성(WP-270)', () => {
  // 열 구성(WP-270)은 필터가 아니라 표시 옵션 — 필터·view·group 을 다시 써도 이어 붙인다. 빈 값(cols=)은 「모두 끔」이라 지우면 안 된다.
  it('이전 cols 를 view 와 무관하게 그대로 이어 붙인다 — 빈 값(모두 끔)도', () => {
    expect(carryViewOptions(new URLSearchParams('q=x'), new URLSearchParams('cols=reporter,due')).get('cols')).toBe('reporter,due');
    expect(carryViewOptions(new URLSearchParams('view=board'), new URLSearchParams('cols=reporter')).get('cols')).toBe('reporter');
    const empty = carryViewOptions(new URLSearchParams('q=x'), new URLSearchParams('cols='));
    expect(empty.has('cols')).toBe(true);
    expect(empty.get('cols')).toBe('');
    expect(carryViewOptions(new URLSearchParams('q=x'), new URLSearchParams('q=y')).has('cols')).toBe(false);
  });
});

// WP-933: 구성요소 필터 — URL component = id CSV + 「구성요소 없음」 none 토큰(OR).
describe('구성요소 필터 왕복', () => {
  it('component=3,5 ↔ componentIds', () => {
    const f = parseFilters(new URLSearchParams('component=3,5'));
    expect(f.componentIds).toEqual([3, 5]);
    expect(f.componentNone).toBe(false);
    expect(filtersToParams(f, 'list', null).get('component')).toBe('3,5');
  });

  it('none 토큰은 componentNone 으로, 함께 쓰면 id 뒤에 none 을 붙인다', () => {
    const f = parseFilters(new URLSearchParams('component=none,4,x'));
    expect(f.componentIds).toEqual([4]);
    expect(f.componentNone).toBe(true);
    expect(filtersToParams(f, 'list', null).get('component')).toBe('4,none');
    expect(filtersToParams({ ...EMPTY, componentNone: true }, 'list', null).get('component')).toBe('none');
  });

  it('비어 있으면 키를 쓰지 않는다', () => {
    expect(EMPTY.componentIds).toEqual([]);
    expect(EMPTY.componentNone).toBe(false);
    expect(filtersToParams(EMPTY, 'list', null).has('component')).toBe(false);
  });

  it('묶음 필터가 아니라 종료 이슈 숨김을 풀지 않는다', () => {
    expect(overridesClosedHiding({ ...EMPTY, componentIds: [1], componentNone: true })).toBe(false);
  });
});

// WP-888: 수정 버전·영향 버전 필터 — URL fixVersion·affectsVersion = id CSV + none 토큰(각각 OR, 서로 AND 는 서버 몫).
describe('버전 필터 왕복', () => {
  it('fixVersion·affectsVersion 이 각자 id 로 왕복한다', () => {
    const f = parseFilters(new URLSearchParams('fixVersion=3,5&affectsVersion=7'));
    expect(f.fixVersionIds).toEqual([3, 5]);
    expect(f.affectsVersionIds).toEqual([7]);
    expect(f.fixVersionNone).toBe(false);
    const p = filtersToParams(f, 'list', null);
    expect(p.get('fixVersion')).toBe('3,5');
    expect(p.get('affectsVersion')).toBe('7');
  });

  it('none 토큰은 각 필터의 「없음」으로, 이름 같은 모르는 토큰은 버린다', () => {
    const f = parseFilters(new URLSearchParams('fixVersion=none,4,x&affectsVersion=NONE'));
    expect(f.fixVersionIds).toEqual([4]);
    expect(f.fixVersionNone).toBe(true);
    expect(f.affectsVersionIds).toEqual([]);
    expect(f.affectsVersionNone).toBe(true);
    const p = filtersToParams(f, 'list', null);
    expect(p.get('fixVersion')).toBe('4,none');
    expect(p.get('affectsVersion')).toBe('none');
  });

  it('비어 있으면 키를 쓰지 않는다(모두 지우기 포함)', () => {
    expect(filtersToParams(EMPTY, 'list', null).has('fixVersion')).toBe(false);
    expect(filtersToParams(EMPTY, 'list', null).has('affectsVersion')).toBe(false);
  });

  it('버전 필터는 종료 이슈 숨김을 푼다 — 버전 상세의 「이슈 목록에서 열기」와 같은 묶음이 보이게', () => {
    expect(overridesClosedHiding({ ...EMPTY, fixVersionIds: [1] })).toBe(true);
    expect(overridesClosedHiding({ ...EMPTY, fixVersionNone: true })).toBe(true);
    expect(overridesClosedHiding({ ...EMPTY, affectsVersionIds: [1] })).toBe(true);
    expect(overridesClosedHiding({ ...EMPTY, affectsVersionNone: true })).toBe(true);
    expect(withDefaultIssueScope({ ...EMPTY, fixVersionIds: [1] }).hideInactiveClosed).toBe(false);
    expect(withDefaultIssueScope(EMPTY).hideInactiveClosed).toBe(true);
  });
});

// WP-1238: 정렬(sort·direction) — 알려진 한 기준만 통과, 방향은 asc/desc(없거나 모르면 desc), 직렬화는 방향까지 늘 적는다.
describe('정렬 sort·direction (WP-1238)', () => {
  const parse = (q: string) => parseFilters(new URLSearchParams(q));

  it('알려진 기준과 방향을 읽고 그대로 직렬화한다', () => {
    const f = parse('sort=dueDate&direction=asc');
    expect(f.sort).toBe('dueDate');
    expect(f.direction).toBe('asc');
    expect(filtersToParams(f, 'list', null).toString()).toBe('sort=dueDate&direction=asc');
  });

  it('방향이 없거나 모르는 값이면 서버 기본과 같은 desc 로 읽고, 직렬화에 desc 를 적는다', () => {
    expect(parse('sort=priority').direction).toBe('desc');
    expect(parse('sort=priority&direction=sideways').direction).toBe('desc');
    expect(filtersToParams(parse('sort=priority'), 'list', null).toString()).toBe('sort=priority&direction=desc');
  });

  it('모르는 기준은 sort·direction 을 모두 버린다 — 필드가 아예 없어 기본 필터와 같은 모양이다', () => {
    const f = parse('sort=title&direction=asc');
    expect('sort' in f).toBe(false);
    expect('direction' in f).toBe(false);
    expect(f).toEqual(EMPTY);
    expect(filtersToParams(f, 'list', null).toString()).toBe('');
  });

  it('direction 은 대소문자를 가리지 않는다(서버와 같다)', () => {
    expect(parse('sort=dueDate&direction=ASC').direction).toBe('asc');
    expect(parse('sort=dueDate&direction=Desc').direction).toBe('desc');
  });

  it('수정일 내림차순은 서버 기본과 같아 정렬 없음으로 읽는다 — 같은 순서가 두 주소로 갈라지지 않게', () => {
    expect(filtersToParams(parse('sort=updatedAt&direction=desc'), 'list', null).toString()).toBe('');
    expect(filtersToParams(parse('sort=updatedAt'), 'list', null).toString()).toBe('');
    expect(filtersToParams(parse('sort=updatedAt&direction=asc'), 'list', null).toString()).toBe('sort=updatedAt&direction=asc');
  });

  it('sort 없이 온 direction 은 버린다', () => {
    expect(filtersToParams(parse('direction=asc'), 'list', null).toString()).toBe('');
  });

  it('CSV(여러 기준)는 첫 기준·첫 방향만 쓴다 — 화면은 한 기준만 고른다', () => {
    const f = parse('sort=assignee,dueDate&direction=asc,desc');
    expect(f.sort).toBe('assignee');
    expect(f.direction).toBe('asc');
  });

  it('다른 필터와 함께 라운드트립된다', () => {
    const q = filtersToParams(parse('priority=HIGH&sort=createdAt&direction=asc'), 'board', 'status').toString();
    expect(parse(q)).toMatchObject({ priorities: ['HIGH'], sort: 'createdAt', direction: 'asc' });
  });

  it('withoutSort 는 정렬만 빼 「필터 없음」 판정이 정렬에 흔들리지 않게 한다', () => {
    const f = parse('sort=status&direction=asc');
    expect(filtersToParams(withoutSort(f), 'list', null).toString()).toBe('');
    // 정렬이 없으면 같은 객체를 그대로 돌려준다(메모 의존값이 깨지지 않게).
    expect(withoutSort(EMPTY)).toBe(EMPTY);
  });

  it('filterOnlyKey 는 정렬·보기·그룹을 빼고 필터만의 정규형을 만든다', () => {
    expect(filterOnlyKey(parse('sort=status&direction=asc'))).toBe('');
    expect(filterOnlyKey(parse('priority=HIGH&sort=status&direction=asc'))).toBe('priority=HIGH');
  });

  it('carrySort 는 이전 쿼리의 정렬만 옮기고, 정렬이 없거나 무효면 아무것도 붙이지 않는다', () => {
    expect(carrySort(new URLSearchParams('view=board'), new URLSearchParams('priority=HIGH&sort=dueDate&direction=asc')).toString())
      .toBe('view=board&sort=dueDate&direction=asc');
    expect(carrySort(new URLSearchParams(), new URLSearchParams('sort=bogus')).toString()).toBe('');
  });

  it('carryViewOptions 는 정렬을 되살리지 않는다 — 「기본으로」가 정렬을 실제로 지울 수 있게', () => {
    const next = filtersToParams(EMPTY, 'list', null);
    expect(carryViewOptions(next, new URLSearchParams('sort=dueDate&direction=asc')).has('sort')).toBe(false);
  });
});
