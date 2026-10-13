import DiffMatchPatch from 'diff-match-patch'

import { countWork } from './workMeter'

/**
 * 블록 하나의 글자 diff(블록 병합의 정확 문맥 패치가 쓴다) — diff-match-patch 결과 그대로이되, 비용 상한을 실제 시계 대신 작업량으로 둔다.
 *
 * 왜: 예전에는 `Diff_Timeout = 0.2`(실제 시계 0.2초)로 끊었다. 그 시계는 diff_bisect_ 가 d 단계마다 읽는데, 기계 부하·GC 로 멈칫하면
 * 같은 입력도 중간에 끊겨 거친 diff(그 부분 통째 삭제+삽입)가 되고, 정확 문맥 패치가 실패해 그 블록이 AI 쪽으로 정해졌다 — 병합 결과가
 * 기계 부하에 따라 달라졌다. 여기서는 같은 지점(bisect 탐색)을 같은 방식(그 부분을 거친 diff 로)으로 끊되, 기준을 입력만으로 정해지는
 * 작업 단위 수(DIFF_WORK_BUDGET)로 바꿨다. 예산 안에서 끝나는 diff 는 라이브러리를 시간 제한 없이 돌린 결과와 같다.
 *
 * 그대로 둔 것: halfMatch 가속(Diff_Timeout > 0 일 때만 켜진다 — 라이브러리 규칙)·줄 단위 가속(checklines). 둘 다 예전에도 시계와 무관했고
 * 결과에 영향을 주므로 예전과 같이 켠다(Diff_Timeout = 0 으로 시계를 끄면 halfMatch 도 꺼져 보통 입력의 diff 가 달라진다).
 */

type Diff = DiffMatchPatch.Diff

/** 타입 선언에 없는 라이브러리 내부 메서드 — bisect 가 가운데 뱀을 찾으면 두 쪽으로 나눠 diff_main 으로 되돌린다(라이브러리 그대로 쓴다). */
interface DmpInternals {
  diff_bisectSplit_(text1: string, text2: string, x: number, y: number, deadline: number): Diff[]
}

const DELETE = -1
const INSERT = 1

/**
 * 글자 diff 한 번(diff_main 최상위 호출 하나 = 블록 하나)의 작업 예산 — 단위는 bisect 의 k 단계 1 + 뱀이 비교한 글자 수 + 탐색 배열 칸 수.
 *
 * 값의 근거 — 단위당 비용은 입력 모양과 상관없이 거의 일정해 시계를 대신할 수 있다:
 * - 이 포트는 단위당 약 22~55ns(부하 없는 개발 기계). 2026-10-13 측정 22~26ns(무작위 글자 2500자 대 2500자 = 약 730만 단위 = 0.17초),
 *   d4357f9d 때 측정 30~55ns.
 * - 700만 = 이 포트로 부하 없이 약 0.15~0.4초다. 블록 하나의 비용을 예전 0.2초 시계 상한과 비슷한 크기로 묶는다.
 * - 예전 경계와 같지는 않다: 원래 라이브러리는 단위당 약 2배 빨라, 같은 기계에서 0.2초에 끊기던 지점은 이 포트 단위로 약 1,870만이었다
 *   (4000자 대 4000자). 그래서 대략 2,700~4,000자 블록을 통째 다시 쓰고 사람도 고친 드문 경우는 예전엔 정확한 diff 였지만 이제
 *   거친 diff(→ AI 쪽)가 된다. 보통 문단은 수만~수십만 단위라 닿지 않는다. 넘는 부분은 예전 시간 초과와 같은 거친 diff 다.
 * - 병합 한 번 전체의 상한은 따로 있다(MERGE_DIFF_WORK_BUDGET) — 블록마다 이 예산을 새로 받으면 큰 블록이 여럿일 때 합이 끝없이 커진다.
 */
export const DIFF_WORK_BUDGET = 7_000_000

