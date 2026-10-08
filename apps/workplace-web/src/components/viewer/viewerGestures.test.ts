import { describe, expect, it } from 'vitest'

import {
  anchorScroll,
  decideDismiss,
  decideSwipe,
  doubleTapTarget,
  dragOffset,
  isDoubleTap,
  isTapDuration,
  lockGesture,
  type LockInput,
  pinchZoom,
  releaseVelocity,
  rubberBand,
} from './viewerGestures'

const lock: LockInput = { dx: 0, dy: 0, startX: 200, viewportWidth: 390, canPanLeft: false, canPanRight: false, atTop: true, zoom: 1 }

describe('lockGesture', () => {
  it('흔들림(6px 미만)은 아직 판정하지 않는다', () => {
    expect(lockGesture({ ...lock, dx: -5, dy: 2 })).toBe('pending')
  })
  it('가로가 우세하고 내용이 그 방향으로 더 갈 수 없으면 넘김', () => {
    expect(lockGesture({ ...lock, dx: -20, dy: 3 })).toBe('swipe')
    expect(lockGesture({ ...lock, dx: 20, dy: 3 })).toBe('swipe')
  })
  it('내용 우선 — 손가락이 왼쪽으로 가는데 오른쪽 여유가 있으면 네이티브(내용 이동)', () => {
    expect(lockGesture({ ...lock, dx: -20, canPanRight: true })).toBe('native')
    // 반대 방향 여유만 있으면 넘김(가장자리에 닿은 상태)
    expect(lockGesture({ ...lock, dx: -20, canPanLeft: true })).toBe('swipe')
    expect(lockGesture({ ...lock, dx: 20, canPanLeft: true })).toBe('native')
  })
  it('화면 가장자리 20px 안에서 시작하면 무시(iOS 뒤로가기 보호)', () => {
    expect(lockGesture({ ...lock, startX: 10, dx: 100 })).toBe('native')
    expect(lockGesture({ ...lock, startX: 375, dx: -100 })).toBe('native')
    expect(lockGesture({ ...lock, startX: 20, dx: 100 })).toBe('swipe')
  })
  it('원래 크기에서 맨 위일 때 아래로 당기면 닫기', () => {
    expect(lockGesture({ ...lock, dy: 20 })).toBe('dismiss')
  })
  it('맨 위가 아니거나 확대 중이거나 위로 밀면 네이티브(스크롤·팬)', () => {
    expect(lockGesture({ ...lock, dy: 20, atTop: false })).toBe('native')
    expect(lockGesture({ ...lock, dy: 20, zoom: 2 })).toBe('native')
    expect(lockGesture({ ...lock, dy: -20 })).toBe('native')
  })
})

describe('decideSwipe', () => {
  const base = { dx: 0, vx: 0, width: 400, hasPrev: true, hasNext: true }
  it('폭 25% 초과 이동이면 넘김(왼쪽 = 다음)', () => {
    expect(decideSwipe({ ...base, dx: -101 })).toBe('next')
    expect(decideSwipe({ ...base, dx: 101 })).toBe('prev')
  })
  it('25% 이하·느리면 제자리', () => {
    expect(decideSwipe({ ...base, dx: -100, vx: -0.2 })).toBe('stay')
  })
  it('플링(같은 방향 0.5px/ms 초과 + 30px 초과)이면 짧아도 넘김', () => {
    expect(decideSwipe({ ...base, dx: -40, vx: -0.8 })).toBe('next')
    expect(decideSwipe({ ...base, dx: -20, vx: -0.8 })).toBe('stay')
    // 반대 방향 속도(되돌리는 중)는 플링 아님
    expect(decideSwipe({ ...base, dx: -40, vx: 0.8 })).toBe('stay')
  })
  it('끝에서는 그 방향으로 넘기지 않는다(순환 없음)', () => {
    expect(decideSwipe({ ...base, dx: -300, hasNext: false })).toBe('stay')
    expect(decideSwipe({ ...base, dx: 300, hasPrev: false })).toBe('stay')
  })
})

describe('decideDismiss', () => {
  it('높이 20% 초과 또는 아래 방향 플링이면 닫기', () => {
    expect(decideDismiss({ dy: 170, vy: 0, height: 800 })).toBe(true)
    expect(decideDismiss({ dy: 60, vy: 0.9, height: 800 })).toBe(true)
    expect(decideDismiss({ dy: 100, vy: 0.1, height: 800 })).toBe(false)
    expect(decideDismiss({ dy: 60, vy: -0.9, height: 800 })).toBe(false)
  })
})

