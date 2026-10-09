// 통합 뷰어 터치 제스처 판정 순수 로직(WP-278). 훅(useViewerGestures)은 DOM 에서 값만 재서 넘기고 결과대로만 움직인다.
// 왜 순수 함수인가: 25%·플링·내용 우선·가장자리 같은 규칙은 브라우저 없이 경계값까지 검증해야 회귀를 잡는다(스펙 §8.1).
import { LONG_PRESS_MS } from '../../hooks/useLongPress'

/** 화면 좌우 가장자리 이 폭 안에서 시작한 제스처는 무시 — iOS 가장자리 뒤로가기와 겹치지 않게(스펙 §5.1). */
export const EDGE_GUARD_PX = 20
/** 넘김 확정 이동 비율 — 무대 폭의 25% 초과(스펙 §5.1). */
export const SWIPE_COMMIT_RATIO = 0.25
/** 플링 판정 속도(px/ms ≈ 500px/s) — 짧게 튕겨도 넘어가게 하는 사진 앱 체감값. */
export const FLING_VELOCITY = 0.5
/** 플링이어도 이 거리(px)는 넘어야 확정 — 탭 흔들림을 플링으로 오인하지 않게. */
export const FLING_MIN_DISTANCE = 30
/**
 * 방향 잠금 전 허용 흔들림(px). 브라우저가 스크롤을 시작하는 임계(약 10px)보다 작아야
 * 잠금 직후 preventDefault 가 아직 취소 가능한 touchmove 에 걸린다.
 */
export const LOCK_SLOP_PX = 6
/** 아래로 쓸어 닫기 확정 비율 — 무대 높이의 20%(사진 앱 체감값, 스펙은 수치 미정). */
export const DISMISS_RATIO = 0.2
/** 두 번 탭 판정 간격(ms)·거리(px) — 단일 탭도 이만큼 기다렸다 처리한다(판정 R6). */
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_DIST_PX = 30
/**
 * 탭으로 치는 최대 누름 시간(ms) — 이보다 오래 누른 채 뗀 것(길게 누르기·천천히 뗀 터치)은 탭이 아니다.
 * 앱 공용 길게 누르기 기준(LONG_PRESS_MS, 500ms)을 그대로 쓴다 — 브라우저 길게 누르기(문맥 메뉴) 판정 시작점과도 같은 값이라,
 * 그 이상은 사용자가 탭이 아닌 다른 의도를 가진 것으로 본다. 한쪽만 바뀌어 "길게 누르기이면서 탭"인 구간이 생기지 않게 한 값을 공유한다.
 */
export const TAP_MAX_MS = LONG_PRESS_MS
/**
 * 터치 확대 범위 — 맞춤(1) 아래로는 줄이지 않는다. PDF 1~3×(스펙 §5.1), 이미지도 같은 상한(판정 R9).
 * 단 iPad 처럼 툴바·키보드로 이미 1 미만(0.5·0.75)에 있으면 하한은 그 시작 배율 — 모으는 핀치가 오히려 1 로 튀어 확대되지 않게(pinchZoom).
 */
export const TOUCH_ZOOM_MIN = 1
export const TOUCH_ZOOM_MAX = 3
/** 두 번 탭 확대 배율(스펙 §5.1: 1× ↔ 2×). */
export const DOUBLE_TAP_ZOOM = 2
/** 손 뗄 때 속도를 재는 최근 구간(ms) — 멈췄다 놓은 경우 오래된 이동이 속도에 섞이지 않게. */
export const VELOCITY_WINDOW_MS = 100

/** 첫 이동에서 정한 제스처 소유권 — pending(아직 모름)·swipe(파일 넘김)·dismiss(아래로 닫기)·native(브라우저 스크롤에 맡김). */
export type GestureLock = 'pending' | 'swipe' | 'dismiss' | 'native'

/** 터치 표본 — 시각(ms)과 화면 좌표. */
export interface Sample {
  t: number
  x: number
  y: number
}

/** 방향 잠금 입력 — 훅이 시작 시점의 스크롤 여유와 누적 이동을 재서 넘긴다. */
export interface LockInput {
  /** 시작점 대비 누적 이동(px). */
  dx: number
  dy: number
  /** 시작점 화면 x(clientX) — 가장자리 판정용. */
  startX: number
  viewportWidth: number
  /** 손가락 아래 가로 스크롤 영역이 왼쪽/오른쪽으로 더 갈 수 있는가(시작 시점). */
  canPanLeft: boolean
  canPanRight: boolean
  /** 손가락 아래 세로 스크롤 영역이 맨 위인가(세로 스크롤 영역이 없으면 참). */
  atTop: boolean
  zoom: number
  /**
   * 브라우저 자체 확대(visualViewport.scale > 1) 중인가 — 확대 대상이 아닌 문서는 페이지 핀치를 허용하므로(WCAG 1.4.4)
   * 그 상태의 한 손가락 끌기는 확대된 페이지 팬이다. 넘김·닫기로 가로채지 않고 네이티브에 맡긴다.
   */
  pageZoomed: boolean
  /**
   * 미디어 재생 막대 구역에서 시작했는가(WP-281, WP-278 판정 R3 의 후속) — 막대를 좌우로 끄는 탐색이 파일 넘김·닫기로 바뀌지 않게
   * 어느 축이든 네이티브(컨트롤)에 맡긴다. 계산은 inScrubZone.
   */
  inScrubZone?: boolean
}

