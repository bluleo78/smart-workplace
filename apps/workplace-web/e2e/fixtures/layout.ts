// 데스크톱 헤더-본문 정렬 단언 헬퍼 — 페이지 레이아웃 통합(Page) 회귀 방지.
// 무엇을: 헤더 내용과 본문의 시작 x 일치, 헤더 하단선 y(=56px, 사이드바 헤더와 한 선), 보조 칸이 헤더 아래인지.
import { expect, type Locator, type Page } from '@playwright/test'

import { stableBox } from './wait'

/** 데스크톱 헤더 높이 — 사이드바 헤더(sidebarTitleClass h-14)·레일 마크 헤더와 같은 선. */
export const HEADER_BOTTOM = 56

/** 정렬 테스트를 돌릴 화면 폭 — 1440(일반), 2560(container max-width 1536 을 넘는 넓은 화면). */
export const DESKTOP_WIDTHS = [1440, 2560] as const

/** 보일 때까지 기다린 뒤 boundingBox 를 null 이 아닐 때까지 다시 잰다(리마운트 찰나의 null 을 넘김 — stableBox). */
export async function boxOf(l: Locator) {
  await expect(l).toBeVisible()
  return stableBox(l)
}

/** 두 요소의 시작 x 가 tol(px) 이내로 같다. */
export async function expectStartAligned(a: Locator, b: Locator, tol = 1) {
  const [ba, bb] = await Promise.all([boxOf(a), boxOf(b)])
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

/** 설정 주석 섹션 — 제목(h2) 텍스트로 찾는다. */
export function settingsSection(page: Page, title: string): Locator {
  return page.locator('[data-slot="settings-section"]').filter({
    has: page.getByRole('heading', { level: 2, name: title, exact: true }),
  })
}

/** 섹션의 제목 열·입력 열 박스를 함께 잰다. */
function sectionColumns(section: Locator) {
  return Promise.all([
    boxOf(section.locator('[data-slot="settings-section-heading"]')),
    boxOf(section.locator('[data-slot="settings-section-content"]')),
  ])
}

/** 2단: 입력 열이 제목 열 오른쪽에 있고 같은 줄에서 시작한다. */
export async function expectSideBySide(section: Locator) {
  const [h, c] = await sectionColumns(section)
  expect(c.x, '입력 열이 제목 열 오른쪽').toBeGreaterThanOrEqual(h.x + h.width)
  expect(Math.abs(c.y - h.y), '같은 줄에서 시작').toBeLessThanOrEqual(2)
}

/** 세로 스택: 입력 열이 제목 열 아래에서 시작하고 시작 x 가 같다. */
export async function expectStacked(section: Locator) {
  const [h, c] = await sectionColumns(section)
  expect(c.y, '입력 열이 제목 아래').toBeGreaterThanOrEqual(h.y + h.height - 1)
  expect(Math.abs(c.x - h.x), '시작 x 같음').toBeLessThanOrEqual(1)
}

/** 헤더·본문 공용 좌우 여백(pageGutterClass px-4). */
const PAGE_GUTTER = 16

/**
 * settings 폭: 본문 내용이 1024px 이하이고, 첫 섹션 제목이 헤더 여백 기준선(헤더 x + 16)에서 시작한다.
 * h1 과 직접 비교하지 않는다 — 헤더 icon 슬롯(뒤로가기 버튼)이 있는 화면은 h1 이 아이콘 폭만큼 오른쪽에 있다.
 */
export async function expectSettingsBodyCapped(page: Page) {
  const body = page.getByTestId('page-body-content')
  const [b, header, heading] = await Promise.all([
    boxOf(body),
    boxOf(page.getByTestId('page-header')),
    boxOf(body.locator('[data-slot="settings-section-heading"]').first()),
  ])
  expect(b.width).toBeLessThanOrEqual(1024)
  expect(Math.abs(heading.x - (header.x + PAGE_GUTTER)), `섹션 x ${heading.x} vs 헤더 기준선 ${header.x + PAGE_GUTTER}`).toBeLessThanOrEqual(1)
}
