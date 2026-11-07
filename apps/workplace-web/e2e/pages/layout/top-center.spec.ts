// top-center.spec.ts — 상단 AI 칩·검색 단추 위치(WP-1415)의 브라우저 판정.
// 세로 가운데·겹침(오른쪽 단추 앞 16px)·접힘(⋯)·동그라미(32px).
// jsdom 이 잴 수 없는 기하(실측 위치·겹침·단계 안정성)만 본다. 내부 밀도 상태는 판정에 쓰지 않는다.
import type { Page } from '@playwright/test'

import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectStays, measureBox, nextFrame } from '../../fixtures/wait'

/** 프로젝트 화면으로 이동 — 헤더에 사이클·버전·타임라인·설정(보조) + 새 태스크(주) 단추가 있다. */
async function gotoProject(page: Page) {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP', name: '프로젝트' }))
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  await page.goto('/projects/WP')
}

/** 헤더 세로 가운데(28px) 기준 — 칩·검색의 세로 가운데가 이 값과 ±0.5px 이내인지. */
const HEADER_CENTER = 28

/** 전환 중 서로 다른 프레임을 섞지 않도록 검색·액션 간격을 같은 레이아웃에서 잰다. */
async function actionGap(page: Page) {
  const actions = page.getByTestId('page-header').locator('[data-ai-actions]')
  return actions.evaluate((element) => {
    const search = document.querySelector('[data-testid="global-search-toggle"]')
    const chip = document.querySelector('[data-testid="chat-launcher"]')
    const frame = search?.getBoundingClientRect().width ? search : chip
    if (!frame) throw new Error('상단 칩·검색이 없다')
    return element.getBoundingClientRect().left - frame.getBoundingClientRect().right
  })
}

/** 겹침 없음 — 틀 오른쪽 끝이 actions 왼쪽 끝보다 16px 이상 왼쪽인지. */
async function expectNoOverlap(page: Page) {
  await expect(async () => expect(await actionGap(page), '틀과 액션 사이 간격').toBeGreaterThanOrEqual(16)).toPass()
}

/** 레일 전환 중 한 프레임만 생기는 겹침도 재시도 없이 잡는다. 200ms 이동·250ms 단계 보정 창을 포함한다. */
async function expectNoOverlapDuring(page: Page, action: () => Promise<void>) {
  const sampling = page.evaluate(() => new Promise<number[]>((resolve) => {
    const gaps: number[] = []
    const start = performance.now()
    const sample = () => {
      const search = document.querySelector('[data-testid="global-search-toggle"]')!
      const actions = document.querySelector('[data-testid="page-header"] [data-ai-actions]')!
      gaps.push(actions.getBoundingClientRect().left - search.getBoundingClientRect().right)
      if (performance.now() - start < 500) requestAnimationFrame(sample)
      else resolve(gaps)
    }
    requestAnimationFrame(sample)
  }))
  await action()
  expect(Math.min(...await sampling), '전환 중 모든 프레임의 최소 간격').toBeGreaterThanOrEqual(16)
}

type Stage = 'expanded' | 'folded' | 'circle'

/** 화면의 칩·보조 메뉴 폭으로 단계를 구분한다. 잠깐 숨기거나 내부 상태만 바꾼 회귀도 잡는다. */
async function renderedStage(page: Page): Promise<Stage> {
  const chip = await measureBox(page.getByTestId('chat-launcher'), 'chat-launcher')
  const actions = await measureBox(page.getByTestId('page-header').locator('[data-ai-actions]'), 'data-ai-actions')
  const more = page.getByTestId('mobile-header-more')
  if (await more.isVisible()) {
    const menu = await measureBox(more, '보조 단추 더보기')
    expect(menu.width, '접힌 보조 메뉴 폭').toBeCloseTo(44, 0)
    expect(actions.width, '접힌 액션 그룹 폭').toBeCloseTo(153, 0)
    if (Math.abs(chip.width - 32) < 0.5) return 'circle'
    expect(chip.width, '접힌 단계의 AI 알약 폭').toBeCloseTo(140, 0)
    return 'folded'
  }
  expect(actions.width, '펼친 액션 그룹 폭').toBeCloseTo(412, 0)
  expect(chip.width, '펼친 단계의 AI 알약 폭').toBeCloseTo(140, 0)
  return 'expanded'
}

/** CSS 위치 전환까지 끝난 뒤 기대 단계를 확인한다. */
async function expectStage(page: Page, stage: Stage) {
  await expect(async () => expect(await renderedStage(page)).toBe(stage)).toPass()
  await expectNoOverlap(page)
}

