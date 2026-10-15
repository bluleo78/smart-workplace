// 작은 버튼(칩의 ×·링크 등)의 터치 영역 확장 — 버튼은 키우지 않고 보이지 않는 ::after 로 사방 8px(40px 안팎)를 넓힌다.
// 모바일 오버레이·칩 안 버튼 공용(ScreenContextChip, 채팅 입력창 첨부 칩).
export const HIT_AREA = "relative after:absolute after:-inset-2 after:content-['']";
// 줄지어 놓인 글줄 안 링크용(WP-55 메모리 결과 줄 되돌리기) — 위아래로만 8px 넓힌다. 좌우로 넓히면 이웃 요소의 탭을 가로챈다(뒤 형제의 ::after 가 위에 그려짐).
// 터치(거친 포인터)에서만 넓힌다(WP-139 UI 리뷰) — 마우스 환경에선 확장이 필요 없고, 확장이 겹치지 않게 벌린 줄 간격도 데스크톱엔 필요 없다.
// Tailwind 는 소스의 문자열 그대로를 스캔하므로 변형 접두를 런타임에 붙이지 않고 클래스마다 적어 둔다.
export const HIT_AREA_Y_COARSE =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2 pointer-coarse:after:content-['']";
