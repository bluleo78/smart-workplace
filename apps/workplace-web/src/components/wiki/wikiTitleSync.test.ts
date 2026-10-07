import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTitleSaver,
  ECHO_WINDOW_MS,
  initTitleSync,
  needsTitleSave,
  TITLE_RETRY_MAX_ATTEMPTS,
  type TitleSyncAction,
  titleSyncReducer,
  type TitleSyncState,
} from './wikiTitleSync'

/** 액션을 순서대로 적용한 최종 상태. */
const run = (remote: string, ...actions: TitleSyncAction[]): TitleSyncState =>
  actions.reduce(titleSyncReducer, initTitleSync(remote))

// 노트 제목 동기화(WP-287) — 내 입력은 보존하고, 다른 사람의 제목은 입력 중이 아닐 때만 반영한다.
describe('titleSyncReducer', () => {
  it('입력 중이 아니면 원격 제목을 바로 반영한다', () => {
    expect(run('회의록', { type: 'remote', title: '주간 회의록', now: 0 }).local).toBe('주간 회의록')
  })

  it('입력 포커스 중엔 원격 제목이 내 입력을 덮지 않고, blur 때 반영한다', () => {
    const typing = run('회의록', { type: 'focus' }, { type: 'remote', title: '남이 바꾼 제목', now: 0 })
    expect(typing.local).toBe('회의록')
    expect(titleSyncReducer(typing, { type: 'blur' }).local).toBe('남이 바꾼 제목')
  })

  it('보내기 전(디바운스 대기) 이거나 응답을 기다리는 동안엔 blur 해도 내 입력을 유지한다', () => {
    const s = run(
      '회의록',
      { type: 'focus' },
      { type: 'change', title: '회의록 2' },
      { type: 'blur' },
      { type: 'remote', title: '다른 제목', now: 0 },
    )
    expect(s.local).toBe('회의록 2')
    const sending = titleSyncReducer(s, { type: 'sent', title: '회의록 2', now: 0 })
    expect(titleSyncReducer(sending, { type: 'remote', title: '다른 제목', now: 0 }).local).toBe('회의록 2')
  })

  it('저장이 끝나면(포커스 밖) 서버가 가진 제목으로 맞춘다', () => {
    const s = run(
      '회의록',
      { type: 'focus' },
      { type: 'change', title: '새 제목' },
      { type: 'sent', title: '새 제목', now: 0 },
      { type: 'blur' },
      { type: 'remote', title: '새 제목', now: 0 },
      { type: 'settled' },
    )
    expect(s.local).toBe('새 제목')
    expect(s.pending).toBe(0)
  })

  it('내 예전 저장의 늦은 메아리(self-echo)는 마지막에 보낸 제목을 되돌리지 않는다', () => {
    // "abc" 를 보내고 이어서 "abcd" 를 보냈는데, "abc" 의 SSE 가 "abcd" 응답보다 늦게 도착한 경우.
    const s = run(
      '',
      { type: 'focus' },
      { type: 'change', title: 'abc' },
      { type: 'sent', title: 'abc', now: 0 },
      { type: 'change', title: 'abcd' },
      { type: 'sent', title: 'abcd', now: 0 },
      { type: 'settled' },
      { type: 'remote', title: 'abcd', now: 0 },
      { type: 'settled' },
      { type: 'blur' },
      { type: 'remote', title: 'abc', now: 0 },
    )
    expect(s.local).toBe('abcd')
  })

  it('내가 보낸 적 없는 제목이 오면 진짜 원격 변경으로 보고 반영하며 보낸 기록을 비운다', () => {
    const s = run(
      '',
      { type: 'change', title: 'abc' },
      { type: 'sent', title: 'abc', now: 0 },
      { type: 'remote', title: 'abc', now: 0 },
      { type: 'settled' },
      { type: 'remote', title: '남의 제목', now: 0 },
    )
    expect(s.local).toBe('남의 제목')
    expect(s.sent).toEqual([])
    // 기록을 비웠으니 나중에 누군가 "abc" 로 되돌려도 그대로 반영한다.
    expect(titleSyncReducer(s, { type: 'remote', title: 'abc', now: 0 }).local).toBe('abc')
  })

  it('메아리 창이 지난 뒤 남이 내 옛 제목으로 되돌리면 진짜 원격 변경으로 반영한다', () => {
    const s = run(
      '',
      { type: 'change', title: 'abc' },
      { type: 'sent', title: 'abc', now: 0 },
      { type: 'change', title: 'abcd' },
      { type: 'sent', title: 'abcd', now: 100 },
      { type: 'settled' },
      { type: 'settled' },
      { type: 'remote', title: 'abcd', now: 200 },
      { type: 'remote', title: 'abc', now: 200 + ECHO_WINDOW_MS + 1 },
    )
    expect(s.local).toBe('abc')
  })

  it('저장이 실패하면 입력을 되돌리지 않고 다음 입력까지 내 제목을 유지한다', () => {
    const s = run(
      '회의록',
      { type: 'change', title: '바꾼 제목' },
      { type: 'sent', title: '바꾼 제목', now: 0 },
      { type: 'failed' },
      { type: 'remote', title: '회의록', now: 0 },
    )
    expect(s.local).toBe('바꾼 제목')
    expect(s.pending).toBe(0)
  })

  it('보낸 기록은 최근 것만 유지한다(무한 증가 방지)', () => {
    let s = initTitleSync('')
    for (let i = 0; i < 30; i++) s = titleSyncReducer(s, { type: 'sent', title: `t${i}`, now: 0 })
    expect(s.sent.length).toBeLessThanOrEqual(10)
    expect(s.sent[s.sent.length - 1].title).toBe('t29')
  })
})

