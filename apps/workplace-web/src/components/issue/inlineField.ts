// 속성 레일 인라인 필드 트리거 공용 모양 — 평소 테두리 없이 값만, 마우스 올리면 테두리 + 배경(편집 가능 신호).
// 담당자·보고자·칩 줄 「＋ 추가」가 같은 선(px-3)·같은 높이에서 시작하도록 한 곳에서 정한다(WP-1079).

/** 테두리·마우스 올림·포커스·비활성 모양. 배치(폭·여백)는 INLINE_FIELD_RAIL_CLASS 또는 호출부가 붙인다. */
export const INLINE_FIELD_CLASS =
  'items-center rounded-md border border-transparent text-left text-sm transition-colors hover:border-input hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

/** 레일 배치 — 풀폭, 담당자 값과 같은 들여쓰기. */
export const INLINE_FIELD_RAIL_CLASS = 'flex w-full px-3 py-2';
