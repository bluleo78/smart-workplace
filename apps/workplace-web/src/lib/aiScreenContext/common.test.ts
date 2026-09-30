import { describe, expect, it } from 'vitest';

import { buildFacts, buildRefs, chipLabel, clip, contextIdentity, fmtKst, LIMITS } from './common';

describe('clip', () => {
  it('상한 이하면 trim 만', () => expect(clip('  abc ', 10)).toBe('abc'));
  it('상한 초과면 말줄임 포함 max 자', () => {
    const out = clip('가'.repeat(300), LIMITS.label);
    expect(out).toHaveLength(LIMITS.label);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildFacts', () => {
  it('빈 값·false 는 제외, true 는 예, 숫자는 문자열', () => {
    expect(buildFacts([['상태', '진행 중'], ['검색어', ''], ['차단', false], ['보관', true], ['멤버', 3], ['x', null]])).toEqual([
      { label: '상태', value: '진행 중' },
      { label: '보관', value: '예' },
      { label: '멤버', value: '3' },
    ]);
  });
  it('모두 비면 undefined', () => expect(buildFacts([['a', '']])).toBeUndefined());
  it(`최대 ${LIMITS.facts}개, 값은 ${LIMITS.factValue}자로 자른다`, () => {
    const many = Array.from({ length: 20 }, (_, i) => [`k${i}`, 'v'.repeat(500)] as [string, string]);
    const out = buildFacts(many)!;
    expect(out).toHaveLength(LIMITS.facts);
    expect(out[0].value).toHaveLength(LIMITS.factValue);
  });
});

describe('buildRefs', () => {
  it('null 제외·숫자 문자열화', () => expect(buildRefs({ pageId: 7, spaceId: null })).toEqual({ pageId: '7' }));
});

describe('fmtKst', () => {
  it('ISO → KST YYYY-MM-DD HH:mm', () => expect(fmtKst('2026-09-30T01:05:00Z')).toBe('2026-09-30 10:05'));
  it('날짜만', () => expect(fmtKst('2026-09-30T16:00:00Z', false)).toBe('2026-10-01'));
});

describe('chipLabel', () => {
  it('focus 우선', () =>
    expect(chipLabel({ view: '이슈 상세', focus: { type: '이슈', label: 'WP-1 버그', refs: {} } })).toBe('이슈 WP-1 버그'));
  it('focus 없으면 view · scope', () => expect(chipLabel({ view: '메일함', scope: { label: '받은편지함' } })).toBe('메일함 · 받은편지함'));
  it('scope 라벨이 view 를 포함하면 scope 라벨만(중복 방지)', () => {
    expect(chipLabel({ view: '이슈 목록', scope: { label: '프로젝트 Workplace 이슈 목록' } })).toBe('프로젝트 Workplace 이슈 목록');
    expect(chipLabel({ view: '내 작업', scope: { label: '내 작업 · 내가 보고' } })).toBe('내 작업 · 내가 보고');
    expect(chipLabel({ view: 'AI 위임 작업', scope: { label: 'AI 위임 작업' } })).toBe('AI 위임 작업');
  });
  it('둘 다 없으면 view', () => expect(chipLabel({ view: '캘린더' })).toBe('캘린더'));
});

describe('contextIdentity', () => {
  const base = {
    view: '이슈 목록',
    scope: { label: '프로젝트 WP 이슈 목록', refs: { projectKey: 'WP' }, count: 3, hasMore: false, facts: [{ label: '상태', value: '할 일' }] },
  };
  it('null 이면 null', () => expect(contextIdentity(null)).toBeNull());
  it('휘발 값(count·hasMore·facts)은 무시한다', () => {
    const changed = { ...base, scope: { ...base.scope, count: 10, hasMore: true, facts: [{ label: '상태', value: '완료' }] } };
    expect(contextIdentity(changed)).toBe(contextIdentity(base));
  });
  it('focus facts 도 무시한다', () => {
    const a = { view: '이슈 상세', focus: { type: '이슈', label: 'WP-1 a', refs: { issueKey: 'WP-1' }, facts: [{ label: '상태', value: '할 일' }] } };
    const b = { ...a, focus: { ...a.focus, facts: [{ label: '상태', value: '완료' }] } };
    expect(contextIdentity(b)).toBe(contextIdentity(a));
  });
  it('refs·view·scope 라벨이 바뀌면 다른 키', () => {
    expect(contextIdentity({ ...base, scope: { ...base.scope, refs: { projectKey: 'XX' } } })).not.toBe(contextIdentity(base));
    expect(contextIdentity({ ...base, view: '보드' })).not.toBe(contextIdentity(base));
    expect(contextIdentity({ ...base, scope: { ...base.scope, label: '다른 범위' } })).not.toBe(contextIdentity(base));
    const f1 = { view: '이슈 상세', focus: { type: '이슈', label: 'x', refs: { issueKey: 'WP-1' } } };
    const f2 = { view: '이슈 상세', focus: { type: '이슈', label: 'x', refs: { issueKey: 'WP-2' } } };
    expect(contextIdentity(f1)).not.toBe(contextIdentity(f2));
  });
});
