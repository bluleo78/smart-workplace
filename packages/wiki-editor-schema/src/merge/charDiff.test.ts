import DiffMatchPatch from 'diff-match-patch'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyExactPatch, mergeMarkdown3 } from './blockMerge'
import { charDiff, DIFF_WORK_BUDGET } from './charDiff'
import { measureWork } from './workMeter'

// 글자 diff 의 비용 상한을 실제 시계(Diff_Timeout 0.2초)에서 작업량 예산으로 바꾼 것을 지킨다 — 결과가 시간과 무관하고(느린 기계 흉내),
// 예산 안에서는 라이브러리를 시간 제한 없이 돌린 결과와 같으며, 큰 입력도 예산에서 결정적으로 끊긴다.

/** 시간 제한 없는 라이브러리 — halfMatch 가속은 켠 채(Diff_Timeout > 0), 기한이 사실상 오지 않게. 예전 설정이 시간 초과 없이 낼 결과. */
const unbounded = new DiffMatchPatch()
unbounded.Diff_Timeout = 1e9

/**
 * 아주 느린 기계 흉내 — 시계를 읽을 때마다 1초가 흐른다. diff-match-patch 는 `new Date().getTime()` 으로 기한을 재므로
 * 예전 설정(0.2초)이라면 첫 bisect 단계에서 이미 기한이 지나 거친 diff 로 끊긴다.
 */
function slowMachine(): void {
  let now = 1_700_000_000_000
  vi.spyOn(Date.prototype, 'getTime').mockImplementation(() => (now += 1000))
  vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000))
}

afterEach(() => vi.restoreAllMocks())

/** 재현 가능한 의사 난수(xorshift) — 실패하면 씨앗으로 같은 입력을 다시 만든다. */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const WORDS = '회의 결정 사항 다음 주 일정 고객 요청 반영 배포 계획 검토 문서 작성 담당 확인 이슈 처리 the of and design review merge note'.split(' ')

describe('charDiff — 시계와 무관', () => {
  // AI 가 한 문단의 네 문장(1·2·4·5번째)에서 낱말을 하나씩 고치고, 사람은 가운데(3번째) 문장을 고쳤다. 정확한 diff 면 AI 덩어리가 문장마다
  // 나뉘어 사람 수정과 겹치지 않으므로 둘 다 남는다. 고친 곳이 고르게 흩어져 가속(halfMatch)이 못 나누므로 bisect 가 문단 전체를 본다 —
  // 예전 설정(시계 0.2초)에서는 느린 기계면 여기서 끊겨 가운데가 통째 교체 덩어리가 되고, 사람 수정 때문에 문맥을 못 찾아 블록이
  // AI 쪽으로 정해졌다(사람 수정 유실, conflicts 1 — 예전 코드에 이 테스트를 돌려 확인).
  const BASE =
    '첫 문장은 회의 일정을 정리합니다. 둘째 문장은 고객 요청을 적습니다. 셋째 문장은 사람이 고칠 곳입니다. 넷째 문장은 배포 계획을 말합니다. 다섯째 문장은 담당자를 적습니다.'
  const AI =
    '첫 문장은 회의 일정을 요약합니다. 둘째 문장은 고객 요구를 적습니다. 셋째 문장은 사람이 고칠 곳입니다. 넷째 문장은 출시 계획을 말합니다. 다섯째 문장은 책임자를 적습니다.'
  const CUR = BASE.replace('사람이 고칠 곳', '사람이 직접 고친 곳')
  const MERGED = AI.replace('사람이 고칠 곳', '사람이 직접 고친 곳')

  it('keeps both edits on a normal machine', () => {
    expect(mergeMarkdown3(BASE, CUR, AI)).toEqual({ markdown: MERGED, conflicts: 0 })
  })

  it('gives the same merge on a machine so slow that a 0.2s wall-clock timeout would cut every diff', () => {
    slowMachine()
    expect(mergeMarkdown3(BASE, CUR, AI)).toEqual({ markdown: MERGED, conflicts: 0 })
    expect(applyExactPatch(BASE, AI, CUR)).toBe(MERGED)
  })
})