/**
 * 병합 한 번(mergeWithSide 한 호출 = 워커 병합 작업 하나)이 글자 diff 에 쓸 수 있는 작업 합 — 블록마다 min(DIFF_WORK_BUDGET, 남은 몫)을 받고,
 * 다 쓰면 뒤 블록의 diff 는 라이브러리가 기한을 넘겼을 때와 같은 거친 결과가 된다(그 블록은 정확 문맥 패치가 보통 실패해 AI 쪽).
 *
 * 왜: 블록 상한만 있으면 사람·AI 가 둘 다 고친 큰 블록 수만큼 비용이 늘어, 바쁜 워커에서 병합 한 번이 워커 시간 상한
 * (MERGE_TIMEOUT_MS 10초, collab mergeRunner.ts)을 넘겨 503 이 될 수 있었다(예전 시계 상한은 블록마다 0.2초 벽시계라 부하로 늘지 않았다).
 *
 * 값의 근거(1,000만 단위):
 * - 부하 없음: 단위당 22~55ns → 0.22~0.55초.
 * - 설계 부하 5배(CPU 를 나눠 쓰는 운영 워커): 1.1~2.75초 — 10초 상한의 3분의 1 이하라, 나머지(파싱·짝짓기·정규화·keepLive 계획, 실측 최악
 *   4.8초)가 들어갈 자리가 남는다.
 * - 테스트 부하 하네스(13~15배 느려짐, CPU 버너 8개 + 병렬 테스트): 3.3~8.3초 — 그래도 10초 아래다.
 * - 통째 다시 쓴 최악 블록 하나(DIFF_WORK_BUDGET)를 다 받고도 남는 몫(300만)으로, 통째 고친 500자 문단(하나 약 18만 단위)도 열 개 넘게
 *   정확히 diff 한다. 둘 다 고친 블록은 보통 몇 개뿐이라(사람이 AI 작업 도중 고친 곳) 대개 이 상한에 닿지 않는다.
 */
export const MERGE_DIFF_WORK_BUDGET = 10_000_000

/**
 * diff_main 에 넘기는 기한 — 라이브러리가 "제한 없음"으로 쓰는 값. 기한을 직접 넘기면 diff_main 이 시계를 읽어 기한을 만들지 않고,
 * 아래 bisect 는 기한을 보지 않는다. 결과적으로 이 diff 는 시계를 전혀 쓰지 않는다.
 */
const NO_DEADLINE = Number.MAX_VALUE

const dmp = new DiffMatchPatch()
// 시간 상한이 아니다 — 라이브러리는 이 값이 0 이하면 halfMatch 가속을 끈다(결과가 달라진다). 예전(0.2)과 같이 켜 두려고 양수로 둔다.
// 시간은 위 NO_DEADLINE 때문에 쓰이지 않는다.
dmp.Diff_Timeout = 1

/** 지금 diff(charDiff 한 번)에 남은 작업 단위 — 단일 스레드 동기 계산이라 모듈 변수 하나로 충분하다(charDiff 가 매번 채운다). */
let workLeft = 0

/**
 * 지금 병합(withMergeDiffBudget 안)에 남은 글자 diff 작업 — 병합 밖(단독 applyExactPatch 등)이면 null 이고 블록 상한만 걸린다.
 * 마지막 diff 의 넘침(뱀 하나)만큼 음수가 될 수 있다 — 그 뒤 diff 는 0 을 받아 곧바로 거친 결과다.
 */
let mergeLeft: number | null = null

