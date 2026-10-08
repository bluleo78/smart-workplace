import { describe, expect, it } from 'vitest'

import { type KeyContext, navState, resolvePending, routeKey, splitName } from './viewerNav'

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

describe('splitName', () => {
  it('확장자 + 앞 2글자를 꼬리로 남긴다', () => {
    expect(splitName('2026_하반기_도입제안서_최종_검토반영_v3.pdf')).toEqual(['2026_하반기_도입제안서_최종_검토반영_', 'v3.pdf'])
  })
  it('짧은 이름은 앞부분을 한 글자 이상 남기고 나머지를 꼬리로', () => {
    expect(splitName('a.pdf')).toEqual(['a', '.pdf'])
  })
  it('확장자가 없으면 끝 2글자가 꼬리', () => {
    expect(splitName('README')).toEqual(['READ', 'ME'])
  })
  it('한 글자 이름은 꼬리 없음', () => {
    expect(splitName('a')).toEqual(['a', ''])
  })
})

describe('resolvePending', () => {
  const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
  it('목표가 없거나 이미 현재 항목이면 버린다', () => {
    expect(resolvePending(items, 'a', null)).toEqual({ kind: 'clear' })
    expect(resolvePending(items, 'b', 'b')).toEqual({ kind: 'clear' })
  })
  it('아직 도달 전이면 현재 목록 위치로 이어서 요청한다', () => {
    expect(resolvePending(items, 'a', 'c')).toEqual({ kind: 'request', index: 2 })
  })
  it('목록이 바뀌어 목표가 사라지면 버린다(엉뚱한 파일로 튀지 않는다)', () => {
    expect(resolvePending([{ key: 'a' }, { key: 'b' }], 'a', 'c')).toEqual({ kind: 'clear' })
  })
  it('목록이 줄어도 목표 key 의 새 위치를 가리킨다', () => {
    expect(resolvePending([{ key: 'b' }, { key: 'c' }], 'b', 'c')).toEqual({ kind: 'request', index: 1 })
  })
})
