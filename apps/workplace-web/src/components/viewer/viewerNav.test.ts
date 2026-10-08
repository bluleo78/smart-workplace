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

describe('routeKey — 영상·오디오(WP-281)', () => {
  const media: KeyContext = { ...base, zoomable: false, media: 'video', inMedia: false, onControl: false, fullscreen: false }
  it('←/→ 는 미디어 포커스·전체화면이면 탐색, 그 외 파일 넘김', () => {
    expect(routeKey({ ...media, key: 'ArrowLeft' })).toBe('prev')
    expect(routeKey({ ...media, key: 'ArrowRight' })).toBe('next')
    expect(routeKey({ ...media, key: 'ArrowLeft', inMedia: true })).toBe('seekBack')
    expect(routeKey({ ...media, key: 'ArrowRight', inMedia: true })).toBe('seekForward')
    expect(routeKey({ ...media, key: 'ArrowRight', fullscreen: true })).toBe('seekForward')
    expect(routeKey({ ...media, key: 'ArrowLeft', media: 'audio', inMedia: true })).toBe('seekBack')
  })
  it('미디어가 아닌 형식은 포커스와 무관하게 기존 넘김', () => {
    expect(routeKey({ ...base, key: 'ArrowRight', inMedia: true, fullscreen: true })).toBe('next')
  })
  it('Space 는 미디어면 재생/정지 — 버튼 위에선 버튼 몫, 미디어 요소 포커스면 네이티브 몫, 전체화면이면 재생/정지', () => {
    expect(routeKey({ ...media, key: ' ' })).toBe('playPause')
    // 네이티브 컨트롤이 Space 를 처리하므로 우리가 또 뒤집지 않는다(이중 전환 방지).
    expect(routeKey({ ...media, key: ' ', inMedia: true })).toBeNull()
    expect(routeKey({ ...media, key: ' ', inMedia: true, fullscreen: true })).toBeNull()
    expect(routeKey({ ...media, key: ' ', onControl: true })).toBeNull()
    expect(routeKey({ ...media, key: ' ', onControl: true, fullscreen: true })).toBe('playPause')
  })
  it('Space 를 누르고 있어 반복되는 keydown 은 무시', () => {
    expect(routeKey({ ...media, key: ' ', repeat: true })).toBeNull()
  })
  it('Space 는 문서면 null(브라우저 스크롤)', () => {
    expect(routeKey({ ...base, key: ' ' })).toBeNull()
  })
  it('Esc 는 전체화면 중·방금 해제면 전체화면만 해제, 그 외 null(다이얼로그 닫기)', () => {
    expect(routeKey({ ...media, key: 'Escape' })).toBeNull()
    expect(routeKey({ ...media, key: 'Escape', fullscreen: true })).toBe('exitFullscreen')
    expect(routeKey({ ...media, key: 'Escape', fullscreenJustExited: true })).toBe('exitFullscreen')
  })
  it('입력칸·AI 패널·Ctrl 조합은 미디어여도 뷰어 몫이 아니다', () => {
    expect(routeKey({ ...media, key: ' ', inEditable: true })).toBeNull()
    expect(routeKey({ ...media, key: 'ArrowLeft', inMedia: true, inAiPanel: true })).toBeNull()
    expect(routeKey({ ...media, key: 'ArrowLeft', inMedia: true, ctrlOrMeta: true })).toBeNull()
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