/**
 * diff_bisect_(Myers 가운데 뱀 찾기) — diff-match-patch 1.0.5 의 같은 이름 함수를 옮긴 것(Apache-2.0, Google). 바꾼 것은 끊는 조건뿐이다:
 * 라이브러리는 d 단계마다 `시계 > 기한` 이면 끊었고, 여기는 남은 작업 단위가 바닥나면 끊는다(k 단계마다 확인 — 넘침이 뱀 하나로 묶인다).
 * 끊으면 라이브러리와 같이 이 부분 문제를 통째 삭제+삽입으로 돌려준다. 다 찾으면 라이브러리 diff_bisectSplit_ 로 나눠 이어 간다.
 * 라이브러리 버전은 package.json 에 정확히 고정돼 있고(1.0.5), 결과가 라이브러리와 같은지는 charDiff.test.ts 가 대조한다.
 */
function boundedBisect(this: DiffMatchPatch, text1: string, text2: string, deadline: number): Diff[] {
  const text1Length = text1.length
  const text2Length = text2.length
  const maxD = Math.ceil((text1Length + text2Length) / 2)
  const vOffset = maxD
  const vLength = 2 * maxD
  // 탐색 배열 준비도 작업이다 — 예산이 이미 바닥이면 배열을 만들지 않고 바로 거친 diff(라이브러리가 d=0 에서 끊을 때와 같은 결과).
  if (workLeft < vLength) return bail(text1, text2, 0)
  let spent = vLength
  const v1 = new Array<number>(vLength).fill(-1)
  const v2 = new Array<number>(vLength).fill(-1)
  v1[vOffset + 1] = 0
  v2[vOffset + 1] = 0
  const delta = text1Length - text2Length
  // 전체 글자 수가 홀수면 앞쪽 경로가 뒤쪽 경로와 만난다.
  const front = delta % 2 !== 0
  // k 반복의 시작·끝 보정 — 격자 밖으로 나간 대각선을 다시 보지 않는다.
  let k1start = 0
  let k1end = 0
  let k2start = 0
  let k2end = 0
  for (let d = 0; d < maxD; d++) {
    // 앞쪽 경로를 한 걸음.
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1
      let x1: number
      if (k1 === -d || (k1 !== d && v1[k1Offset - 1] < v1[k1Offset + 1])) x1 = v1[k1Offset + 1]
      else x1 = v1[k1Offset - 1] + 1
      let y1 = x1 - k1
      const snakeFrom = x1
      while (x1 < text1Length && y1 < text2Length && text1.charAt(x1) === text2.charAt(y1)) {
        x1++
        y1++
      }
      spent += 1 + (x1 - snakeFrom)
      if (spent > workLeft) return bail(text1, text2, spent)
      v1[k1Offset] = x1
      if (x1 > text1Length) {
        k1end += 2 // 격자 오른쪽 밖
      } else if (y1 > text2Length) {
        k1start += 2 // 격자 아래 밖
      } else if (front) {
        const k2Offset = vOffset + delta - k1
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = text1Length - v2[k2Offset] // 뒤쪽 경로 좌표를 앞쪽 좌표계로
          if (x1 >= x2) return split(this, text1, text2, x1, y1, deadline, spent) // 겹침 — 가운데 뱀
        }
      }
    }
    // 뒤쪽 경로를 한 걸음.
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2
      let x2: number
      if (k2 === -d || (k2 !== d && v2[k2Offset - 1] < v2[k2Offset + 1])) x2 = v2[k2Offset + 1]
      else x2 = v2[k2Offset - 1] + 1
      let y2 = x2 - k2
      const snakeFrom = x2
      while (
        x2 < text1Length &&
        y2 < text2Length &&
        text1.charAt(text1Length - x2 - 1) === text2.charAt(text2Length - y2 - 1)
      ) {
        x2++
        y2++
      }
      spent += 1 + (x2 - snakeFrom)
      if (spent > workLeft) return bail(text1, text2, spent)
      v2[k2Offset] = x2
      if (x2 > text1Length) {
        k2end += 2 // 격자 왼쪽 밖
      } else if (y2 > text2Length) {
        k2start += 2 // 격자 위 밖
      } else if (!front) {
        const k1Offset = vOffset + delta - k2
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset]
          const y1 = vOffset + x1 - k1Offset
          if (x1 >= text1Length - x2) return split(this, text1, text2, x1, y1, deadline, spent) // 겹침 — 가운데 뱀
        }
      }
    }
  }
  // 공통 글자가 하나도 없다(d 가 끝까지 감) — 라이브러리와 같이 통째 삭제+삽입.
  return bail(text1, text2, spent)
}

