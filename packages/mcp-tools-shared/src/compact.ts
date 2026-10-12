// src/compact.ts — LLM 응답 토큰 절약용 공통 가공. 행마다 반복되는 null·빈 배열 키를 지운다(#850).
// false·0 은 의미가 있는 값(예: 알림 read:false)이라 남긴다.

/** 값이 null·undefined·빈 배열인 키를 뺀 얕은 복사본. */
export function dropEmpty<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0)),
  ) as Partial<T>;
}

/**
 * 지정한 키를 뺀 얕은 복사본. 서버 응답에서 숫자 사용자 ID(ownerId·updatedBy 등)를 걷어낼 때 쓴다(#833, WP-353).
 * 허용 목록으로 고르지 않고 빼는 이유는 drive-view.ts 와 같다 — 서버에 새 필드가 생겨도 조용히 누락되지 않는다.
 */
export function omitKeys<T extends Record<string, unknown>, K extends string>(row: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !(keys as string[]).includes(k))) as Omit<T, K>;
}

/**
 * 커서 페이지 → LLM 뷰 { items, hasMore?, nextCursor? }(WP-352). 다음 페이지가 없으면 hasMore·nextCursor 를 **생략**한다 —
 * null·false 를 실으면 "더 있나?" 를 매번 해석해야 하고, 빠진 키 = 끝이라는 규칙이 #850 의 dropEmpty 와 같아진다.
 * 서버 hasMore 가 true 여도 nextCursor 가 없으면(비정상) 이어 읽을 수단이 없어 잘림만 알린다.
 */
export function cursorPageView<T>(items: T[], page: { nextCursor?: string | null; hasMore?: boolean }) {
  const more = Boolean(page.nextCursor) || page.hasMore === true;
  return { items, ...(more && { hasMore: true as const }), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
}

/**
 * 번호 페이지 → LLM 뷰 { items, total?, hasMore?, nextPage? }(WP-352). total 은 전체 건수라 잘렸는지 가늠하는 데 쓰고,
 * 다음 페이지가 없으면 hasMore·nextPage 를 생략한다. nextPage 는 다음 호출의 page 인자(0 기준)다.
 */
export function numberedPageView<T>(items: T[], page: { total?: number; hasMore: boolean; page: number }) {
  return {
    items,
    ...(page.total !== undefined && { total: page.total }),
    ...(page.hasMore && { hasMore: true as const, nextPage: page.page + 1 }),
  };
}

/**
 * 도구·서버 상한에 걸려 잘렸을 수 있는 목록 → { items, truncated? }(WP-352). 잘리지 않았으면 truncated 를 **생략**한다
 * (cursorPageView·numberedPageView 와 같은 규칙 — 빠진 키 = 끝). 서버에 페이지가 없는 목록이 쓴다.
 */
export function truncatedView<T>(items: T[], truncated: boolean) {
  return { items, ...(truncated && { truncated: true as const }) };
}
