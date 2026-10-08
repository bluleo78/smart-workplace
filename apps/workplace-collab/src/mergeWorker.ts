// DOM 전역 설치가 TipTap 변환기(markdownCodec)보다 먼저여야 한다 — 워커는 별도 isolate 라 메인의 설치가 보이지 않는다.
import './dom-install'

import { parentPort } from 'node:worker_threads'

import { docToMarkdown } from '@smart-workplace/wiki-editor-schema'
import { closestBase, type MergeSide, mergeWithSide, prepareMergeSide } from '@smart-workplace/wiki-editor-schema/merge'

import { normalizeMarkdown, planKeepLive, yUpdateToRoot } from './markdownCodec'
import type { LiveMergeResult, MergeJob, MergeJobMessage, MergeReply, PrepareResult, WorkerValue } from './mergeRunner'

/**
 * 3-way 병합 워커 스레드(WP-289) — 무거운 문자열 계산(정규화·기준본 고르기·블록 병합)을 이벤트 루프 밖에서 한다.
 * 왜 워커인가: 크거나 고약한 노트에서 병합이 수 초(10000 동일 블록 4.8s), 정규화가 한 번에 0.5s 가까이 걸린다 — 메인 스레드에서
 * 돌면 그동안 모든 문서의 실시간 동기화가 멈춘다. 시간 제한을 넘기면 실행기가 이 스레드를 강제 종료한다(부분 결과 없음).
 * 병합 뒤 keepLive 계획(병합 결과 블록 ↔ 실시간 블록 짝짓기·끝 공백 되붙이기)도 여기서 만든다 — 블록마다 직렬화·정규화하고 LCS 표를 채우는
 * 계산이라 큰 노트에선 메인 스레드를 오래 붙잡는다. 실시간 문서는 상태 사본(Y 업데이트)으로 받아 다룰 뿐, 적용은 메인 스레드가 한 트랜잭션으로 한다.
 */

/**
 * 마지막 병합의 기준본·AI본 쪽 계산(기준본 고르기 + 블록 나누기·기준↔AI 짝짓기). 같은 요청의 재병합 회차(병합 도중 문서가 바뀜)는
 * 같은 기준본 후보·AI본으로 오므로 이것을 재사용하고 현재본 쪽만 다시 계산한다. 입력 문자열이 같으면 결과도 같아 재사용해도 결과는 같다.
 */
let lastSide: { bases: string[]; ai: string; side: MergeSide } | null = null

/** 기준본 후보·AI본 → 병합 준비물(직전과 같은 입력이면 재사용). */
function mergeSideOf(bases: string[], ai: string): MergeSide {
  const hit = lastSide && lastSide.ai === ai && lastSide.bases.length === bases.length && lastSide.bases.every((b, i) => b === bases[i])
  if (!hit) lastSide = { bases, ai, side: prepareMergeSide(closestBase(bases, ai), ai) }
  return lastSide!.side
}

/** 병합 + 계획 — 실시간 상태 하나에서 현재본(직렬화)과 계획을 함께 만든다(둘이 같은 문서를 가리키게). */
function merge(job: MergeJob): LiveMergeResult {
  const live = yUpdateToRoot(job.live)
  const current = docToMarkdown(live)
  // 현재본이 곧 AI본이면 병합할 것이 없다 — 준비물도 만들지 않는다(mergeMarkdown3 의 지름길과 같다).
  const merged = current === job.ai ? { markdown: current, conflicts: 0 } : mergeWithSide(mergeSideOf(job.bases, job.ai), current)
  return { ...merged, plan: planKeepLive(live, merged.markdown) }
}

/** 정규화 + 빈 본문 판정. 빈 AI본은 기준본·현재본도 모두 비었을 때만 허용(아니면 병합이 "AI 가 거의 모두 지움"이 된다). */
function prepare(body: string, bases: string[], current: string): PrepareResult {
  let ai: string
  let normBases: string[]
  try {
    ai = normalizeMarkdown(body)
    normBases = bases.map(normalizeMarkdown)
  } catch (e) {
    return { rejected: `unparseable body: ${(e as Error).message}`, code: 'unparseable_body' }
  }
  if (ai.trim() === '' && (normBases.some((b) => b.trim() !== '') || current.trim() !== '')) {
    return { rejected: 'empty body: refusing to merge an empty body into a non-empty note', code: 'empty_body' }
  }
  return { ai, bases: normBases }
}

parentPort!.on('message', (job: MergeJobMessage) => {
  // 테스트 전용 고장 — 처리 밖 예외(워커 'error')·스레드 종료(워커 'exit')로 실행기의 고장 경로를 재현한다.
  if (job.fault === 'exit') process.exit(3)
  if (job.fault === 'throw') throw new Error('test fault')
  try {
    if (job.delayMs) {
      // 테스트 전용 — CPU 를 붙잡는 느린 계산 흉내(비동기 대기면 메인 스레드에서 돌아도 통과해 검증이 무의미하다).
      const until = Date.now() + job.delayMs
      while (Date.now() < until) {
        // 바쁜 대기
      }
    }
    const value: WorkerValue = job.kind === 'prepare' ? prepare(job.body, job.bases, job.current) : merge(job)
    parentPort!.postMessage({ id: job.id, ok: true, value } satisfies MergeReply)
  } catch (e) {
    parentPort!.postMessage({ id: job.id, ok: false, error: (e as Error).message } satisfies MergeReply)
  }
})
