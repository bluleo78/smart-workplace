import './dom-install'

import { afterEach, describe, expect, it } from 'vitest'

import { markdownToYUpdate } from './markdownCodec'
import { createMergeRunner, type LiveMergeResult, MergeFailedError, MergeTimeoutError, type MergeRunner } from './mergeRunner'
import { manualClock } from './testing/manualClock'
import { createTestMergeRunner } from './testing/testMergeRunner'
import { WORKER_BOOT_LIMIT_MS } from './testing/workerBoot'

// 병합 실행기 — 실제 워커 스레드로 정규화·병합·시간 제한·재기동을 확인한다. 정상 경로는 운영 진입점(src/mergeWorker.ts),
// 붙잡기·고장이 필요한 시간 초과·고장 경로는 같은 handleJob 을 감싼 테스트 워커(testing/faultyMergeWorker.ts)로 돈다.
// 기한은 손으로 돌리는 시계(manualClock)로 잰다 — 실행기 기한은 워커 기동까지 포함해서, 실제 시계면 부하로 기동이 수 초 걸릴 때
// 시간 초과가 테스트 의도와 무관하게 터졌다. "느린 계산"도 시간(바쁜 대기 N ms) 대신 관문으로 붙잡아, 언제 끝나는지를 테스트가 정한다.
// 테스트마다 실제 워커를 띄우므로 시간 제한은 워커 기동 상한이다(멈춘 기동 감시 — 단언은 시간에 기대지 않는다).
describe('mergeRunner', { timeout: WORKER_BOOT_LIMIT_MS }, () => {
  let runner: MergeRunner | undefined

  afterEach(async () => {
    await runner?.destroy()
    runner = undefined
  })

  // 실시간 상태 버퍼는 보낼 때 워커로 옮겨진다(떼어 감) — 작업마다 새로 만든다.
  const job = () => ({ bases: ['가'], live: markdownToYUpdate('가'), ai: '가 AI' })
  /** 약속의 결과를 기다리지 않고 기록한다 — 끝났는지(settled)를 단언하고, 나중에 결과(값 또는 오류)를 꺼낸다. */
  const track = <T>(p: Promise<T>) => {
    const t = { settled: false, outcome: undefined as Promise<T | Error> | undefined }
    t.outcome = p.then(
      (v) => ((t.settled = true), v),
      (e: Error) => ((t.settled = true), e),
    )
    return t
  }

  it('normalizes the bodies and rejects an empty AI body against a non-empty base', async () => {
    // 시간이 흐르지 않는 시계 — 이 테스트는 기한을 다루지 않는다(워커 기동이 얼마나 걸리든 기한에 걸리지 않게).
    runner = createMergeRunner({ clock: manualClock() })
    expect(await runner.prepare({ body: '|a|b|\n|-|-|\n|1|2|', bases: ['_강조_'] })).toEqual({
      ai: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      bases: ['*강조*'],
    })
    expect(await runner.prepare({ body: ' \n ', bases: ['본문'] })).toMatchObject({ rejected: expect.stringMatching(/^empty body/) })
    expect(await runner.prepare({ body: '', bases: [''] })).toEqual({ ai: '', bases: [''] })
  })

  it('merges in the worker', async () => {
    runner = createMergeRunner({ clock: manualClock() })
    const r = await runner.merge({ bases: ['가\n\n나'], live: markdownToYUpdate('가 사람\n\n나'), ai: '가\n\n나 AI' })
    expect(r).toMatchObject({ markdown: '가 사람\n\n나 AI', conflicts: 0 })
    // 계획 — 사람이 고친 첫 블록은 실시간 노드 그대로(인덱스 0), AI 가 고친 둘째 블록만 새 노드.
    expect(r.plan.liveCount).toBe(2)
    expect(r.plan.blocks[0]).toBe(0)
    expect(typeof r.plan.blocks[1]).toBe('object')
  })

  it('terminates a timed-out worker and serves the next job from a fresh one', async () => {
    const clock = manualClock()
    let jobs = 0
    const t = createTestMergeRunner({ clock, timeoutMs: 300, testHold: () => jobs++ === 0 })
    runner = t
    const first = track(t.merge(job()))
    // 첫 작업이 워커 안에서 계산 중(스레드를 쥐고 끝나지 않음)이 된 뒤에 기한을 흘린다.
    await expect.poll(() => t.held(), { timeout: WORKER_BOOT_LIMIT_MS }).toBe(1)
    clock.advance(299)
    // 기한 전 — 실행기는 시간 초과 때 그 자리에서(동기로) 워커를 버린다(terminate). 일찍 불렸다면 여기서 이미 버려졌다.
    expect(t.workers[0].terminated).toBeUndefined()
    expect(first.settled).toBe(false)
    clock.advance(1)
    // 기한에 바로 시간 초과 — 끝나지 않는 계산을 기다리지 않는다.
    expect(await first.outcome).toBeInstanceOf(MergeTimeoutError)
    // 계산 중이던 스레드는 강제 종료로 실제로 멈췄다(못 멈추면 이 약속이 풀리지 않는다).
    expect(t.workers[0].terminated).toBeDefined()
    await t.workers[0].terminated
    // 다음 작업은 새 워커가 받는다.
    expect((await t.merge(job())).markdown).toBe('가 AI')
    expect(t.workers).toHaveLength(2)
  })

  it('times out a queued job whose deadline passes behind a slow one, without delaying the slow one', async () => {
    const clock = manualClock()
    let jobs = 0
    const t = createTestMergeRunner({ clock, timeoutMs: 5000, testHold: () => jobs++ === 0 })
    runner = t
    const slow = track(t.merge(job()))
    await expect.poll(() => t.held(), { timeout: WORKER_BOOT_LIMIT_MS }).toBe(1)
    // 앞 작업이 워커를 붙잡은 동안 기한 200ms 인 작업이 줄 선다 — 앞 작업을 기다리지 않고 자기 기한에 끝난다.
    const queued = track(t.merge(job(), 200))
    clock.advance(200)
    const err = await queued.outcome
    expect(err).toBeInstanceOf(MergeTimeoutError)
    expect((err as Error).message).toMatch(/while queued/)
    // 앞 작업은 그대로 계산 중이다(줄 선 작업의 시간 초과가 워커를 건드리지 않는다).
    expect(slow.settled).toBe(false)
    t.release()
    expect(((await slow.outcome) as LiveMergeResult).markdown).toBe('가 AI')
    expect(t.workers).toHaveLength(1)
  })

  for (const fault of ['throw', 'exit'] as const) {
    it(`fails the job when the worker crashes (${fault}) and serves the next job from a fresh worker`, async () => {
      let jobs = 0
      const t = createTestMergeRunner({ clock: manualClock(), testFault: () => (jobs++ === 0 ? fault : undefined) })
      runner = t
      await expect(t.merge(job())).rejects.toBeInstanceOf(MergeFailedError)
      expect((await t.merge(job())).markdown).toBe('가 AI')
      expect(t.workers).toHaveLength(2)
    })
  }

  it('reports the time actually left on a timeout', async () => {
    const clock = manualClock()
    const t = createTestMergeRunner({ clock, timeoutMs: 5000, testHold: () => true })
    runner = t
    // 앞 작업이 워커를 붙잡은 동안 기한 250ms 인 작업이 줄 선다.
    const first = track(t.merge(job()))
    await expect.poll(() => t.held(), { timeout: WORKER_BOOT_LIMIT_MS }).toBe(1)
    const second = track(t.merge(job(), 250))
    // 100ms 기다린 뒤 앞 작업이 끝나 둘째가 보내진다 — 보낼 때 남은 시간은 150ms 다.
    clock.advance(100)
    t.release()
    expect(((await first.outcome) as LiveMergeResult).markdown).toBe('가 AI')
    await expect.poll(() => t.held(), { timeout: WORKER_BOOT_LIMIT_MS }).toBe(2)
    clock.advance(150)
    // 보낼 때 남은 시간(150ms) — 처음 기한(250ms)도, 기본 상한(5000ms)도 아니다.
    expect(((await second.outcome) as Error).message).toBe('merge timed out after 150ms')
  })
})
