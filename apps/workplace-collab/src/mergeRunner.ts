import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

import type { MergeResult } from '@smart-workplace/wiki-editor-schema/merge'

import type { HttpErrorCode } from './internalRoutes'
import type { KeepLivePlan } from './markdownCodec'

/**
 * 워커 계산 한 번(정규화 또는 병합)의 시간 상한(ms). 넘기면 워커를 강제 종료하고 실패로 끝낸다 — 호출자는 아무것도 적용하지 않는다.
 * 실측 최악(10000 동일 블록 병합 4.8s·긴 문단 540개 전부 고침 3.9s)의 두 배 남짓. 호출자(server)는 요청 하나의 전체 기한으로도 쓴다.
 */
export const MERGE_TIMEOUT_MS = 10_000

/** 시간 상한을 넘겼다 — 결과 없음(부분 적용 금지). */
export class MergeTimeoutError extends Error {}
/** 계산 자체가 실패했다(워커 예외·비정상 종료·실행기 종료). */
export class MergeFailedError extends Error {}

/** 정규화 요청 — AI본·기준본 후보(원문)와 현재본(이미 정규화된 Yjs 직렬화). */
export interface PrepareJob {
  body: string
  bases: string[]
  current: string
}
/** 정규화 결과 — 정규화된 AI본·기준본 후보, 또는 병합하면 안 되는 본문(빈 본문·파싱 실패)의 거부 사유. */
export type PrepareResult = { ai: string; bases: string[] } | { rejected: string; code: Exclude<HttpErrorCode, 'invalid_request'> }

/**
 * 병합 요청 — bases(기준본 후보, 1개 이상) 중 ai 에 가까운 것을 기준본으로 현재본과 3-way 병합. bases·ai 는 정규화된 마크다운.
 * live = 실시간 문서 상태(Y.encodeStateAsUpdate) — 워커가 여기서 현재본을 직렬화하고, 병합 결과를 실시간 블록에 짝지은 keepLive 계획까지 만든다
 * (메인 스레드는 계획을 인덱스로 적용만 한다). 같은 상태에서 현재본과 계획을 함께 만들므로 둘은 늘 같은 문서를 가리킨다.
 * live 의 버퍼는 보낼 때 워커로 옮겨진다(복사하지 않음 — transferOf) — 호출자는 넘긴 뒤 다시 쓰지 않는다.
 */
export interface MergeJob {
  bases: string[]
  live: Uint8Array
  ai: string
}

/** 병합 결과 + 적용 계획(markdown 은 병합본 — 로그·검증용, 적용은 plan 으로). */
export interface LiveMergeResult extends MergeResult {
  plan: KeepLivePlan
}

/** 워커 메시지 규약 — 처리는 mergeJob.ts(handleJob). */
export type MergeJobMessage = { id: number } & (
  | ({ kind: 'prepare' } & PrepareJob)
  | ({ kind: 'merge' } & MergeJob)
)
export type WorkerValue = PrepareResult | LiveMergeResult
export type MergeReply = { id: number; ok: true; value: WorkerValue } | { id: number; ok: false; error: string }

/**
 * 워커로 복사 없이 넘길 버퍼 — 병합 요청의 실시간 상태(Y.encodeStateAsUpdate 결과, 큰 노트에선 수 MB)는 보낸 뒤 다시 쓰지 않으므로 옮긴다.
 * 배열이 버퍼 전체를 쓸 때만 옮긴다(풀에서 잘라 낸 Buffer 처럼 남과 나눠 쓰는 버퍼를 떼어 가면 다른 값이 망가진다) — 아니면 평소처럼 복사.
 */
function transferOf(msg: MergeJobMessage): ArrayBuffer[] {
  if (msg.kind !== 'merge') return []
  const { buffer, byteOffset, byteLength } = msg.live
  return buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength ? [buffer] : []
}

/** 이벤트 루프 밖(워커 스레드)에서 정규화·병합을 돌리는 실행기. */
export interface MergeRunner {
  /** 기본 시간 상한(ms) — 호출자가 요청 하나의 전체 기한을 잡는 데도 쓴다. */
  readonly timeoutMs: number
  /** 정규화 + 빈 본문 판정. */
  prepare(job: PrepareJob, timeoutMs?: number): Promise<PrepareResult>
  /** 3-way 병합 + keepLive 적용 계획. */
  merge(job: MergeJob, timeoutMs?: number): Promise<LiveMergeResult>
  /** 워커 종료(서버 종료). 대기 중인 작업은 실패로 끝난다. */
  destroy(): Promise<void>
}

/** 실행기 옵션 — spawnWorker 는 워커를 띄우는 방법(기본 = mergeWorker, execArgv = 소스 실행이면 tsx 로더). */
export interface MergeRunnerOptions {
  timeoutMs?: number
  spawnWorker?: (execArgv: string[] | undefined) => Worker
}

/** 소스 실행(vitest·tsx)인가 — 그러면 워커 진입점도 .ts 소스이고 tsx 로더가 필요하다. */
const fromSource = import.meta.url.endsWith('.ts')

/** 소스 실행이면 워커에 tsx 로더를 건다 — tsx 로 띄운 프로세스는 이미 execArgv 에 있어 그대로 물려받고, vitest 는 없다. */
function workerExecArgv(): string[] | undefined {
  if (!fromSource || process.execArgv.some((a) => a.includes('tsx'))) return undefined
  const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  return [...process.execArgv, '--import', loader]
}

