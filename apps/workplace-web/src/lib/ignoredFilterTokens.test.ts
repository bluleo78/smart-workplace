// WP-2083 — 주소에서 버려지는 필터 토큰 판정 단위 테스트.
import { describe, expect, it } from 'vitest';

import { ignoredFilterTokens, withoutIgnoredFilterTokens } from './ignoredFilterTokens';

const ign = (qs: string) => ignoredFilterTokens(new URLSearchParams(qs));

describe('ignoredFilterTokens', () => {
  it('모르는 상태 범주', () => {
    expect(ign('status=BOGUS')).toEqual([{ key: 'status', label: '상태 범주', value: 'BOGUS' }]);
  });
  it('쉼표 목록에서는 모르는 토큰만', () => {
    expect(ign('priority=HIGH,BOGUS')).toEqual([{ key: 'priority', label: '우선순위', value: 'BOGUS' }]);
  });
  it('null·none 과 양의 정수는 살고 나머지는 버려진다', () => {
    expect(ign('assignee=null,3,abc&component=none,x')).toEqual([
      { key: 'assignee', label: '담당자', value: 'abc' },
      { key: 'component', label: '구성요소', value: 'x' },
    ]);
  });
  it('NULL·NONE 대소문자는 살아남는다', () => {
    expect(ign('assignee=NULL&component=None')).toEqual([]);
  });
  it('대소문자 무시는 null·none 에만 — 나머지는 정확히 비교한다', () => {
    expect(ign('priority=HIGH,high')).toEqual([{ key: 'priority', label: '우선순위', value: 'high' }]);
    expect(ign('status=TODO,todo')).toEqual([{ key: 'status', label: '상태 범주', value: 'todo' }]);
  });
  it('전체 값 키는 다듬지 않은 원래 값으로 판정한다', () => {
    expect(ignoredFilterTokens(new URLSearchParams({ parent: ' 12' }))).toEqual([{ key: 'parent', label: '상위 이슈', value: ' 12' }]);
    expect(ignoredFilterTokens(new URLSearchParams({ dueFrom: '2026-11-11 ' }))).toEqual([
      { key: 'dueFrom', label: '마감 시작', value: '2026-11-11 ' },
    ]);
    expect(ignoredFilterTokens(new URLSearchParams({ parent: '  ' }))).toEqual([]);
  });
  it('정렬은 모르는 기준만', () => {
    expect(ign('sort=bogus')).toEqual([{ key: 'sort', label: '정렬', value: 'bogus' }]);
    expect(ign('sort=updatedAt&direction=desc')).toEqual([]);
  });
  it('빈 값·불리언·보기·AI 키는 보지 않는다', () => {
    expect(ign('status=&topLevel=false&closed=nope&view=board&aiChat=1')).toEqual([]);
  });
  it('날짜·상위 이슈·완료 기간은 통째로 판정한다', () => {
    expect(ign('dueFrom=2026-13-99&parent=0&closedIn=zzz')).toEqual([
      { key: 'dueFrom', label: '마감 시작', value: '2026-13-99' },
      { key: 'parent', label: '상위 이슈', value: '0' },
      { key: 'closedIn', label: '완료 기간', value: 'zzz' },
    ]);
  });
  it('올바른 날짜·상위 이슈·완료 기간은 버려지지 않는다', () => {
    expect(ign('dueFrom=2026-11-11&parent=12&closedIn=last-week')).toEqual([]);
  });
});

describe('withoutIgnoredFilterTokens', () => {
  it('버려진 토큰만 빼고 나머지 키는 그대로 둔다', () => {
    const out = withoutIgnoredFilterTokens(new URLSearchParams('priority=HIGH,BOGUS&status=BOGUS&view=board&aiChat=1'));
    expect(out.toString()).toBe('priority=HIGH&view=board&aiChat=1');
  });
  it('대소문자만 다른 토큰도 뺀다', () => {
    expect(withoutIgnoredFilterTokens(new URLSearchParams('priority=HIGH,high')).toString()).toBe('priority=HIGH');
  });
  it('정렬을 지우면 direction 도 지운다', () => {
    expect(withoutIgnoredFilterTokens(new URLSearchParams('sort=bogus&direction=asc&view=board')).toString()).toBe('view=board');
  });
  it('통째 키는 지운다', () => {
    expect(withoutIgnoredFilterTokens(new URLSearchParams('parent=0&q=a')).toString()).toBe('q=a');
  });
});
