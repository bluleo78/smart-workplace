import { describe, expect, it } from 'vitest'

import {
  fitMediaSize,
  FULLSCREEN_ESC_GUARD_MS,
  fullscreenJustExited,
  progressPercent,
  seekTarget,
  shouldAutoplay,
} from './mediaPlayback'

describe('shouldAutoplay', () => {
  it('직접 연 항목만, 떠나기 전까지만 자동재생', () => {
    expect(shouldAutoplay({ key: 'a', openedKey: 'a', leftOpened: false })).toBe(true)
    // 넘겨 온 항목
    expect(shouldAutoplay({ key: 'b', openedKey: 'a', leftOpened: true })).toBe(false)
    expect(shouldAutoplay({ key: 'b', openedKey: 'a', leftOpened: false })).toBe(false)
    // 떠났다 되돌아온 연 항목
    expect(shouldAutoplay({ key: 'a', openedKey: 'a', leftOpened: true })).toBe(false)
  })
})

describe('progressPercent', () => {
  it('응답 전체 크기를 분모로 내림 %', () => {
    expect(progressPercent(0, 1000, null)).toBe(0)
    expect(progressPercent(625, 1000, null)).toBe(62)
    expect(progressPercent(1000, 1000, 5)).toBe(100)
  })
  it('응답 크기를 모르면 항목 메타 크기, 둘 다 모르면 null', () => {
    expect(progressPercent(500, undefined, 1000)).toBe(50)
    expect(progressPercent(500, 0, 1000)).toBe(50)
    expect(progressPercent(500, null, null)).toBeNull()
    expect(progressPercent(500, 0, 0)).toBeNull()
  })
  it('메타 크기가 실제보다 작아도 100 을 넘지 않는다', () => {
    expect(progressPercent(2000, null, 1000)).toBe(100)
  })
})

describe('seekTarget', () => {
  it('0 ~ 길이로 자른다', () => {
    expect(seekTarget(3, -5, 10)).toBe(0)
    expect(seekTarget(8, 5, 10)).toBe(10)
    expect(seekTarget(4, 5, 10)).toBe(9)
  })
  it('길이를 모르면 아래쪽만 자른다', () => {
    expect(seekTarget(4, 5, NaN)).toBe(9)
    expect(seekTarget(4, 5, Infinity)).toBe(9)
    expect(seekTarget(1, -5, NaN)).toBe(0)
  })
})

describe('fullscreenJustExited', () => {
  it('해제 뒤 가드 시간 안만 참', () => {
    expect(fullscreenJustExited(null, 1000)).toBe(false)
    expect(fullscreenJustExited(1000, 1000 + FULLSCREEN_ESC_GUARD_MS)).toBe(true)
    expect(fullscreenJustExited(1000, 1001 + FULLSCREEN_ESC_GUARD_MS)).toBe(false)
  })
})

describe('fitMediaSize', () => {
  it('비율을 지켜 상자에 가득 — 작은 영상은 키운다', () => {
    expect(fitMediaSize(64, 48, 320, 600)).toEqual({ w: 320, h: 240 })
    expect(fitMediaSize(1920, 1080, 390, 600)).toEqual({ w: 390, h: 219 })
    // 세로가 빡빡하면 높이에 맞춘다.
    expect(fitMediaSize(1920, 1080, 1000, 300)).toEqual({ w: 533, h: 300 })
  })
  it('크기를 모르면 null', () => {
    expect(fitMediaSize(0, 48, 320, 600)).toBeNull()
    expect(fitMediaSize(64, 48, 0, 600)).toBeNull()
  })
})
