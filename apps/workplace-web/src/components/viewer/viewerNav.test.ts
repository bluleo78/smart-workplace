import { describe, expect, it } from 'vitest'

import { type KeyContext, middleEllipsis, navState, routeKey } from './viewerNav'

const base: KeyContext = { key: 'ArrowRight', ctrlOrMeta: false, inAiPanel: false, inEditable: false, inHorizontalScroller: false, zoomable: true }

describe('navState', () => {
  it('처음·끝에선 해당 방향이 없다(순환 없음)', () => {
    expect(navState(0, 3)).toEqual({ hasPrev: false, hasNext: true, label: '1 / 3' })
    expect(navState(2, 3)).toEqual({ hasPrev: true, hasNext: false, label: '3 / 3' })
  })
  it('1건이면 양쪽 없음·라벨 비움', () => {
    expect(navState(0, 1)).toEqual({ hasPrev: false, hasNext: false, label: '' })
  })
})

describe('routeKey', () => {
  it('← → 는 넘김', () => {
    expect(routeKey({ ...base, key: 'ArrowLeft' })).toBe('prev')
    expect(routeKey(base)).toBe('next')
  })
  it('AI 패널·입력칸·가로 스크롤 영역 안이면 넘기지 않는다', () => {
    expect(routeKey({ ...base, inAiPanel: true })).toBeNull()
    expect(routeKey({ ...base, inEditable: true })).toBeNull()
    expect(routeKey({ ...base, inHorizontalScroller: true })).toBeNull()
  })
  it('+ - 0 은 확대 가능한 형식에서만', () => {
    expect(routeKey({ ...base, key: '+' })).toBe('zoomIn')
    expect(routeKey({ ...base, key: '=' })).toBe('zoomIn')
    expect(routeKey({ ...base, key: '-' })).toBe('zoomOut')
    expect(routeKey({ ...base, key: '0' })).toBe('zoomReset')
    expect(routeKey({ ...base, key: '+', zoomable: false })).toBeNull()
  })
  it('Ctrl/⌘ 조합은 브라우저 몫', () => {
    expect(routeKey({ ...base, key: '+', ctrlOrMeta: true })).toBeNull()
    expect(routeKey({ ...base, ctrlOrMeta: true })).toBeNull()
  })
})

describe('middleEllipsis', () => {
  it('짧으면 그대로', () => expect(middleEllipsis('a.pdf', 20)).toBe('a.pdf'))
  it('길면 가운데를 줄이고 확장자를 남긴다', () => {
    const out = middleEllipsis('2026_하반기_도입제안서_최종_검토반영_v3.pdf', 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.endsWith('v3.pdf')).toBe(true)
    expect(out).toContain('…')
  })
  it('확장자가 없어도 줄인다', () => {
    expect(middleEllipsis('a'.repeat(40), 10)).toHaveLength(10)
  })
})