/**
 * 첫 의미 있는 이동에서 제스처 소유권을 정한다(스펙 §5.1).
 * - 가장자리 20px 시작은 OS 몫(native).
 * - 가로 우세: 내용이 그 방향으로 더 갈 수 있으면 내용 먼저(native), 가장자리에 닿아 있으면 넘김(swipe).
 * - 세로 우세: 원래 크기 + 맨 위 + 아래로 당김이면 닫기(dismiss), 그 외는 스크롤·팬(native).
 */
export function lockGesture(i: LockInput): GestureLock {
  if (i.startX < EDGE_GUARD_PX || i.startX > i.viewportWidth - EDGE_GUARD_PX) return 'native'
  const ax = Math.abs(i.dx)
  const ay = Math.abs(i.dy)
  if (Math.max(ax, ay) < LOCK_SLOP_PX) return 'pending'
  // 페이지가 브라우저 확대 중이면 끌기는 확대 화면 팬 — 넘김·닫기 없음(움직이지 않은 탭은 위 pending 으로 그대로 탭).
  if (i.pageZoomed) return 'native'
  // 재생 막대 구역 — 탐색 끌기는 컨트롤 몫(스펙 §5.3 #1). 움직이지 않은 탭은 위 pending 으로 남아 탭 판정을 그대로 탄다.
  if (i.inScrubZone) return 'native'
  if (ax > ay) {
    // 손가락이 왼쪽(dx<0) = 내용은 오른쪽을 보려는 것 → 오른쪽 여유가 있으면 내용이 먼저 움직인다.
    const room = i.dx < 0 ? i.canPanRight : i.canPanLeft
    return room ? 'native' : 'swipe'
  }
  return i.dy > 0 && i.zoom === 1 && i.atTop ? 'dismiss' : 'native'
}

/** 영상 재생 막대(네이티브 컨트롤) 높이 — 영상 요소 아래 이만큼은 스와이프에서 뺀다(스펙 §5.3 #1, 약 48px). */
export const SCRUB_ZONE_PX = 48

/** 뷰어가 다루는 미디어 요소 종류. */
export type MediaElementKind = 'video' | 'audio'

/**
 * 터치 시작점(화면 y)이 재생 막대 구역인가.
 * - 오디오: 요소 전체가 컨트롤(재생 막대 포함 한 줄)이라 어디서 시작하든 구역.
 * - 영상: 요소 아래 SCRUB_ZONE_PX 띠(네이티브 컨트롤이 그려지는 자리). 그 위 영상 면적은 넘김 가능.
 */
export function inScrubZone(y: number, rect: { top: number; height: number }, el: MediaElementKind): boolean {
  if (el === 'audio') return true
  const bottom = rect.top + rect.height
  return y >= bottom - SCRUB_ZONE_PX && y <= bottom
}

/**
 * 단일 탭이 상·하단 바를 토글하는가(스펙 §5.3 #2·오디오).
 * - 오디오 형식: 토글하지 않는다 — 화면이 작은 플레이어 하나라 바를 숨길 이유가 없고, 플레이어 조작 탭이 바를 흔들지 않게.
 * - 영상 요소 위 탭: 네이티브 컨트롤 표시 몫 — 바 토글은 영상 밖 여백 탭으로만.
 * - 그 외(이미지·문서·영상 밖 여백): 토글.
 */
export function tapTogglesBars(i: { media: MediaElementKind | null; onMediaElement: boolean }): boolean {
  if (i.media === 'audio') return false
  return !i.onMediaElement
}

/** 손을 뗄 때 넘김 확정 — 폭 25% 초과 또는 같은 방향 플링. 끝에서는 그 방향으로 넘기지 않는다(순환 없음). */
export function decideSwipe(i: { dx: number; vx: number; width: number; hasPrev: boolean; hasNext: boolean }): 'prev' | 'next' | 'stay' {
  const far = Math.abs(i.dx) > i.width * SWIPE_COMMIT_RATIO
  const fling = Math.abs(i.vx) > FLING_VELOCITY && Math.sign(i.vx) === Math.sign(i.dx) && Math.abs(i.dx) > FLING_MIN_DISTANCE
  if (!far && !fling) return 'stay'
  if (i.dx < 0) return i.hasNext ? 'next' : 'stay'
  return i.hasPrev ? 'prev' : 'stay'
}

