import { describe, expect, it } from 'vitest'

import { summarize, type UploadBatch, uploadQueueReducer } from './uploadQueue'
import { files } from './uploadTestUtils'

/** 배치를 올릴 자리(공간 1 루트). */
const ROOT = { sid: 1, folderId: null }

/** n 개짜리 배치를 start 로 만든 상태를 돌려준다. */
function started(n: number): UploadBatch {
  return uploadQueueReducer(null, { type: 'start', root: ROOT, items: files(n) })!
}

describe('uploadQueueReducer', () => {
  it('start 는 모든 항목을 queued, running=true 로 만든다', () => {
    const s = started(3)
    expect(s.running).toBe(true)
    expect(s.cancelled).toBe(false)
    expect(s.items.map((i) => i.id)).toEqual(['0', '1', '2'])
    expect(s.items.every((i) => i.status === 'queued')).toBe(true)
  })

  // 패널의 접힘 상태는 배치마다 새로 — 새 start 는 새 id, 다시 시도는 같은 배치라 id 를 유지한다.
  it('start 마다 배치 id 가 바뀌고 retry 는 id 를 유지한다', () => {
    let s = started(2)
    s = uploadQueueReducer(s, { type: 'fail', id: '0', error: 'x', retryable: true })!
    s = uploadQueueReducer(s, { type: 'finish' })!
    const firstId = s.id
    const retried = uploadQueueReducer(s, { type: 'retry', ids: ['0'] })!
    expect(retried.id).toBe(firstId)
    const next = uploadQueueReducer(s, { type: 'start', root: ROOT, items: files(1) })!
    expect(next.id).not.toBe(firstId)
  })

  it('start 는 배치의 자리(root)를 담고 retry 도 그대로 둔다', () => {
    let s = uploadQueueReducer(null, { type: 'start', root: { sid: 3, folderId: 7 }, items: files(1) })!
    expect(s.root).toEqual({ sid: 3, folderId: 7 })
    s = uploadQueueReducer(s, { type: 'fail', id: '0', error: 'x', retryable: true })!
    expect(uploadQueueReducer(s, { type: 'retry', ids: ['0'] })!.root).toEqual({ sid: 3, folderId: 7 })
  })

  it('progress 가 같은 퍼센트면 같은 상태 객체를 돌려준다', () => {
    let s = started(1)
    s = uploadQueueReducer(s, { type: 'begin', id: '0' })!
    s = uploadQueueReducer(s, { type: 'progress', id: '0', percent: 42 })!
    expect(uploadQueueReducer(s, { type: 'progress', id: '0', percent: 42 })).toBe(s)
  })

  it('begin → progress(42) 는 uploading 이고 percent 42', () => {
    let s = started(1)
    s = uploadQueueReducer(s, { type: 'begin', id: '0' })!
    s = uploadQueueReducer(s, { type: 'progress', id: '0', percent: 42 })!
    expect(s.items[0].status).toBe('uploading')
    expect(s.items[0].percent).toBe(42)
  })

  it('progress(100) 뒤에도 응답 전까지 uploading 이다', () => {
    let s = started(1)
    s = uploadQueueReducer(s, { type: 'begin', id: '0' })!
    s = uploadQueueReducer(s, { type: 'progress', id: '0', percent: 100 })!
    expect(s.items[0].status).toBe('uploading')
    expect(s.items[0].percent).toBe(100)
    s = uploadQueueReducer(s, { type: 'done', id: '0' })!
    expect(s.items[0].status).toBe('done')
  })

  it('fail 은 이유와 retryable 을 보존한다', () => {
    let s = started(2)
    s = uploadQueueReducer(s, { type: 'fail', id: '1', error: '동영상 1GB 초과', retryable: false })!
    expect(s.items[1].status).toBe('failed')
    expect(s.items[1].error).toBe('동영상 1GB 초과')
    expect(s.items[1].retryable).toBe(false)
  })

  it('cancel 은 queued·uploading 만 cancelled 로 바꾸고 done·failed 는 둔다', () => {
    let s = started(4)
    s = uploadQueueReducer(s, { type: 'done', id: '0' })!
    s = uploadQueueReducer(s, { type: 'fail', id: '1', error: 'x', retryable: true })!
    s = uploadQueueReducer(s, { type: 'begin', id: '2' })!
    s = uploadQueueReducer(s, { type: 'cancel' })!
    expect(s.items.map((i) => i.status)).toEqual(['done', 'failed', 'cancelled', 'cancelled'])
    expect(s.cancelled).toBe(true)
    expect(s.running).toBe(false)
  })

  it('finish 는 running=false', () => {
    const s = uploadQueueReducer(started(1), { type: 'finish' })!
    expect(s.running).toBe(false)
  })

  it('retry 는 지정한 행만 queued 로 되돌리고 error 를 지운다', () => {
    let s = started(3)
    s = uploadQueueReducer(s, { type: 'fail', id: '0', error: 'a', retryable: true })!
    s = uploadQueueReducer(s, { type: 'fail', id: '1', error: 'b', retryable: true })!
    s = uploadQueueReducer(s, { type: 'finish' })!
    s = uploadQueueReducer(s, { type: 'retry', ids: ['1'] })!
    expect(s.items[1].status).toBe('queued')
    expect(s.items[1].error).toBeUndefined()
    expect(s.items[0].status).toBe('failed')
    expect(s.items[0].error).toBe('a')
    expect(s.running).toBe(true)
    expect(s.cancelled).toBe(false)
  })

  it('clear 는 null', () => {
    expect(uploadQueueReducer(started(1), { type: 'clear' })).toBeNull()
  })

  it('배치가 없으면 start 외 액션은 무시한다', () => {
    expect(uploadQueueReducer(null, { type: 'finish' })).toBeNull()
  })
})

