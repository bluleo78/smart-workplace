// WP-55 설정 > AI 비서 > 메모리 카드(데스크톱) — 위치·목록·배지·메타, 제자리 편집(카운트·300자 초과), 삭제 토스트 되돌리기, 직접 추가(빈 값·초과 비활성·종류),
// 모두 지우기 확인, 스위치 꺼짐(흐림 + 편집 가능), 빈 상태, 45개 주황·50개 가득 참, 저장 실패 토스트.
import type { Page } from '@playwright/test'

import { memoryItem, mockAiMemories, openMemorySettings } from '../../fixtures/ai-memory-mock'
import { mockAiPreferences } from '../../fixtures/ai-suggestions-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { gate, stableBox } from '../../fixtures/wait'

const rows = (page: Page) => page.getByTestId('ai-memory-row')

test('추천 질문 카드 아래·개인 비서 위에 최신순 목록과 배지·메타·카운트가 보인다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [
    memoryItem(3, { kind: 'CONTEXT', content: '백엔드 팀이고 주로 WP 프로젝트를 본다', source: 'USER', updatedAt: '2026-10-13T12:00:00Z' }),
    memoryItem(2, { content: '이슈 목록은 짧은 목록으로 보여 준다', updatedAt: '2026-10-12T12:00:00Z' }),
  ])
  await openMemorySettings(page)
  const card = page.getByTestId('ai-memory-card')
  await expect(card).toContainText('대화에서 알려 준 선호·교정과 업무 맥락을 기억해 다음 대화에 반영해요. 나만 볼 수 있어요.')
  const suggestion = await stableBox(page.getByTestId('ai-suggestions-card'))
  const memory = await stableBox(card)
  const personal = await stableBox(page.getByText('개인 비서', { exact: true }))
  expect(memory.y).toBeGreaterThan(suggestion.y)
  expect(personal.y).toBeGreaterThan(memory.y + memory.height - 1)

  await expect(rows(page).getByTestId('ai-memory-content')).toHaveText([
    '백엔드 팀이고 주로 WP 프로젝트를 본다',
    '이슈 목록은 짧은 목록으로 보여 준다',
  ])
  await expect(rows(page).getByTestId('ai-memory-kind')).toHaveText(['맥락', '선호'])
  await expect(rows(page).nth(0).getByTestId('ai-memory-meta')).toHaveText('직접 추가 · 2026-10-13')
  await expect(rows(page).nth(1).getByTestId('ai-memory-meta')).toHaveText('AI가 저장 · 2026-10-12')
  await expect(page.getByTestId('ai-memory-count')).toHaveText('2 / 50')
  await expect(page.getByTestId('ai-memory-toggle')).toHaveAttribute('aria-checked', 'true')
})

test('제자리에서 고치면 PATCH 를 보내고 맨 위로 올라간다 — 취소하면 원래대로', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { content: '첫째' }), memoryItem(2, { content: '둘째' })])
  await openMemorySettings(page)
  const second = rows(page).nth(1)
  await second.getByTestId('ai-memory-edit').click()
  await expect(page.getByTestId('ai-memory-edit-input')).toHaveValue('둘째')
  await page.getByTestId('ai-memory-edit-input').fill('둘째를 고침')
  await expect(page.getByTestId('ai-memory-edit-count')).toHaveText('6 / 300')
  await page.getByTestId('ai-memory-edit-submit').click()
  await mock.updates.waitFor()
  expect(mock.updates.lastBody()).toEqual({ content: '둘째를 고침' })
  expect(mock.updates.lastUrl()?.pathname).toBe('/api/v1/users/me/ai-memories/2')
  await expect(rows(page).getByTestId('ai-memory-content')).toHaveText(['둘째를 고침', '첫째'])

  await rows(page).nth(1).getByTestId('ai-memory-edit').click()
  await page.getByTestId('ai-memory-edit-input').fill('버릴 내용')
  await page.getByRole('button', { name: '취소' }).click()
  await expect(rows(page).nth(1).getByTestId('ai-memory-content')).toHaveText('첫째')
  expect(mock.updates.count()).toBe(1)
})

// Review Focus 3: 코드포인트 기준 — 이모지 300개는 저장 가능, 301개는 카운트 빨강 + 저장 비활성, 입력은 자르지 않는다.
// F-j: 추가 폼과 행 고치기를 함께 열어도 두 입력란의 접근성 이름이 다르다.
test('추가 폼과 제자리 고치기 입력란은 서로 다른 이름으로 읽힌다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [memoryItem(3, { content: '첫째' })])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-add').click()
  await rows(page).first().getByTestId('ai-memory-edit').click()
  await expect(page.getByRole('textbox', { name: '기억할 내용', exact: true })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: '메모리 내용', exact: true })).toHaveValue('첫째')
})

