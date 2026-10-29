/**
 * 테스트가 끝날 때마다 비울 모듈 상태의 정리 함수 목록(WP-1206).
 *
 * 화면 테스트 정리(src/test/setup.ts)가 무거운 모듈(동기화 세션 등)을 직접 불러오지 않고도 그 모듈의 상태를 비우게 한다 —
 * 모듈이 불러와질 때 스스로 등록하므로, 그 모듈을 쓴 테스트 파일에서만 정리가 돈다. vitest 는 파일마다 모듈을 새로 불러오므로
 * 앞 파일의 정리 함수가 다음 파일로 넘어가지 않는다. 운영에서는 아무도 비우지 않는 빈 목록일 뿐이다.
 */
const resets: Array<() => void> = []

/** 테스트 끝 정리 때 부를 함수를 등록한다. */
export function registerTestReset(fn: () => void): void {
  resets.push(fn)
}

/** 등록된 정리 함수를 모두 부른다 — src/test/setup.ts 의 afterEach 가 화면을 내린 직후 부른다. */
export function runTestResets(): void {
  for (const fn of resets) fn()
}
