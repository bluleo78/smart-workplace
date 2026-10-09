// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Box, cancelFitTags, fitTags, placeTags, scheduleFitTags, SELECTOR, type TagMeasure } from './wikiTagLayout'

// 태그 배치(WP-291 디자이너 리뷰 I-1·I-2) — 측정값만 넣는 순수 함수. 태그 높이 18, 캐럿 줄 100~116, 태그는 캐럿 위 2px.
describe('placeTags', () => {
  const WIDE: Box = { left: 0, right: 1000, top: -Infinity, bottom: Infinity }
  /** x 에 캐럿이 있는 표식 — 태그 폭 w, 기본 배치(오른쪽·위). */
  const at = (x: number, w = 60, clip: Box = WIDE, lineTop = 100): TagMeasure => ({
    tag: { left: x - 1, right: x - 1 + w, top: lineTop - 20, bottom: lineTop - 2 },
    marker: { top: lineTop, bottom: lineTop + 16 },
    clip,
  })
  const none = { flip: false, side: 'above', stack: 0 }

  it('stacks two tags at the same spot so both stay visible', () => {
    expect(placeTags([at(200), at(200)])).toEqual([none, { ...none, stack: 1 }])
  })

  it('stacks tags a few characters apart whose rects overlap', () => {
    expect(placeTags([at(200), at(246)])).toEqual([none, { ...none, stack: 1 }])
  })

  it('leaves far-apart tags and tags on different lines alone', () => {
    expect(placeTags([at(200), at(400), at(200, 60, WIDE, 160)])).toEqual([none, none, none])
  })

  it('climbs past every overlapping tag, not just the first', () => {
    expect(placeTags([at(200), at(200), at(220)]).map((p) => p.stack)).toEqual([0, 1, 2])
  })

  it('flips left at the right edge (editor or overflow ancestor, whichever is tighter)', () => {
    const clip = { ...WIDE, right: 230 }
    expect(placeTags([at(200, 60, clip)])).toEqual([{ ...none, flip: true }])
  })

  it('does not flip when flipping would overflow the left edge instead', () => {
    const clip = { ...WIDE, left: 180, right: 230 }
    expect(placeTags([at(200, 60, clip)])).toEqual([none])
  })

  it('opens below the caret when an overflow ancestor (table wrapper) cuts the top', () => {
    const table = { ...WIDE, top: 90 }
    expect(placeTags([at(200, 60, table)])).toEqual([{ ...none, side: 'below' }])
  })

  it('stacks below-tags downward', () => {
    const table = { ...WIDE, top: 90 }
    expect(placeTags([at(200, 60, table), at(200, 60, table)])).toEqual([
      { ...none, side: 'below' },
      { ...none, side: 'below', stack: 1 },
    ])
  })

  it('falls back to below when stacking upward would be cut by the overflow ancestor', () => {
    // 첫 태그는 위에 들어가지만(80 ≥ 70), 두 번째를 위로 쌓으면 59 < 70 이라 잘린다 → 아래로.
    const table = { ...WIDE, top: 70 }
    expect(placeTags([at(200, 60, table), at(200, 60, table)])).toEqual([none, { ...none, side: 'below' }])
  })

  it('puts the tag beside the caret when both above and below are cut (header-only table)', () => {
    // 감싸개 90~126: 위 태그(80)도, 아래 태그(118~136)도 잘린다 → 캐럿 옆(줄 안).
    const oneRow = { ...WIDE, top: 90, bottom: 126 }
    expect(placeTags([at(200, 60, oneRow)])).toEqual([{ ...none, side: 'inline' }])
  })

  it('keeps the below tag when it fits inside the wrapper bottom', () => {
    const table = { ...WIDE, top: 90, bottom: 136 }
    expect(placeTags([at(200, 60, table)])).toEqual([{ ...none, side: 'below' }])
  })
})

