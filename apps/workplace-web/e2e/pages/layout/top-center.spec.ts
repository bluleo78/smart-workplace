// top-center.spec.ts — 상단 AI 칩·검색 단추 위치(WP-1415)의 브라우저 판정.
// 세로 가운데·겹침(오른쪽 단추 앞 16px)·접힘(⋯)·동그라미(32px).
// jsdom 이 잴 수 없는 기하(실측 위치·겹침)만 본다. 접기·동그라미 판정 계산은 vitest 가 지킨다.
import type { Page } from '@playwright/test'

import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { measureBox } from '../../fixtures/wait'

/** 프로젝트 화면으로 이동 — 헤더에 사이클·버전·타임라인·설정(보조) + 새 태스크(주) 단추가 있다. */
async function gotoProject(page: Page) {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP', name: '프로젝트' }))
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  await page.goto('/projects/WP')
}

/** 헤더 세로 가운데(28px) 기준 — 칩·검색의 세로 가운데가 이 값과 ±0.5px 이내인지. */
const HEADER_CENTER = 28

/** 틀(칩+검색)의 오른쪽 끝 — 검색 트리거가 있으면 그 오른쪽 끝, 없으면 칩 오른쪽 끝. */
async function frameRightEdge(page: Page): Promise<number> {
  const search = page.getByTestId('global-search-toggle')
  if (await search.isVisible()) {
    const s = await measureBox(search, 'global-search-toggle')
    return s.x + s.width
  }
  const chip = await measureBox(page.getByTestId('chat-launcher'), 'chat-launcher')
  return chip.x + chip.width
}

/** 겹침 없음 — 틀 오른쪽 끝이 actions 왼쪽 끝보다 16px 이상 왼쪽인지. */
async function expectNoOverlap(page: Page) {
  const actions = page.getByTestId('page-header').locator('[data-ai-actions]')
  await expect(async () => {
    const [rightEdge, a] = [await frameRightEdge(page), await measureBox(actions, 'data-ai-actions')]
    expect(rightEdge, '틀 오른쪽 끝 ≤ actions 왼쪽 끝 - 16').toBeLessThanOrEqual(a.x - 16)
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
  await expectNoOverlap(page)
})

// 1440px + AI 옆 패널 460px — 겹침 없음(≥16px).
test('1440px + AI 옆 패널 460px — 겹침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectNoOverlap(page)
})

// 1024px + AI 옆 패널 460px — 겹침 없음(≥16px).
test('1024px + AI 옆 패널 460px — 겹침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1024, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectNoOverlap(page)
})
