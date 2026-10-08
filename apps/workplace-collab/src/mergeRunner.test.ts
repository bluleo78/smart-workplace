import './dom-install'

import { afterEach, describe, expect, it } from 'vitest'

import { markdownToYUpdate } from './markdownCodec'
import { createMergeRunner, MergeFailedError, MergeTimeoutError, type MergeRunner } from './mergeRunner'

// 병합 실행기 — 실제 워커 스레드(src/mergeWorker.ts)로 정규화·병합·시간 제한·재기동을 확인한다.
describe('mergeRunner', () => {
  let runner: MergeRunner | undefined

  afterEach(async () => {
    await runner?.destroy()
    runner = undefined
  })

  it('normalizes the bodies and rejects an empty AI body against a non-empty base', async () => {
    runner = createMergeRunner()
    expect(await runner.prepare({ body: '|a|b|\n|-|-|\n|1|2|', bases: ['_강조_'], current: '' })).toEqual({
      ai: '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
      bases: ['*강조*'],
    })
    expect(await runner.prepare({ body: ' \n ', bases: ['본문'], current: '' })).toMatchObject({ rejected: expect.stringMatching(/^empty body/) })
    expect(await runner.prepare({ body: '', bases: [''], current: '' })).toEqual({ ai: '', bases: [''] })
  })

  it('merges in the worker', async () => {
    runner = createMergeRunner()
    const r = await runner.merge({ bases: ['가\n\n나'], live: markdownToYUpdate('가 사람\n\n나'), ai: '가\n\n나 AI' })
    expect(r).toMatchObject({ markdown: '가 사람\n\n나 AI', conflicts: 0 })
    // 계획 — 사람이 고친 첫 블록은 실시간 노드 그대로(인덱스 0), AI 가 고친 둘째 블록만 새 노드.
    expect(r.plan.liveCount).toBe(2)
    expect(r.plan.blocks[0]).toBe(0)
    expect(typeof r.plan.blocks[1]).toBe('object')
  })

  it('terminates a timed-out worker and serves the next job from a fresh one', async () => {
    let jobs = 0
    runner = createMergeRunner({ timeoutMs: 300, testDelayMs: () => (jobs++ === 0 ? 5000 : 0) })
    // 실시간 상태 버퍼는 보낼 때 워커로 옮겨진다(떼어 감) — 작업마다 새로 만든다.
    const job = () => ({ bases: ['가'], live: markdownToYUpdate('가'), ai: '가 AI' })
    const started = performance.now()
    await expect(runner.merge(job())).rejects.toBeInstanceOf(MergeTimeoutError)
    expect(performance.now() - started).toBeLessThan(2000)
    expect((await runner.merge(job(), 5000)).markdown).toBe('가 AI')
  })

  it('times out a queued job whose deadline passes behind a slow one, without delaying the slow one', async () => {
    runner = createMergeRunner({ timeoutMs: 5000, testDelayMs: 800 })
    // 실시간 상태 버퍼는 보낼 때 워커로 옮겨진다(떼어 감) — 작업마다 새로 만든다.
    const job = () => ({ bases: ['가'], live: markdownToYUpdate('가'), ai: '가 AI' })
    const slow = runner.merge(job())
    const started = performance.now()
    let slowDone = false
    void slow.then(() => (slowDone = true))
    // 앞 작업(800ms)이 끝나기를 기다리지 않고 자기 기한(200ms)에 끝난다.
    await expect(runner.merge(job(), 200)).rejects.toBeInstanceOf(MergeTimeoutError)
    expect(performance.now() - started).toBeLessThan(600)
    expect(slowDone).toBe(false)
    expect((await slow).markdown).toBe('가 AI')
  })

  for (const fault of ['throw', 'exit'] as const) {
    it(`fails the job when the worker crashes (${fault}) and serves the next job from a fresh worker`, async () => {
      let jobs = 0
      runner = createMergeRunner({ testFault: () => (jobs++ === 0 ? fault : undefined) })
      // 실시간 상태 버퍼는 보낼 때 워커로 옮겨진다(떼어 감) — 작업마다 새로 만든다.
    const job = () => ({ bases: ['가'], live: markdownToYUpdate('가'), ai: '가 AI' })
      await expect(runner.merge(job())).rejects.toBeInstanceOf(MergeFailedError)
      expect((await runner.merge(job())).markdown).toBe('가 AI')
    })
  }

  it('reports the time actually left on a timeout', async () => {
    runner = createMergeRunner({ timeoutMs: 5000, testDelayMs: 3000 })
    const err = await runner.merge({ bases: ['가'], live: markdownToYUpdate('가'), ai: '가 AI' }, 250).catch((e: Error) => e)
    // 보낼 때 남은 시간(≤ 250ms) — 기본 상한(5000ms)이 아니다.
    const ms = Number(/after (\d+)ms/.exec((err as Error).message)?.[1])
    expect(ms).toBeGreaterThan(200)
    expect(ms).toBeLessThanOrEqual(250)
  })
})
