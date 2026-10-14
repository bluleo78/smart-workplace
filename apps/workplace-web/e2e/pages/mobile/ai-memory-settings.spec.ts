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

// WP-380: 모바일 만료 행 — 링크가 넘치지 않고, 기한 연장은 바텀시트(기한 없음 버튼 없음)에서 고른다.
test.describe('기한 (WP-380)', () => {
  test.use({ timezoneId: 'Asia/Seoul' })

  test('만료 행의 기한 연장은 바텀시트로 고르고 가로로 넘치지 않는다', async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T03:00:00Z'))
    const mock = await mockAiMemories(page, [
      memoryItem(6, { content: '지난 출장 중에는 메일 답장을 짧게 한다', expiresOn: '2026-10-10', expired: true }),
    ])
    await openMemorySettings(page)
    await expectNoHorizontalOverflow(page)
    await page.getByTestId('ai-memory-extend').click()
    await expect(page.getByTestId('ai-memory-extend-sheet')).toBeVisible()
    await expect(page.getByTestId('ai-memory-extend-sheet-clear')).toHaveCount(0)
    await page.getByTestId('ai-memory-extend-sheet-next-week').click()
    await mock.updates.waitFor()
    expect(mock.updates.lastBody()).toEqual({ expiresOn: '2026-10-21' })
  })
})

// WP-383 터치: 막힌 핀(범위 고정 10개)은 호버가 없어 탭하면 토스트로 이유를 알린다. 핀·수정·삭제는 44px, 고정 행도 두 줄을 유지한다.
test('고정이 가득이면 막힌 핀을 탭할 때 토스트가 뜨고, 핀·수정·삭제는 44px 다', async ({ authenticatedPage: page }) => {
  const pinnedTen = Array.from({ length: 10 }, (_, i) => memoryItem(20 - i, { pinned: true, content: `고정 ${i}` }))
  await mockAiMemories(page, [...pinnedTen, memoryItem(5, { content: '보통' })])
  await openMemorySettings(page)
  await expectNoHorizontalOverflow(page)
  for (const id of ['ai-memory-pin', 'ai-memory-edit', 'ai-memory-delete']) {
    const box = await stableBox(page.getByTestId(id).first())
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44)
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44)
  }
  // 막힌 핀은 aria-disabled 버튼 — Playwright tap 은 비활성으로 보고 기다리기만 하므로 그 자리를 손가락으로 직접 누른다(실제 터치와 같다).
  const blocked = page.getByTestId('ai-memory-row').filter({ hasText: '보통' }).getByTestId('ai-memory-pin')
  await expect(blocked).toHaveAttribute('aria-disabled', 'true')
  await blocked.scrollIntoViewIfNeeded()
  const box = await stableBox(blocked)
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByText('이 범위는 고정이 10개까지예요')).toBeVisible()
})
