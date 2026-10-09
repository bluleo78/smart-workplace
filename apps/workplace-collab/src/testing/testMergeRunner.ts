import { Worker, type WorkerOptions } from 'node:worker_threads'

import { createMergeRunner, type MergeJobMessage, type MergeRunner } from '../mergeRunner'

/** 테스트 워커가 받는 메시지 — 운영 규약 + 작업마다 정한 지연(워커 안 동기 블로킹)·고장(예외·종료). */
export type TestJobMessage = MergeJobMessage & { delayMs?: number; fault?: 'throw' | 'exit' }

/** 테스트 실행기 옵션 — 지연·고장은 작업을 보낼 때마다 다시 읽는다(작업 순번으로 정규화·병합을 구분하는 테스트용). */
export interface TestMergeRunnerOptions {
  timeoutMs?: number
  testDelayMs?: number | (() => number)
  testFault?: () => 'throw' | 'exit' | undefined
}

const FAULTY_WORKER_URL = new URL('./faultyMergeWorker.ts', import.meta.url)

/** 보내는 작업마다 지연·고장 값을 실어 테스트 워커로 넘기는 워커 — 값을 읽는 시점이 실행기가 작업을 보내는 순간과 같다. */
class HookedWorker extends Worker {
  constructor(
    options: WorkerOptions,
    private readonly hooks: TestMergeRunnerOptions,
  ) {
    super(FAULTY_WORKER_URL, options)
  }

  // 실행기는 MergeJobMessage 만 보낸다 — 그래서 인자 타입을 좁혀 받아 지연·고장 값을 덧붙인다.
  override postMessage(msg: MergeJobMessage, transfer?: Parameters<Worker['postMessage']>[1]): void {
    const { testDelayMs, testFault } = this.hooks
    const delayMs = typeof testDelayMs === 'function' ? testDelayMs() : testDelayMs
    super.postMessage({ ...msg, delayMs, fault: testFault?.() } satisfies TestJobMessage, transfer)
  }
}

/** 지연·고장을 넣을 수 있는 병합 실행기 — 실제 워커 스레드에서 운영 처리(handleJob)를 그대로 돌린다. */
export function createTestMergeRunner(opts: TestMergeRunnerOptions = {}): MergeRunner {
  return createMergeRunner({ timeoutMs: opts.timeoutMs, spawnWorker: (execArgv) => new HookedWorker({ execArgv }, opts) })
}
