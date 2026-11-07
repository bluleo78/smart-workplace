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

/** 패널을 연 접힌 상태에서 메뉴의 실제 목적지와 키보드 동작을 검사한다. */
async function openFoldedProject(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'folded')
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

/** 클릭 가능 대기 길이와 무관하게 dispatch 뒤 500ms 동안 매 프레임의 레일 겹침을 잡는다. */
async function expectNoOverlapDuring(page: Page, action: () => Promise<void>) {
  const sampling = page.evaluate(() => new Promise<number[]>((resolve) => {
    const gaps: number[] = []
    const onActionClick = () => {
      document.removeEventListener('click', onActionClick, true)
      const start = performance.now()
      const sample = () => {
        const search = document.querySelector('[data-testid="global-search-toggle"]')!
        const actions = document.querySelector('[data-testid="page-header"] [data-ai-actions]')!
        gaps.push(actions.getBoundingClientRect().left - search.getBoundingClientRect().right)
        if (performance.now() - start < 500) requestAnimationFrame(sample)
        else resolve(gaps)
      }
      requestAnimationFrame(sample)
    }
    document.addEventListener('click', onActionClick, true)
  }))
  await action()
  expect(Math.min(...await sampling), '전환 중 모든 프레임의 최소 간격').toBeGreaterThanOrEqual(16)
}

test('레이아웃 샘플은 클릭 가능 대기 뒤의 전환 프레임도 잡는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setContent(`
    <button data-testid="probe">전환</button>
    <div data-testid="global-search-toggle" style="position:fixed;left:0;top:32px;width:100px;height:10px"></div>
    <header data-testid="page-header"><div data-ai-actions style="position:fixed;left:116px;top:32px;width:100px;height:10px"></div></header>
  `)
  await page.evaluate(() => {
    const target = document.querySelector<HTMLButtonElement>('[data-testid="probe"]')!
    const actions = document.querySelector<HTMLElement>('[data-ai-actions]')!
    const box = target.getBoundingClientRect()
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:fixed;z-index:9999;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`
    document.body.append(overlay)
    window.setTimeout(() => overlay.remove(), 650)
    target.addEventListener('click', () => {
      actions.style.left = '80px'
      window.setTimeout(() => { actions.style.left = '116px' }, 150)
    }, { once: true })
  })

  let failure: unknown
  try {
    await expectNoOverlapDuring(page, () => page.getByTestId('probe').click())
  } catch (error) {
    failure = error
  }
  expect(failure, '지연된 click 뒤의 간격 위반을 샘플러가 검출한다').toBeInstanceOf(Error)
  expect((failure as Error).message).toContain('전환 중 모든 프레임의 최소 간격')
})

type Stage = 'expanded' | 'folded' | 'circle'

/** 펼친 헤더의 보조 단추 + 주 단추 — 접히면 보조 넷이 「더보기」 하나로 들어간다. */
const EXPANDED_ACTIONS = ['사이클', '버전', '타임라인', '설정', '새 태스크']

/**
 * 액션 그룹 안에서 실제로 그려진(폭이 있는) 단추의 글자와, 그 단추 폭의 합 + 단추 사이 flex 간격을 같은 프레임에서 잰다.
 * 단추 글자 폭은 OS·글꼴마다 몇 px 씩 달라 그룹 폭을 고정값으로 비교하면 환경에 따라 늘 실패한다(WP-1441 — macOS 에서 153 기대, 149.25).
 * 대신 「보이는 단추가 무엇인가」와 「그룹 폭 = 보이는 단추 폭 합 + 간격」(숨긴 채 자리만 차지하는 단추가 없다 — 단추 사이에 끼어도)으로 같은 회귀를 잡는다.
 */