/** 손을 뗄 때 아래로 닫기 확정 — 높이 20% 초과 또는 아래 방향 플링. */
export function decideDismiss(i: { dy: number; vy: number; height: number }): boolean {
  if (i.dy > i.height * DISMISS_RATIO) return true
  return i.vy > FLING_VELOCITY && i.dy > FLING_MIN_DISTANCE
}

/**
 * 러버밴드 — 끝에서 더 끌면 점점 덜 따라오게(iOS 스크롤 바운스 곡선). 결과는 limit 를 넘지 않는다.
 * f(x) = (1 - 1 / (|x|·0.55 / limit + 1)) · limit
 */
export function rubberBand(dx: number, limit: number): number {
  if (dx === 0 || limit <= 0) return 0
  return Math.sign(dx) * (1 - 1 / ((Math.abs(dx) * 0.55) / limit + 1)) * limit
}

/** 끌기 중 무대 이동량 — 넘길 곳이 있으면 손가락을 그대로, 처음·끝이면 러버밴드(폭 30% 한계). */
export function dragOffset(dx: number, width: number, hasPrev: boolean, hasNext: boolean): number {
  const blocked = (dx < 0 && !hasNext) || (dx > 0 && !hasPrev)
  return blocked ? rubberBand(dx, width * 0.3) : dx
}

/** 최근 windowMs 구간의 평균 속도(px/ms). 표본이 부족하거나 시간이 0 이면 0. */
export function releaseVelocity(samples: Sample[], windowMs = VELOCITY_WINDOW_MS): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 }
  const last = samples[samples.length - 1]
  let first = last
  for (let k = samples.length - 2; k >= 0 && last.t - samples[k].t <= windowMs; k--) first = samples[k]
  const dt = last.t - first.t
  if (dt <= 0) return { vx: 0, vy: 0 }
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt }
}

/** 누른 시각(startT)과 뗀 시각(endT, ms)으로 본 탭 여부 — TAP_MAX_MS 이상 누른 채 뗀 것(길게 누르기)은 탭이 아니다. 이동 판정은 lockGesture(6px) 몫. */
export function isTapDuration(startT: number, endT: number): boolean {
  return endT - startT < TAP_MAX_MS
}

/** 직전 탭과 이번 탭이 두 번 탭인가(시간·거리 모두 안). */
export function isDoubleTap(prev: Sample | null, cur: Sample): boolean {
  if (!prev) return false
  return cur.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_DIST_PX
}

/**
 * 두 손가락 거리 비율로 새 배율 — 터치 범위(1~3)로 자른다. 시작 거리가 0 이하면 그대로.
 * 하한은 min(1, 시작 배율) — 이미 1 미만에서 시작했으면 그보다 아래로만 막는다(모으는데 확대되는 역전 방지).
 */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (startDist <= 0) return startZoom
  return Math.min(TOUCH_ZOOM_MAX, Math.max(Math.min(TOUCH_ZOOM_MIN, startZoom), startZoom * (dist / startDist)))
}

/** 무대 touch-action 표식 — index.css 의 [data-viewer-stage] 규칙과 짝(판정 R2, WP-278 최종 수정). */
export type StageTouch = 'none' | 'pan' | 'manipulation'

/**
 * 무대 터치 동작 결정. fine 포인터면 표식 없음(데스크톱에 터치 규칙이 닿지 않게).
 * - 영상·오디오 = none: 브라우저 핀치 확대를 끄고(스펙 §5.3) 스와이프·닫기는 JS 가, 재생 막대 끌기는 네이티브 컨트롤이 받는다.
 * - 확대 대상이 아닌 형식(마크다운·텍스트·CSV·안내 문구 등) = manipulation: 뷰어 배율이 없으니 브라우저 핀치 확대를 살린다(WCAG 1.4.4). 두 번 탭 확대만 끈다.
 * - 맞춤(1×) 이미지 = none: 스크롤할 것이 없어 스와이프·닫기·핀치를 전부 JS 가 받는다.
 * - 그 외(확대한 이미지·PDF) = pan: 네이티브 스크롤은 두고 브라우저 핀치는 끈다 — 확대는 뷰어 배율로.
 */
