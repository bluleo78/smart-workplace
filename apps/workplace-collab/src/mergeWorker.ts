import { parentPort } from 'node:worker_threads'

import { handleJob } from './mergeJob'
import type { MergeJobMessage } from './mergeRunner'

/**
 * 3-way 병합 워커 스레드 진입점(WP-289) — 무거운 문자열 계산(처리는 mergeJob.handleJob)을 이벤트 루프 밖에서 한다.
 * 왜 워커인가: 크거나 고약한 노트에서 병합이 수 초(10000 동일 블록 4.8s), 정규화가 한 번에 0.5s 가까이 걸린다 — 메인 스레드에서
 * 돌면 그동안 모든 문서의 실시간 동기화가 멈춘다. 시간 제한을 넘기면 실행기가 이 스레드를 강제 종료한다(부분 결과 없음).
 */
parentPort!.on('message', (job: MergeJobMessage) => parentPort!.postMessage(handleJob(job)))
