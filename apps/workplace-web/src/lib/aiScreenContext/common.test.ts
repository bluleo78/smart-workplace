import { describe, expect, it } from 'vitest';

import { buildFacts, buildRefs, chipLabel, clip, contextKey, fmtKst, LIMITS } from './common';

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

describe('chipLabel / contextKey', () => {
  it('focus 우선', () =>
    expect(chipLabel({ view: '이슈 상세', focus: { type: '이슈', label: 'WP-1 버그', refs: {} } })).toBe('이슈 WP-1 버그'));
  it('focus 없으면 view · scope', () => expect(chipLabel({ view: '메일함', scope: { label: '받은편지함' } })).toBe('메일함 · 받은편지함'));
  it('둘 다 없으면 view', () => expect(chipLabel({ view: '캘린더' })).toBe('캘린더'));
  it('contextKey 는 null 안전', () => expect(contextKey(null)).toBeNull());
});
