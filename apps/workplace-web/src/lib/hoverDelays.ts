// 앱 공용 호버 카드 지연(WP-1237) — components/ui 는 shadcn 원본이라 앱 정책값은 여기 둔다.

/** 열림 지연 — 칩·링크 위를 스쳐 지나갈 때마다 카드가 번쩍이거나 요청하지 않게(반응 칩·본문 이슈 키 링크). */
export const HOVER_OPEN_DELAY_MS = 300
/** 닫힘 지연 — 트리거에서 카드로 마우스를 옮기는 동안 유지(카드 안 버튼을 누를 수 있게). */
export const HOVER_CLOSE_DELAY_MS = 150
