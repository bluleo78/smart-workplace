import { describe, expect, it } from 'vitest'

import {
  anchoredScroll,
  decideDismiss,
  decideSwipe,
  doubleTapTarget,
  dragOffset,
  focusFraction,
  isDoubleTap,
  isTapDuration,
  lockGesture,
  type LockInput,
  pickAnchorIndex,
  pinchZoom,
  releaseVelocity,
  rubberBand,
  stageTouchAction,
} from './viewerGestures'

const lock: LockInput = { dx: 0, dy: 0, startX: 200, viewportWidth: 390, canPanLeft: false, canPanRight: false, atTop: true, zoom: 1, pageZoomed: false }

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
  it('브라우저 자체 확대 중이면 끌기는 확대 페이지 팬(네이티브) — 넘김·닫기 없음, 움직이지 않은 탭은 그대로 판정 대기', () => {
    expect(lockGesture({ ...lock, pageZoomed: true, dx: -100 })).toBe('native')
    expect(lockGesture({ ...lock, pageZoomed: true, dy: 40 })).toBe('native')
    expect(lockGesture({ ...lock, pageZoomed: true, dx: 3, dy: 2 })).toBe('pending')
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
  it('1 미만(iPad 툴바 축소)에서 시작하면 하한은 시작 배율 — 모아도 확대로 튀지 않는다', () => {
    expect(pinchZoom(0.5, 100, 50)).toBe(0.5)
    expect(pinchZoom(0.5, 100, 150)).toBe(0.75)
    expect(pinchZoom(0.5, 100, 400)).toBe(2)
    expect(pinchZoom(0.75, 100, 10)).toBe(0.75)
  })
  it('두 번 탭은 맞춤 ↔ 2배', () => {
    expect(doubleTapTarget(1)).toBe(2)
    expect(doubleTapTarget(2)).toBe(1)
    expect(doubleTapTarget(2.6)).toBe(1)
  })
})

describe('pickAnchorIndex', () => {
  // PDF 3쪽 — 폭 300·높이 400, 페이지 사이 간격 16(배율과 무관한 고정 간격).
  const pages = [0, 1, 2].map((k) => ({ left: 45, top: 16 + k * 416, width: 300, height: 400 }))
  it('점을 품은 요소를 고른다', () => {
    expect(pickAnchorIndex(pages, 100, 500)).toBe(1)
  })
  it('페이지 사이 간격의 점은 가장 가까운 페이지', () => {
    expect(pickAnchorIndex(pages, 100, 420)).toBe(0)
    expect(pickAnchorIndex(pages, 100, 430)).toBe(1)
  })
  it('후보가 없으면 -1', () => {
    expect(pickAnchorIndex([], 0, 0)).toBe(-1)
  })
})

describe('focusFraction', () => {
  const box = { left: 100, top: 200, width: 200, height: 400 }
  it('요소 안 비율', () => {
    expect(focusFraction(box, 150, 300)).toEqual({ fx: 0.25, fy: 0.25 })
  })
  it('요소 밖(좌우 여백·페이지 간격)은 가까운 끝으로 자른다', () => {
    expect(focusFraction(box, 20, 700)).toEqual({ fx: 0, fy: 1 })
  })
  it('크기 0 축은 가운데', () => {
    expect(focusFraction({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({ fx: 0.5, fy: 0.5 })
  })
})

describe('anchoredScroll', () => {
  it('확대 뒤 기준 요소의 같은 비율 지점이 기준 화면 좌표에 오게 스크롤한다', () => {
    // 3쪽(맞춤 top=848)의 가운데를 화면 y=400 에서 두 번 탭 → 2배. 확대 뒤(스크롤 그대로) 3쪽은 top=1680·높이 800.
    const focus = { x: 195, y: 400, ...focusFraction({ left: 45, top: 848 - 600, width: 300, height: 400 }, 195, 400) }
    // 맞춤 때 스크롤 600 에서 3쪽 화면 top 은 248 → fy = 0.38. 2배 뒤 같은 스크롤에서 3쪽 화면 top = 16+2*(800+16)-600 = 1048.
    const s = anchoredScroll({ scrollLeft: 0, scrollTop: 600, box: { left: -105, top: 1048, width: 600, height: 800 }, focus })
    // 그 지점(1048 + 0.38*800 = 1352)이 화면 y=400 으로 와야 하므로 스크롤 += 952. 가로도 같은 비율(0.5 → 195).
    expect(s).toEqual({ left: 0, top: 1552 })
    // 단순 비례 모델((600+400)*2-400 = 1600)은 고정 간격·여백만큼(48px) 어긋났다.
    expect(s.top).not.toBe(1600)
  })
  it('가로도 기준 비율 지점을 맞춘다 — 음수 스크롤은 0', () => {
    const focus = { x: 300, y: 100, fx: 0.8, fy: 0.5 }
    expect(anchoredScroll({ scrollLeft: 0, scrollTop: 0, box: { left: 16, top: 0, width: 716, height: 200 }, focus })).toEqual({ left: 289, top: 0 })
    expect(anchoredScroll({ scrollLeft: 0, scrollTop: 0, box: { left: 16, top: 0, width: 100, height: 200 }, focus: { ...focus, fx: 0 } })).toEqual({ left: 0, top: 0 })
  })
  it('축소로 브라우저가 스크롤을 이미 잘라 냈어도 현재 스크롤 기준으로 맞춘다', () => {
    // 스크롤이 300 으로 잘린 상태에서 기준 요소가 화면 top=-100 에 있으면 fy=0.5 지점(-100+200=100)을 y=400 으로 → 300-300 = 0.
    expect(anchoredScroll({ scrollLeft: 0, scrollTop: 300, box: { left: 0, top: -100, width: 390, height: 400 }, focus: { x: 0, y: 400, fx: 0, fy: 0.5 } })).toEqual({ left: 0, top: 0 })
  })
})

describe('stageTouchAction', () => {
  const base = { coarse: true, zoomable: true, image: true, zoom: 1 }
  it('fine 포인터(데스크톱 마우스)면 표식 없음', () => {
    expect(stageTouchAction({ ...base, coarse: false })).toBeUndefined()
    expect(stageTouchAction({ ...base, coarse: false, zoomable: false })).toBeUndefined()
  })
  it('확대 대상이 아닌 형식은 manipulation — 브라우저 핀치 확대를 살린다(WCAG 1.4.4)', () => {
    expect(stageTouchAction({ ...base, zoomable: false, image: false })).toBe('manipulation')
    // 사용 불가 이미지(원본 삭제 안내)도 뷰어 배율이 없으니 같은 규칙.
    expect(stageTouchAction({ ...base, zoomable: false })).toBe('manipulation')
  })
  it('맞춤 이미지는 none, 확대한 이미지·PDF 는 pan', () => {
    expect(stageTouchAction(base)).toBe('none')
    expect(stageTouchAction({ ...base, zoom: 2 })).toBe('pan')
    expect(stageTouchAction({ ...base, image: false })).toBe('pan')
  })
})
