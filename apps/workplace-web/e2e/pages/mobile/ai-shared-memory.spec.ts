// WP-386 모바일 공용 메모리 탭 — 공간은 위쪽 선택 상자, 가로 넘침 없음, 아이콘·버튼 터치 크기(44px).
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockSharedMemory, openSharedMemory, sharedItem, sharedSpace } from '../../fixtures/shared-memory-mock'
import { stableBox } from '../../fixtures/wait'

test('공간은 선택 상자로 고르고, 화면이 넘치지 않고 아이콘·버튼이 터치 크기다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const WP = sharedSpace({})
  const NOTE = sharedSpace({ type: 'WIKI_SPACE', id: 3, key: null, name: '개발팀 노트', label: '개발팀 노트' })
  await mockSharedMemory(page, {
    spaces: [WP, NOTE],
    items: { 'PROJECT:12': [sharedItem(1, { content: 'https://example.com/' + 'a'.repeat(200), canEdit: true, origin: 'USER_ADDED', author: { name: '양동희' } })] },
  })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(page.getByTestId('shared-space-list')).toBeHidden()
  const select = page.getByTestId('shared-space-select')
  expect(Math.round((await stableBox(select)).height)).toBeGreaterThanOrEqual(44)
  await expectNoHorizontalOverflow(page)
  for (const id of ['shared-memory-edit', 'shared-memory-delete', 'shared-memory-add']) {
    expect(Math.round((await stableBox(page.getByTestId(id).first())).height)).toBeGreaterThanOrEqual(44)
  }
  await select.click()
  await page.getByRole('option', { name: /개발팀 노트/ }).click()
  await expect(page).toHaveURL(/space=WIKI_SPACE%3A3/)
  await expectNoHorizontalOverflow(page)
})
