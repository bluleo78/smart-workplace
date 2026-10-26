// 페이지 테스트의 세션 히스토리 도우미(WP-995) — setup.ts 도 쓰므로 App 을 불러오지 않는 작은 파일에 둔다.

/**
 * 밀린 히스토리 이동(history.back·go)이 끝날 때까지 기다린다 — jsdom 은 이동을 타이머 몇 개(이동 예약 → 문서 갱신 → popstate)에
 * 걸쳐 끝낸다. history.back() 으로 닫는 화면(시트·AI 시트)을 닫은 직후 다시 여는 테스트는 이걸 기다려야, 늦게 도착한 뒤로 가기가
 * 새로 연 화면을 닫지 않는다. 테스트 사이 정리(setup.ts)도 이걸 쓴다.
 */
export async function settleHistory() {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}
