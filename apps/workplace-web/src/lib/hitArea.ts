// 작은 버튼(칩의 ×·링크 등)의 터치 영역 확장 — 버튼은 키우지 않고 보이지 않는 ::after 로 사방 8px(40px 안팎)를 넓힌다.
// 모바일 오버레이·칩 안 버튼 공용(ScreenContextChip, 채팅 입력창 첨부 칩).
export const HIT_AREA = "relative after:absolute after:-inset-2 after:content-['']";
// 줄지어 놓인 칩용(WP-139 후속 질문) — 위아래로만 8px 넓힌다. 좌우로 넓히면 이웃 칩의 탭을 가로챈다(뒤 형제의 ::after 가 위에 그려짐).
export const HIT_AREA_Y = "relative after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']";