/** 쓴 작업을 예산·계량에 반영한다(예산은 음수가 될 수 있다 — 마지막 k 단계의 넘침, 뱀 하나 이하). */
function spend(units: number): void {
  workLeft -= units
  countWork('diff', units) // 작업량 계량(workMeter — 테스트가 상한을 확인한다)
}

/** 이 부분 문제를 통째 삭제+삽입으로 — 라이브러리가 기한에 걸리거나 공통 글자가 없을 때 돌려주는 것과 같다. */
function bail(text1: string, text2: string, spent: number): Diff[] {
  spend(spent)
  return [
    [DELETE, text1],
    [INSERT, text2],
  ]
}

/** 가운데 뱀에서 둘로 나눠 라이브러리 diff_bisectSplit_ 로 이어 간다(그 안의 diff_main 이 다시 boundedBisect 를 부른다). */
function split(self: DiffMatchPatch, text1: string, text2: string, x: number, y: number, deadline: number, spent: number): Diff[] {
  spend(spent)
  return (self as unknown as DmpInternals).diff_bisectSplit_(text1, text2, x, y, deadline)
}

// 인스턴스 메서드로 갈아 끼운다 — 라이브러리 diff_compute_ 가 this.diff_bisect_ 로 부르므로 halfMatch·줄 단위 가속 뒤의 모든 bisect 가 이것을 쓴다.
dmp.diff_bisect_ = boundedBisect

/**
 * base → other 글자 diff(정리 전). 같은 입력이면 기계 부하와 상관없이 늘 같은 결과다.
 * 작업량이 받은 몫 — min(budget, 병합에 남은 몫) — 을 넘는 부분은 거친 diff(통째 삭제+삽입)가 된다 — 예전 시간 초과와 같은 모양.
 * budget 은 운영에서 늘 기본값이다(테스트가 작은 예산으로 끊기는 경로를 싸게 보려고 받는다).
 */
export function charDiff(base: string, other: string, budget = DIFF_WORK_BUDGET): Diff[] {
  const granted = mergeLeft == null ? budget : Math.min(budget, Math.max(0, mergeLeft))
  workLeft = granted
  try {
    return dmp.diff_main(base, other, true, NO_DEADLINE)
  } finally {
    // 실제로 쓴 만큼(넘침 포함) 병합 몫에서 뺀다 — 병합 밖이면 granted 가 Infinity 일 수 있어 빼지 않는다.
    if (mergeLeft != null) mergeLeft -= granted - workLeft
  }
}

/**
 * fn(병합 한 번) 동안의 글자 diff 를 모두 합쳐 MERGE_DIFF_WORK_BUDGET 안으로 묶는다 — 블록마다의 charDiff 가 남은 몫을 나눠 쓴다.
 * 이미 병합 안이면 바깥 몫을 그대로 이어 쓴다(안쪽 호출이 몫을 다시 채우면 상한이 풀린다). 예외가 나도 몫을 걷어 다음 병합에 남지 않게 한다.
 */
export function withMergeDiffBudget<T>(fn: () => T): T {
  if (mergeLeft != null) return fn()
  mergeLeft = MERGE_DIFF_WORK_BUDGET
  try {
    return fn()
  } finally {
    mergeLeft = null
  }
}

/** 같은 인스턴스에 정리 단계(diff_cleanupSemantic)를 건다 — 호출자가 같은 설정의 dmp 를 따로 만들지 않게. */
export function cleanupSemantic(diffs: Diff[]): void {
  dmp.diff_cleanupSemantic(diffs)
}
