// parseFieldNumber·FIELD_TYPE_LABEL(WP-412) — 커스텀 필드 규칙 단위 테스트(custom-fields E2E 에서 이관).
import { describe, expect, it } from 'vitest';

import { FIELD_TYPE_LABEL, FIELD_TYPES } from '@/types/customField';

import { parseFieldNumber } from './fieldNumber';

describe('parseFieldNumber (#813)', () => {
  it('빈 입력은 값 비움', () => {
    expect(parseFieldNumber('')).toEqual({ kind: 'clear' });
  });

  it('안전 정수 범위 안의 숫자는 그대로 반영(경계 포함)', () => {
    expect(parseFieldNumber('5')).toEqual({ kind: 'value', value: 5 });
    expect(parseFieldNumber('-1.5')).toEqual({ kind: 'value', value: -1.5 });
    expect(parseFieldNumber(String(Number.MAX_SAFE_INTEGER))).toEqual({ kind: 'value', value: Number.MAX_SAFE_INTEGER });
  });

  it('범위를 넘는 큰 수는 지수표기로 저장되지 않게 거부', () => {
    expect(parseFieldNumber('99999999999999999999999')).toEqual({ kind: 'unsafe' });
    expect(parseFieldNumber('-9007199254740993')).toEqual({ kind: 'unsafe' });
  });

  it('숫자가 아니거나 무한대면 무시', () => {
    expect(parseFieldNumber('-')).toEqual({ kind: 'ignore' });
    expect(parseFieldNumber('Infinity')).toEqual({ kind: 'ignore' });
  });
});

describe('FIELD_TYPE_LABEL (#317)', () => {
  it('모든 필드 타입을 한국어로 표시한다', () => {
    expect(FIELD_TYPES.map((t) => FIELD_TYPE_LABEL[t])).toEqual(['텍스트', '숫자', '날짜', '선택', '복수 선택']);
  });
});