describe('fitTags', () => {
  /** jsdom 은 레이아웃이 없어 사각형을 직접 심는다. */
  function host(cls: 'wiki-ai-marker' | 'wiki-presence-cursor', key: string, box: Box, visible = true): HTMLElement {
    const el = document.createElement('span')
    el.className = cls
    el.dataset.tagKey = key
    if (cls === 'wiki-presence-cursor' && visible) el.dataset.labelVisible = ''
    const tag = document.createElement('span')
    tag.className = `${cls}__tag`
    el.append(tag)
    el.getBoundingClientRect = () => ({ ...box, top: box.bottom, bottom: box.bottom + 16 }) as DOMRect
    tag.getBoundingClientRect = () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top }) as DOMRect
    return el
  }

  it('stacks an AI tag and a visible cursor tag that overlap, in stable key order', () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600 }) as DOMRect
    const ai = host('wiki-ai-marker', 'm-b', { left: 100, right: 180, top: 80, bottom: 96 })
    const cur = host('wiki-presence-cursor', 'presence-a', { left: 104, right: 170, top: 80, bottom: 96 })
    root.append(ai, cur)
    fitTags(root)
    // 'm-b' < 'presence-a' 이라 ✦ 가 먼저 놓이고 커서가 한 칸 비켜 쌓인다
    expect(ai.style.getPropertyValue('--wiki-tag-stack')).toBe('')
    expect(cur.style.getPropertyValue('--wiki-tag-stack')).toBe('1')
  })

  it('ignores hidden cursor labels', () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({ left: 0, right: 800, top: 0, bottom: 600 }) as DOMRect
    const ai = host('wiki-ai-marker', 'm-b', { left: 100, right: 180, top: 80, bottom: 96 })
    const hidden = host('wiki-presence-cursor', 'a-first', { left: 104, right: 170, top: 80, bottom: 96 }, false)
    root.append(ai, hidden)
    fitTags(root)
    expect(ai.style.getPropertyValue('--wiki-tag-stack')).toBe('')
  })

  it('flips a cursor tag that overflows the editor right edge with the presence modifier class', () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 600 }) as DOMRect
    const cur = host('wiki-presence-cursor', 'presence-1', { left: 160, right: 260, top: 80, bottom: 96 })
    root.append(cur)
    fitTags(root)
    expect(cur.classList.contains('wiki-presence-cursor--flip')).toBe(true)
  })

  it('clears stale placement from a cursor whose label was hidden (and refits the rest)', () => {
    const root = document.createElement('div')
    root.getBoundingClientRect = () => ({ left: 0, right: 200, top: 0, bottom: 600 }) as DOMRect
    const ai = host('wiki-ai-marker', 'ai-1', { left: 160, right: 190, top: 80, bottom: 96 })
    const cur = host('wiki-presence-cursor', 'presence-1', { left: 160, right: 260, top: 80, bottom: 96 })
    root.append(ai, cur)
    fitTags(root)
    expect(cur.classList.contains('wiki-presence-cursor--flip')).toBe(true)
    expect(cur.style.getPropertyValue('--wiki-tag-stack')).toBe('1')
    // 이름표가 꺼지면 배치 대상이 아니다 — 남은 수정 클래스·쌓기 칸을 지워 다음에 켤 때 옛 자리로 번쩍이지 않게.
    delete cur.dataset.labelVisible
    fitTags(root)
    expect(cur.classList.contains('wiki-presence-cursor--flip')).toBe(false)
    expect(cur.style.getPropertyValue('--wiki-tag-stack')).toBe('')
  })
})

describe('scheduleFitTags', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces several requests in one frame into a single layout pass', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const query = vi.spyOn(root, 'querySelectorAll')
    const passes = () => query.mock.calls.filter(([sel]) => sel === SELECTOR).length
    scheduleFitTags(root)
    scheduleFitTags(root)
    scheduleFitTags(root)
    expect(passes()).toBe(0)
    vi.advanceTimersToNextFrame()
    expect(passes()).toBe(1)
    // 다음 프레임 요청은 다시 한 번.
    scheduleFitTags(root)
    vi.advanceTimersToNextFrame()
    expect(passes()).toBe(2)
  })

  it('cancels a pending pass (plugin destroy) and can schedule again afterwards', () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    const query = vi.spyOn(root, 'querySelectorAll')
    const passes = () => query.mock.calls.filter(([sel]) => sel === SELECTOR).length
    scheduleFitTags(root)
    cancelFitTags(root)
    vi.advanceTimersToNextFrame()
    expect(passes()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    scheduleFitTags(root)
    vi.advanceTimersToNextFrame()
    expect(passes()).toBe(1)
  })
})