/** 실제 손잡이를 끄는 중에도 각 프레임의 검색·액션 사이 16px 간격을 확인한다. */
async function dragPanelTo(page: Page, width: number) {
  const panel = await measureBox(page.getByTestId('ai-side-panel'), 'ai-side-panel')
  const handle = await measureBox(page.getByTestId('ai-resize-handle'), 'ai-resize-handle')
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  const distance = panel.width - width
  const steps = Math.ceil(Math.abs(distance) / 20)
  await page.mouse.move(x, y)
  await page.mouse.down()
  try {
    for (let step = 1; step <= steps; step++) {
      await page.mouse.move(x + distance * step / steps, y)
      await nextFrame(page)
      expect(await actionGap(page), '끄는 중 틀과 액션 사이 간격').toBeGreaterThanOrEqual(16)
    }
  } finally {
    await page.mouse.up()
  }
  await expect(async () => {
    const box = await measureBox(page.getByTestId('ai-side-panel'), 'ai-side-panel')
    expect(box.width).toBeCloseTo(width, 0)
  }).toPass()
}

// 1440px 패널 닫힘 — 칩·검색 세로 가운데 = 헤더 가운데(28px) ±0.5px.
test('1440px 패널 닫힘 — 칩·검색 세로 가운데', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoProject(page)
  const chip = page.getByTestId('chat-launcher')
  const search = page.getByTestId('global-search-toggle')
  await expect(chip).toBeVisible()
  await expect(search).toBeVisible()
  await expectStage(page, 'expanded')
  await expect(async () => {
    const [c, s] = [await measureBox(chip, 'chat-launcher'), await measureBox(search, 'global-search-toggle')]
    expect(Math.abs(c.y + c.height / 2 - HEADER_CENTER), '칩 세로 가운데').toBeLessThanOrEqual(0.5)
    expect(Math.abs(s.y + s.height / 2 - HEADER_CENTER), '검색 세로 가운데').toBeLessThanOrEqual(0.5)
  }).toPass()
})

// 1024px(lg 경계) 패널 닫힘 — 겹침 없음(≥16px).
test('1024px 패널 닫힘 — 겹침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await gotoProject(page)
  await expect(page.getByTestId('chat-launcher')).toBeVisible()
  await expectStage(page, 'expanded')
})

// 1440px + AI 옆 패널 460px — 겹침 없음(≥16px).
test('1440px + AI 옆 패널 460px — 겹침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'folded')
})

// 1024px + AI 옆 패널 460px — 겹침 없음(≥16px).
test('1024px + AI 옆 패널 460px — 동그라미·접힌 메뉴가 레일을 가리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1024, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'circle')
  await expect(page.getByTestId('rail-toggle')).toBeVisible()
  await expect(async () => {
    const chip = await measureBox(page.getByTestId('chat-launcher'), 'chat-launcher')
    const rail = await measureBox(page.getByTestId('rail-toggle'), 'rail-toggle')
    expect(chip.x, '동그라미가 화면 안에 있다').toBeGreaterThanOrEqual(0)
    expect(chip.x + chip.width, '동그라미 오른쪽이 화면 안에 있다').toBeLessThanOrEqual(1024)
    expect(chip.x, '동그라미가 레일 펼치기 단추를 가리지 않는다').toBeGreaterThanOrEqual(rail.x + rail.width)
  }).toPass()
})

// 리뷰에서 왕복하던 폭을 각각 새 화면에서 열어, 관측한 단계가 3초 동안 유지되는지 본다.
for (const width of [1180, 1200, 1240]) {
  test(`${width}px + AI 옆 패널 460px — 접힌 알약 단계가 3초간 안정적이다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
    await page.setViewportSize({ width, height: 900 })
    await gotoProject(page)
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await expectStage(page, 'folded')
    // 부재 확인: 재시도 없이 50ms마다 실측해 리뷰의 3초 왕복 창 전체에서 단계 변화를 잡는다.
    await expectStays(page, () => renderedStage(page), 'folded', { ms: 3000, message: '접힌 알약 단계 유지' })
    await expectNoOverlap(page)
  })
}

test('1420px에서 패널을 끄는 동안 16px 간격을 지키고 펼침 → 접힘 → 동그라미 → 펼침으로 복귀한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '320'))
  await page.setViewportSize({ width: 1420, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'expanded')
  await dragPanelTo(page, 460)
  await expectStage(page, 'folded')
  await dragPanelTo(page, 600)
  await expectStage(page, 'circle')
  await dragPanelTo(page, 320)
  await expectStage(page, 'expanded')
})

test('레일을 펼치고 접을 때 16px 간격과 동그라미 단계 전환이 안정적이다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1200, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'folded')
  await expectNoOverlapDuring(page, () => page.getByTestId('rail-toggle').click())
  await expectStage(page, 'circle')
  await expectStays(page, () => renderedStage(page), 'circle', { ms: 3000, message: '레일 펼친 동그라미 단계 유지' })
  await expectNoOverlapDuring(page, () => page.getByTestId('rail-collapse').click())
  await expectStage(page, 'folded')
})
