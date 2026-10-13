/**
 * 병합 작업량 계량 지점 — 테스트가 병합의 작업량(결정적 정수)을 종류별로 재는 내부 훅.
 *
 * 왜: 큰 노트 병합의 성능 회귀(짝짓기가 O(n²) 로 퇴화)를 벽시계로 재면 기계 부하에 따라 결과가 흔들린다(전체 테스트를 병렬로
 * 돌리면 같은 계산이 10배 넘게 느려져 "빠르게" 단언이 깨졌다). 작업 단위는 입력이 같으면 늘 같으므로 부하와 무관하게 복잡도를 지킨다.
 *
 * 종류(WorkKind)를 나누는 이유: 단위의 뜻이 서로 달라 한 합계로 섞으면 한쪽 상한이 다른 쪽 작업으로 채워진다(짝짓기 상한을 재는 테스트에
 * 사람·AI 가 둘 다 고친 큰 블록이 있으면 글자 diff 작업이 짝짓기 작업으로 잡혔다).
 * - pairing: alignBlocks 와 그 하위 단계의 비교 작업(범위 크기·DP 칸·역색인 항목·후보 수). 호출은 범위·블록 단위다.
 * - diff: 글자 diff(charDiff)의 bisect 작업 — 같은 단위를 비용 상한(예산)으로도 쓴다(시계 대신, charDiff.ts). bisect 한 번마다 한 번 알린다.
 * - scan: 블록 열을 한 번 훑는 선형 단계(블록 나누기·잇기·다음 짝 찾기·삽입 합치기 등)의 입력 크기 — 그런 단계가 블록마다 다시 불려
 *   전체가 O(n²) 이 되는 퇴화를 잡는다. 단계 안쪽 반복문을 다시 쓴 퇴화는 세지 못한다(호출 지점에서 입력 크기만 센다).
 *
 * 운영 비용: 기록기가 없으면(기본) 호출 지점마다 null 확인 한 번뿐이다. 호출은 단계·범위·블록 또는 bisect 단위라 글자 단위 안쪽 반복문에는 없다.
 * 패키지 exports(`./merge` = blockMerge.ts)에 없는 내부 모듈이다 — 같은 패키지의 테스트만 상대 경로로 부른다.
 */

/** 작업 종류 — 위 설명. */
export type WorkKind = 'pairing' | 'diff' | 'scan'

/** 종류별 작업 단위 합. */
export type WorkTotals = Record<WorkKind, number>

/** 지금 작업량을 받는 기록기(measureWork 동안만 있다). */
let sink: ((kind: WorkKind, units: number) => void) | null = null

/** kind 작업 units 개를 했다고 알린다 — 재는 중이 아니면 아무 일도 하지 않는다. */
export function countWork(kind: WorkKind, units: number): void {
  if (sink) sink(kind, units)
}

/**
 * fn 을 돌리며 그동안 센 작업 단위 합을 종류별로 돌려준다. 중첩 호출은 지원하지 않는다(테스트 한 곳에서만 쓴다).
 * 예외가 나도 기록기를 걷어 다음 계산(운영 경로)에 남지 않게 한다.
 */
export function measureWork<T>(fn: () => T): { result: T; work: WorkTotals } {
  const work: WorkTotals = { pairing: 0, diff: 0, scan: 0 }
  sink = (kind, n) => {
    work[kind] += n
  }
  try {
    return { result: fn(), work }
  } finally {
    sink = null
  }
}
