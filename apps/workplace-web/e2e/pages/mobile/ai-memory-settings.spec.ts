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

// 아이콘 두 개가 오른쪽을 먹어 내용이 11자 폭으로 접히고 날짜가 "2026-10-/12" 로 끊기던 문제 — 내용은 카드 폭 대부분을 쓰고, 날짜는 한 줄이다.
test('내용이 행 폭 대부분을 쓰고 메타 날짜가 중간에서 끊기지 않는다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [memoryItem(2, { content: '이슈 목록은 담당자만 붙인 짧은 목록으로 보여 준다', updatedAt: '2026-10-12T12:00:00Z' })])
  await openMemorySettings(page)
  const row = await stableBox(page.getByTestId('ai-memory-row'))
  const content = await stableBox(page.getByTestId('ai-memory-content'))
  const badge = await stableBox(page.getByTestId('ai-memory-kind'))
  // 배지·좌우 여백을 뺀 폭의 대부분(아이콘 열을 가로질러 쓴다).
  expect(content.width).toBeGreaterThanOrEqual(row.width - badge.width - 40)
  const dateRects = await page
    .getByTestId('ai-memory-meta')
    .locator('span')
    .evaluate((el) => el.getClientRects().length)
  expect(dateRects, '날짜는 한 줄(조각 1개)').toBe(1)
  // 아이콘 터치 영역은 44px 를 유지하되 행 높이를 키우지 않고 메타 줄 오른쪽에 놓인다.
  const edit = await stableBox(page.getByTestId('ai-memory-edit'))
  const meta = await stableBox(page.getByTestId('ai-memory-meta'))
  expect(edit.y + edit.height / 2, '아이콘 중심이 메타 줄 중앙').toBeCloseTo(meta.y + meta.height / 2, 0)
})

// WP-379: 범위 묶음 소제목·카운트와 범위 고르기가 좁은 화면에서 넘치지 않고 터치 크기다.
test('범위 묶음과 범위 고르기가 넘치지 않고 터치 크기다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [
    memoryItem(3, { content: '메신저 대화 요약은 세 줄로 정리해 보여 준다', scope: 'MESSAGING' }),
    memoryItem(2, { content: '답은 존댓말로 한다' }),
  ])
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-group')).toHaveCount(2)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('ai-memory-edit').first().click()
  expect(Math.round((await stableBox(page.getByTestId('ai-memory-edit-scope'))).height)).toBeGreaterThanOrEqual(44)
  await expectNoHorizontalOverflow(page)
})
