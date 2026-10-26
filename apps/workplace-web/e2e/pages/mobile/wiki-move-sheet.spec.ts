// 모바일 노트 「이동…」(WP-839) — 행 ⋯ 시트에서 위치 고르기 시트를 열어, 누르면 바로 옮긴다.
import { expect, test } from '../../fixtures/mobile.fixture'
import { mockWikiMoveTree } from '../../fixtures/wiki-move-mock'


test('휴대폰 — ⋯ 시트의 「이동…」에서 위치를 누르면 바로 옮긴다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  const moves = await mockWikiMoveTree(page)
  await page.goto('/wiki/spaces/1')
  const list = page.getByTestId('mobile-module-list')
  await list.getByTestId('wiki-tree-row-3').getByRole('button', { name: '페이지 메뉴' }).tap()
  await page.getByTestId('wiki-tree-action-sheet').getByTestId('mobile-action-wiki-move').tap()
  const sheet = page.getByTestId('wiki-move-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('picker-option-2')).toContainText('지금 위치')
  await sheet.getByTestId('picker-option-4').tap()
  await expect.poll(() => moves.lastBody()).toEqual({ parentId: 4, position: 0 })
})
