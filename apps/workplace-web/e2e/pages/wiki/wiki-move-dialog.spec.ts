// 노트 사이드바 「이동…」(WP-839) — 끌기 없이 키보드로 페이지를 다른 페이지 하위에 넣는다. 휴대폰은 같은 목록을 선택 시트로.
// 자기·하위 페이지가 옮길 자리에서 빠지는지는 src/pages/wiki/wikiSidebar.test.tsx 가 지킨다(WP-983). 여기엔 키보드 조작(@input)만 남는다.
import { expect, test } from '../../fixtures/auth.fixture'
import { mockWikiMoveTree } from '../../fixtures/wiki-move-mock'

test('키보드로 ⋯ → 「이동…」 → 위치를 골라 옮기면 고른 페이지의 맨 아래 하위로 PATCH 한다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  const moves = await mockWikiMoveTree(page)
  await page.goto('/wiki/spaces/1')
  const row = page.getByTestId('wiki-tree-row-7')
  // 키보드만으로 — 행 메뉴 버튼에 포커스(호버 없이 focus-within 으로 보인다) → Enter → ↓ 로 「이동…」 → Enter.
  await row.getByRole('button', { name: '페이지 메뉴' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: '이동…' })).toBeFocused()
  await page.keyboard.press('Enter')

  const dialog = page.getByTestId('wiki-move-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading')).toHaveText('「신규 입사자 온보딩 가이드」 옮기기')
  // 지금 위치(최상위)는 고를 수 없고, 자기 자신은 목록에 없다.
  await expect(dialog.getByTestId('wiki-move-option-root')).toContainText('지금 위치')
  await expect(dialog.getByTestId('wiki-move-option-7')).toHaveCount(0)
  await expect(dialog.getByTestId('wiki-move-confirm')).toBeDisabled()

  // 검색으로 좁힌 뒤 Tab 으로 목록의 「설계 문서」에 가서 Enter(고르기) → Tab 들로 「옮기기」 Enter.
  await page.getByTestId('wiki-move-search').fill('설계')
  await expect(dialog.getByRole('option')).toHaveText(['설계 문서', '노트 동시 편집 설계'])
  await dialog.getByTestId('wiki-move-option-5').focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByTestId('wiki-move-option-5')).toHaveAttribute('aria-selected', 'true')
  await dialog.getByTestId('wiki-move-confirm').focus()
  await page.keyboard.press('Enter')

  await expect.poll(() => moves.lastBody()).toEqual({ parentId: 5, position: 1 })
  await expect(dialog).toBeHidden()
})

