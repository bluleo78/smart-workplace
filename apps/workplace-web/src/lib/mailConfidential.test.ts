// 기밀 메일 머리말(WP-2029) 순수 함수 — 칸 글자에서 [기밀] 머리말을 떼는 규칙을 고정한다.
import { describe, expect, it } from 'vitest';

import { CONFIDENTIAL_PREFIX, showsConfidentialPrefix, stripConfidentialPrefix } from './mailConfidential';

describe('stripConfidentialPrefix', () => {
  it('앞의 [기밀] 과 뒤 공백을 뗀다', () => {
    expect(stripConfidentialPrefix('[기밀] 견적')).toBe('견적');
  });
  it('맨 앞 공백 뒤의 [기밀] 도 뗀다', () => {
    expect(stripConfidentialPrefix('  [기밀]견적')).toBe('견적');
  });
  it('중간에 낀 [기밀] 은 남긴다(답장 제목 「RE: [기밀] …」을 바꾸지 않는다)', () => {
    expect(stripConfidentialPrefix('RE: [기밀] 단가')).toBe('RE: [기밀] 단가');
  });
  it('맨 앞 머리말만 떼고 뒤의 글자·공백은 그대로 둔다', () => {
    expect(stripConfidentialPrefix('[기밀] 견적  초안 [기밀]')).toBe('견적  초안 [기밀]');
  });
  it('머리말이 없으면 그대로', () => {
    expect(stripConfidentialPrefix('견적')).toBe('견적');
  });
  it('머리말이 없으면 연속 공백도 그대로', () => {
    expect(stripConfidentialPrefix('견적  초안')).toBe('견적  초안');
  });
  it('맨 앞에 겹쳐 든 머리말은 모두 뗀다', () => {
    expect(stripConfidentialPrefix('[기밀] [기밀] 견적')).toBe('견적');
  });
  it('머리말 문구는 [기밀]', () => {
    expect(CONFIDENTIAL_PREFIX).toBe('[기밀]');
  });
});

describe('showsConfidentialPrefix', () => {
  it('기밀이고 제목에 [기밀] 이 없으면 머리말을 그린다', () => {
    expect(showsConfidentialPrefix(true, '견적')).toBe(true);
  });
  it('제목 어디든 [기밀] 이 있으면 서버가 더 붙이지 않으므로 그리지 않는다', () => {
    expect(showsConfidentialPrefix(true, 'RE: [기밀] 단가')).toBe(false);
    expect(showsConfidentialPrefix(true, '견적 [기밀]')).toBe(false);
  });
  it('기밀이 아니면 그리지 않는다', () => {
    expect(showsConfidentialPrefix(false, '견적')).toBe(false);
  });
});
