// 도움말 패널 배치(WP-1505) — 데스크톱 오른쪽 도킹의 브라우저 판정.
// 나란히/위아래 판정 자체(isDockStacked)·열림 기억·이동은 vitest 가 지킨다. 여기엔 jsdom 이 잴 수 없는 것만 둔다:
// - @layout: 실제 상자 위치(본문 | 도움말 | AI 나란히, 한 칸에 위아래), 창 폭·레일 펼침에 따른 전환과 그 중간 프레임의 흔들림,
//   본문·헤더 단추·상단 「?」가 패널 밑으로 들어가지 않음(--help-side-width), 좁은 폭의 가로 넘침
// - @input: 실제 키보드·두 번 누르기로 패널 폭이 바뀌고 기억되는지(AI 패널 폭 손잡이 ai-panel-resize.spec 과 같은 방식)
// 도움말 묶음(/help/…)은 작은 목으로 준다 — 실제 매뉴얼 내용에 기대지 않게.
import type { Page } from '@playwright/test'

import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockHelpBundle } from '../../fixtures/help-bundle-mock'
import { expectNoHorizontalOverflow } from '../../fixtures/mobile.fixture'
import { measureBox, resizeAndSettle } from '../../fixtures/wait'

// 위아래 경계: 레일 접힘 56 + 도움말 기본 360 + AI 기본 380 + 본문 최소 640 = 1436px — 두 패널이 열린 채 이보다 좁으면 합친다.

/** 홈(도움말 장이 있는 주소)으로 가서 도움말 패널을 연다. */
async function openHelp(page: Page, path = '/') {
  await mockHelpBundle(page)
  await page.goto(path)
  await page.getByTestId('help-toggle').click()
  await expect(page.getByTestId('help-panel')).toBeVisible()
}

/** 상단 칩으로 AI 사이드 패널을 연다. */
async function openAi(page: Page) {
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
}

/** 프로젝트 화면 — 헤더 오른쪽에 단추가 여럿 있어 상단 틀·패널과의 겹침을 보기 좋다(top-center.spec 과 같은 목). */
async function stubProject(page: Page) {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP', name: '프로젝트' }))
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
}

/** 본문(main)·도움말·AI 상자를 같은 순간에 잰다. */
async function boxes(page: Page) {
  return {
    main: await measureBox(page.locator('main#main-content'), 'main'),
    help: await measureBox(page.getByTestId('help-panel'), 'help-panel'),
    ai: await measureBox(page.getByTestId('ai-side-panel'), 'ai-side-panel'),
  }
}

/** 나란히 — 「본문 | 도움말 | AI」가 겹치지 않고 붙어 있으며 위끝이 같다. */
async function expectSideBySide(page: Page) {
  await expect(page.getByTestId('right-dock-stacked')).toHaveCount(0)
  await expect(async () => {
    const { main, help, ai } = await boxes(page)
    expect(main.x + main.width, '본문 오른쪽 ≤ 도움말 왼쪽').toBeLessThanOrEqual(help.x + 0.5)
    expect(Math.abs(help.x + help.width - ai.x), '도움말 오른쪽 = AI 왼쪽').toBeLessThanOrEqual(1)
    expect(Math.abs(help.y - ai.y), '두 패널 위끝').toBeLessThanOrEqual(1)
    expect(ai.x + ai.width, 'AI 는 창 오른쪽 끝').toBeCloseTo(page.viewportSize()!.width, 0)
  }).toPass()
}

/** 위아래 — 한 칸에 도움말(위)·AI(아래), 같은 x·같은 폭, 본문은 그 칸 왼쪽. */
async function expectStacked(page: Page) {
  await expect(page.getByTestId('right-dock-stacked')).toBeVisible()
  await expect(async () => {
    const { main, help, ai } = await boxes(page)
    const column = await measureBox(page.getByTestId('right-dock-stacked'), 'right-dock-stacked')
    expect(help.y + help.height, '도움말 아래끝 ≤ AI 위끝').toBeLessThanOrEqual(ai.y + 0.5)
    expect(Math.abs(help.x - ai.x), '두 패널 x').toBeLessThanOrEqual(1)
    expect(Math.abs(help.width - ai.width), '두 패널 폭').toBeLessThanOrEqual(1)
    expect(main.x + main.width, '본문 오른쪽 ≤ 합친 칸 왼쪽').toBeLessThanOrEqual(column.x + 0.5)
  }).toPass()
}

/**
 * action 을 누른 뒤 ms 동안 매 프레임 위아래(stacked) 여부와 레일 폭을 기록한다 — 레일 펼침처럼 폭이 애니메이션으로 바뀌는 동안
 * 판정이 경계에서 오락가락하지 않는지 보려고. 판정 기록은 바뀐 순간만 남겨 [처음, 바뀐 값…] 꼴로, 레일 폭은 프레임마다 돌려준다.
 */
