import { Worker, type WorkerOptions } from 'node:worker_threads'

import type { Clock } from '../clock'
import { createMergeRunner, type MergeJobMessage, type MergeRunner } from '../mergeRunner'

/**
 * 테스트 워커가 받는 메시지 — 운영 규약 + 작업마다 정한 붙잡기·고장.
 * holdUntil: 이 값 이상으로 관문(gate[0])이 열릴 때까지 워커 스레드를 동기로 붙잡는다(CPU 를 쥔 느린 계산 흉내 — release 로 푼다).
 */
export type TestJobMessage = MergeJobMessage & { holdUntil?: number; fault?: 'throw' | 'exit' }

/**
 * 테스트 실행기 옵션 — 붙잡기·고장은 작업을 보낼 때마다 그 작업(종류·순서)을 보고 정한다.
 * clock 을 넘기면 실행기 기한도 그 시계로 잰다(testing/manualClock — 기한을 다루지 않는 테스트는 시간이 흐르지 않는 시계를 넘긴다).
 */
export interface TestMergeRunnerOptions {
  timeoutMs?: number
  clock?: Clock
  testHold?: (job: MergeJobMessage) => boolean
  testFault?: (job: MergeJobMessage) => 'throw' | 'exit' | undefined
}

/** 붙잡기를 풀고 관찰할 수 있는 테스트 실행기. */
export interface TestMergeRunner extends MergeRunner {
  /** 지금 붙잡힌 작업을 모두 풀어 준다(뒤에 붙잡히는 작업은 다음 release 까지 붙잡힌다). */
  release(): void
  /** 지금까지 워커 안에서 붙잡히기 시작한 작업 수 — "그 작업이 워커에서 계산 중"을 시간 대기 대신 사건으로 기다린다. */
  held(): number
  /** 띄운 워커들(띄운 순서) — 새 워커로 다음 작업을 받았는지, 버린 워커가 실제로 멈췄는지 확인한다. */
  readonly workers: HookedWorker[]
}

const FAULTY_WORKER_URL = new URL('./faultyMergeWorker.ts', import.meta.url)

/**
 * 보내는 작업마다 붙잡기·고장 값을 실어 테스트 워커로 넘기는 워커 — 값을 정하는 시점이 실행기가 작업을 보내는 순간과 같다.
 * gate 는 실행기 전체가 나눠 쓰는 공유 메모리(Int32Array, [0] 관문 세대 · [1] 붙잡힌 작업 수) — 워커를 새로 띄워도 같다.
 */
export class HookedWorker extends Worker {
  /** 실행기가 이 워커를 버렸을 때 terminate 가 돌려준 약속(스레드가 실제로 멈추면 풀린다). 버리지 않았으면 undefined. */
  terminated: Promise<number> | undefined

  constructor(
    options: WorkerOptions,
    private readonly hooks: TestMergeRunnerOptions,
    private readonly gate: Int32Array,
  ) {
    super(FAULTY_WORKER_URL, { ...options, workerData: { gate: gate.buffer } })
  }

  // 실행기는 MergeJobMessage 만 보낸다 — 그래서 인자 타입을 좁혀 받아 붙잡기·고장 값을 덧붙인다.
  override postMessage(msg: MergeJobMessage, transfer?: Parameters<Worker['postMessage']>[1]): void {
    const { testHold, testFault } = this.hooks
    // 지금 관문 세대보다 하나 위까지 붙잡는다 — 다음 release 가 이 작업을 푼다.
    const holdUntil = testHold?.(msg) ? Atomics.load(this.gate, 0) + 1 : undefined
    super.postMessage({ ...msg, holdUntil, fault: testFault?.(msg) } satisfies TestJobMessage, transfer)
  }

  override terminate(): Promise<number> {
    this.terminated ??= super.terminate()
    return this.terminated
  }
}

/** 붙잡기·고장을 넣을 수 있는 병합 실행기 — 실제 워커 스레드에서 운영 처리(handleJob)를 그대로 돌린다. */
export function createTestMergeRunner(opts: TestMergeRunnerOptions = {}): TestMergeRunner {
  const gate = new Int32Array(new SharedArrayBuffer(8))
  const workers: HookedWorker[] = []
  const runner = createMergeRunner({
    timeoutMs: opts.timeoutMs,
    clock: opts.clock,
    spawnWorker: (execArgv) => {
      const w = new HookedWorker({ execArgv }, opts, gate)
      workers.push(w)
      return w
    },
  })
  return {
    ...runner,
    release() {
      Atomics.add(gate, 0, 1)
      Atomics.notify(gate, 0)
    },
    held: () => Atomics.load(gate, 1),
    workers,
  }
}
