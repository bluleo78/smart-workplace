// 기밀 메일 머리말(WP-2029) 순수 함수 — 칸 글자에서 [기밀] 머리말을 떼는 규칙을 고정한다.
import { describe, expect, it } from 'vitest';

import { CONFIDENTIAL_PREFIX, stripConfidentialPrefix } from './mailConfidential';

describe('stripConfidentialPrefix', () => {
  it('앞의 [기밀] 과 뒤 공백을 뗀다', () => {
    expect(stripConfidentialPrefix('[기밀] 견적')).toBe('견적');
  });
  it('중간에 낀 [기밀] 도 뗀다', () => {
    expect(stripConfidentialPrefix('RE: [기밀] 단가')).toBe('RE: 단가');
  });
  it('머리말이 없으면 그대로', () => {
    expect(stripConfidentialPrefix('견적')).toBe('견적');
  });
  it('머리말이 없으면 연속 공백도 그대로', () => {
    expect(stripConfidentialPrefix('견적  초안')).toBe('견적  초안');
  });
  it('여러 번 들어 있어도 모두 뗀다', () => {
    expect(stripConfidentialPrefix('[기밀] [기밀] 견적')).toBe('견적');
  });
  it('머리말 문구는 [기밀]', () => {
    expect(CONFIDENTIAL_PREFIX).toBe('[기밀]');
  });
});
