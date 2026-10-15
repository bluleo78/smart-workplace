import { describe, expect, it } from 'vitest';

import { firstJsonArray, firstJsonObject } from './json-extract.js';

describe('firstJsonArray', () => {
  it('코드펜스·머리말을 걷고 첫 배열을 돌려준다', () => {
    expect(firstJsonArray('추천입니다:\n```json\n["a","b"]\n```')).toEqual(['a', 'b']);
  });
  it('문구 속 "[긴급]" 같은 대괄호는 건너뛰고 다음 배열을 찾는다', () => {
    expect(firstJsonArray('[긴급] 처리 ["x 해줘"]')).toEqual(['x 해줘']);
  });
  it('문자열 안의 대괄호·따옴표 이스케이프에 견딘다', () => {
    expect(firstJsonArray('["a]b","c\\"]d"]')).toEqual(['a]b', 'c"]d']);
  });
  it('배열이 없으면 null', () => {
    expect(firstJsonArray('없음')).toBeNull();
  });
});

describe('firstJsonObject', () => {
  it('머리말·코드펜스 뒤의 첫 객체를 돌려준다', () => {
    expect(firstJsonObject('정리 결과:\n```json\n{"ops":[]}\n```')).toEqual({ ops: [] });
  });
  it('중첩 객체와 문자열 안의 중괄호에 견딘다', () => {
    expect(firstJsonObject('{"ops":[{"op":"ADD","content":"} {"}]}')).toEqual({ ops: [{ op: 'ADD', content: '} {' }] });
  });
  it('JSON 이 아닌 중괄호는 건너뛴다', () => {
    expect(firstJsonObject('{긴급} {"ops":[]}')).toEqual({ ops: [] });
  });
  it('배열만 있거나 닫히지 않으면 null', () => {
    expect(firstJsonObject('[1,2]')).toBeNull();
    expect(firstJsonObject('{"ops":[')).toBeNull();
  });
  it('maxChars 뒤는 보지 않는다', () => {
    expect(firstJsonObject(`${'x'.repeat(20)}{"a":1}`, 10)).toBeNull();
  });
});
