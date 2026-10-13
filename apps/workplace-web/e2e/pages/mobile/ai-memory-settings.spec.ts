// WP-55 모바일 메모리 카드 — 가로 넘침 없음, 긴 내용 줄바꿈, 수정·삭제 아이콘과 추가 버튼이 터치 크기(44px).
import { memoryItem, mockAiMemories, openMemorySettings } from '../../fixtures/ai-memory-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { stableBox } from '../../fixtures/wait'

test('카드가 넘치지 않고 아이콘·버튼이 터치 크기다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [
    memoryItem(3, { content: 'https://example.com/' + 'a'.repeat(200) }),
    memoryItem(2, { content: '이슈 목록은 짧은 목록으로 보여 준다' }),
  ])
  await openMemorySettings(page)
  await expectNoHorizontalOverflow(page)
  for (const id of ['ai-memory-edit', 'ai-memory-delete']) {
    const box = await stableBox(page.getByTestId(id).first())
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44)
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44)
  }
  expect(Math.round((await stableBox(page.getByTestId('ai-memory-add'))).height)).toBeGreaterThanOrEqual(44)
  await page.getByTestId('ai-memory-add').click()
  expect(Math.round((await stableBox(page.getByTestId('ai-memory-kind-CONTEXT'))).height)).toBeGreaterThanOrEqual(44)
  await page.getByTestId('ai-memory-add-input').fill('x')
  const addForm = page.getByTestId('ai-memory-add-form')
  for (const btn of [addForm.getByRole('button', { name: '취소' }), page.getByTestId('ai-memory-add-submit')]) {
    expect(Math.round((await stableBox(btn)).height)).toBeGreaterThanOrEqual(44)
  }
  await expectNoHorizontalOverflow(page)
  await addForm.getByRole('button', { name: '취소' }).click()
  // 제자리 고치기의 취소/저장도 터치 크기다.
  await page.getByTestId('ai-memory-edit').first().click()
  for (const btn of [page.getByTestId('ai-memory-edit-submit'), page.getByRole('button', { name: '취소' })]) {
    expect(Math.round((await stableBox(btn)).height)).toBeGreaterThanOrEqual(44)
  }
  await expectNoHorizontalOverflow(page)
})
