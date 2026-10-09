import { describe, expect, it } from 'vitest';

import { toSingleLine } from './singleLine';

describe('toSingleLine', () => {
  it('LF·CR·CRLF 를 각각 공백 하나로 바꾼다', () => {
    expect(toSingleLine('a\nb\rc\r\nd')).toBe('a b c d');
  });
  it('개행이 없으면 그대로다', () => {
    expect(toSingleLine('긴 제목 그대로')).toBe('긴 제목 그대로');
  });
});