test('300자를 넘기면 카운트가 빨갛고 저장이 막히며 내용을 자르지 않는다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [memoryItem(3, { content: '첫째' })])
  await openMemorySettings(page)
  await rows(page).first().getByTestId('ai-memory-edit').click()
  const input = page.getByTestId('ai-memory-edit-input')
  await input.fill('😀'.repeat(300))
  await expect(page.getByTestId('ai-memory-edit-count')).toHaveText('300 / 300')
  await expect(page.getByTestId('ai-memory-edit-submit')).toBeEnabled()
  await input.fill('😀'.repeat(301))
  await expect(page.getByTestId('ai-memory-edit-count')).toHaveText('301 / 300')
  await expect(page.getByTestId('ai-memory-edit-count')).toHaveClass(/text-destructive/)
  await expect(page.getByTestId('ai-memory-edit-submit')).toBeDisabled()
  expect([...(await input.inputValue())].length).toBe(301)
})

test('지우면 바로 사라지고 토스트의 되돌리기로 같은 종류·내용을 다시 만든다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { kind: 'CONTEXT', content: '백엔드 팀이다' }), memoryItem(2, { content: '둘째' })])
  await openMemorySettings(page)
  await rows(page).first().getByTestId('ai-memory-delete').click()
  await mock.deletes.waitFor()
  expect(mock.deletes.lastUrl()?.pathname).toBe('/api/v1/users/me/ai-memories/3')
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByText('메모리를 삭제했어요')).toBeVisible()
  await page.getByRole('button', { name: '되돌리기' }).click()
  await mock.creates.waitFor()
  expect(mock.creates.lastBody()).toEqual({ kind: 'CONTEXT', content: '백엔드 팀이다' })
  await expect(rows(page).first().getByTestId('ai-memory-content')).toHaveText('백엔드 팀이다')
  await expect(rows(page).first().getByTestId('ai-memory-meta')).toContainText('직접 추가')
})

// CR9: 되돌리기는 직접 추가 경로를 그대로 쓴다 — 지운 행이 사라진(언마운트된) 뒤에도 실패 토스트(서버 문구)가 뜨고 목록은 그대로다.
test('삭제 토스트의 되돌리기가 실패하면 서버 문구 토스트를 띄우고 목록은 그대로다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { content: '백엔드 팀이다' }), memoryItem(2, { content: '둘째' })])
  await openMemorySettings(page)
  await rows(page).first().getByTestId('ai-memory-delete').click()
  await mock.deletes.waitFor()
  await expect(rows(page)).toHaveCount(1)
  mock.failNext(409, 'AI_MEMORY_FULL', '메모리가 가득 찼어요(최대 50개). 필요 없는 항목을 지워 주세요')
  await page.getByRole('button', { name: '되돌리기' }).click()
  await mock.creates.waitFor()
  await expect(page.getByText('메모리가 가득 찼어요(최대 50개). 필요 없는 항목을 지워 주세요')).toBeVisible()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first().getByTestId('ai-memory-content')).toHaveText('둘째')
})

test('직접 추가 폼은 목록 맨 위에 열리고, 빈 값·초과면 막히며, 고른 종류로 추가한다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { content: '첫째' })])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-add').click()
  const form = page.getByTestId('ai-memory-add-form')
  const formBox = await stableBox(form)
  const rowBox = await stableBox(rows(page).first())
  expect(formBox.y).toBeLessThan(rowBox.y)
  await expect(page.getByTestId('ai-memory-kind-PREFERENCE')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ai-memory-add-submit')).toBeDisabled()
  await page.getByTestId('ai-memory-add-input').fill('   ')
  await expect(page.getByTestId('ai-memory-add-submit')).toBeDisabled()
  await page.getByTestId('ai-memory-add-input').fill('가'.repeat(301))
  await expect(page.getByTestId('ai-memory-add-count')).toHaveClass(/text-destructive/)
  await expect(page.getByTestId('ai-memory-add-submit')).toBeDisabled()

  await page.getByTestId('ai-memory-kind-CONTEXT').click()
  await page.getByTestId('ai-memory-add-input').fill('  주로 WP 프로젝트를 본다  ')
  await expect(page.getByTestId('ai-memory-add-count')).toHaveText('14 / 300')
  await page.getByTestId('ai-memory-add-submit').click()
  await mock.creates.waitFor()
  expect(mock.creates.lastBody()).toEqual({ kind: 'CONTEXT', content: '  주로 WP 프로젝트를 본다  ' })
  await expect(form).toHaveCount(0)
  await expect(rows(page).first().getByTestId('ai-memory-content')).toHaveText('주로 WP 프로젝트를 본다')
  await expect(rows(page).first().getByTestId('ai-memory-kind')).toHaveText('맥락')
  await expect(page.getByTestId('ai-memory-count')).toHaveText('2 / 50')
})

