// 데스크톱 헤더-본문 정렬 단언 헬퍼 — 페이지 레이아웃 통합(Page) 회귀 방지.
// 무엇을: 헤더 내용과 본문의 시작 x 일치, 헤더 하단선 y(=56px, 사이드바 헤더와 한 선), 보조 칸이 헤더 아래인지.
import { expect, type Locator } from '@playwright/test'

/** 데스크톱 헤더 높이 — 사이드바 헤더(sidebarTitleClass h-14)·레일 마크 헤더와 같은 선. */
export const HEADER_BOTTOM = 56

/** 정렬 테스트를 돌릴 화면 폭 — 1440(일반), 2560(container max-width 1536 을 넘는 넓은 화면). */
export const DESKTOP_WIDTHS = [1440, 2560] as const

/** boundingBox 가 null 이면 즉시 실패시키는 래퍼. */
export async function boxOf(l: Locator) {
  await expect(l).toBeVisible()
  const b = await l.boundingBox()
  if (!b) throw new Error('boundingBox 없음')
  return b
}

/** 두 요소의 시작 x 가 tol(px) 이내로 같다. */
export async function expectStartAligned(a: Locator, b: Locator, tol = 1) {
  const [ba, bb] = [await boxOf(a), await boxOf(b)]
  expect(Math.abs(ba.x - bb.x), `x 차이: ${ba.x} vs ${bb.x}`).toBeLessThanOrEqual(tol)
}

/** 헤더 하단선이 56px — 사이드바 헤더 하단선과 이어진다. */
export async function expectHeaderBottomAt56(header: Locator) {
  const b = await boxOf(header)
  expect(Math.round(b.y + b.height)).toBe(HEADER_BOTTOM)
}

/** 보조 칸이 페이지 헤더 아래에서 시작(헤더 옆으로 올라가지 않음). */
export async function expectBelowHeader(l: Locator) {
  const b = await boxOf(l)
  expect(b.y).toBeGreaterThanOrEqual(HEADER_BOTTOM)
}
