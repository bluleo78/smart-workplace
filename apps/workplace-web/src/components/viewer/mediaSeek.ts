// 미디어 요소 포커스에서 받은 ←/→ 처리(WP-281) — 네이티브 컨트롤과 이중 탐색하지 않게 브라우저 처리 여부를 본 뒤 탐색한다.
import { seekTarget } from './mediaPlayback'

/** 위치 변화로 칠 최소 차이(초) — 재생 중 한 틱(수 ms) 사이 자연 진행보다 크고, 네이티브 재생 막대 한 걸음보다 작게. */
const SEEK_EPSILON = 0.25

/**
 * ←/→ 를 미디어 요소 포커스에서 받았을 때 — 브라우저가 기본 동작으로 처리했는지 본 뒤에만 우리가 탐색한다(이중 탐색·음량 막대 가로채기 방지).
 * 네이티브 컨트롤(재생 막대·음량 막대)은 shadow DOM 이라 어느 컨트롤에 포커스가 있는지 페이지에서 알 수 없다.
 * 그래서 keydown 기본 동작(동기)이 끝난 다음 틱에 위치 변화·음량/음소거 변화가 없으면 = 요소 자체 포커스(브라우저는 처리 안 함)로 보고 delta 만큼 옮긴다.
 * seeking 플래그는 보지 않는다 — Chromium 은 요소 자체 포커스의 ←/→ 에도 같은 위치로 seeking 만 세워 실제로는 옮기지 않는다(E2E 로 확인).
 */
export function seekUnlessNativeHandled(el: HTMLMediaElement, delta: number) {
  const t0 = el.currentTime
  const v0 = el.volume
  const m0 = el.muted
  setTimeout(() => {
    const handled = Math.abs(el.currentTime - t0) > SEEK_EPSILON || el.volume !== v0 || el.muted !== m0
    if (!handled && el.isConnected) el.currentTime = seekTarget(el.currentTime, delta, el.duration)
  }, 0)
}