async function sampleStackedDuring(page: Page, action: () => Promise<void>, ms = 600) {
  const sampling = page.evaluate((windowMs) => new Promise<{ runs: boolean[]; railWidths: number[] }>((resolve) => {
    const onClick = () => {
      document.removeEventListener('click', onClick, true)
      const runs: boolean[] = []
      const railWidths: number[] = []
      const start = performance.now()
      const sample = () => {
        const stacked = document.querySelector('[data-testid="right-dock-stacked"]') !== null
        if (runs[runs.length - 1] !== stacked) runs.push(stacked)
        const rail = document.querySelector<HTMLElement>('[data-testid="app-rail"]')
        if (rail) railWidths.push(rail.getBoundingClientRect().width)
        if (performance.now() - start < windowMs) requestAnimationFrame(sample)
        else resolve({ runs, railWidths })
      }
      sample()
    }
    document.addEventListener('click', onClick, true)
  }), ms)
  await action()
  return sampling
}

/**
 * 공통 fixture 가 넣은 애니메이션 끄기 style(data-test-no-animation)을 뗀다 — 레일 폭이 한 프레임에 끝까지 가 버리면
 * 「애니메이션 중간 프레임에도 판정이 흔들리지 않음」을 볼 수 없어서. 지금 문서에만 적용된다(새로 열면 다시 깔린다).
 * 이어 쓰는 page(WP-1002)에 남지 않도록, 부르는 테스트는 page.addInitScript 를 써서 끝나면 컨텍스트가 버려지게 한다.
 */
async function restoreAnimations(page: Page) {
  await page.evaluate(() => document.querySelectorAll('style[data-test-no-animation]').forEach((el) => el.remove()))
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('style[data-test-no-animation]').length)).toBe(0)
}

/** 레일 폭 기록에 접힘(56)과 펼침(152) 사이 중간 값이 있었는지 — 애니메이션이 실제로 돌았다는 증거. */
function sawMidFrame(railWidths: number[]) {
  return railWidths.some((w) => w > 57 && w < 151)
}

test('두 패널을 열면 넓은 화면은 나란히, 창을 좁히면 위아래로 합치고 넓히면 나란히로 돌아온다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await openHelp(page)
  await openAi(page)
  await expectSideBySide(page)

  await resizeAndSettle(page, { width: 1280, height: 900 })
  await expectStacked(page)
  await expectNoHorizontalOverflow(page)

  await resizeAndSettle(page, { width: 1920, height: 900 })
  await expectSideBySide(page)
})

test('레일을 펼쳐 본문이 640px 아래로 좁아지면 위아래로 한 번만 바뀌고, 접으면 나란히로 한 번만 돌아온다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 1480: 접힌 레일(56)이면 본문 1480−56−360−380 = 684 로 나란히, 펼친 레일(152)이면 588 로 위아래.
  await page.addInitScript(() => window.localStorage.setItem('app-rail-expanded', 'false'))
  await page.setViewportSize({ width: 1480, height: 900 })
  await openHelp(page)
  await openAi(page)
  await expectSideBySide(page)
  await restoreAnimations(page)

  // 레일 폭은 200ms 동안 56 → 152 로 늘어난다 — 그 사이 프레임마다 판정해도 나란히 → 위아래 한 번뿐이어야 한다.
  const expanding = await sampleStackedDuring(page, () => page.getByTestId('rail-toggle').click())
  // 중간 프레임이 없으면 애니메이션이 꺼진 채라 흔들림을 보지 못한 것이다 — 그때는 실패시킨다.
  expect(sawMidFrame(expanding.railWidths), `펼치는 동안 레일 중간 폭 관측(기록 ${expanding.railWidths.map(Math.round).join(',')})`).toBe(true)
  expect(expanding.runs, '펼치는 동안 판정 기록(나란히 → 위아래 한 번)').toEqual([false, true])
  await expectStacked(page)

  const collapsing = await sampleStackedDuring(page, () => page.getByTestId('rail-collapse').click())
  expect(sawMidFrame(collapsing.railWidths), `접는 동안 레일 중간 폭 관측(기록 ${collapsing.railWidths.map(Math.round).join(',')})`).toBe(true)
  expect(collapsing.runs, '접는 동안 판정 기록(위아래 → 나란히 한 번)').toEqual([true, false])
  await expectSideBySide(page)
})

