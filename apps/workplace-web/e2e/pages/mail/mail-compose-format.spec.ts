// 메일 작성 서식(WP-1524) — 브라우저가 있어야 판정되는 것만 둔다(jsdom 은 레이아웃·포인터 끌기·실제 색을 못 잰다).
// 512px 작성창의 둘째 줄 넘침·위치(@layout), 크게 보기에서 두 줄이 위에 붙는지(@layout), 표 격자 끌기(@input), 다크 대비(@layout).
// 서식 명령·HTML 출력·펼침 기억은 vitest(MailComposer.test.tsx 등)가 지킨다.
import type { Locator, Page } from '@playwright/test'

import { mailAccount } from '../../factories/mail.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { textContrast, withTheme } from '../../fixtures/contrast'

/** 메일 계정 1건 + 빈 INBOX 기본 모킹. */
async function mockMail(page: Page) {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await page.route(
    (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )
}

/** 새 메일 작성창을 열고 서식 토글을 눌러 둘째 줄을 펼친다. */
async function openComposeWithFormatRow(page: Page) {
  await page.goto('/mail/1')
  await page.getByTestId('mail-compose-new').click()
  await expect(page.getByTestId('mail-compose-dock')).toBeVisible()
  await page.getByTestId('mail-composer-toolbar').getByRole('button', { name: '서식' }).click()
  await expect(page.getByTestId('mail-composer-format-row')).toBeVisible()
}

/** 가로로 넘치지 않는지 — scrollWidth 가 clientWidth 이하. */
async function expectNoOverflowX(el: Locator) {
  const { sw, cw } = await el.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }))
  expect(sw, `scrollWidth ${sw} vs clientWidth ${cw}`).toBeLessThanOrEqual(cw)
}

