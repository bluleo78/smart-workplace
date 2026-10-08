// 실제 손가락 터치 — CDP Input.dispatchTouchEvent 로 touchStart/Move/End 를 만든다(WP-278 뷰어 제스처).
// 왜 page.mouse 가 아닌가: 마우스는 pointerType 'mouse' 라 Touch Events·touch-action·passive 리스너 경로를 타지 않아
// 실기기에서 깨지는 제스처도 통과시킨다. CDP 터치는 브라우저가 터치·포인터·스크롤·click 을 실제 순서로 만든다.
//
// 이벤트 시각은 합성 시계로 명시한다(dispatchTouchEvent 의 timestamp — Chromium 은 이 값을 event.timeStamp 로 그대로 쓴다).
// 왜: 생략하면 브라우저가 "보낸 순간" 을 찍는데, send 는 렌더러 응답(ack)을 기다리므로 부하가 걸리면
// 탭 길이(500ms 상한)·두 번 탭 간격(300ms) 판정이 벽시계 지연에 따라 흔들린다. 합성 시각이면 제스처 판정이 항상 같다.
import type { CDPSession, Locator, Page } from '@playwright/test'

export interface Pt {
  x: number
  y: number
}

/** 제스처 안 이벤트 간격(초) — 60Hz 한 프레임. */
const STEP_S = 0.016
/**
 * 서로 다른 헬퍼 호출(제스처) 사이 최소 간격(초) — 두 번 탭 판정 창(300ms)보다 길어, 따로 부른 탭 두 번이 두 번 탭으로 묶이지 않는다.
 * 두 번 탭은 touchDoubleTap 한 번으로만 만든다.
 */
const GESTURE_GAP_S = 0.4
/** 합성 시계(초, epoch 기준) — 단조 증가. 벽시계보다 늦지 않게 Date.now() 와 비교해 앞선 값을 쓴다. */
let clockS = 0

/** 새 제스처의 시작 시각(초). */
function gestureStart(): number {
  clockS = Math.max(Date.now() / 1000, clockS + GESTURE_GAP_S)
  return clockS
}

/** 합성 시각을 붙여 터치 이벤트 하나를 보낸다(그 시각까지 시계를 당긴다). */
async function send(s: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Array<Pt & { id: number }>, t: number) {
  clockS = Math.max(clockS, t)
  await s.send('Input.dispatchTouchEvent', { type, touchPoints, timestamp: t })
}

