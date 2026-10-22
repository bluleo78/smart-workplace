// 작은 버튼(칩의 ×·링크 등)의 터치 영역 확장 — 버튼은 키우지 않고 보이지 않는 ::after 로 사방 8px(40px 안팎)를 넓힌다.
// 모바일 오버레이·칩 안 버튼 공용(ScreenContextChip, 채팅 입력창 첨부 칩).
export const HIT_AREA = "relative after:absolute after:-inset-2 after:content-['']";
// 줄지어 놓인 글줄 안 링크용(WP-55 메모리 결과 줄 되돌리기) — 위아래로만 8px 넓힌다. 좌우로 넓히면 이웃 요소의 탭을 가로챈다(뒤 형제의 ::after 가 위에 그려짐).
// 터치(거친 포인터)에서만 넓힌다(WP-139 UI 리뷰) — 마우스 환경에선 확장이 필요 없고, 확장이 겹치지 않게 벌린 줄 간격도 데스크톱엔 필요 없다.
// Tailwind 는 소스의 문자열 그대로를 스캔하므로 변형 접두를 런타임에 붙이지 않고 클래스마다 적어 둔다.
export const HIT_AREA_Y_COARSE =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2 pointer-coarse:after:content-['']";
// 홀로 놓인 작은 아이콘 버튼(✕·＋ 등)의 터치 영역(WP-734) — 터치에서만 사방 10px 넓혀 14~20px 아이콘도 34~40px 로 눌린다. 보이는 크기·데스크톱은 그대로.
export const HIT_AREA_COARSE =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5 pointer-coarse:after:content-['']";
// 촘촘히 놓인 체크박스·스위치·옆 버튼용(WP-734) — 사방 5px 만 넓혀 16px 체크박스가 24px(WCAG 2.2 최소) 로 눌리되, 이웃 대상의 영역을 덮지 않는다.
// ::after 는 테두리 안쪽(padding box) 기준이라 1px 테두리를 빼고 5px 를 넓혀야 테두리 있는 16px 체크박스가 24px 가 된다(4px 면 22px).
export const HIT_AREA_COARSE_TIGHT =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-[5px] pointer-coarse:after:content-['']";
// 줄지어 놓인 칩(일정 폼 참석자·태그의 「＋」 점선 칩, WP-801)용 — 터치에서만 위아래 12px 넓혀 22px 칩이 44px 넘게 눌리고, 좌우는 2px 만 넓혀 옆 칩을 덮지 않는다.
export const HIT_AREA_CHIP_COARSE =
  "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-0.5 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']";
