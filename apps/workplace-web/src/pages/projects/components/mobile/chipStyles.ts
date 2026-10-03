// 모바일 이슈 목록 칩 공용 스타일(WP-194) — 툴바 칩·에픽 칩이 같은 높이·터치 영역·활성 표시를 쓰도록 한 곳에 둔다.

// 터치 영역 확장 — 보이지 않는 ::after 를 위아래 6px 씩 넓혀 보이는 32px 를 44px 로 맞춘다(레이아웃 높이는 그대로).
export const HIT_EXPAND = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";

// 칩 공통 스타일 — 보이는 높이 32px(h-8) + HIT_EXPAND 로 터치 영역 44px
// (칩 줄 컨테이너 py-2=8px 안이라 스크롤 영역에 잘리지 않고, 툴바 높이도 그대로).
export const MOBILE_CHIP = `${HIT_EXPAND} inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm whitespace-nowrap`;

// 활성 칩(에픽 선택·필터 적용) — 테두리 대신 primary 틴트로 「걸려 있음」을 표시.
export const MOBILE_CHIP_ACTIVE = 'border-primary/40 bg-primary/10 text-primary font-medium';