describe('rubberBand / dragOffset', () => {
  it('러버밴드는 방향을 지키며 실제 이동보다 작고 한계를 넘지 않는다', () => {
    expect(rubberBand(0, 120)).toBe(0)
    const r = rubberBand(-100, 120)
    expect(r).toBeLessThan(0)
    expect(Math.abs(r)).toBeLessThan(100)
    expect(Math.abs(rubberBand(10_000, 120))).toBeLessThan(120)
  })
  it('갈 곳이 있으면 손가락을 그대로 따르고, 끝이면 러버밴드', () => {
    expect(dragOffset(-80, 400, true, true)).toBe(-80)
    expect(Math.abs(dragOffset(-80, 400, true, false))).toBeLessThan(80)
    expect(Math.abs(dragOffset(80, 400, false, true))).toBeLessThan(80)
  })
})

describe('releaseVelocity', () => {
  it('마지막 100ms 창의 평균 속도(px/ms)', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 50, x: -50, y: 0 }, { t: 100, x: -100, y: 10 }])).toEqual({ vx: -1, vy: 0.1 })
  })
  it('창 밖의 오래된 표본은 무시한다(멈췄다 튕긴 경우)', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }, { t: 500, x: -10, y: 0 }, { t: 550, x: -60, y: 0 }]).vx).toBe(-1)
  })
  it('표본이 하나뿐이면 0', () => {
    expect(releaseVelocity([{ t: 0, x: 0, y: 0 }])).toEqual({ vx: 0, vy: 0 })
  })
})

describe('isDoubleTap', () => {
  it('300ms·30px 안의 두 번째 탭', () => {
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 250, x: 110, y: 105 })).toBe(true)
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 350, x: 100, y: 100 })).toBe(false)
    expect(isDoubleTap({ t: 0, x: 100, y: 100 }, { t: 100, x: 200, y: 100 })).toBe(false)
    expect(isDoubleTap(null, { t: 0, x: 0, y: 0 })).toBe(false)
  })
})

describe('isTapDuration', () => {
  it('500ms 미만으로 눌렀다 뗀 것만 탭 — 그 이상은 길게 누르기', () => {
    expect(isTapDuration(1000, 1040)).toBe(true)
    expect(isTapDuration(1000, 1499)).toBe(true)
    expect(isTapDuration(1000, 1500)).toBe(false)
    expect(isTapDuration(1000, 1600)).toBe(false)
  })
})

describe('pinchZoom / doubleTapTarget', () => {
  it('두 손가락 거리 비율로 배율을 바꾸고 1~3 으로 자른다', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2)
    expect(pinchZoom(2, 100, 50)).toBe(1)
    expect(pinchZoom(1, 100, 50)).toBe(1)
    expect(pinchZoom(2, 100, 400)).toBe(3)
    expect(pinchZoom(1.5, 0, 100)).toBe(1.5)
  })
  it('두 번 탭은 맞춤 ↔ 2배', () => {
    expect(doubleTapTarget(1)).toBe(2)
    expect(doubleTapTarget(2)).toBe(1)
    expect(doubleTapTarget(2.6)).toBe(1)
  })
})

describe('anchorScroll', () => {
  it('확대 시 기준점이 화면의 같은 자리에 남는다', () => {
    expect(anchorScroll({ scrollLeft: 0, scrollTop: 0, focusX: 100, focusY: 50, from: 1, to: 2 })).toEqual({ left: 100, top: 50 })
  })
  it('축소는 반대로, 음수 스크롤은 0', () => {
    expect(anchorScroll({ scrollLeft: 100, scrollTop: 50, focusX: 100, focusY: 50, from: 2, to: 1 })).toEqual({ left: 0, top: 0 })
    expect(anchorScroll({ scrollLeft: 0, scrollTop: 0, focusX: 100, focusY: 50, from: 2, to: 1 })).toEqual({ left: 0, top: 0 })
  })
  it('잘못된 기준 배율(0 이하)이면 그대로', () => {
    expect(anchorScroll({ scrollLeft: 7, scrollTop: 9, focusX: 1, focusY: 1, from: 0, to: 2 })).toEqual({ left: 7, top: 9 })
  })
})
