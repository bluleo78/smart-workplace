import {
  COLLAB_AI_APPLY_ACK_TYPE,
  COLLAB_AI_APPLY_TYPE,
  COLLAB_AI_CANCEL_TYPE,
  COLLAB_ROLE_CHANGED_TYPE,
} from '@smart-workplace/wiki-editor-schema/collab-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_APPLY_ACK_TIMEOUT_MS, type AiApplyProvider, requestAiApply } from './aiApplyHandshake'

/** 가짜 provider — 보낸 stateless 를 모으고, 서버 stateless 를 흉내 내 리스너에 흘린다. */
function fakeProvider(over: Partial<{ status: string; isSynced: boolean; authorizedScope: string }> = {}) {
  const listeners = new Set<(e: { payload: string }) => void>()
  const sent: Array<{ type: string; requestId: string }> = []
  const provider: AiApplyProvider = {
    isSynced: over.isSynced ?? true,
    authorizedScope: over.authorizedScope ?? 'read-write',
    configuration: { websocketProvider: { status: over.status ?? 'connected' } },
    sendStateless: (payload) => sent.push(JSON.parse(payload) as { type: string; requestId: string }),
    on: (_e, fn) => listeners.add(fn),
    off: (_e, fn) => listeners.delete(fn),
  }
  const emit = (msg: unknown) => {
    const payload = typeof msg === 'string' ? msg : JSON.stringify(msg)
    for (const fn of [...listeners]) fn({ payload })
  }
  return { provider, sent, emit, listeners }
}

/** 넣기 기록용 — commit 이 넣었는지와 ai-cancel 과의 순서를 본다. */
function inserter(sent: Array<{ type: string }>) {
  const order: string[] = []
  return {
    order,
    insert: () => {
      order.push(...sent.map((m) => m.type), 'insert')
    },
  }
}