interface Pending {
  msg: MergeJobMessage
  /** 이 시각(epoch ms)까지 끝나야 한다 — 대기열에서 기다린 시간도 포함(요청 하나의 응답 시간 상한). */
  deadline: number
  resolve: (v: WorkerValue) => void
  reject: (e: Error) => void
  /** 대기열에 있는 동안 기한이 오면 빼고 시간 초과로 끝내는 타이머(보낼 때 해제). */
  queueTimer?: NodeJS.Timeout
}

/**
 * 워커 하나 + FIFO 대기열 — 한 번에 하나씩 보낸다.
 * 시간 제한은 기한(deadline, 요청 시각 + timeoutMs)으로 잰다 — 대기열에서 기한이 오면 보내지 않고 그 자리에서 시간 초과로 끝내,
 * 앞 문서의 느린 병합 뒤에 줄 선 요청도 응답 시간이 timeoutMs 를 넘지 않는다.
 * 시간 초과·비정상 종료면 워커를 종료하고(CPU 를 붙잡은 계산은 이 방법으로만 멈춘다) 다음 작업 때 새로 띄운다.
 * 워커 파일: 번들(dist)에선 `dist/mergeWorker.js`(tsup 둘째 진입점), 소스 실행(vitest·tsx)에선 `src/mergeWorker.ts` 를 tsx 로더로.
 */
export function createMergeRunner(opts: MergeRunnerOptions = {}): MergeRunner {
  const timeoutMs = opts.timeoutMs ?? MERGE_TIMEOUT_MS
  const workerUrl = new URL(fromSource ? './mergeWorker.ts' : './mergeWorker.js', import.meta.url)
  const queue: Pending[] = []
  let worker: Worker | null = null
  let running: { p: Pending; timer: NodeJS.Timeout } | null = null
  let nextId = 1
  let destroyed = false

  /** 현재 작업을 끝내고(성공·실패) 다음 작업을 보낸다. */
  function finish(outcome: { value: WorkerValue } | { error: Error }): void {
    if (!running) return
    const { p, timer } = running
    clearTimeout(timer)
    running = null
    if ('value' in outcome) p.resolve(outcome.value)
    else p.reject(outcome.error)
    pump()
  }

  /** 워커를 버린다 — 다음 작업 때 새로 띄운다. */
  function discard(w: Worker): void {
    if (worker === w) worker = null
    w.removeAllListeners()
    // 버린 워커의 늦은 error 를 삼킨다 — 듣는 이 없는 'error' 는 메인 프로세스를 죽인다.
    w.on('error', () => {})
    void w.terminate()
  }

  function spawn(): Worker {
    const execArgv = workerExecArgv()
    const w = opts.spawnWorker?.(execArgv) ?? new Worker(workerUrl, { execArgv })
    // 대기 작업이 없을 때 프로세스 종료를 붙잡지 않게(테스트·종료 신호).
    w.unref()
    w.on('message', (msg: MergeReply) => {
      if (!running || msg.id !== running.p.msg.id) return
      finish(msg.ok ? { value: msg.value } : { error: new MergeFailedError(msg.error) })
    })
    w.on('error', (e) => {
      discard(w)
      finish({ error: new MergeFailedError(`merge worker crashed: ${e.message}`) })
    })
    w.on('exit', (code) => {
      discard(w)
      finish({ error: new MergeFailedError(`merge worker exited (${code})`) })
    })
    return w
  }

  function pump(): void {
    while (!running && !destroyed && queue.length > 0) {
      const p = queue.shift()!
      clearTimeout(p.queueTimer)
      const left = p.deadline - Date.now()
      if (left <= 0) {
        // 줄 서 있는 동안 기한이 지났다 — 보내지 않는다.
        p.reject(new MergeTimeoutError('merge timed out while queued'))
        continue
      }
      worker ??= spawn()
      const w = worker
      const timer = setTimeout(() => {
        // 계산 중인 스레드를 강제 종료한다 — 결과는 버려지고 아무것도 적용되지 않는다.
        discard(w)
        finish({ error: new MergeTimeoutError(`merge timed out after ${left}ms`) })
      }, left)
      running = { p, timer }
      w.postMessage(p.msg, transferOf(p.msg))
    }
  }

  function run(msg: MergeJobMessage, limit: number): Promise<WorkerValue> {
    if (destroyed) return Promise.reject(new MergeFailedError('merge runner destroyed'))
    return new Promise<WorkerValue>((resolve, reject) => {
      const wait = Math.max(1, limit)
      const p: Pending = { msg, deadline: Date.now() + wait, resolve, reject }
      p.queueTimer = setTimeout(() => {
        const i = queue.indexOf(p)
        if (i < 0) return
        queue.splice(i, 1)
        reject(new MergeTimeoutError('merge timed out while queued'))
      }, wait)
      queue.push(p)
      pump()
    })
  }

  return {
    timeoutMs,
    prepare(job, limit = timeoutMs) {
      return run({ id: nextId++, kind: 'prepare', ...job }, limit) as Promise<PrepareResult>
    },
    merge(job, limit = timeoutMs) {
      return run({ id: nextId++, kind: 'merge', ...job }, limit) as Promise<LiveMergeResult>
    },
    async destroy() {
      destroyed = true
      for (const p of queue.splice(0)) {
        clearTimeout(p.queueTimer)
        p.reject(new MergeFailedError('merge runner destroyed'))
      }
      if (running) finish({ error: new MergeFailedError('merge runner destroyed') })
      if (worker) discard(worker)
    },
  }
}
