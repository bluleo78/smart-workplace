import { describe, expect, it } from 'vitest';
import { clip, formatKstShort, headUtf16 } from './text-format.js';

// WP-1375: 지시문 글 다듬기 도우미 — 서로게이트 쌍을 쪼개지 않는 자르기와 KST 짧은 시각.
describe('text-format', () => {
  it('headUtf16 — max 이하면 그대로, 넘으면 앞 max 글자', () => {
    expect(headUtf16('abc', 3)).toBe('abc');
    expect(headUtf16('abcd', 3)).toBe('abc');
  });

  it('headUtf16 — 자르는 자리가 서로게이트 쌍 가운데면 그 쌍 앞에서 자른다', () => {
    expect(headUtf16('ab😀c', 3)).toBe('ab');
  });

  it('clip — 넘으면 앞부분에 「…」, 서로게이트 쌍은 쪼개지 않는다', () => {
    expect(clip('abc', 3)).toBe('abc');
    expect(clip('abcd', 3)).toBe('abc…');
    expect(clip('ab😀c', 3)).toBe('ab…');
  });

  it('formatKstShort — UTC 시각을 KST yyyy-MM-dd HH:mm 로, 못 읽으면 원문', () => {
    expect(formatKstShort('2026-11-04T15:30:00Z')).toBe('2026-11-05 00:30');
    expect(formatKstShort('nope')).toBe('nope');
  });
});
