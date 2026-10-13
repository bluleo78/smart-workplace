import type { RunnerClock } from '../mergeRunner'

/** 손으로 돌리는 시계 — advance 를 부를 때만 시간이 흐른다. */
export interface ManualClock extends RunnerClock {
  /** 시간을 ms 만큼 흘린다 — 그 안에 오는 타이머를 시각 순(같으면 건 순)으로 부른다. */
  advance(ms: number): void
}

/**
 * 병합 실행기 테스트용 시계(RunnerClock) — 실제 시간은 흐르지 않고 테스트가 advance 로 정한 만큼만 흐른다.
 * 왜: 실행기의 기한은 워커 기동 시간까지 포함한다. 실제 시계로 재면 기계 부하로 기동이 수 초 걸릴 때 기한을 다루지 않는 테스트까지
 * 시간 초과로 깨진다. 이 시계를 쓰면 "기한이 왔다"는 테스트가 advance 를 부른 순간에만 일어난다(워커가 얼마나 느리든).
 */
export function manualClock(): ManualClock {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++
      timers.set(id, { at: now + Math.max(0, ms), fn })
      return id
    },
    clearTimeout(handle) {
      timers.delete(handle as number)
    },
    advance(ms) {
      const target = now + ms
      for (;;) {
        // 아직 남은 타이머 중 target 안에서 가장 이른 것 — 부른 타이머가 새 타이머를 걸어도 같은 advance 안에서 처리된다.
        let due: [number, { at: number; fn: () => void }] | undefined
        for (const entry of timers) {
          if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry
        }
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = target
    },
  }
}
