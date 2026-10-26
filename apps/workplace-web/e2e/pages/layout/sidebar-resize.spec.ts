// 앱 왼쪽 목록 폭 조절(WP-878) — 경계선을 끌어 폭을 바꾸고, 앱마다 따로 기억하며, 두 번 누르면 기본 폭으로 돌아간다.
// 실제 포인터·키보드 입력은 @input, 실제 폭(틀 채움·창 폭 상한·모바일 전체 폭) 측정은 @layout(WP-971).
// 두 공통 래퍼를 하나씩 본다: 채팅(ResponsiveModuleLayout)·연락처(MobileSidebarSheet). 범위·저장값 해석은 sidebarWidth.test.ts.
import type { Page } from '@playwright/test'

import { expect, stubChat, test } from '../../fixtures/mobile.fixture'

/** 목록 틀과 그 안 <aside> 의 실제 폭(px). 둘이 같아야 사이드바가 틀을 꽉 채운 것이다. */
async function widths(page: Page) {
  const frame = page.getByTestId('sidebar-frame')
  const frameW = (await frame.boundingBox())!.width
  const asideW = (await frame.locator('> aside').boundingBox())!.width
  return { frameW: Math.round(frameW), asideW: Math.round(asideW) }
}

/** 앱을 열고 목록 틀(손잡이)이 그려질 때까지 기다린다. */
async function openApp(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByTestId('sidebar-resize-handle')).toBeVisible()
}

/** 경계선 손잡이를 잡고 dx 만큼 끈다(실제 포인터 이벤트). */
async function dragHandle(page: Page, dx: number) {
  const box = (await page.getByTestId('sidebar-resize-handle').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y)
  await page.mouse.move(x + dx, y)
  await page.mouse.up()
}

test.describe('데스크톱', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('경계선을 끌면 목록이 넓어지고, 다시 열어도 그 폭이며 다른 앱 목록 폭은 그대로다 @smoke', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await openApp(page, '/chat')
    // 기본 폭은 예전 고정 폭(w-56)과 같다.
    expect(await widths(page)).toEqual({ frameW: 224, asideW: 224 })

    await dragHandle(page, 120)
    expect(await widths(page)).toEqual({ frameW: 344, asideW: 344 })
    // 끄는 동안 걸어 둔 커서·선택 막음은 손을 떼면 풀린다.
    expect(await page.evaluate(() => [document.body.style.cursor, document.body.style.userSelect])).toEqual(['', ''])

    await page.reload()
    await expect(page.getByTestId('sidebar-resize-handle')).toBeVisible()
    expect(await widths(page)).toEqual({ frameW: 344, asideW: 344 })

    // 앱마다 따로 기억 — 연락처는 손대지 않았으니 기본 폭.
    await openApp(page, '/contacts')
    expect(await widths(page)).toEqual({ frameW: 224, asideW: 224 })
  })

  test('최소·최대 폭을 넘겨 끌 수 없다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await openApp(page, '/chat')

    await dragHandle(page, 600)
    expect((await widths(page)).frameW).toBe(480)
    await dragHandle(page, -600)
    expect((await widths(page)).frameW).toBe(180)
  })

  test('경계선을 두 번 누르면 기본 폭으로 돌아가고 저장값도 지운다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await openApp(page, '/contacts')
    await dragHandle(page, 80)
    expect((await widths(page)).frameW).toBe(304)
    expect(await page.evaluate(() => localStorage.getItem('sidebar-width:contacts'))).toBe('304')

    await page.getByTestId('sidebar-resize-handle').dblclick()
    expect((await widths(page)).frameW).toBe(224)
    expect(await page.evaluate(() => localStorage.getItem('sidebar-width:contacts'))).toBeNull()
  })

  test('Tab 으로 경계선을 잡아 ←→ 로 한 칸씩, Home·End 로 최소·최대 폭으로 바꾼다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await page.goto('/contacts')
    const handle = page.getByRole('separator', { name: '목록 폭 조절' })
    await handle.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    expect((await widths(page)).frameW).toBe(256)
    await expect(handle).toHaveAttribute('aria-valuenow', '256')
    expect(await page.evaluate(() => localStorage.getItem('sidebar-width:contacts'))).toBe('256')
    await page.keyboard.press('End')
    expect((await widths(page)).frameW).toBe(480)
    await page.keyboard.press('Home')
    expect((await widths(page)).frameW).toBe(180)
  })

  test('움직이지 않은 클릭은 폭을 저장하지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await openApp(page, '/contacts')
    await page.getByTestId('sidebar-resize-handle').click()
    expect((await widths(page)).frameW).toBe(224)
    expect(await page.evaluate(() => localStorage.getItem('sidebar-width:contacts'))).toBeNull()
  })

  // 8개 앱 목록이 모두 틀을 꽉 채우는지 — 틀은 <aside> 직계 규약에 기대므로 앱마다 배선을 확인한다.
  // 앱 키(widthKey)와 모듈 루트 경로가 같다(/tasks → tasks).
  for (const key of ['tasks', 'chat', 'wiki', 'drive', 'settings', 'mail', 'contacts', 'calendar'] as const) {
    test(`/${key} 목록은 저장된 폭으로 틀을 채운다`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
      await page.addInitScript((k) => localStorage.setItem(`sidebar-width:${k}`, '300'), key)
      await openApp(page, `/${key}`)
      expect(await widths(page)).toEqual({ frameW: 300, asideW: 300 })
    })
  }
})

