import { parentPort, workerData } from 'node:worker_threads'

import type { handleJob as HandleJob } from '../mergeJob'
import type { TestJobMessage } from './testMergeRunner'

/**
 * 테스트 전용 병합 워커 진입점 — 운영 처리(handleJob)를 감싸 작업마다 붙잡기·고장을 넣는다(testMergeRunner 가 띄운다).
 * 운영 처리(mergeJob — TipTap·DOM 전역)는 처음 실제로 처리할 때 불러온다: 고장·붙잡기만 하고 버려지는 워커가 무거운 모듈을 싣느라
 * 기동이 늘지 않게 한다(부하에서 워커 기동이 수 초 — 테스트 하나에 기동이 쌓이면 테스트 시간 제한에 걸린다).
 */

/** 실행기가 나눠 준 관문 — [0] 관문 세대(release 마다 1 증가), [1] 붙잡히기 시작한 작업 수. */
const gate = new Int32Array((workerData as { gate: SharedArrayBuffer }).gate)
let handle: typeof HandleJob | undefined

/**
 * 관문 세대가 until 이상이 될 때까지 이 스레드를 동기로 붙잡는다 — CPU 를 쥔 계산처럼 워커의 이벤트 루프가 멈춰, 실행기는 강제
 * 종료로만 멈출 수 있다(비동기 대기면 메인 스레드에서 돌아도 통과해 검증이 무의미하다). 기다림은 짧게 끊어 다시 JS 로 돌아오므로
 * 강제 종료가 늦어도 그 간격 안에 먹힌다.
 */
function hold(until: number): void {
  Atomics.add(gate, 1, 1)
  for (let seen = Atomics.load(gate, 0); seen < until; seen = Atomics.load(gate, 0)) Atomics.wait(gate, 0, seen, 50)
}

parentPort!.on('message', (job: TestJobMessage) => {
  // 고장 — 처리 밖 예외(워커 'error')·스레드 종료(워커 'exit')로 실행기의 고장 경로를 재현한다.
  if (job.fault === 'exit') process.exit(3)
  if (job.fault === 'throw') throw new Error('test fault')
  if (job.holdUntil != null) hold(job.holdUntil)
  if (handle) {
    parentPort!.postMessage(handle(job))
    return
  }
  // 실행기는 답을 받기 전에 다음 작업을 보내지 않으므로 불러오는 동안 다른 작업이 끼어들지 않는다.
  void import('../mergeJob').then((m) => {
    handle = m.handleJob
    parentPort!.postMessage(handle(job))
  })
})