describe('charDiff — 예산 안에서는 라이브러리(시간 제한 없음)와 같다', () => {
  // 옮긴 bisect 가 라이브러리와 같은지 — 끊는 조건만 바꿨으므로 예산 안에서 끝나는 diff 는 한 글자도 달라서는 안 된다.
  // 짧은 문단 ~ 수백 낱말 문단 × 수정 밀도(낱말 1%~전부), 여러 줄 블록(줄 단위 가속 경로)을 씨앗별로 대조한다.
  // (더 넓은 대조 — 병합 테스트가 실제로 diff 한 입력 전부 + 씨앗 3,500쌍 — 은 보고서의 일회성 대조로 했다.)
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`matches diff-match-patch without a time limit (seed ${seed})`, () => {
      const rand = rng(seed)
      const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)]
      const sentence = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ')
      const mutate = (t: string, density: number) => {
        const w = t.split(' ')
        for (let i = 0; i < w.length; i++) {
          const r = rand()
          if (r < density / 3) w[i] = pick(WORDS)
          else if (r < (2 * density) / 3) w.splice(i, 1)
          else if (r < density) w.splice(i, 0, pick(WORDS))
        }
        return w.join(' ')
      }
      for (let i = 0; i < 25; i++) {
        const base = sentence(pick([3, 20, 60, 150]))
        const ai = mutate(base, pick([0.01, 0.1, 0.5, 1]))
        const { result, units } = measureWork(() => charDiff(base, ai))
        expect(units).toBeLessThanOrEqual(DIFF_WORK_BUDGET) // 예산 안(끊기지 않은) 경우만 대조한다
        expect(result).toEqual(unbounded.diff_main(base, ai))
      }
      for (let i = 0; i < 5; i++) {
        const lines = Array.from({ length: pick([5, 40]) }, () => sentence(pick([2, 8])))
        const ai = lines.map((l) => (rand() < 0.2 ? mutate(l, 0.5) : l)).join('\n')
        expect(charDiff(lines.join('\n'), ai)).toEqual(unbounded.diff_main(lines.join('\n'), ai))
      }
    })
  }
})

describe('charDiff — 큰 입력은 예산에서 결정적으로 끊긴다', () => {
  // 통째로 다시 쓴 문단(공통 낱말이 흩어져 있어 가속이 못 나누고 bisect 가 끝까지 가야 하는 최악 모양). 끊기는 경로를 싸게 보려고
  // 작은 예산(SMALL)을 넘긴다 — 끊는 방식은 예산 크기와 무관하다(운영 예산으로는 같은 모양이 블록당 1,000만 단위에서 끊긴다).
  // 상한은 "예산 + 마지막 k 단계의 뱀 하나(짧은 쪽 길이 이하)"다.
  const SMALL = 200_000
  const rand = rng(42)
  const words = (n: number) => Array.from({ length: n }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(' ')
  const BASE = words(600)
  const AI = words(600)

  it('caps the work at the budget and returns the same coarse result every time, on any clock', () => {
    // 예산이 없으면 이 입력은 SMALL 의 몇 배를 쓴다 — 끊기는 경로를 실제로 보는지 확인.
    expect(measureWork(() => charDiff(BASE, AI, Infinity)).units).toBeGreaterThan(3 * SMALL)
    const first = measureWork(() => charDiff(BASE, AI, SMALL))
    expect(first.units).toBeLessThanOrEqual(SMALL + Math.min(BASE.length, AI.length))
    expect(measureWork(() => charDiff(BASE, AI, SMALL))).toEqual(first)
    slowMachine()
    expect(measureWork(() => charDiff(BASE, AI, SMALL))).toEqual(first)
  })

  it('still returns a valid diff when cut (coarse, not wrong)', () => {
    // 끊긴 결과도 올바른 diff 다 — 기준에 적용하면 AI 본이 나온다(거칠 뿐 틀리지 않는다).
    const coarse = charDiff(BASE, AI, SMALL)
    expect(coarse.filter(([op]) => op !== 1).map(([, t]) => t).join('')).toBe(BASE)
    expect(coarse.filter(([op]) => op !== -1).map(([, t]) => t).join('')).toBe(AI)
  })
})
