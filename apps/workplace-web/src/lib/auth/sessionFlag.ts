/**
 * 로그인 흔적(세션 표시) localStorage 키 — 로그인·로그아웃·refresh 거절 때 쓰고 지우며,
 * 첫 청크 미리 받기가 로그인 화면으로 갈 사람을 걸러내려고 읽는다(WP-2021). 읽고 쓰는 모든 곳이 이 상수를 쓴다.
 */
export const AUTH_FLAG_KEY = 'hasSession';
