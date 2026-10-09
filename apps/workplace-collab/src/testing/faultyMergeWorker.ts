import { parentPort } from 'node:worker_threads'

import { handleJob } from '../mergeJob'
import type { TestJobMessage } from './testMergeRunner'

/**
 * 테스트 전용 병합 워커 진입점 — 운영 처리(handleJob)를 감싸 작업마다 지연·고장을 넣는다(testMergeRunner 가 띄운다).
 */
parentPort!.on('message', (job: TestJobMessage) => {
  // 고장 — 처리 밖 예외(워커 'error')·스레드 종료(워커 'exit')로 실행기의 고장 경로를 재현한다.
  if (job.fault === 'exit') process.exit(3)
  if (job.fault === 'throw') throw new Error('test fault')
  if (job.delayMs) {
    // CPU 를 붙잡는 느린 계산 흉내(비동기 대기면 메인 스레드에서 돌아도 통과해 검증이 무의미하다).
    const until = Date.now() + job.delayMs
    while (Date.now() < until) {
      // 바쁜 대기
    }
  }
  parentPort!.postMessage(handleJob(job))
})
