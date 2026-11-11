// e2e/pages/layout/reuse-app-replaced-document.spec.ts
// 이어 쓰는 page 의 문서가 앞 테스트에서 덮였을 때 다음 테스트가 앱을 제대로 여는지(WP-1516).
// 왜: fixture(e2e/fixtures/reuse-app.ts)는 같은 워커의 다음 테스트에서 문서를 그대로 두고 앱만 다시 띄운다(__e2eRemount).
// 앞 테스트가 setContent·document.write 로 문서를 덮거나 data: 주소로 떠나면 옛 root 는 문서에서 떨어지고 head 에 앱 CSS 가 없어,
// 그대로 다시 띄우면 화면에 아무것도 보이지 않는다 — 다시 띄우기가 이를 알아채고 문서를 실제로 새로 여는지 본다.
// 순서가 곧 시나리오라 serial 로 한 워커·한 page 에서 차례로 돈다. 문서·CSS 적용은 jsdom 이 흉내 낼 수 없어 @platform.
import type { Page } from '@playwright/test'

import { expect, test } from '../../fixtures/auth.fixture'

test.describe.configure({ mode: 'serial' })

/** 앱 셸이 그려지는 가장 단순한 화면 — 목 없이 404 화면이 레일과 함께 뜬다. */
const APP_PATH = '/no-such-page'

/** 앱이 실제 문서에 붙어 그려졌는지 — 화면 요소가 보이고, root 가 문서에 붙어 있고, 앱 CSS 가 적용됐다. */
async function expectAppRendered(page: Page) {
  await expect(page.getByRole('main').getByRole('heading', { name: '404' })).toBeVisible()
  await expect(page.getByTestId('app-rail')).toBeVisible()
  const doc = await page.evaluate(() => ({
    rootConnected: document.getElementById('root')?.isConnected ?? false,
    styleSheets: document.styleSheets.length,
  }))
  expect(doc.rootConnected, '#root 가 지금 문서에 붙어 있다').toBe(true)
  expect(doc.styleSheets, '앱 CSS 가 문서에 있다').toBeGreaterThan(0)
}

test.describe('이어 쓰는 page 의 문서가 덮인 뒤', { tag: '@platform' }, () => {
  test('앱을 띄운 뒤 setContent 로 문서를 덮는다', async ({ authenticatedPage: page }) => {
    await page.goto(APP_PATH)
    await expectAppRendered(page)
    await page.setContent('<p>replaced</p>')
    await expect(page.getByText('replaced')).toBeVisible()
  })

  test('setContent 다음 테스트는 앱을 CSS 와 함께 실제 문서에 그린다', async ({ authenticatedPage: page }) => {
    await page.goto(APP_PATH)
    await expectAppRendered(page)
    // 다음 테스트를 위해 document.write 로 문서를 덮는다(setContent 와 다른 경로).
    await page.evaluate(() => {
      document.open()
      document.write('<p>x</p>')
      document.close()
    })
    await expect(page.getByText('x', { exact: true })).toBeVisible()
  })

  test('document.write 다음 테스트도 앱을 CSS 와 함께 실제 문서에 그린다', async ({ authenticatedPage: page }) => {
    await page.goto(APP_PATH)
    await expectAppRendered(page)
    // 다음 테스트를 위해 data: 주소로 떠난다 — 그 문서에는 다시 띄우기 함수(__e2eRemount)가 없다.
    await page.goto('data:text/html,<p>data</p>')
    await expect(page.getByText('data', { exact: true })).toBeVisible()
  })

  test('data: 주소 다음 테스트도 앱을 CSS 와 함께 실제 문서에 그린다', async ({ authenticatedPage: page }) => {
    await page.goto(APP_PATH)
    await expectAppRendered(page)
  })
})
