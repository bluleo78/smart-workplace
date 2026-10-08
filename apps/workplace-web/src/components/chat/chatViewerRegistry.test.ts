import { describe, expect, it, vi } from 'vitest'

import { createChatViewerRegistry } from './chatViewerRegistry'

describe('chatViewerRegistry', () => {
  it('키마다 소유자는 하나 — 클릭한 호스트가 덮어쓰고, 소유자만 내려놓을 수 있다', () => {
    const r = createChatViewerRegistry()
    const a = r.newHostId()
    const b = r.newHostId()
    r.claim('k', a)
    r.claim('k', b)
    expect(r.owner('k')).toBe(b)
    r.release('k', a)
    expect(r.owner('k')).toBe(b)
    r.release('k', b)
    expect(r.owner('k')).toBeNull()
    expect(r.owner('other')).toBeNull()
  })

  it('소유권이 바뀔 때만 구독자에게 알린다', () => {
    const r = createChatViewerRegistry()
    const l = vi.fn()
    const off = r.subscribe(l)
    r.claim('k', 1)
    r.claim('k', 1)
    r.release('k', 2)
    expect(l).toHaveBeenCalledTimes(1)
    off()
    r.release('k', 1)
    expect(l).toHaveBeenCalledTimes(1)
  })

  it('언마운트하면 보고·소유권이 함께 풀린다', () => {
    const r = createChatViewerRegistry()
    r.report('k', 1, { resolvable: true, ready: true })
    r.claim('k', 1)
    r.unregister('k', 1)
    expect(r.owner('k')).toBeNull()
    expect(r.nobodyCanShow('k')).toBe(false)
  })

  it('nobodyCanShow — 모든 호스트가 준비됐고 아무도 묶음을 못 만들 때만 참(호스트가 없으면 판단 안 함)', () => {
    const r = createChatViewerRegistry()
    expect(r.nobodyCanShow('k')).toBe(false)
    r.report('k', 1, { resolvable: false, ready: true })
    expect(r.nobodyCanShow('k')).toBe(true)
    r.report('k', 2, { resolvable: false, ready: false })
    expect(r.nobodyCanShow('k')).toBe(false)
    r.report('k', 2, { resolvable: true, ready: true })
    expect(r.nobodyCanShow('k')).toBe(false)
    r.report('k', 2, { resolvable: false, ready: true })
    expect(r.nobodyCanShow('k')).toBe(true)
  })
})