test.describe('좁은 데스크톱 창', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('저장 폭이 커도 앱 영역의 40% 를 넘지 않고, 거기서 끌면 보이는 폭부터 줄며 상한 밖으로는 저장하지 않는다', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => localStorage.setItem('sidebar-width:contacts', '480'))
    await openApp(page, '/contacts')
    // 앱 영역 = 틀의 부모 flex 줄(앱 레일 제외).
    const cap = await page.getByTestId('sidebar-frame').evaluate((el) => Math.floor(el.parentElement!.clientWidth * 0.4))
    expect(cap).toBeLessThan(480)
    expect(Math.abs((await widths(page)).frameW - cap)).toBeLessThanOrEqual(1)

    await dragHandle(page, -40)
    expect(Math.abs((await widths(page)).frameW - (cap - 40))).toBeLessThanOrEqual(1)
    // 상한 밖으로 끌어도 상한까지만 저장된다.
    await dragHandle(page, 200)
    expect(await page.evaluate(() => localStorage.getItem('sidebar-width:contacts'))).toBe(String(cap))
  })

  // WP-897: 손잡이는 저장값(480)이 아니라 보이는 폭과 그 화면에서 닿을 수 있는 최대를 알린다 — 새로고침 직후에도, 창을 넓혀도.
  test('경계선 손잡이는 저장 폭이 아니라 보이는 폭·이 화면의 상한을 알리고, 창을 넓히면 따라간다', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => localStorage.setItem('sidebar-width:contacts', '480'))
    await openApp(page, '/contacts')
    const handle = page.getByRole('separator', { name: '목록 폭 조절' })
    const cap = await page.getByTestId('sidebar-frame').evaluate((el) => Math.floor(el.parentElement!.clientWidth * 0.4))
    await expect(handle).toHaveAttribute('aria-valuenow', String(cap))
    await expect(handle).toHaveAttribute('aria-valuemax', String(cap))
    // 키를 누르지 않아도 맞는다 — 저장값은 그대로 480.
    expect(await page.evaluate(() => localStorage.getItem('sidebar-width:contacts'))).toBe('480')

    // 창을 넓히면 상한이 풀려 저장 폭 480 이 보이고 그대로 알린다.
    await page.setViewportSize({ width: 1600, height: 800 })
    await expect(handle).toHaveAttribute('aria-valuemax', '480')
    await expect(handle).toHaveAttribute('aria-valuenow', '480')
    expect((await widths(page)).frameW).toBe(480)
  })
})

test.describe('모바일', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('모바일 목록에는 폭 조절 손잡이가 없고 목록은 전체 폭이다', async ({ authenticatedPage: page }) => {
    await stubChat(page)
    // 데스크톱에서 넓혀 둔 값이 있어도 모바일 목록 폭에는 쓰이지 않는다.
    await page.addInitScript(() => localStorage.setItem('sidebar-width:chat', '400'))
    await page.goto('/chat')
    const list = page.getByTestId('mobile-module-list')
    await expect(list).toBeVisible()
    await expect(page.getByTestId('sidebar-resize-handle')).toHaveCount(0)
    expect(Math.round((await list.locator('> aside').boundingBox())!.width)).toBe(390)
  })
})