describe('summarize', () => {
  it('done/failed/queued/overallPercent 를 계산한다 (5개 중 2 완료 + 1개 42% → 48)', () => {
    let s = started(5)
    s = uploadQueueReducer(s, { type: 'done', id: '0' })!
    s = uploadQueueReducer(s, { type: 'done', id: '1' })!
    s = uploadQueueReducer(s, { type: 'begin', id: '2' })!
    s = uploadQueueReducer(s, { type: 'progress', id: '2', percent: 42 })!
    const sum = summarize(s)
    expect(sum.total).toBe(5)
    expect(sum.done).toBe(2)
    expect(sum.failed).toBe(0)
    expect(sum.queued).toBe(2)
    expect(sum.uploading?.id).toBe('2')
    expect(sum.overallPercent).toBe(48)
  })

  // 실패·취소도 「처리됨」으로 쳐서 모든 파일을 다룬 뒤엔 막대가 100% 에 닿는다.
  it('overallPercent 는 실패도 처리된 것으로 센다 (10개 중 5개 실패, 올리는 중 없음 → 50)', () => {
    let s = started(10)
    for (const id of ['0', '1', '2', '3', '4']) s = uploadQueueReducer(s, { type: 'fail', id, error: 'x', retryable: true })!
    expect(summarize(s).overallPercent).toBe(50)
  })

  it('overallPercent 는 완료·실패·취소를 모두 처리로 쳐 끝나면 100', () => {
    let s = started(3)
    s = uploadQueueReducer(s, { type: 'done', id: '0' })!
    s = uploadQueueReducer(s, { type: 'fail', id: '1', error: 'x', retryable: true })!
    s = uploadQueueReducer(s, { type: 'cancel' })!
    expect(summarize(s).overallPercent).toBe(100)
  })

  it('failed 수를 센다', () => {
    let s = started(2)
    s = uploadQueueReducer(s, { type: 'fail', id: '0', error: 'x', retryable: true })!
    expect(summarize(s).failed).toBe(1)
    expect(summarize(s).uploading).toBeUndefined()
  })
})
