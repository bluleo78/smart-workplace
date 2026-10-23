// labelWithValue(WP-853) — 속성 버튼 접근 이름에 보이는 값을 붙이는 규칙 단위 테스트.
import { describe, expect, it } from 'vitest';

import { labelWithValue } from './labelWithValue';

describe('labelWithValue', () => {
  it('이름 뒤에 「: 값」을 붙인다', () => {
    expect(labelWithValue('마감일 선택', '2026년 11월 20일')).toBe('마감일 선택: 2026년 11월 20일');
    expect(labelWithValue('담당자 편집', '미지정')).toBe('담당자 편집: 미지정');
  });

  it('덧붙임 조각은 쉼표로 잇는다', () => {
    expect(labelWithValue('마감일', '1월 15일', '마감 지남')).toBe('마감일: 1월 15일, 마감 지남');
  });

  it('비었거나 false 인 조각은 건너뛴다', () => {
    expect(labelWithValue('상태', '할 일', false)).toBe('상태: 할 일');
    expect(labelWithValue('상태', '할 일', null, undefined, '  ', '차단됨')).toBe('상태: 할 일, 차단됨');
  });

  it('보이는 값이 없으면 이름만 돌려준다', () => {
    expect(labelWithValue('사이클 편집')).toBe('사이클 편집');
    expect(labelWithValue('사이클 편집', '', null)).toBe('사이클 편집');
  });
});
