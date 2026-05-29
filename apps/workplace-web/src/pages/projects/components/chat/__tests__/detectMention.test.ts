// detectMention 순수 함수 단위 테스트 — caret 직전 텍스트에서 @mention 토큰 검출 동작을 고정.
// 정상 케이스 + 경계 케이스(빈 query / 글자 뒤 @ / @ 없음 / 공백으로 끊김) 를 모두 검증한다.
import { describe, expect, it } from 'vitest';

import { detectMention } from '../detectMention';

describe('detectMention', () => {
  it('caret 직전 @abc 를 검출한다', () => {
    expect(detectMention('hello @abc')).toEqual({ query: 'abc', anchor: 6 });
  });

  it('문장 시작의 @ 도 검출한다', () => {
    expect(detectMention('@foo')).toEqual({ query: 'foo', anchor: 0 });
  });

  it('빈 query (@ 만 입력) 도 검출한다 — 전체 멤버 표시', () => {
    expect(detectMention('hi @')).toEqual({ query: '', anchor: 3 });
  });

  it('영문/숫자/.-_ 외 문자는 mention 토큰을 끊는다', () => {
    expect(detectMention('hi @foo bar')).toBeNull();
  });

  it('@ 앞이 글자면 mention 으로 보지 않는다 (email 등 오인 방지)', () => {
    expect(detectMention('a@bc')).toBeNull();
  });

  it('@ 가 전혀 없으면 null', () => {
    expect(detectMention('hello world')).toBeNull();
  });
});
