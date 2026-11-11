// top-center.spec.ts — 상단 AI 칩·검색·도움말(「?」, WP-1505) 단추 위치(WP-1415)의 브라우저 판정.
// 틀의 오른쪽 끝은 맨 오른쪽 「?」 단추다 — 액션과의 간격은 그 단추에서 잰다.
// 세로 가운데·겹침(오른쪽 단추 앞 16px)·동그라미(32px). 프로젝트 머리줄은 접는 보조 단추가 없어(설정은 늘 보이는 액션, WP-1477)
// 좁아지면 접힘(⋯) 없이 AI 칩만 동그라미로 줄어든다 — 접힘이 나타나면 회귀다.
// jsdom 이 잴 수 없는 기하(실측 위치·겹침·단계 안정성)만 본다. 내부 밀도 상태는 판정에 쓰지 않는다.
import type { Page } from '@playwright/test'

import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { expectStays, measureBox, nextFrame } from '../../fixtures/wait'

/** 프로젝트 화면으로 이동 — 헤더에 설정(보조) + 새 태스크(주) 단추가 있다(사이클·버전·타임라인은 탭 줄, WP-1477). */
async function gotoProject(page: Page) {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP', name: '프로젝트' }))
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  await page.goto('/projects/WP')
  // 머리줄·탭 줄이 실제로 그려질 때까지 기다린 뒤 잰다. AI 칩·검색은 body 포털이라 페이지(지연 로딩되는 탭 레이아웃·이슈 탭)보다
  // 먼저 보인다 — 머리줄이 없을 때 단계 판정을 시작하면 실패 원인이 「단계가 틀렸다」로 잘못 보인다. 이슈 탭이 골라져 있으면
  // 마지막 탭 기억(WP-1477)이 다른 탭으로 보내지 않은 이슈 화면 머리줄이다.
  await expect(page.getByRole('navigation', { name: '프로젝트 탭' }).getByRole('link', { name: '이슈' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('page-header').locator('[data-ai-actions]')).toBeVisible()
}

/** 1024px + AI 옆 패널 460px — 제목 자리가 가장 좁아 AI 칩이 동그라미가 되는 상태로 연다. */
async function openNarrowProject(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1024, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'circle')
}

/** 헤더 세로 가운데(28px) 기준 — 칩·검색의 세로 가운데가 이 값과 ±0.5px 이내인지. */
const HEADER_CENTER = 28

/** 전환 중 서로 다른 프레임을 섞지 않도록 틀 오른쪽 끝(「?」)·액션 간격을 같은 레이아웃에서 잰다. */
async function actionGap(page: Page) {
  const actions = page.getByTestId('page-header').locator('[data-ai-actions]')
  return actions.evaluate((element) => {
    const help = document.querySelector('[data-testid="help-toggle"]')
    const chip = document.querySelector('[data-testid="chat-launcher"]')
    const frame = help?.getBoundingClientRect().width ? help : chip
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
        const help = document.querySelector('[data-testid="help-toggle"]')!
        const actions = document.querySelector('[data-testid="page-header"] [data-ai-actions]')!
        gaps.push(actions.getBoundingClientRect().left - help.getBoundingClientRect().right)
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
    <div data-testid="help-toggle" style="position:fixed;left:0;top:32px;width:100px;height:10px"></div>
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

/**
 * 프로젝트 머리줄 액션 — 설정(테두리 단추) + 새 태스크(주 단추). 사이클·버전·타임라인은 탭 줄로 옮겼다(WP-1477).
 * 접는 보조 단추가 없으니 펼침·동그라미 어느 단계에서도 이 둘이 그대로 보여야 한다.
 */
const HEADER_ACTIONS = ['설정', '새 태스크']

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
  // 접기 틀(MobileHeaderMore — ⋯ 또는 한 항목 인라인)이 데스크톱 머리줄에 나타나면 'folded' — 어느 테스트도 기대하지 않으므로 회귀로 잡힌다.
  const header = page.getByTestId('page-header')
  const foldFrames = await header.getByTestId('mobile-header-more').count() + await header.getByTestId('mobile-header-inline-action').count()
  if (foldFrames > 0) return 'folded'
  expect(actions.labels, '머리줄 액션 단추(접힘 없음)').toEqual(HEADER_ACTIONS)
  if (Math.abs(chip.width - 32) < 0.5) return 'circle'
  expect(chip.width, '펼친 단계의 AI 알약 폭').toBeCloseTo(140, 0)
  return 'expanded'
}

/** CSS 위치 전환까지 끝난 뒤 기대 단계를 확인한다. */
async function expectStage(page: Page, stage: Stage) {
  await expect(async () => expect(await renderedStage(page)).toBe(stage)).toPass()
  await expectNoOverlap(page)
}

test('가장 좁아 AI 칩이 동그라미가 돼도 설정은 ⋯·인라인 링크로 접히지 않고 테두리 단추로 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openNarrowProject(page)
  // 옛 머리줄(보조 단추 넷)은 여기서 ⋯ 로 접혔다. 이제 보조 단추가 없어(WP-1477) 접기 틀이 아예 없고, 설정은 원래 단추 그대로 보인다.
  const header = page.getByTestId('page-header')
  await expect(header.getByTestId('mobile-header-more')).toHaveCount(0)
  await expect(header.getByTestId('mobile-header-inline-action')).toHaveCount(0)
  const settings = header.locator('[data-ai-actions]').getByRole('link', { name: '설정' })
  await expect(settings).toBeVisible()
  await expect(settings).toHaveAttribute('href', '/projects/WP/settings')
  // 테두리 단추 모양(Button variant=outline 의 border) 그대로 — 접기 틀의 인라인 링크는 테두리를 걷는다.
  expect(await settings.evaluate((el) => getComputedStyle(el).borderTopWidth)).not.toBe('0px')
})

/** 실제 손잡이를 끄는 중에도 각 프레임의 「?」·액션 사이 16px 간격을 확인한다. */
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

// 1440px 패널 닫힘 — 칩·검색·「?」 세로 가운데 = 헤더 가운데(28px) ±0.5px, 검색 → 「?」 는 8px 간격으로 나란하다.
test('1440px 패널 닫힘 — 칩·검색·도움말 세로 가운데', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoProject(page)
  const chip = page.getByTestId('chat-launcher')
  const search = page.getByTestId('global-search-toggle')
  const help = page.getByTestId('help-toggle')
  await expect(chip).toBeVisible()
  await expect(search).toBeVisible()
  await expect(help).toBeVisible()
  await expectStage(page, 'expanded')
  await expect(async () => {
    const [c, s, h] = [await measureBox(chip, 'chat-launcher'), await measureBox(search, 'global-search-toggle'), await measureBox(help, 'help-toggle')]
    expect(Math.abs(c.y + c.height / 2 - HEADER_CENTER), '칩 세로 가운데').toBeLessThanOrEqual(0.5)
    expect(Math.abs(s.y + s.height / 2 - HEADER_CENTER), '검색 세로 가운데').toBeLessThanOrEqual(0.5)
    expect(Math.abs(h.y + h.height / 2 - HEADER_CENTER), '도움말 세로 가운데').toBeLessThanOrEqual(0.5)
    expect(h.width, '도움말 단추 폭').toBeCloseTo(32, 0)
    expect(h.x - (s.x + s.width), '검색과 도움말 사이 간격').toBeCloseTo(8, 0)
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
// 머리줄 액션이 설정·새 태스크 둘(약 169px)로 줄어 제목 자리가 160px 이상 남으므로(약 247px — 상단 가운데 「?」 자리 40px 를 뺀 값, WP-1505)
// 접지도 줄이지도 않는다(WP-1477).
// 옛 머리줄(단추 다섯, 약 360px)에서는 여기서 보조 단추가 접혔다.
test('1440px + AI 옆 패널 460px — 겹침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'expanded')
})

// 1024px + AI 옆 패널 460px — 겹침 없음(≥16px).
test('1024px + AI 옆 패널 460px — 동그라미가 레일을 가리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
// 세 폭 모두 제목 자리가 약 175~215px — 동그라미로 줄이는 기준(160 미만)과 되돌리는 기준(268 초과) 사이 이력 구간이라
// 왕복이 생긴다면 여기서 생긴다. 접는 보조 단추가 없어(WP-1477) 이 구간의 단계는 접힘이 아니라 펼친 알약이다.
// 상단 가운데에 「?」 자리 40px 가 더해져(WP-1505) 예전 1180px 은 제목 자리 약 155px 로 동그라미가 되므로 1220px 로 바꿨다.
// 1280px 이상은 2차 사이드바가 펼쳐져(WP-506) 제목 자리가 오히려 좁아지니 폭을 그보다 키우지 않는다.
for (const width of [1200, 1220, 1240]) {
  test(`${width}px + AI 옆 패널 460px — 펼친 알약 단계가 3초간 안정적이다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
    await page.setViewportSize({ width, height: 900 })
    await gotoProject(page)
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await expectStage(page, 'expanded')
    // 부재 확인: 재시도 없이 50ms마다 실측해 리뷰의 3초 왕복 창 전체에서 단계 변화를 잡는다.
    await expectStays(page, () => renderedStage(page), 'expanded', { ms: 3000, message: '펼친 알약 단계 유지' })
    await expectNoOverlap(page)
  })
}

// 1420px 에서 320px 는 제목 자리 약 356px, 460px 은 약 227px 로 이력 구간 안이라 펼친 채 남고(옛 머리줄은 여기서 접혔다),
// 600px 에서 160 밑(약 87px)으로 떨어져 동그라미가 된다(WP-1477). 값은 「?」 자리 40px 를 뺀 실측(WP-1505) — 단계는 그대로라 폭을 바꾸지 않았다.
test('1420px에서 패널을 끄는 동안 16px 간격을 지키고 펼침 → 펼침 → 동그라미 → 펼침으로 복귀한다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '320'))
  await page.setViewportSize({ width: 1420, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'expanded')
  await dragPanelTo(page, 460)
  await expectStage(page, 'expanded')
  await dragPanelTo(page, 600)
  await expectStage(page, 'circle')
  await dragPanelTo(page, 320)
  await expectStage(page, 'expanded')
})

// 1200px + 460px 는 펼친 알약(제목 자리 약 175px — 「?」 자리 40px 를 뺀 값, WP-1505). 레일을 펼치면(+96px) 160 밑으로 떨어져 동그라미,
// 접으면 동그라미로 잰 제목 자리(약 283px)가 268 을 넘어 다시 펼침(WP-1477 — 옛 머리줄은 접힘 단계였다).
test('레일을 펼치고 접을 때 16px 간격과 동그라미 단계 전환이 안정적이다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '460'))
  await page.setViewportSize({ width: 1200, height: 900 })
  await gotoProject(page)
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('ai-side-panel')).toBeVisible()
  await expectStage(page, 'expanded')
  await expectNoOverlapDuring(page, () => page.getByTestId('rail-toggle').click())
  await expectStage(page, 'circle')
  await expectStays(page, () => renderedStage(page), 'circle', { ms: 3000, message: '레일 펼친 동그라미 단계 유지' })
  await expectNoOverlapDuring(page, () => page.getByTestId('rail-collapse').click())
  await expectStage(page, 'expanded')
})
