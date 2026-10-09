import { describe, expect, it } from 'vitest'

import { createLabelClock, cursorSignature, hitCaret, LABEL_SHOW_MS } from './presenceLabels'

describe('createLabelClock', () => {
  it('shows a label for LABEL_SHOW_MS after a touch, then hides it', () => {
    const c = createLabelClock()
    expect(c.visible(1, 0)).toBe(false)
    c.touch(1, 1000)
    expect(c.visible(1, 1000 + LABEL_SHOW_MS - 1)).toBe(true)
    expect(c.visible(1, 1000 + LABEL_SHOW_MS)).toBe(false)
  })

  it('extends the window on another touch and reports the earliest upcoming hide', () => {
    const c = createLabelClock(3000)
    c.touch(1, 0)
    c.touch(2, 1000)
    expect(c.nextChange(500)).toBe(2500)
    c.touch(1, 2000)
    expect(c.nextChange(2100)).toBe(1900)
    expect(c.nextChange(10_000)).toBeNull()
  })

  it('forgets a client that left', () => {
    const c = createLabelClock()
    c.touch(1, 0)
    c.forget(1)
    expect(c.visible(1, 1)).toBe(false)
  })
})

describe('cursorSignature', () => {
  const rel = (n: number) => ({ type: null, tname: 'default', item: { client: 1, clock: n }, assoc: 0 })
  it('changes only when anchor or head changes', () => {
    expect(cursorSignature({ anchor: rel(1), head: rel(1) })).toBe(cursorSignature({ anchor: rel(1), head: rel(1) }))
    expect(cursorSignature({ anchor: rel(1), head: rel(1) })).not.toBe(cursorSignature({ anchor: rel(1), head: rel(2) }))
    expect(cursorSignature(null)).toBe('')
  })
})

describe('hitCaret', () => {
  const carets = [
    { id: 1, x: 100, top: 50, bottom: 70 },
    { id: 2, x: 110, top: 50, bottom: 70 },
    { id: 3, x: 300, top: 200, bottom: 220 },
  ]
  it('picks the nearest caret within the horizontal slop on the same line', () => {
    expect(hitCaret({ x: 103, y: 60 }, carets, 6)).toBe(1)
    expect(hitCaret({ x: 108, y: 60 }, carets, 6)).toBe(2)
    expect(hitCaret({ x: 290, y: 210 }, carets, 12)).toBe(3)
  })
  it('misses outside the slop or the line', () => {
    expect(hitCaret({ x: 120, y: 60 }, carets, 6)).toBeNull()
    expect(hitCaret({ x: 100, y: 90 }, carets, 6)).toBeNull()
  })
})
