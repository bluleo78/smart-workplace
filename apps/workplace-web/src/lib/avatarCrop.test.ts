// 아바타 자르기 기하(WP-1222) — 화면의 끌기·확대가 원본 픽셀의 정사각(cropX·cropY·cropSize)으로 바르게 바뀌고,
// 원이 이미지 밖으로 나가거나 자른 변이 서버 최소(128px) 밑으로 가지 않는지 지킨다.
import { describe, expect, it } from 'vitest'

import {
  centeredOffset,
  clampOffset,
  clampZoom,
  coverScale,
  cropFromView,
  maxZoom,
  zoomAroundCenter,
} from './avatarCrop'

const D = 200
const landscape = { width: 800, height: 400 }

describe('coverScale · maxZoom', () => {
  it('짧은 변이 원 지름을 채우는 배율', () => {
    expect(coverScale(landscape, D)).toBe(0.5)
    expect(coverScale({ width: 300, height: 600 }, D)).toBeCloseTo(2 / 3)
  })
  it('확대 상한 — 자른 변이 128px 까지, 최대 4배, 128px 이미지는 1배', () => {
    expect(maxZoom(landscape)).toBe(400 / 128)
    expect(maxZoom({ width: 4000, height: 3000 })).toBe(4)
    expect(maxZoom({ width: 128, height: 500 })).toBe(1)
  })
  it('clampZoom 은 [1, 상한] 으로 묶는다', () => {
    expect(clampZoom(0.2, landscape)).toBe(1)
    expect(clampZoom(10, landscape)).toBe(400 / 128)
    expect(clampZoom(2, landscape)).toBe(2)
  })
})

describe('clampOffset — 원이 늘 이미지 안', () => {
  const s = coverScale(landscape, D) // 400×200 으로 보인다
  it('오른쪽·아래로 너무 밀면 0 에 멈춘다', () => {
    expect(clampOffset({ x: 50, y: 30 }, landscape, s, D)).toEqual({ x: 0, y: 0 })
  })
  it('왼쪽으로 너무 밀면 이미지 오른쪽 끝이 원 오른쪽에 멈춘다', () => {
    expect(clampOffset({ x: -500, y: -10 }, landscape, s, D)).toEqual({ x: -200, y: 0 })
  })
  it('범위 안이면 그대로', () => {
    expect(clampOffset({ x: -120, y: 0 }, landscape, s, D)).toEqual({ x: -120, y: 0 })
  })
})

describe('cropFromView — 원본 픽셀 정사각', () => {
  it('처음(가운데·1배)은 짧은 변 전체의 가운데 정사각', () => {
    const s = coverScale(landscape, D)
    expect(cropFromView(centeredOffset(landscape, s, D), s, landscape, D)).toEqual({ cropX: 200, cropY: 0, cropSize: 400 })
  })
  it('왼쪽 끝까지 밀면 cropX 0, 오른쪽 끝까지 밀면 cropX = 가로 - 변', () => {
    const s = coverScale(landscape, D)
    expect(cropFromView({ x: 0, y: 0 }, s, landscape, D).cropX).toBe(0)
    expect(cropFromView({ x: -200, y: 0 }, s, landscape, D)).toEqual({ cropX: 400, cropY: 0, cropSize: 400 })
  })
  it('2배 확대는 변이 절반, 가운데를 유지한다', () => {
    const s1 = coverScale(landscape, D)
    const o1 = centeredOffset(landscape, s1, D)
    const o2 = zoomAroundCenter(o1, s1, s1 * 2, landscape, D)
    expect(cropFromView(o2, s1 * 2, landscape, D)).toEqual({ cropX: 300, cropY: 100, cropSize: 200 })
  })
  it('최대 확대에서도 변은 128px(부동소수 오차로 127 이 되지 않는다)', () => {
    const img = { width: 1000, height: 333 }
    const s = coverScale(img, D) * maxZoom(img)
    expect(cropFromView(centeredOffset(img, s, D), s, img, D).cropSize).toBe(128)
  })
  it('반올림해도 영역이 이미지 밖으로 나가지 않는다', () => {
    const img = { width: 333, height: 777 }
    const s = coverScale(img, D) * 1.37
    const crop = cropFromView(clampOffset({ x: -9999, y: -9999 }, img, s, D), s, img, D)
    expect(crop.cropX + crop.cropSize).toBeLessThanOrEqual(img.width)
    expect(crop.cropY + crop.cropSize).toBeLessThanOrEqual(img.height)
    expect(crop.cropX).toBeGreaterThanOrEqual(0)
  })
})

describe('zoomAroundCenter', () => {
  it('축소로 가장자리가 원 안에 들어오면 다시 묶는다', () => {
    const s1 = coverScale(landscape, D)
    // 2배에서 왼쪽 끝으로 붙인 뒤 1배로 줄이면 x 는 0 이어야 한다(원 왼쪽에 빈 곳 없음).
    const o = zoomAroundCenter({ x: 0, y: -100 }, s1 * 2, s1, landscape, D)
    expect(o.x).toBeLessThanOrEqual(0)
    expect(o.y).toBe(0)
    expect(o.x).toBeGreaterThanOrEqual(D - landscape.width * s1)
  })
})