for (const width of [1440, 1024]) {
  test(`${width}px 에서 도움말 패널은 본문·헤더 단추·상단 「?」를 가리지 않는다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 900 })
    await stubProject(page)
    await openHelp(page, '/projects/WP')
    await expect(page.getByTestId('page-header').locator('[data-ai-actions]')).toBeVisible()

    await expect(async () => {
      const main = await measureBox(page.locator('main#main-content'), 'main')
      const help = await measureBox(page.getByTestId('help-panel'), 'help-panel')
      const toggle = await measureBox(page.getByTestId('help-toggle'), 'help-toggle')
      expect(main.x + main.width, '본문 오른쪽 ≤ 도움말 왼쪽').toBeLessThanOrEqual(help.x + 0.5)
      // 상단 가운데 틀은 body 에 뜬 fixed 요소라 --help-side-width 를 빼지 않으면 패널 위로 넘어간다.
      expect(toggle.x + toggle.width, '상단 「?」 오른쪽 ≤ 도움말 왼쪽').toBeLessThanOrEqual(help.x)
    }).toPass()

    // 헤더 오른쪽 단추마다 가운데 점의 맨 위 요소가 그 단추(또는 그 안) — 패널·상단 틀에 덮이지 않는다.
    const covered = await page.getByTestId('page-header').locator('[data-ai-actions]').evaluate((group) =>
      [...group.querySelectorAll<HTMLElement>('button, a')]
        .filter((el) => el.getBoundingClientRect().width > 0 && !el.parentElement?.closest('button, a'))
        .filter((el) => {
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return !(hit && el.contains(hit))
        })
        .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName))
    expect(covered, '덮인 헤더 단추').toEqual([])
    await expectNoHorizontalOverflow(page)
  })
}

test('도움말 패널 폭을 가장 넓혀도 상단 「?」는 패널 왼쪽에 머문다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('help-panel-width', '600'))
  await page.setViewportSize({ width: 1024, height: 900 })
  await stubProject(page)
  await openHelp(page, '/projects/WP')

  await expect(async () => {
    const help = await measureBox(page.getByTestId('help-panel'), 'help-panel')
    const toggle = await measureBox(page.getByTestId('help-toggle'), 'help-toggle')
    expect(Math.round(help.width), '기억한 폭').toBe(600)
    expect(toggle.x + toggle.width, '상단 「?」 오른쪽 ≤ 도움말 왼쪽').toBeLessThanOrEqual(help.x)
  }).toPass()
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--help-side-width'))).toBe('600px')
  await expectNoHorizontalOverflow(page)

  // AI 까지 열면 1024 는 위아래 — 합친 칸 폭은 AI 폭이고 --help-side-width 는 지워져 칩 계산이 --ai-side-width 하나로 맞는다.
  await openAi(page)
  await expectStacked(page)
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--help-side-width'))).toBe('')
  await expect(async () => {
    const column = await measureBox(page.getByTestId('right-dock-stacked'), 'right-dock-stacked')
    const toggle = await measureBox(page.getByTestId('help-toggle'), 'help-toggle')
    expect(toggle.x + toggle.width, '상단 「?」 오른쪽 ≤ 합친 칸 왼쪽').toBeLessThanOrEqual(column.x)
  }).toPass()
  await expectNoHorizontalOverflow(page)
})

test('Shift+Tab 으로 도움말 경계선을 잡아 ← 로 넓히고 Home·End·두 번 누르기로 바꾼 폭을 새로고침 뒤에도 기억한다', { tag: ['@input', '@platform'] }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openHelp(page)
  const panelWidth = async () => Math.round((await page.getByTestId('help-panel').boundingBox())!.width)
  const handle = page.getByRole('separator', { name: '도움말 패널 폭 조절' })
  await expect(handle).toHaveAttribute('aria-valuenow', '360')

  // 경계선은 패널의 첫 탭 정지점이다 — 패널 안 첫 조작 요소에서 Shift+Tab 한 번이면 경계선에 닿는다(실제 탭 순서).
  await page.getByTestId('help-panel').locator(':is(button, a[href], input, textarea, select)').first().focus()
  await page.keyboard.press('Shift+Tab')
  await expect(handle).toBeFocused()
  // 왼쪽 경계 손잡이 — ← 는 경계선을 왼쪽으로 옮겨 패널이 넓어진다(한 번에 16px).
  await page.keyboard.press('ArrowLeft')
  await expect.poll(panelWidth).toBe(376)
  await page.keyboard.press('End')
  await expect.poll(panelWidth).toBe(600)
  await page.keyboard.press('Home')
  await expect.poll(panelWidth).toBe(320)
  expect(await page.evaluate(() => localStorage.getItem('help-panel-width'))).toBe('320')
  // 상단 「?」 위치 계산이 읽는 폭도 함께 바뀐다.
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--help-side-width'))).toBe('320px')

  // 새로고침해도 열림·폭이 그대로다.
  await page.reload()
  await expect(page.getByTestId('help-panel')).toBeVisible()
  await expect.poll(panelWidth).toBe(320)

  await page.getByTestId('help-resize-handle').dblclick()
  await expect.poll(panelWidth).toBe(360)
  expect(await page.evaluate(() => localStorage.getItem('help-panel-width'))).toBe('360')
})
