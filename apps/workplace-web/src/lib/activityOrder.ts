// 이슈 활동(코멘트·이력)의 정렬 순서(WP-1016).
// 기본은 지금처럼 오래된 순이고, 최신 항목부터 보고 싶은 사람은 「최신순」을 고른다 — 사람마다 선호가 달라 앱 전체 설정으로 기억한다.
// 서버 응답은 늘 오래된 순(ASC)이라 화면에서만 뒤집는다.

/** 활동 정렬 — 오래된 순(기본) / 최신순. */
export type ActivityOrder = 'oldest' | 'newest';

export const DEFAULT_ACTIVITY_ORDER: ActivityOrder = 'oldest';

/** 저장해 둔 값을 읽는다 — 모르는 값·없음은 기본(오래된 순). */
export function parseActivityOrder(value: string | null): ActivityOrder {
  return value === 'newest' ? 'newest' : DEFAULT_ACTIVITY_ORDER;
}

/** 오래된 순으로 온 항목을 고른 순서로 — 최신순이면 뒤집은 새 배열, 오래된 순이면 그대로. */
export function orderActivity<T>(items: readonly T[], order: ActivityOrder): readonly T[] {
  return order === 'newest' ? [...items].reverse() : items;
}
