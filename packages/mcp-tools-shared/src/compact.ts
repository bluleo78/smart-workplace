// src/compact.ts — LLM 응답 토큰 절약용 공통 가공. 행마다 반복되는 null·빈 배열 키를 지운다(#850).
// false·0 은 의미가 있는 값(예: 알림 read:false)이라 남긴다.

/** 값이 null·undefined·빈 배열인 키를 뺀 얕은 복사본. */
export function dropEmpty<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0)),
  ) as Partial<T>;
}
