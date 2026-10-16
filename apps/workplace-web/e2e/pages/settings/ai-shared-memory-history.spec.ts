// WP-386 공용 메모리 기록(데스크톱 대화상자) — 동작 문구·행위자, 출처 대화 링크 없음, 서버 undoable 만 되돌리기, 되돌리기 → 되돌림 표시·목록 다시 읽기, 409 두 종.
import type { Page } from '@playwright/test'

import type { SharedMemoryOrigin } from '../../../src/types/sharedAiMemory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockSharedMemory, openSharedMemory, sharedChange, sharedSpace } from '../../fixtures/shared-memory-mock'
import { gate } from '../../fixtures/wait'

const WP = sharedSpace({ canManage: false })
const items = (page: Page) => page.getByTestId('memory-log-item')
const snap = (id: number, content: string, origin: SharedMemoryOrigin = 'AI_EXTRACTED') => ({ id, content, origin })

async function openHistory(page: Page) {
  await page.getByTestId('shared-memory-history-open').click()
  await expect(page.getByTestId('shared-memory-history-dialog')).toBeVisible()
}

test('기록 보기는 그 공간 기록을 동작·행위자와 함께 보이고 출처 대화 링크는 없다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, {
    spaces: [WP],
    changes: {
      'PROJECT:12': [
        sharedChange(5, { action: 'MERGED', memory: snap(9, '회의록은 당일에 올리고 요약은 다음 날', 'AI_CLEANED'), before: [snap(9, '회의록은 당일에'), snap(8, '요약은 다음 날')], undoable: false }),
        sharedChange(4, { action: 'ADDED', actor: { kind: 'USER', name: '이영희' }, memory: snap(7, '회의록은 당일에 올린다', 'USER_ADDED'), undoable: false }),
        sharedChange(3, { action: 'ADDED', actor: { kind: 'USER', name: '양동희' }, memory: snap(6, '이슈 본문은 배경부터', 'USER_REQUESTED'), undoable: true }),
      ],
    },
  })
  await openSharedMemory(page, 'PROJECT:12')
  await openHistory(page)
  await mock.changeLists.waitFor()
  expect(mock.changeLists.lastUrl()?.searchParams.get('spaceType')).toBe('PROJECT')
  expect(mock.changeLists.lastUrl()?.searchParams.get('spaceId')).toBe('12')
  await expect(page.getByTestId('shared-memory-history-dialog')).toContainText('내가 추가했거나 요청한 항목은 되돌릴 수 있어요')
  await expect(page.getByTestId('memory-log-label')).toHaveText(['합침', '직접 추가함', '새로 기억함'])
  // 행위자는 동작 문구 바로 뒤(「합침 · AI · 시각」).
  await expect(items(page).nth(0).locator('p').first()).toContainText('합침 · AI ·')
  await expect(items(page).nth(0)).toContainText('합치기 전')
  await expect(items(page).nth(1).locator('p').first()).toContainText('직접 추가함 · 이영희 ·')
  await expect(page.getByTestId('memory-log-source')).toHaveCount(0)
  // 서버가 허락한 기록(undoable)에만 되돌리기.
  await expect(items(page).nth(0).getByTestId('memory-log-undo')).toHaveCount(0)
  await expect(items(page).nth(1).getByTestId('memory-log-undo')).toHaveCount(0)
  await expect(items(page).nth(2).getByTestId('memory-log-undo')).toBeVisible()
})

test('되돌리면 그 기록이 되돌림으로 바뀌고 목록·개수를 다시 읽는다', async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, { spaces: [WP], changes: { 'PROJECT:12': [sharedChange(3, { memory: snap(6, '이슈 본문은 배경부터', 'USER_REQUESTED') })] } })
  await openSharedMemory(page, 'PROJECT:12')
  const listsBefore = mock.lists.count()
  await openHistory(page)
  await page.getByTestId('memory-log-undo').click()
  await mock.undos.waitFor()
  expect(mock.undos.lastUrl()?.pathname).toBe('/api/v1/shared-ai-memories/changes/3/undo')
  await expect(page.getByTestId('memory-log-undone')).toBeVisible()
  await expect(page.getByText('되돌렸어요')).toBeVisible()
  await expect.poll(() => mock.lists.count()).toBeGreaterThan(listsBefore)
})

test('그 뒤에 바뀐 메모리·이미 되돌린 기록이면 안내 토스트를 띄운다', async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, {
    spaces: [WP],
    changes: { 'PROJECT:12': [sharedChange(3, { memory: snap(6, 'a') }), sharedChange(2, { memory: snap(5, 'b') })] },
  })
  await openSharedMemory(page, 'PROJECT:12')
  await openHistory(page)
  mock.failNext(409, 'SHARED_MEMORY_CHANGED')
  await items(page).nth(0).getByTestId('memory-log-undo').click()
  await expect(page.getByText('그 뒤에 메모리가 바뀌어 되돌릴 수 없어요')).toBeVisible()
  await expect(items(page).nth(0).getByTestId('memory-log-undone')).toHaveCount(0)
  mock.failNext(409, 'SHARED_MEMORY_CHANGE_UNDONE')
  await items(page).nth(1).getByTestId('memory-log-undo').click()
  await expect(page.getByText('이미 되돌린 기록이에요')).toBeVisible()
})

test('기록을 받는 동안은 스켈레톤을, 실패하면 이유 문구와 다시 시도를 보이고 다시 시도하면 처음부터 다시 받는다', async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, { spaces: [WP], changes: { 'PROJECT:12': [sharedChange(3, { memory: snap(6, '이슈 본문은 배경부터', 'USER_REQUESTED') })] } })
  // 기록 목록 요청만 실패시킨다(목 뒤에 건 라우트가 먼저 받고, 풀면 목으로 넘긴다). 풀기 전엔 응답을 붙들어 로딩 상태를 본다.
  let failing = true
  const held = gate()
  await page.route(
    (u) => u.pathname === '/api/v1/shared-ai-memories/changes',
    async (route) => {
      if (!failing) return route.fallback()
      await held.p
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'INTERNAL', message: '오류' }) })
    },
  )
  await openSharedMemory(page, 'PROJECT:12')
  await openHistory(page)
  const dialog = page.getByTestId('shared-memory-history-dialog')
  // 받는 중: 글자 대신 항목 모양 스켈레톤(스크린리더에는 상태 한 줄).
  await expect(dialog.getByTestId('shared-memory-history-loading')).toBeVisible()
  await expect(dialog.getByTestId('shared-memory-history-loading')).toHaveAccessibleName('기록을 불러오는 중')
  held.release()
  // 실패: 이유 문구 + 다시 시도.
  const error = dialog.getByTestId('shared-memory-history-error')
  await expect(error).toContainText('기록을 불러오지 못했어요')
  await expect(error.getByRole('button', { name: '다시 시도' })).toBeVisible()
  await expect(dialog.getByTestId('shared-memory-history-loading')).toHaveCount(0)
  await expect(dialog.getByTestId('memory-log-item')).toHaveCount(0)
  // 다시 시도: 첫 묶음(cursor 없음)을 다시 받아 목록으로 바뀐다.
  failing = false
  const before = mock.changeLists.count()
  await error.getByRole('button', { name: '다시 시도' }).click()
  await mock.changeLists.waitFor(before + 1)
  expect(mock.changeLists.lastUrl()?.searchParams.get('cursor')).toBeNull()
  await expect(dialog.getByTestId('memory-log-item')).toHaveCount(1)
  await expect(dialog.getByTestId('shared-memory-history-error')).toHaveCount(0)
})
