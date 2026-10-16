// WP-386 모바일 공용 메모리 기록 — 바텀시트, 가로 넘침 없음, 되돌리기 44px.
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockSharedMemory, openSharedMemory, sharedChange, sharedSpace } from '../../fixtures/shared-memory-mock'
import { stableBox } from '../../fixtures/wait'

test('기록은 바텀시트로 열리고 넘치지 않으며 되돌리기가 터치 크기다', async ({ authenticatedPage: page }) => {
  await mockSharedMemory(page, {
    spaces: [sharedSpace({})],
    changes: { 'PROJECT:12': [sharedChange(3, { memory: { id: 6, content: 'https://example.com/' + 'a'.repeat(200), origin: 'USER_REQUESTED' } })] },
  })
  await openSharedMemory(page, 'PROJECT:12')
  await page.getByTestId('shared-memory-history-open').click()
  await expect(page.getByTestId('shared-memory-history-sheet')).toBeVisible()
  await expect(page.getByTestId('shared-memory-history-dialog')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  expect(Math.round((await stableBox(page.getByTestId('memory-log-undo'))).height)).toBeGreaterThanOrEqual(44)
})
