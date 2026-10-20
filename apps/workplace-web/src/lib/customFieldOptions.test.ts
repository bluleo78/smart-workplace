import { describe, expect, it } from 'vitest';

import { formatFieldOptions, parseFieldOptions } from './customFieldOptions';

describe('프로젝트 필드 옵션 글 변환(WP-611)', () => {
  it('콤마로 나누고 앞뒤 공백·빈 항목을 버린다', () => {
    expect(parseFieldOptions(' 기획, 개발,  검수 ,,')).toEqual(['기획', '개발', '검수']);
    expect(parseFieldOptions('   ')).toEqual([]);
  });

  it('옵션 배열을 「a, b」 글로 — 없으면 빈 글', () => {
    expect(formatFieldOptions(['기획', '개발'])).toBe('기획, 개발');
    expect(formatFieldOptions(null)).toBe('');
  });

  it('글 → 배열 → 글이 같은 옵션을 유지한다', () => {
    expect(parseFieldOptions(formatFieldOptions(['A', 'B C']))).toEqual(['A', 'B C']);
  });
});