export function stageTouchAction(i: {
  coarse: boolean
  zoomable: boolean
  image: boolean
  zoom: number
  /** 영상·오디오(WP-281) — 핀치 확대를 끈다(스펙 §5.3 "줌 끔"). 스크롤할 내용도 없어 스와이프·닫기를 JS 가 받는다. */
  media?: boolean
}): StageTouch | undefined {
  if (!i.coarse) return undefined
  if (i.media) return 'none'
  if (!i.zoomable) return 'manipulation'
  return i.image && i.zoom === 1 ? 'none' : 'pan'
}

/**
 * 배율을 둘째 자리에서 자른다 — 핀치 확정·＋/－ 단계가 같은 규칙을 쓴다(data-zoom·표시가 0.30000000000000004 같은 긴 소수가 되지 않게).
 */
export function roundZoom(z: number): number {
  return +z.toFixed(2)
}

/** 두 번 탭 목표 배율 — 맞춤이면 2배, 확대 중이면 맞춤. */
export function doubleTapTarget(zoom: number): number {
  return zoom > 1 ? 1 : DOUBLE_TAP_ZOOM
}

/** 화면 좌표 사각형 — getBoundingClientRect 에서 필요한 값만(순수 함수 입력). */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 확대 기준점 — 제스처 시작(핀치)·탭(두 번 탭) 순간에 잰다.
 * x·y: 화면 좌표(clientX/Y) — 확대 뒤에도 이 화면 위치에 같은 내용이 오게 한다.
 * fx·fy: 그 점이 기준 요소(PDF 페이지 캔버스·이미지) 안 어디쯤인지(0~1 비율).
 * 왜 요소 안 비율인가(판정 R1 수정): PDF 페이지 사이 간격(gap)·위아래 여백(py)·이미지 여백(p)·가운데 정렬 auto 여백은 배율을 따라 커지지 않는다.
 * "스크롤 좌표 전체가 배율에 비례" 로 계산하면 뒤 페이지일수록(20쪽 ≈ 320px) 어긋나고, 여백 있는 이미지는 엉뚱한 끝으로 잘린다.
 * 배율에 정확히 비례하는 것은 요소 자신의 크기뿐이므로 확대 뒤 그 요소의 실제 위치를 다시 재서 맞춘다.
 */
export interface ZoomFocus {
  x: number
  y: number
  fx: number
  fy: number
}

/** 사각형과 점 사이 거리(안이면 0) — 페이지 사이 간격에 놓인 점도 가장 가까운 페이지로 잡으려고. */
function boxDistance(b: Box, x: number, y: number): number {
  const dx = Math.max(b.left - x, 0, x - (b.left + b.width))
  const dy = Math.max(b.top - y, 0, y - (b.top + b.height))
  return Math.hypot(dx, dy)
}

/** 기준점에 가장 가까운 내용 요소의 순번(점을 품은 요소가 있으면 그것). 후보가 없으면 -1. */
export function pickAnchorIndex(boxes: Box[], x: number, y: number): number {
  let best = -1
  let bestDist = Infinity
  boxes.forEach((b, k) => {
    const d = boxDistance(b, x, y)
    if (d < bestDist) {
      best = k
      bestDist = d
    }
  })
  return best
}

/**
 * 점이 요소 안 어디쯤인지(0~1). 요소 밖(이미지 좌우 검은 여백·페이지 사이 간격)은 가장 가까운 끝(0 또는 1)으로 자른다 —
 * 여백은 배율을 따라 커지지 않으므로 바깥으로 외삽하면 오히려 어긋난다. 크기가 0 인 축은 가운데(0.5).
 */
export function focusFraction(b: Box, x: number, y: number): { fx: number; fy: number } {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
  return {
    fx: b.width > 0 ? clamp01((x - b.left) / b.width) : 0.5,
    fy: b.height > 0 ? clamp01((y - b.top) / b.height) : 0.5,
  }
}

/**
 * 확대가 레이아웃에 반영된 뒤의 스크롤 위치 — 기준 요소의 "새" 화면 위치(box, 현재 스크롤 기준으로 잰 값)에서
 * 기준 비율 지점이 기준 화면 좌표(focus.x·y)에 오도록 현재 스크롤에 차이만큼 더한다.
 * 현재 스크롤과 새 위치를 같은 시점에 재므로, 축소 중 브라우저가 스크롤을 먼저 잘라 냈어도 기준이 틀어지지 않는다.
 * 음수는 0 으로(브라우저가 최대값은 자른다).
 */
export function anchoredScroll(i: { scrollLeft: number; scrollTop: number; box: Box; focus: ZoomFocus }): { left: number; top: number } {
  const px = i.box.left + i.focus.fx * i.box.width
  const py = i.box.top + i.focus.fy * i.box.height
  return {
    left: Math.max(0, Math.round(i.scrollLeft + px - i.focus.x)),
    top: Math.max(0, Math.round(i.scrollTop + py - i.focus.y)),
  }
}