test.describe('메일 작성 서식 (WP-1524)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mockMail(page)
  })

  test('512px 작성창에서 서식 둘째 줄이 넘치지 않고 1행 바로 아래 같은 폭으로 놓인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await openComposeWithFormatRow(page)
    const dock = (await page.getByTestId('mail-compose-dock').boundingBox())!
    expect(Math.round(dock.width)).toBe(512)

    const row1 = page.getByTestId('mail-composer-toolbar')
    const row2 = page.getByTestId('mail-composer-format-row')
    await expectNoOverflowX(row1)
    await expectNoOverflowX(row2)
    const b1 = (await row1.boundingBox())!
    const b2 = (await row2.boundingBox())!
    // 둘째 줄은 첫 줄 바로 아래(간격 gap-1.5 = 6px 안팎), 같은 x·같은 폭.
    expect(b2.y).toBeGreaterThanOrEqual(b1.y + b1.height)
    expect(b2.y - (b1.y + b1.height)).toBeLessThanOrEqual(8)
    expect(Math.abs(b2.x - b1.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(b2.width - b1.width)).toBeLessThanOrEqual(1)
  })

  test('크게 보기에서 두 줄이 함께 위에 붙어 본문을 스크롤해도 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await openComposeWithFormatRow(page)
    await page.getByRole('button', { name: '크게 보기' }).click()
    await expect(page.getByTestId('mail-compose-backdrop')).toBeVisible()
    const toolbars = page.getByTestId('mail-composer-toolbars')
    await expect(page.getByTestId('mail-composer-format-row')).toBeVisible()

    // 본문을 화면보다 길게 채운다.
    await page.getByTestId('mail-composer-body').click()
    for (let i = 0; i < 60; i++) await page.keyboard.press('Enter')
    await page.keyboard.type('맨 아래 줄')

    // 작성창 안 세로 스크롤 영역을 찾아 끝까지 내린다.
    const moved = await toolbars.evaluate((el) => {
      let n: HTMLElement | null = el.parentElement
      while (n && !(n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY))) n = n.parentElement
      if (!n) return -1
      n.scrollTop = n.scrollHeight
      return n.scrollTop
    })
    expect(moved, '스크롤 영역을 찾아 내렸다').toBeGreaterThan(0)

    // 스크롤했는데도 두 줄이 스크롤 영역 맨 위에 붙어 보인다(스크롤 영역 안쪽 여백 12px 만큼은 떨어진다).
    const scrollerTop = await toolbars.evaluate((el) => {
      let n: HTMLElement | null = el.parentElement
      while (n && !/(auto|scroll)/.test(getComputedStyle(n).overflowY)) n = n.parentElement
      return n!.getBoundingClientRect().top
    })
    const t = (await toolbars.boundingBox())!
    expect(t.y - scrollerTop, `toolbars top ${t.y} vs scroller top ${scrollerTop}`).toBeGreaterThanOrEqual(0)
    expect(t.y - scrollerTop).toBeLessThanOrEqual(16)
    await expect(page.getByTestId('mail-composer-toolbar')).toBeInViewport()
    await expect(page.getByTestId('mail-composer-format-row')).toBeInViewport()
  })

  test('표 격자를 끌어 3×4 를 고르면 머리글 1행 + 3행 4열 표가 들어가고, 칸에 커서를 두면 표 막대가 표 위에 뜬다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await openComposeWithFormatRow(page)
    await page.getByTestId('mail-composer-body').click()
    await page.getByTestId('mail-composer-format-row').getByRole('button', { name: '표 넣기' }).click()

    // 격자 끌기 — 1×1 에서 눌러 3행 4열 칸에서 뗀다.
    const from = page.getByRole('button', { name: '1행 1열 표' })
    const to = page.getByRole('button', { name: '3행 4열 표' })
    await expect(from).toBeVisible()
    const fb = (await from.boundingBox())!
    const tb = (await to.boundingBox())!
    await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
    await page.mouse.down()
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 })
    await page.mouse.up()

    const table = page.getByTestId('mail-composer-body').locator('table')
    await expect(table).toHaveCount(1)
    await expect(table.locator('tr')).toHaveCount(3)
    await expect(table.locator('tr').first().locator('th')).toHaveCount(4)
    await expect(table.locator('td')).toHaveCount(8)

    // 커서가 표 안(삽입 직후 첫 칸)이면 표 막대가 표 위에 뜬다.
    const bar = page.getByTestId('mail-table-toolbar')
    await expect(bar).toBeVisible()
    const bb = (await bar.boundingBox())!
    const tbl = (await table.boundingBox())!
    expect(bb.y + bb.height).toBeLessThanOrEqual(tbl.y + 1)
    // 작성창 표도 받는 사람이 보는 모양처럼 내용만큼의 폭이다 — 본문 전체 폭으로 늘지 않는다.
    const bodyBox = (await page.getByTestId('mail-composer-body').boundingBox())!
    expect(tbl.width, `table ${tbl.width} vs body ${bodyBox.width}`).toBeLessThan(bodyBox.width * 0.9)
  })

  test('다크 작성창에서 배경색 글자와 머리글 글자가 읽힌다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await withTheme(page, 'dark')
    await openComposeWithFormatRow(page)
    await expect(page.locator('html')).toHaveClass(/\bdark\b/)

    // 글자에 배경색(노랑 — 팔레트 중 밝은 쪽)을 칠한다.
    const body = page.getByTestId('mail-composer-body')
    await body.click()
    await page.keyboard.type('강조할 글자')
    await page.keyboard.press('ControlOrMeta+a')
    const row = page.getByTestId('mail-composer-format-row')
    await row.getByRole('button', { name: '배경색' }).click()
    await page.getByRole('menuitem', { name: '배경색 노랑' }).click()
    const marked = body.locator('span[style*="background-color"]').first()
    await expect(marked).toHaveText('강조할 글자')
    expect(await textContrast(marked)).toBeGreaterThanOrEqual(4.5)

    // 표 머리글(#f3f4f6 배경) 글자.
    await body.click()
    await page.keyboard.press('ControlOrMeta+End')
    await row.getByRole('button', { name: '표 넣기' }).click()
    await page.getByRole('button', { name: '2행 2열 표' }).click()
    const th = body.locator('th').first()
    await expect(th).toBeVisible()
    expect(await textContrast(th)).toBeGreaterThanOrEqual(4.5)
  })
})
