// 화면 테스트(renderPage·renderScreen)의 비동기 대기 — 두 렌더 도우미가 같이 쓴다. renderScreen 이 renderPage 를 불러오면
// App 전체 모듈이 딸려 오므로(WP-1002) 상수만 이 작은 파일에 둔다.

/**
 * 화면 테스트에서 첫 화면 뒤 단언(요청 → 응답 → 다시 그리기)의 기본 대기 — RTL 기본 1초는 부하가 크면 넘친다(WP-1006).
 * 조건이 맞으면 바로 끝나므로 통과하는 테스트는 느려지지 않고, 진짜 실패만 이만큼 늦게 알린다. 렌더 도우미가 켜고 setup 의 afterEach 가 되돌린다.
 */
export const PAGE_ASYNC_TIMEOUT = 5_000
