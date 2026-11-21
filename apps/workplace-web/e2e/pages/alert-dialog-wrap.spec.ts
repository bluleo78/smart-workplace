// 공용 확인창(AlertDialog) 긴 이름 줄바꿈 E2E (WP-1921, 백엔드 없이 page.route 모킹).
// 띄어쓰기 없는 긴 이름이 설명 안에서 창 테두리를 넘지 않는지는 jsdom 이 폭을 못 재서 브라우저(@layout)로만 판정된다.
// 짧은 설명 확인창의 겉모습(모바일 가운데 정렬·한 줄)이 공용 클래스 변경으로 바뀌지 않았는지도 함께 지킨다.
import type { Locator, Page } from '@playwright/test'

import { createSpace, personalSpace } from '../factories/drive.factory'
import { oauthConnection } from '../factories/oauth.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { boxOf } from '../fixtures/layout'

// 띄어쓰기 없는 60자 이상 이름 — 공백이 없어 줄바꿈 지점이 없는 최악의 경우.
const LONG_NAME = 'Very_Long_Unbroken_Space_Name_Without_Any_Spaces_ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'

// 드라이브 사이드바·DrivePage 가 요구하는 경로 모킹 후 공간 삭제 확인창을 연다.
async function openSpaceDeleteDialog(page: Page, spaceName: string): Promise<Locator> {
  const spaces = [personalSpace({ id: 1 }), createSpace({ id: 2, name: spaceName })]
  await page.route(
    (url) => url.pathname === '/api/v1/drive/quota',
    (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 } }),
  )
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (r) => (r.request().method() === 'GET' ? r.fulfill({ json: spaces }) : r.fallback()),
  )
  await page.route(
    (url) => /\/api\/v1\/drive\/spaces\/\d+\/items$/.test(url.pathname),
    (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { folders: [], files: [] } }) : r.fallback()),
  )
  await page.goto('/drive')
  await page.getByTestId('drive-space-menu-2').click()
  await page.getByTestId('drive-space-delete-2').click()
  const dialog = page.getByTestId('drive-space-delete-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

// 설명 오른쪽 끝이 창 오른쪽 끝을 넘지 않고, 설명 안에서 가로로 잘리지 않는다.
// 방금 연 확인창 안에서 찾는다 — 닫히는 중인 다른 확인창의 설명을 재지 않게.
async function expectDescriptionInsideDialog(dialog: Locator) {
  const description = dialog.locator('[data-slot=alert-dialog-description]')
  await expect(description).toBeVisible()
  const m = await description.evaluate((desc) => ({
    descRight: desc.getBoundingClientRect().right,
    contentRight: desc.closest('[data-slot=alert-dialog-content]')!.getBoundingClientRect().right,
    scrollWidth: desc.scrollWidth,
    clientWidth: desc.clientWidth,
  }))
  expect(m.descRight, `설명 right ${m.descRight} > 창 right ${m.contentRight}`).toBeLessThanOrEqual(m.contentRight + 0.5)
  expect(m.scrollWidth, `설명 scrollWidth ${m.scrollWidth} > clientWidth ${m.clientWidth}`).toBeLessThanOrEqual(m.clientWidth + 1)
}

test.describe('확인창 긴 이름 줄바꿈', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('띄어쓰기 없는 긴 공간 이름도 삭제 확인창 안에서 접힌다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const dialog = await openSpaceDeleteDialog(page, LONG_NAME)
    await expectDescriptionInsideDialog(dialog)
  })

  test('짧은 설명 확인창은 가운데 정렬이고 제목이 한 줄로 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const dialog = await openSpaceDeleteDialog(page, '팀 공간')
    const description = dialog.locator('[data-slot=alert-dialog-description]')
    const textAlign = await description.evaluate((el) => getComputedStyle(el).textAlign)
    expect(textAlign).toBe('center')
    // 제목이 글자 단위로 쪼개지지 않았는지(한 줄 높이) — 설명은 문장이 길어 두 줄일 수 있다.
    const titleHeight = (await boxOf(dialog.locator('[data-slot=alert-dialog-title]'))).height
    expect(titleHeight, `제목 높이 ${titleHeight}`).toBeLessThan(32)
  })

  test('연결된 앱 해제 확인창의 긴 앱 이름도 창 안에서 접힌다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/users/me/api-tokens', [])
    await mockApi(page, 'GET', '/api/v1/users/me/oauth-connections', [oauthConnection({ id: 1, clientName: LONG_NAME })])
    await page.goto('/settings/tokens')
    await page.getByTestId('oauth-connection-revoke-1').click()
    const dialog = page.getByTestId('oauth-connection-confirm-dialog')
    await expect(dialog).toBeVisible()
    await expectDescriptionInsideDialog(dialog)
  })
})
