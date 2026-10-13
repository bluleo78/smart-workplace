/**
 * 블록 짝짓기 작업량 계량 지점 — 테스트가 alignBlocks 의 비교 작업량(결정적 정수)을 재는 내부 훅.
 *
 * 왜: 큰 노트 병합의 성능 회귀(짝짓기가 O(n²) 로 퇴화)를 벽시계로 재면 기계 부하에 따라 결과가 흔들린다(전체 테스트를 병렬로
 * 돌리면 같은 계산이 10배 넘게 느려져 "빠르게" 단언이 깨졌다). 작업 단위는 입력이 같으면 늘 같으므로 부하와 무관하게 복잡도를 지킨다.
 *
 * 운영 비용: 기록기가 없으면(기본) 호출 지점마다 null 확인 한 번뿐이고, 호출은 범위·블록 단위라 안쪽 반복문에는 없다.
 * 패키지 exports(`./merge` = blockMerge.ts)에 없는 내부 모듈이다 — 같은 패키지의 테스트만 상대 경로로 부른다.
 */

/** 지금 작업량을 받는 기록기(measureWork 동안만 있다). */
let sink: ((units: number) => void) | null = null

/** 작업 units 개를 했다고 알린다 — 재는 중이 아니면 아무 일도 하지 않는다. */
export function countWork(units: number): void {
  if (sink) sink(units)
}

/**
 * fn 을 돌리며 그동안 센 작업 단위 합을 돌려준다. 중첩 호출은 지원하지 않는다(테스트 한 곳에서만 쓴다).
 * 예외가 나도 기록기를 걷어 다음 계산(운영 경로)에 남지 않게 한다.
 */
export function measureWork<T>(fn: () => T): { result: T; units: number } {
  let units = 0
  sink = (n) => {
    units += n
  }
  try {
    return { result: fn(), units }
  } finally {
    sink = null
  }
}
