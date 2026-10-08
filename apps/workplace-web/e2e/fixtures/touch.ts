// 실제 손가락 터치 — CDP Input.dispatchTouchEvent 로 touchStart/Move/End 를 만든다(WP-278 뷰어 제스처).
// 왜 page.mouse 가 아닌가: 마우스는 pointerType 'mouse' 라 Touch Events·touch-action·passive 리스너 경로를 타지 않아
// 실기기에서 깨지는 제스처도 통과시킨다. CDP 터치는 브라우저가 터치·포인터·스크롤·click 을 실제 순서로 만든다.
import type { Locator, Page } from '@playwright/test'

export interface Pt {
  x: number
  y: number
}

/** 요소 중심 좌표. */
export async function centerOf(target: Locator): Promise<Pt> {
  const b = (await target.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/**
 * 한 손가락 끌기 — from → to 를 steps 번에 나눠 움직인다.
 * stepDelayMs 를 주면 느린 끌기(플링 아님), 생략하면 빠른 끌기.
 */
export async function touchDrag(page: Page, from: Pt, to: Pt, opts: { steps?: number; stepDelayMs?: number } = {}) {
  const steps = opts.steps ?? 8
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] })
    for (let k = 1; k <= steps; k++) {
      const p = { x: from.x + ((to.x - from.x) * k) / steps, y: from.y + ((to.y - from.y) * k) / steps, id: 0 }
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] })
      // eslint-disable-next-line playwright/no-wait-for-timeout -- 느린 끌기 제스처 자체의 속도(손가락 이동 시간)라 조건 대기로 바꿀 수 없다
      if (opts.stepDelayMs) await page.waitForTimeout(opts.stepDelayMs)
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await s.detach()
  }
}

/** 한 번 탭. */
export async function touchTap(page: Page, p: Pt) {
  const s = await page.context().newCDPSession(page)
  try {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] })
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await s.detach()
  }
}

/** 두 번 탭 — 지연 없이 연달아(300ms 판정 창 안). */
export async function touchDoubleTap(page: Page, p: Pt) {
  const s = await page.context().newCDPSession(page)
  try {
    for (let k = 0; k < 2; k++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] })
      await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
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
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(fromDist) })
    for (let k = 1; k <= steps; k++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(fromDist + ((toDist - fromDist) * k) / steps) })
    }
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
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
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] })
    for (let k = 1; k <= 6; k++) {
      await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (dx * k) / 6, y: from.y, id: 0 }] })
    }
    const a = { x: from.x + dx, y: from.y, id: 0 }
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, { x: a.x, y: a.y + 120, id: 1 }] })
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } finally {
    await s.detach()
  }
}
