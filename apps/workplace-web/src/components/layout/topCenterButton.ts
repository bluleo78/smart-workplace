// 상단 가운데 32px 동그라미 단추 모양(WP-1505) — 검색 🔍(SearchTrigger)과 도움말 「?」(HelpTrigger)가 한 묶음으로 보이게 같은 클래스를 쓴다.
// 크기(32px)는 TopCenterSlot 의 150px 계산(칩 반폭 70 + 8 + 검색 32 + 8 + 「?」 32)과 맞물리므로 바꾸면 그쪽도 고친다.
export const TOP_CENTER_ROUND_BUTTON =
  'inline-flex h-[32px] w-[32px] items-center justify-center rounded-full border bg-card/90 text-muted-foreground shadow-md backdrop-blur hover:text-foreground'