describe('requestAiApply', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ai-apply 를 보내고 같은 requestId 의 ack 가 오면 acked 로 끝나고, commit 은 취소 없이 넣는다', async () => {
    const { provider, sent, emit, listeners } = fakeProvider()
    const p = requestAiApply(() => provider)
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe(COLLAB_AI_APPLY_TYPE)
    expect(sent[0].requestId).toMatch(/.+/)
    emit({ type: COLLAB_AI_APPLY_ACK_TYPE, requestId: sent[0].requestId })
    const r = await p
    expect(r.acked).toBe(true)
    // 끝나면 리스너를 거둔다.
    expect(listeners.size).toBe(0)
    const ins = vi.fn()
    expect(r.commit(ins)).toBe(true)
    expect(ins).toHaveBeenCalledOnce()
    expect(sent.map((m) => m.type)).toEqual([COLLAB_AI_APPLY_TYPE])
  })

  it('다른 requestId·다른 type·깨진 페이로드는 무시하고 기다린다', async () => {
    const { provider, sent, emit } = fakeProvider()
    let settled = false
    const p = requestAiApply(() => provider).then((r) => {
      settled = true
      return r
    })
    const id = sent[0].requestId
    emit({ type: COLLAB_AI_APPLY_ACK_TYPE, requestId: 'other' })
    emit({ type: COLLAB_ROLE_CHANGED_TYPE, role: 'VIEWER' })
    emit({ type: COLLAB_AI_CANCEL_TYPE, requestId: id })
    emit('not json')
    emit('null')
    await Promise.resolve()
    expect(settled).toBe(false)
    emit({ type: COLLAB_AI_APPLY_ACK_TYPE, requestId: id })
    await expect(p).resolves.toMatchObject({ acked: true })
  })

  it('ack 가 오지 않으면 시간 초과(기본 3000ms) 뒤 acked=false 로 끝나고 리스너를 거둔다', async () => {
    const { provider, listeners } = fakeProvider()
    let result: { acked: boolean } | null = null
    void requestAiApply(() => provider).then((r) => {
      result = r
    })
    await vi.advanceTimersByTimeAsync(AI_APPLY_ACK_TIMEOUT_MS - 1)
    expect(result).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toMatchObject({ acked: false })
    expect(listeners.size).toBe(0)
  })

  it('timeoutMs 옵션을 따른다', async () => {
    const { provider } = fakeProvider()
    const p = requestAiApply(() => provider, { timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(50)
    await expect(p).resolves.toMatchObject({ acked: false })
  })

  it('시간 초과 뒤 commit 은 같은 요청의 ai-cancel 을 넣기 전에 먼저 보낸다(늦은 태그가 다음 사람 저장에 붙지 않게)', async () => {
    const { provider, sent } = fakeProvider()
    const p = requestAiApply(() => provider)
    await vi.advanceTimersByTimeAsync(AI_APPLY_ACK_TIMEOUT_MS)
    const ins = inserter(sent)
    expect((await p).commit(ins.insert)).toBe(true)
    expect(ins.order).toEqual([COLLAB_AI_APPLY_TYPE, COLLAB_AI_CANCEL_TYPE, 'insert'])
    expect(sent[1].requestId).toBe(sent[0].requestId)
  })

  it.each([
    ['끊김', { status: 'disconnected' }],
    ['연결 중', { status: 'connecting' }],
    ['첫 동기화 전', { isSynced: false }],
    ['읽기 전용', { authorizedScope: 'readonly' }],
  ])('%s 이면 보내지 않고 즉시 acked=false, commit 은 아무것도 보내지 않고 넣는다', async (_label, over) => {
    const { provider, sent, listeners } = fakeProvider(over)
    const r = await requestAiApply(() => provider)
    expect(r.acked).toBe(false)
    expect(sent).toHaveLength(0)
    expect(listeners.size).toBe(0)
    const ins = vi.fn()
    expect(r.commit(ins)).toBe(true)
    expect(ins).toHaveBeenCalledOnce()
    expect(sent).toHaveLength(0)
  })

  it('canInsert 가 처음부터 거짓이면 보내지 않고, commit 은 넣지도 취소하지도 않는다', async () => {
    const { provider, sent } = fakeProvider()
    const r = await requestAiApply(() => provider, { canInsert: () => false })
    expect(sent).toHaveLength(0)
    const ins = vi.fn()
    expect(r.commit(ins)).toBe(false)
    expect(ins).not.toHaveBeenCalled()
    expect(sent).toHaveLength(0)
  })

  it('기다리는 사이 canInsert 가 거짓이 되면 commit 은 넣지 않고 ai-cancel 을 한 번만 보낸다', async () => {
    const { provider, sent, emit } = fakeProvider()
    let can = true
    const p = requestAiApply(() => provider, { canInsert: () => can })
    const id = sent[0].requestId
    emit({ type: COLLAB_AI_APPLY_ACK_TYPE, requestId: id })
    const r = await p
    can = false
    const ins = vi.fn()
    expect(r.commit(ins)).toBe(false)
    expect(r.commit(ins)).toBe(false)
    expect(ins).not.toHaveBeenCalled()
    expect(sent).toEqual([
      { type: COLLAB_AI_APPLY_TYPE, requestId: id },
      { type: COLLAB_AI_CANCEL_TYPE, requestId: id },
    ])
  })

  it('취소는 그때의 provider 로 보내고, ack 리스너는 보낸 provider 에서 거둔다(기다리는 사이 세션이 바뀐 경우)', async () => {
    const first = fakeProvider()
    const now = fakeProvider()
    let current = first.provider
    const p = requestAiApply(() => current)
    await vi.advanceTimersByTimeAsync(AI_APPLY_ACK_TIMEOUT_MS)
    current = now.provider
    ;(await p).commit(() => {})
    expect(first.sent.map((m) => m.type)).toEqual([COLLAB_AI_APPLY_TYPE])
    expect(first.listeners.size).toBe(0)
    expect(now.sent).toEqual([{ type: COLLAB_AI_CANCEL_TYPE, requestId: first.sent[0].requestId }])
  })

  it('요청마다 requestId 가 다르다', () => {
    const { provider, sent } = fakeProvider()
    void requestAiApply(() => provider)
    void requestAiApply(() => provider)
    expect(sent[0].requestId).not.toBe(sent[1].requestId)
  })

  it('signal 이 중단되면 ack 를 기다리지 않고 바로 acked=false 로 끝나고, commit 은 넣지 않고 ai-cancel 을 보낸다', async () => {
    const { provider, sent, listeners } = fakeProvider()
    const ctl = new AbortController()
    const p = requestAiApply(() => provider, { signal: ctl.signal })
    ctl.abort()
    const r = await p
    expect(r.acked).toBe(false)
    expect(listeners.size).toBe(0)
    const ins = vi.fn()
    expect(r.commit(ins)).toBe(false)
    expect(ins).not.toHaveBeenCalled()
    expect(sent.map((m) => m.type)).toEqual([COLLAB_AI_APPLY_TYPE, COLLAB_AI_CANCEL_TYPE])
  })

  it('이미 중단된 signal 이면 보내지 않는다', async () => {
    const { provider, sent } = fakeProvider()
    const ctl = new AbortController()
    ctl.abort()
    const r = await requestAiApply(() => provider, { signal: ctl.signal })
    expect(r.acked).toBe(false)
    expect(sent).toHaveLength(0)
    expect(r.commit(() => {})).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