describe('titleSyncReducer — 실패·되돌림', () => {
  it('다시 보내도 소용없는 실패(abandoned)면 내 입력을 포기하고 원격 제목을 다시 따른다', () => {
    const s = run(
      '회의록',
      { type: 'change', title: '새 제목' },
      { type: 'sent', title: '새 제목', now: 0 },
      { type: 'abandoned' },
    )
    expect(s.dirty).toBe(false)
    expect(s.local).toBe('회의록')
    expect(titleSyncReducer(s, { type: 'remote', title: '남이 바꾼 제목', now: 1 }).local).toBe('남이 바꾼 제목')
  })

  it('실패 뒤 원격 제목으로 되돌리면 보낼 것이 없어 원격 제목을 다시 따른다', () => {
    const s = run(
      '회의록',
      { type: 'focus' },
      { type: 'change', title: '새 제목' },
      { type: 'sent', title: '새 제목', now: 0 },
      { type: 'failed' },
      { type: 'change', title: '회의록' },
      { type: 'blur' },
    )
    expect(s.dirty).toBe(false)
    expect(needsTitleSave(s, '회의록')).toBe(false)
    expect(titleSyncReducer(s, { type: 'remote', title: '남이 바꾼 제목', now: 1 }).local).toBe('남이 바꾼 제목')
  })
})

// 제목 저장 스케줄러 — 일시 실패는 같은 제목을 간격을 두고 다시 보내고, 토스트는 연속 실패에 한 번만.
describe('createTitleSaver', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** send 결과를 호출마다 정해 주는 가짜 저장 + 리듀서 연결 기록. */
  function setup(results: ('ok' | 'fail' | 'slow-fail' | 'forbidden')[]) {
    const sent: string[] = []
    const events: string[] = []
    const errors: unknown[] = []
    const saver = createTitleSaver({
      debounceMs: 400,
      send: (title) => {
        sent.push(title)
        const r = results.shift() ?? 'ok'
        if (r === 'ok') return Promise.resolve()
        if (r === 'slow-fail') return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        return Promise.reject(r === 'forbidden' ? { response: { status: 403 } } : new Error('network'))
      },
      onSent: (t) => events.push(`sent:${t}`),
      onSettled: () => events.push('settled'),
      onFailed: () => events.push('failed'),
      onAbandoned: () => events.push('abandoned'),
      onError: (e) => errors.push(e),
    })
    return { saver, sent, events, errors }
  }

  it('디바운스 뒤 보낸다', async () => {
    const { saver, sent } = setup([])
    saver.schedule('가')
    await vi.advanceTimersByTimeAsync(399)
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(sent).toEqual(['가'])
  })

  it('일시 실패하면 같은 제목을 1s·2s 간격으로 다시 보내 저장하고, 토스트는 한 번만', async () => {
    const { saver, sent, events, errors } = setup(['fail', 'fail', 'ok'])
    saver.schedule('제목')
    await vi.advanceTimersByTimeAsync(400)
    expect(sent).toEqual(['제목'])
    await vi.advanceTimersByTimeAsync(999)
    expect(sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sent).toEqual(['제목', '제목'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(sent).toEqual(['제목', '제목', '제목'])
    expect(events).toEqual(['sent:제목', 'failed', 'sent:제목', 'failed', 'sent:제목', 'settled'])
    expect(errors).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toHaveLength(3)
  })

  it('재시도는 상한(30s 간격·횟수)이 있고, 멈춘 뒤에도 blur·언마운트(flush) 때 다시 보낸다', async () => {
    const { saver, sent } = setup(Array(20).fill('fail'))
    saver.schedule('제목')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(sent).toHaveLength(1 + TITLE_RETRY_MAX_ATTEMPTS)
    saver.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toHaveLength(2 + TITLE_RETRY_MAX_ATTEMPTS)
  })

  it('재시도 대기 중 blur(flush)하면 바로 보낸다', async () => {
    const { saver, sent } = setup(['fail', 'ok'])
    saver.schedule('제목')
    await vi.advanceTimersByTimeAsync(400)
    saver.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toEqual(['제목', '제목'])
  })

  it('새 입력이 있으면 옛 제목은 다시 보내지 않고 그 요청만 끝난 것으로 친다', async () => {
    const { saver, sent, events } = setup(['slow-fail', 'ok'])
    saver.schedule('옛 제목')
    await vi.advanceTimersByTimeAsync(400)
    saver.schedule('새 제목') // 옛 제목 응답 전 새 입력 — 새 제목이 먼저 저장되고 옛 제목은 늦게 실패한다
    await vi.advanceTimersByTimeAsync(400)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sent).toEqual(['옛 제목', '새 제목'])
    expect(events).toEqual(['sent:옛 제목', 'sent:새 제목', 'settled', 'settled'])
  })

  it('권한 없음 같은 4xx 는 다시 보내지 않고 포기한다', async () => {
    const { saver, sent, events } = setup(['forbidden'])
    saver.schedule('제목')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toEqual(['제목'])
    expect(events).toEqual(['sent:제목', 'abandoned'])
  })

  it('cancel(원격 제목으로 되돌림)하면 대기 중 재시도를 버린다', async () => {
    const { saver, sent } = setup(['fail'])
    saver.schedule('제목')
    await vi.advanceTimersByTimeAsync(400)
    saver.cancel()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toEqual(['제목'])
  })

  it('언마운트(dispose)는 대기 중 제목을 보내고 그 뒤 실패는 재시도하지 않는다', async () => {
    const { saver, sent } = setup(['fail'])
    saver.schedule('제목')
    saver.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toEqual(['제목'])
  })
})