/** 요소 중심 좌표. */
export async function centerOf(target: Locator): Promise<Pt> {
  const b = (await target.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * 페이지 타이머(setTimeout 등)를 멈춘다 — 이후엔 page.clock.runFor(ms) 로만 흐른다.
 * "탭 판정 지연(300ms) 뒤에도 바가 토글되지 않음" 같은 부재 확인을 벽시계 대기 없이 결정적으로 하려고 쓴다.
 * 주의 1: requestAnimationFrame 도 멈추므로 PDF 렌더(pdf.js 가 rAF 로 그림)가 필요한 테스트에선 쓰지 않는다.
 * 주의 2: 설치된 동안 event.timeStamp 도 가짜 시계를 따른다(위 합성 timestamp 는 무시됨) — 멈춘 동안의 터치는 모두 같은 시각,
 *   즉 순간 동작이 된다(두 번 탭 간격 0·탭 길이 0). 시간 길이가 판정에 필요한 제스처는 그 사이에 page.clock.runFor 로 흘린다(touchHold 의 pageClock).
 */
export async function pausePageClock(page: Page) {
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
}

/**
 * 한 손가락 끌기 — from → to 를 steps 번에 나눠 움직인다.
 * stepDelayMs 를 주면 느린 끌기(이벤트 간격 = stepDelayMs, 플링 아님), 생략하면 빠른 끌기(16ms 간격).
 * beforeEnd 는 손을 떼기 직전(손가락이 아직 닿은 상태)에 불린다 — 끌기 중 무대가 실제로 움직였는지 확인할 때.
 */
export async function touchDrag(
  page: Page,
  from: Pt,
  to: Pt,
  opts: { steps?: number; stepDelayMs?: number; beforeEnd?: () => Promise<void> } = {},
) {
  const steps = opts.steps ?? 8
  const step = opts.stepDelayMs ? opts.stepDelayMs / 1000 : STEP_S
  const s = await page.context().newCDPSession(page)
  try {
    const t0 = gestureStart()
    await send(s, 'touchStart', [{ ...from, id: 0 }], t0)
    for (let k = 1; k <= steps; k++) {
      const p = { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps, id: 0 }
      await send(s, 'touchMove', [p], t0 + step * k)
      // eslint-disable-next-line playwright/no-wait-for-timeout -- 느린 끌기 중 화면(무대 이동)을 실제로 보이게 하는 손가락 이동 시간 — 판정 자체는 합성 시각을 쓴다
      if (opts.stepDelayMs) await page.waitForTimeout(opts.stepDelayMs)
    }
    await opts.beforeEnd?.()
    // 마지막 이동 직후 뗀다(반 프레임) — 멈췄다 놓은 것으로 치지 않게.
    await send(s, 'touchEnd', [], t0 + step * steps + STEP_S / 2)
  } finally {
    await s.detach()
  }
}

/** 한 번 탭 — 40ms 동안 누른다. */
export async function touchTap(page: Page, p: Pt) {
  const s = await page.context().newCDPSession(page)
  try {
    const t0 = gestureStart()
    await send(s, 'touchStart', [{ ...p, id: 0 }], t0)
    await send(s, 'touchEnd', [], t0 + 0.04)
  } finally {
    await s.detach()
  }
}

/**
 * 제자리 길게 누르기 — holdMs 동안 누른 뒤 뗀다(합성 시각이라 실제로 기다리지 않는다).
 * pageClock: pausePageClock 으로 시계를 멈춘 페이지면 참 — 그땐 event.timeStamp 가 가짜 시계를 따르므로 누른 동안 그 시계를 holdMs 흘린다.
 */
export async function touchHold(page: Page, p: Pt, holdMs: number, opts: { pageClock?: boolean } = {}) {
  const s = await page.context().newCDPSession(page)
  try {
    const t0 = gestureStart()
    await send(s, 'touchStart', [{ ...p, id: 0 }], t0)
    if (opts.pageClock) await page.clock.runFor(holdMs)
    await send(s, 'touchEnd', [], t0 + holdMs / 1000)
  } finally {
    await s.detach()
  }
}

/** 두 번 탭 — 40ms 탭 두 번, 사이 80ms(첫 뗌 → 둘째 뗌 120ms, 300ms 판정 창 안). 한 세션에서 연달아 보낸다. */
export async function touchDoubleTap(page: Page, p: Pt) {
  const s = await page.context().newCDPSession(page)
  try {
    const t0 = gestureStart()
    for (const off of [0, 0.12]) {
      await send(s, 'touchStart', [{ ...p, id: 0 }], t0 + off)
      await send(s, 'touchEnd', [], t0 + off + 0.04)
    }
  } finally {
    await s.detach()
  }
}

/** 두 손가락 핀치 — center 를 중심으로 가로로 fromDist → toDist 만큼 벌리거나 모은다. */
export async function touchPinch(page: Page, center: Pt, fromDist: number, toDist: number, steps = 8) {
  const pts = (d: number) => [
    { x: center.x - d / 2, y: center.y, id: 0 },
    { x: center.x + d / 2, y: center.y, id: 1 },
  ]
  const s = await page.context().newCDPSession(page)
  try {
    const t0 = gestureStart()
    await send(s, 'touchStart', pts(fromDist), t0)
    for (let k = 1; k <= steps; k++) {
      await send(s, 'touchMove', pts(fromDist + ((toDist - fromDist) * k) / steps), t0 + STEP_S * k)
    }
    await send(s, 'touchEnd', [], t0 + STEP_S * (steps + 1))
  } finally {
    await s.detach()
  }
}

/**
 * 한 손가락으로 dx 만큼 끈 뒤 두 번째 손가락을 얹고 둘 다 뗀다 — "스와이프 도중 두 번째 손가락" 재현.
 */
export async function touchSwipeThenSecondFinger(page: Page, from: Pt, dx: number) {
  const s = await page.context().newCDPSession(page)
  try {
    const t0 = gestureStart()
    await send(s, 'touchStart', [{ ...from, id: 0 }], t0)
    for (let k = 1; k <= 6; k++) {
      await send(s, 'touchMove', [{ x: from.x + (dx * k) / 6, y: from.y, id: 0 }], t0 + STEP_S * k)
    }
    const a = { x: from.x + dx, y: from.y, id: 0 }
    await send(s, 'touchStart', [a, { x: a.x, y: a.y + 120, id: 1 }], t0 + STEP_S * 7)
    await send(s, 'touchEnd', [], t0 + STEP_S * 8)
  } finally {
    await s.detach()
  }
}

/**
 * 두 손가락으로 fromDist → toDist 만큼 벌리다가 세 번째 손가락을 얹고 모두 뗀다 — "핀치 중 손바닥 오접촉" 재현.
 * 세 번째 손가락이 닿은 뒤에는 핀치를 확정하지 않고 미리보기만 걷혀야 한다.
 */
export async function touchPinchThenThirdFinger(page: Page, center: Pt, fromDist: number, toDist: number) {
  const pts = (d: number) => [
    { x: center.x - d / 2, y: center.y, id: 0 },
    { x: center.x + d / 2, y: center.y, id: 1 },
  ]
  const s = await page.context().newCDPSession(page)
  try {
    const t0 = gestureStart()
    await send(s, 'touchStart', pts(fromDist), t0)
    for (let k = 1; k <= 6; k++) {
      await send(s, 'touchMove', pts(fromDist + ((toDist - fromDist) * k) / 6), t0 + STEP_S * k)
    }
    await send(s, 'touchStart', [...pts(toDist), { x: center.x, y: center.y + 120, id: 2 }], t0 + STEP_S * 7)
    await send(s, 'touchEnd', [], t0 + STEP_S * 8)
  } finally {
    await s.detach()
  }
}