test('모두 지우기는 개수를 알려 주는 확인 뒤에만 지우고, 지우면 빈 상태가 된다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3), memoryItem(2), memoryItem(1)])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-clear').click()
  const dialog = page.getByTestId('ai-memory-clear-dialog')
  await expect(dialog).toContainText('메모리를 모두 지울까요?')
  await expect(dialog).toContainText('기억한 내용 3개가 모두 삭제되고 되돌릴 수 없어요. 다음 대화부터 반영되지 않아요.')
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(rows(page)).toHaveCount(3)
  expect(mock.clears.count()).toBe(0)

  await page.getByTestId('ai-memory-clear').click()
  await page.getByTestId('ai-memory-clear-confirm').click()
  await mock.clears.waitFor()
  await expect(page.getByTestId('ai-memory-empty')).toBeVisible()
  await expect(page.getByTestId('ai-memory-clear')).toHaveCount(0)
  await expect(page.getByTestId('ai-memory-count')).toHaveText('0 / 50')
})

test('스위치를 끄면 false 를 저장하고 목록이 흐려지지만 편집은 그대로 된다', async ({ authenticatedPage: page }) => {
  const puts = await mockAiPreferences(page, true)
  await mockAiMemories(page, [memoryItem(3, { content: '첫째' })])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-toggle').click()
  await puts.waitFor()
  expect(puts.lastBody()).toEqual({ memoryEnabled: false })
  await expect(page.getByTestId('ai-memory-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('ai-memory-toggle-hint')).toHaveText('꺼져 있어요 — 새로 저장하지 않고 대화에도 반영하지 않아요')
  await expect(page.getByTestId('ai-suggestions-toggle')).toHaveAttribute('aria-checked', 'true') // 부분 갱신 — 추천은 그대로
  await expect.poll(() => page.getByTestId('ai-memory-list-area').evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(1)
  await rows(page).first().getByTestId('ai-memory-edit').click()
  await expect(page.getByTestId('ai-memory-edit-input')).toBeEditable()
  await expect(page.getByTestId('ai-memory-add')).toBeEnabled()
})

// F-i: 추천·메모리 스위치는 저장을 따로 한다 — 먼저 보낸 추천 저장의 응답이 늦게(메모리 저장 전 값을 싣고) 와도 메모리 스위치를 되돌리지 않는다.
test('두 스위치를 연달아 바꿔도 늦게 온 응답이 다른 스위치를 되돌리지 않는다', async ({ authenticatedPage: page }) => {
  const hold = gate()
  const puts = await mockAiPreferences(page, true, { holdFirstPut: hold.p })
  await mockAiMemories(page, [])
  await openMemorySettings(page)
  await page.getByTestId('ai-suggestions-toggle').click()
  await puts.waitFor(1)
  await page.getByTestId('ai-memory-toggle').click()
  await puts.waitFor(2)
  expect(puts.bodies()).toEqual([{ suggestionsEnabled: false }, { memoryEnabled: false }])
  await expect(page.getByTestId('ai-memory-toggle')).toHaveAttribute('aria-checked', 'false')
  hold.release() // 첫 응답 = { suggestionsEnabled: false, memoryEnabled: true }(도착 시점 값)
  // 추천 저장이 끝나 스위치가 풀린 뒤(캐시 반영은 그 전에 끝난다) 두 값을 본다.
  await expect(page.getByTestId('ai-suggestions-toggle')).toBeEnabled()
  await expect(page.getByTestId('ai-suggestions-toggle')).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('ai-memory-toggle')).toHaveAttribute('aria-checked', 'false')
})

test('비어 있으면 안내 문구와 0 / 50 을 보이고 모두 지우기는 없다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [])
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-empty')).toHaveText(
    "아직 기억한 내용이 없어요. 대화에서 '앞으로는 ~해줘'라고 말하거나 직접 추가해 보세요.",
  )
  await expect(page.getByTestId('ai-memory-count')).toHaveText('0 / 50')
  await expect(page.getByTestId('ai-memory-clear')).toHaveCount(0)
})

