// NUMBER 커스텀 필드 입력 해석(WP-412) — FieldNumberInput 의 분기 판단을 순수 함수로 뺐다.
// 안전 정수 범위(Number.MAX_SAFE_INTEGER, 2^53-1)를 넘는 값은 IEEE 754 double 변환에서 소리 없이
// 반올림돼 지수표기(1e+23)로 저장되는 데이터 손상이 생기므로(#813) 'unsafe' 로 구분해 반영을 막는다.

/** 입력 문자열 해석 결과 — clear: 값 비움(null), ignore: 무시(입력 중 '-' 등), unsafe: 범위 초과 거부, value: 반영. */
export type FieldNumberParse =
  | { kind: 'clear' }
  | { kind: 'ignore' }
  | { kind: 'unsafe' }
  | { kind: 'value'; value: number };

/** number input 의 원문 값을 해석한다. 빈 값은 null 로 비우고, 유한·안전 범위 숫자만 반영한다. */
export function parseFieldNumber(raw: string): FieldNumberParse {
  if (raw === '') return { kind: 'clear' };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { kind: 'ignore' };
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return { kind: 'unsafe' };
  return { kind: 'value', value: n };
}
