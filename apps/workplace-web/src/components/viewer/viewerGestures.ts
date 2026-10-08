// 통합 뷰어 터치 제스처 판정 순수 로직(WP-278). 훅(useViewerGestures)은 DOM 에서 값만 재서 넘기고 결과대로만 움직인다.
// 왜 순수 함수인가: 25%·플링·내용 우선·가장자리 같은 규칙은 브라우저 없이 경계값까지 검증해야 회귀를 잡는다(스펙 §8.1).

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
 * 500ms 는 브라우저 길게 누르기(문맥 메뉴) 판정 시작점과 같은 값 — 그 이상은 사용자가 탭이 아닌 다른 의도를 가진 것으로 본다.
 */
export const TAP_MAX_MS = 500
/** 터치 확대 범위 — 맞춤(1) 아래로는 줄이지 않는다. PDF 1~3×(스펙 §5.1), 이미지도 같은 상한(판정 R9). */
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
  if (ax > ay) {
    // 손가락이 왼쪽(dx<0) = 내용은 오른쪽을 보려는 것 → 오른쪽 여유가 있으면 내용이 먼저 움직인다.
    const room = i.dx < 0 ? i.canPanRight : i.canPanLeft
    return room ? 'native' : 'swipe'
  }
  return i.dy > 0 && i.zoom === 1 && i.atTop ? 'dismiss' : 'native'
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

/** 두 손가락 거리 비율로 새 배율 — 터치 범위(1~3)로 자른다. 시작 거리가 0 이하면 그대로. */
export function pinchZoom(startZoom: number, startDist: number, dist: number): number {
  if (startDist <= 0) return startZoom
  return Math.min(TOUCH_ZOOM_MAX, Math.max(TOUCH_ZOOM_MIN, startZoom * (dist / startDist)))
}

/** 두 번 탭 목표 배율 — 맞춤이면 2배, 확대 중이면 맞춤. */
export function doubleTapTarget(zoom: number): number {
  return zoom > 1 ? 1 : DOUBLE_TAP_ZOOM
}

/**
 * 배율이 from → to 로 바뀐 뒤의 스크롤 위치 — 스크롤 영역 안 기준점(focus, 영역 왼쪽 위 기준 px)이 화면의 같은 자리에 남게 한다.
 * 확대는 레이아웃 폭을 키우는 방식(WP-277)이라 내용 좌표가 배율에 비례한다는 가정. 음수는 0 으로(브라우저가 최대값은 자른다).
 */
export function anchorScroll(i: { scrollLeft: number; scrollTop: number; focusX: number; focusY: number; from: number; to: number }): { left: number; top: number } {
  if (i.from <= 0) return { left: i.scrollLeft, top: i.scrollTop }
  const r = i.to / i.from
  return {
    left: Math.max(0, Math.round((i.scrollLeft + i.focusX) * r - i.focusX)),
    top: Math.max(0, Math.round((i.scrollTop + i.focusY) * r - i.focusY)),
  }
}
