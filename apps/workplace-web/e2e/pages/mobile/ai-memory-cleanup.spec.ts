// WP-385 모바일 「AI가 정리한 기록」 — 바텀시트로 열리고, 긴 내용·제목에도 가로로 넘치지 않으며, 기록 보기·되돌리기가 터치 크기(44px)다.
import { memoryChange, memoryItem, memorySnap, mockAiMemories, mockMemoryChanges, openMemorySettings } from '../../fixtures/ai-memory-mock'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { stableBox } from '../../fixtures/wait'

test.use({ timezoneId: 'Asia/Seoul' })

test('기록은 바텀시트로 열리고 넘치지 않으며 되돌리기·기록 보기가 터치 크기다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T03:00:00Z'))
  await mockAiMemories(page, [memoryItem(2)])
  const m = await mockMemoryChanges(page, [
    [
      memoryChange(2, {
        memory: memorySnap(21, 'https://example.com/' + 'a'.repeat(200)),
        source: { id: '11111111-2222-4333-8444-555555555555', title: '아주 긴 대화 제목 '.repeat(8) },
      }),
      memoryChange(1, {
        action: 'MERGED',
        memory: memorySnap(11, '보고서·요약은 표로 정리한다'),
        before: [memorySnap(11, '주간 보고서는 표로'), memorySnap(12, '요약은 표 형식 선호')],
      }),
    ],
  ])
  await openMemorySettings(page)
  const open = page.getByTestId('ai-memory-cleanup-open')
  expect(Math.round((await stableBox(open)).height)).toBeGreaterThanOrEqual(44)
  await expectNoHorizontalOverflow(page)

  await open.click()
  const sheet = page.getByTestId('ai-memory-cleanup-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('ai-memory-cleanup-dialog')).toHaveCount(0)
  await expect(sheet.getByTestId('memory-log-item')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/tc/ai-memory-cleanup/mobile-sheet.png' })
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth), '시트 안 가로 넘침 없음').toBe(true)
  await expectNoHorizontalOverflow(page)

  const undo = sheet.getByTestId('memory-log-undo').first()
  await expect(undo).toHaveAccessibleDescription(/^새로 기억함 https:\/\/example\.com\//)
  const box = await stableBox(undo)
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44)
  await undo.click()
  await m.undos.waitFor()
  expect(m.undos.lastUrl()?.pathname).toBe('/api/v1/users/me/ai-memories/changes/2/undo')
  await expect(sheet.getByTestId('memory-log-item').first().getByTestId('memory-log-undone')).toHaveText('되돌림 · 오후 12:00')
  // 바텀시트에서도 되돌린 뒤 포커스가 되돌림 표시로 옮겨 시트 밖으로 새지 않는다.
  await expect(sheet.getByTestId('memory-log-item').first().getByTestId('memory-log-undone')).toBeFocused()
})

test('바텀시트에서도 첫 묶음 실패는 이유 문구와 터치 크기 다시 시도로 보이고, 다시 시도하면 목록이 된다', async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-10-15T03:00:00Z'))
  const m = await mockMemoryChanges(page, [[memoryChange(1)]])
  // 기록 목록(size=30)을 실패시킨다(앱의 자동 재시도까지 모두) — 안내 줄 횟수(size=1)는 목에 맡기고, 다시 시도 직전에 푼다.
  let failing = true
  await page.route(
    (u) => u.pathname === '/api/v1/users/me/ai-memories/changes' && u.searchParams.get('size') !== '1',
    (route) => {
      if (!failing) return route.fallback()
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL', message: '오류' }) })
    },
  )
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-cleanup-open').click()
  const sheet = page.getByTestId('ai-memory-cleanup-sheet')
  const error = sheet.getByTestId('ai-memory-cleanup-error')
  await expect(error).toContainText('기록을 불러오지 못했어요')
  const retry = error.getByRole('button', { name: '다시 시도' })
  expect(Math.round((await stableBox(retry)).height)).toBeGreaterThanOrEqual(44)
  await expectNoHorizontalOverflow(page)
  failing = false
  const before = m.lists.count()
  await retry.click()
  await m.lists.waitFor(before + 1)
  await expect(sheet.getByTestId('memory-log-item')).toHaveCount(1)
  await expect(error).toHaveCount(0)
})
