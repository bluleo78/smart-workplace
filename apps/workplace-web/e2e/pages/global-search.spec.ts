import { expect, test } from '../fixtures/auth.fixture'
import { measureBox } from '../fixtures/wait'

// global-search.spec.ts — 통합 검색 팔레트(WP-1353)의 브라우저 판정분.
// 탭 순서·묶음·키보드 이동·최근 검색·AI 요청 같은 동작은 vitest(src/components/search/SearchPalette.test.tsx)가 지킨다.
// 여기서는 jsdom 이 잴 수 없는 기하(트리거와 페이지 헤더 버튼이 겹치지 않음, 팔레트 폭·가운데)와
// 실제 키보드 입력(「/」 단축키, 입력 중 「/」 무시, Esc)만 본다. 한 글자·빈 입력은 요청을 보내지 않으므로 검색 API 모킹이 필요 없다.

for (const width of [1024, 1280]) {
  test(`${width}px 에서 검색 트리거는 페이지 헤더 버튼과 겹치지 않고 팔레트는 폭 680px 이하로 가운데 선다`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const header = page.getByTestId('canvas-header')
    await expect(header).toBeVisible()

    // 트리거 30px 원형 — TopCenterSlot 의 108px 계산과 맞물리는 크기.
    const toggle = page.getByTestId('global-search-toggle')
    const t = await measureBox(toggle, 'global-search-toggle')
    expect(Math.round(t.width)).toBe(30)
    expect(Math.round(t.height)).toBe(30)

    // 헤더 안 모든 보이는 버튼과 가로로 겹치지 않는다(세로가 겹치는 줄만 비교).
    await expect(async () => {
      const buttons = await header.getByRole('button').all()
      for (const b of buttons) {
        const box = await b.boundingBox()
        if (!box || box.width === 0) continue
        const overlapsX = box.x < t.x + t.width && box.x + box.width > t.x
        const overlapsY = box.y < t.y + t.height && box.y + box.height > t.y
        expect(overlapsX && overlapsY, `헤더 버튼(${box.x},${box.y})이 검색 트리거를 덮는다`).toBe(false)
      }
    }).toPass()

    await toggle.click()
    const palette = page.getByTestId('global-search')
    await expect(palette).toBeVisible()
    await expect(async () => {
      const p = await measureBox(palette, 'global-search')
      expect(p.width).toBeLessThanOrEqual(680)
      // 화면 가운데 — 좌우 여백이 같다(±2px).
      expect(Math.abs(p.x + p.width / 2 - width / 2)).toBeLessThanOrEqual(2)
    }).toPass()
  })
}

test('「/」 로 팔레트가 열리고 입력 중 「/」 는 글자로 들어가며 Esc 로 닫힌다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.getByTestId('global-search-toggle')).toBeVisible()
  await page.locator('body').press('/')
  const input = page.getByTestId('global-search-input')
  await expect(input).toBeFocused()

  // 입력 중의 「/」 는 단축키가 아니라 글자다(한 글자라 검색 요청도 가지 않는다).
  await page.keyboard.press('/')
  await expect(input).toHaveValue('/')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('global-search')).toHaveCount(0)
})

test('다른 입력칸에 글을 쓰는 중의 「/」 는 팔레트를 열지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('global-search-toggle')).toBeVisible()
  // 화면에 입력칸이 있다고 가정하지 않고 하나 심어 포커스를 둔다.
  await page.evaluate(() => {
    const el = document.createElement('input')
    el.id = 'probe-input'
    document.body.appendChild(el)
    el.focus()
  })
  await page.keyboard.press('/')
  await expect(page.locator('#probe-input')).toHaveValue('/')
  await expect(page.getByTestId('global-search')).toHaveCount(0)
})