const many = (n: number) => Array.from({ length: n }, (_, i) => memoryItem(n - i))

test('45개면 카운트가 주황이고 추가는 된다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, many(45))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-count')).toHaveText('45 / 50')
  await expect(page.getByTestId('ai-memory-count')).toHaveClass(/text-warning-text/)
  await expect(page.getByTestId('ai-memory-add')).toBeEnabled()
  await expect(page.getByTestId('ai-memory-full')).toHaveCount(0)
})

test('50개면 추가가 막히고 가득 참 경고가 보인다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, many(50))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-count')).toHaveText('50 / 50')
  await expect(page.getByTestId('ai-memory-add')).toBeDisabled()
  await expect(page.getByTestId('ai-memory-full')).toHaveText(
    '메모리가 가득 찼어요. 새로 기억하려면 필요 없는 항목을 지워 주세요. (AI도 새로 저장하지 못해요)',
  )
})

test('저장이 거절되면 서버 사유를 토스트로 보이고 폼을 닫지 않는다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3)])
  await openMemorySettings(page)
  mock.failNext(409, 'AI_MEMORY_FULL', '메모리가 가득 찼어요(최대 50개). 필요 없는 항목을 지워 주세요')
  await page.getByTestId('ai-memory-add').click()
  await page.getByTestId('ai-memory-add-input').fill('새 메모리')
  await page.getByTestId('ai-memory-add-submit').click()
  await expect(page.getByText('메모리가 가득 찼어요(최대 50개). 필요 없는 항목을 지워 주세요')).toBeVisible()
  await expect(page.getByTestId('ai-memory-add-form')).toBeVisible()
})

// 쓰기가 끝나도 목록을 다시 읽기 전에는 지운 줄이 남아 있다 — 그 사이 삭제 버튼이 잠겨 두 번째 DELETE(404)가 나가지 않는다.
test('삭제 뒤 목록이 갱신되기 전에는 삭제 버튼이 잠겨 두 번째 요청이 나가지 않는다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { content: '첫째' }), memoryItem(2, { content: '둘째' })])
  await openMemorySettings(page)
  const list = gate()
  mock.holdNextList(list.p)
  const del = rows(page).first().getByTestId('ai-memory-delete')
  await del.click()
  await mock.deletes.waitFor()
  await expect(page.getByText('메모리를 삭제했어요')).toBeVisible()
  await expect(rows(page)).toHaveCount(2) // 목록 응답이 아직 — 지운 줄이 남아 있다
  await expect(del).toBeDisabled()
  expect(mock.deletes.count()).toBe(1)
  list.release()
  await expect(rows(page)).toHaveCount(1)
  expect(mock.deletes.count()).toBe(1)
})

// 고치기·추가도 목록을 다시 읽은 뒤에 닫힌다 — 닫힌 순간 옛 내용·옛 자리가 보이지 않는다.
test('고치기는 목록이 갱신될 때까지 편집기를 열어 두고 저장 버튼을 잠근다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { content: '첫째' }), memoryItem(2, { content: '둘째' })])
  await openMemorySettings(page)
  const list = gate()
  await rows(page).nth(1).getByTestId('ai-memory-edit').click()
  await page.getByTestId('ai-memory-edit-input').fill('둘째를 고침')
  mock.holdNextList(list.p)
  await page.getByTestId('ai-memory-edit-submit').click()
  await mock.updates.waitFor()
  await expect(page.getByTestId('ai-memory-edit-submit')).toBeDisabled()
  await expect(page.getByTestId('ai-memory-edit-input')).toBeVisible()
  list.release()
  await expect(page.getByTestId('ai-memory-edit-input')).toHaveCount(0)
  await expect(rows(page).getByTestId('ai-memory-content')).toHaveText(['둘째를 고침', '첫째'])
})

test('모두 지우기 확인 버튼은 요청 중 잠긴다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3), memoryItem(2)])
  await openMemorySettings(page)
  const list = gate()
  await page.getByTestId('ai-memory-clear').click()
  mock.holdNextList(list.p)
  await page.getByTestId('ai-memory-clear-confirm').click()
  await mock.clears.waitFor()
  await expect(page.getByTestId('ai-memory-empty')).toHaveCount(0)
  list.release()
  await expect(page.getByTestId('ai-memory-empty')).toBeVisible()
  expect(mock.clears.count()).toBe(1)
})