async function measureActions(page: Page) {
  return page.getByTestId('page-header').locator('[data-ai-actions]').evaluate((group) => {
    const visible = [...group.querySelectorAll<HTMLElement>('button, a')]
      .filter((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter((el) => !el.parentElement?.closest('button, a'))
    const rects = visible.map((el) => el.getBoundingClientRect())
    const groupRect = group.getBoundingClientRect()
    return {
      labels: visible.map((el) => (el.getAttribute('data-testid') === 'mobile-header-more' ? '더보기' : (el.textContent ?? '').replace(/^\+\s*/, '').trim())),
      width: groupRect.width,
      // 단추가 그룹의 직계 자식이 아니어도(더보기는 감싼 요소 안) 간격은 그룹의 column-gap 하나다.
      expected: rects.reduce((sum, r) => sum + r.width, 0) + Math.max(0, rects.length - 1) * (parseFloat(getComputedStyle(group).columnGap) || 0),
    }
  })
}

/** 화면의 칩·보조 메뉴로 단계를 구분한다. 잠깐 숨기거나 내부 상태만 바꾼 회귀도 잡는다. */
async function renderedStage(page: Page): Promise<Stage> {
  const chip = await measureBox(page.getByTestId('chat-launcher'), 'chat-launcher')
  const actions = await measureActions(page)
  expect(actions.width, '액션 그룹 폭 = 보이는 단추 폭 합 + 간격(숨긴 단추가 자리를 차지하지 않음)').toBeCloseTo(actions.expected, 0)
  const more = page.getByTestId('mobile-header-more')
  if (await more.isVisible()) {
    const menu = await measureBox(more, '보조 단추 더보기')
    expect(menu.width, '접힌 보조 메뉴 폭').toBeCloseTo(44, 0)
    expect(actions.labels, '접힌 액션 그룹 단추').toEqual(['더보기', '새 태스크'])
    if (Math.abs(chip.width - 32) < 0.5) return 'circle'
    expect(chip.width, '접힌 단계의 AI 알약 폭').toBeCloseTo(140, 0)
    return 'folded'
  }
  expect(actions.labels, '펼친 액션 그룹 단추').toEqual(EXPANDED_ACTIONS)
  expect(chip.width, '펼친 단계의 AI 알약 폭').toBeCloseTo(140, 0)
  return 'expanded'
}

/** CSS 위치 전환까지 끝난 뒤 기대 단계를 확인한다. */
async function expectStage(page: Page, stage: Stage) {
  await expect(async () => expect(await renderedStage(page)).toBe(stage)).toPass()
  await expectNoOverlap(page)
}

test('접힌 보조 메뉴는 네 목적지마다 메뉴 항목 하나만 렌더한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openFoldedProject(page)
  await page.getByTestId('mobile-header-more').click()

  const menu = page.getByTestId('mobile-header-more-menu')
  const items = menu.getByRole('menuitem')
  await expect(items).toHaveCount(4)
  const destinations = await items.evaluateAll((elements) =>
    elements.map((element) => element instanceof HTMLAnchorElement ? element.getAttribute('href') : null),
  )
  expect(destinations).toEqual([
    '/projects/WP/cycles',
    '/projects/WP/versions',
    '/projects/WP/timeline',
    '/projects/WP/settings',
  ])
})

test('접힌 보조 메뉴는 목적지마다 한 번씩 이동하고 Esc 로 닫혀 AI 패널을 유지한다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await openFoldedProject(page)
  const trigger = page.getByTestId('mobile-header-more')
  await trigger.focus()
  await page.keyboard.press('Enter')

  const menu = page.getByTestId('mobile-header-more-menu')
  const items = menu.getByRole('menuitem')
  const destinations = [
    '/projects/WP/cycles',
    '/projects/WP/versions',
    '/projects/WP/timeline',
    '/projects/WP/settings',
  ]
  await expect(items).toHaveCount(destinations.length)
  await expect(items.nth(0)).toBeFocused()
  for (let index = 1; index < destinations.length; index += 1) {
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(index)).toBeFocused()
    await expect(items.nth(index)).toHaveAttribute('href', destinations[index])
  }

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expect(trigger).toBeFocused()
})

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
