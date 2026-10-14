// WP-55 설정 > AI 비서 > 메모리 카드(데스크톱) — 위치·목록·배지·메타, 제자리 편집(카운트·300자 초과), 삭제 토스트 되돌리기, 직접 추가(빈 값·초과 비활성·종류),
// 모두 지우기 확인, 스위치 꺼짐(흐림 + 편집 가능), 빈 상태, 45개 주황·50개 가득 참, 저장 실패 토스트.
// WP-379: 범위 묶음(순서·소제목·묶음 카운트·접기), 편집·추가의 범위, 가득 찬 범위.
// WP-380: 기한 표기, 만료 행(흐림·삭제 예정일·기한 연장·계속 기억), 편집·추가의 기한 고르기.
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
  // 시안 배지 색 — 선호는 AI 보라(ai), 맥락은 info.
  await expect(rows(page).nth(0).getByTestId('ai-memory-kind')).toHaveAttribute('data-variant', 'info')
  await expect(rows(page).nth(1).getByTestId('ai-memory-kind')).toHaveAttribute('data-variant', 'ai')
  await expect(rows(page).nth(0).getByTestId('ai-memory-meta')).toHaveText('직접 추가 · 2026-10-13')
  await expect(rows(page).nth(1).getByTestId('ai-memory-meta')).toHaveText('AI가 저장 · 2026-10-12')
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('2 / 50')
  await expect(page.getByTestId('ai-memory-group-title')).toHaveText('공통 · 모든 AI 대화에 반영돼요')
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
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('2 / 50')
})

test('모두 지우기는 개수를 알려 주는 확인 뒤에만 지우고, 지우면 빈 상태가 된다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3), memoryItem(2), memoryItem(1)])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-clear').click()
  const dialog = page.getByTestId('ai-memory-clear-dialog')
  await expect(dialog).toContainText('메모리를 모두 지울까요?')
  await expect(dialog).toContainText('모든 범위의 메모리 3개가 삭제되고 되돌릴 수 없어요. 다음 대화부터 반영되지 않아요.')
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(rows(page)).toHaveCount(3)
  expect(mock.clears.count()).toBe(0)

  await page.getByTestId('ai-memory-clear').click()
  await page.getByTestId('ai-memory-clear-confirm').click()
  await mock.clears.waitFor()
  await expect(page.getByTestId('ai-memory-empty')).toBeVisible()
  await expect(page.getByTestId('ai-memory-clear')).toHaveCount(0)
  await expect(page.getByTestId('ai-memory-group')).toHaveCount(0)
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

test('비어 있으면 안내 문구를 보이고 묶음·모두 지우기는 없다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [])
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-empty')).toHaveText(
    "아직 기억한 내용이 없어요. 대화에서 '앞으로는 ~해줘'라고 말하거나 직접 추가해 보세요.",
  )
  await expect(page.getByTestId('ai-memory-group')).toHaveCount(0)
  await expect(page.getByTestId('ai-memory-clear')).toHaveCount(0)
})

const many = (n: number) => Array.from({ length: n }, (_, i) => memoryItem(n - i))

test('45개면 묶음 카운트가 주황이고 추가는 된다 — 10개 넘는 묶음은 5개만 보이다 펼치고 접는다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, many(45))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('45 / 50')
  await expect(page.getByTestId('ai-memory-group-count')).toHaveClass(/text-warning-text/)
  await expect(page.getByTestId('ai-memory-add')).toBeEnabled()
  await expect(page.getByTestId('ai-memory-group-full')).toHaveCount(0)

  await expect(rows(page)).toHaveCount(5)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveText('40개 더 보기')
  await page.getByTestId('ai-memory-group-more').click()
  await expect(rows(page)).toHaveCount(45)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveText('접기')
  await page.getByTestId('ai-memory-group-more').click()
  await expect(rows(page)).toHaveCount(5)
})

test('공통 50개면 공통 묶음에 가득 참 경고, 추가는 열리고 기본 범위는 이슈이며 공통은 고를 수 없다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, many(50))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('가득 참 · 50 / 50')
  await expect(page.getByTestId('ai-memory-group-full')).toHaveText(
    '공통 메모리가 가득 찼어요. 새로 기억하려면 필요 없는 항목을 지워 주세요. (AI도 새로 저장하지 못해요)',
  )
  await page.getByTestId('ai-memory-add').click()
  await expect(page.getByTestId('ai-memory-add-scope')).toHaveText('이슈')
  await page.getByTestId('ai-memory-add-scope').click()
  await expect(page.getByTestId('ai-memory-add-scope-COMMON')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('ai-memory-add-scope-COMMON')).toContainText('가득 참')
  await page.keyboard.press('Escape')
  await page.getByTestId('ai-memory-add-input').fill('이슈 목록은 짧게 보여 준다')
  await page.getByTestId('ai-memory-add-submit').click()
  await mock.creates.waitFor()
  expect(mock.creates.lastBody()).toEqual({ kind: 'PREFERENCE', content: '이슈 목록은 짧게 보여 준다', scope: 'ISSUE' })
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

test('범위 묶음은 공통 → 이슈 → 메일 순서이고 빈 범위는 숨긴다 — 소제목·카운트는 묶음마다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [
    memoryItem(9, { content: '메일은 세 줄로 요약한다', scope: 'MAIL' }),
    memoryItem(8, { content: '답은 존댓말로 한다' }),
    memoryItem(7, { content: '이슈 목록은 짧게 보여 준다', scope: 'ISSUE' }),
    memoryItem(6, { content: '백엔드 팀이다', kind: 'CONTEXT' }),
  ])
  await openMemorySettings(page)
  const groups = page.getByTestId('ai-memory-group')
  await expect(groups).toHaveCount(3)
  expect(await groups.evaluateAll((els) => els.map((e) => e.getAttribute('data-scope')))).toEqual(['COMMON', 'ISSUE', 'MAIL'])
  await expect(page.getByTestId('ai-memory-group-title')).toHaveText([
    '공통 · 모든 AI 대화에 반영돼요',
    '이슈 · 이슈 화면의 AI 대화에만 반영돼요',
    '메일 · 메일 화면의 AI 대화에만 반영돼요',
  ])
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText(['2 / 50', '1 / 50', '1 / 50'])
  await expect(groups.nth(0).getByTestId('ai-memory-content')).toHaveText(['답은 존댓말로 한다', '백엔드 팀이다'])
})

test('고치기에서 범위를 바꾸면 PATCH 에 scope 를 싣고 그 묶음으로 옮겨 간다 — 범위를 그대로 두면 scope 를 보내지 않는다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { content: '목록은 짧게' }), memoryItem(2, { content: '메일은 짧게', scope: 'MAIL' })])
  await openMemorySettings(page)
  await rows(page).nth(0).getByTestId('ai-memory-edit').click()
  await expect(page.getByTestId('ai-memory-edit-scope')).toHaveText('공통 (모든 AI)')
  await page.getByTestId('ai-memory-edit-scope').click()
  await page.getByTestId('ai-memory-edit-scope-ISSUE').click()
  await page.getByTestId('ai-memory-edit-submit').click()
  await mock.updates.waitFor()
  expect(mock.updates.lastBody()).toEqual({ content: '목록은 짧게', scope: 'ISSUE' })
  await expect(page.locator('[data-testid="ai-memory-group"][data-scope="ISSUE"]').getByTestId('ai-memory-content')).toHaveText('목록은 짧게')

  // 메일 → 공통으로(null).
  await page.locator('[data-testid="ai-memory-group"][data-scope="MAIL"]').getByTestId('ai-memory-edit').click()
  await page.getByTestId('ai-memory-edit-scope').click()
  await page.getByTestId('ai-memory-edit-scope-COMMON').click()
  await page.getByTestId('ai-memory-edit-submit').click()
  await mock.updates.waitFor(2)
  expect(mock.updates.lastBody()).toEqual({ content: '메일은 짧게', scope: null })

  // 내용만 고치면 scope 키가 없다.
  await rows(page).first().getByTestId('ai-memory-edit').click()
  await page.getByTestId('ai-memory-edit-input').fill('메일은 아주 짧게')
  await page.getByTestId('ai-memory-edit-submit').click()
  await mock.updates.waitFor(3)
  expect(mock.updates.lastBody()).toEqual({ content: '메일은 아주 짧게' })
})

test('가득 찬 범위로는 옮길 수 없지만 그 범위 안의 항목은 그대로 고칠 수 있다', async ({ authenticatedPage: page }) => {
  const issues = Array.from({ length: 50 }, (_, i) => memoryItem(50 - i, { scope: 'ISSUE', content: `이슈 메모 ${50 - i}` }))
  const mock = await mockAiMemories(page, [memoryItem(60, { content: '공통 하나' }), ...issues])
  await openMemorySettings(page)
  const issueGroup = page.locator('[data-testid="ai-memory-group"][data-scope="ISSUE"]')

  // 공통 항목 — 가득 찬 이슈로는 옮길 수 없다.
  await page.locator('[data-testid="ai-memory-group"][data-scope="COMMON"]').getByTestId('ai-memory-edit').click()
  await page.getByTestId('ai-memory-edit-scope').click()
  await expect(page.getByTestId('ai-memory-edit-scope-ISSUE')).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '취소' }).click()

  // 가득 찬 이슈 안의 항목 — 같은 범위라 선택은 열려 있고, 내용을 실제로 저장하면 scope 키 없이 PATCH 한다.
  await issueGroup.getByTestId('ai-memory-edit').first().click()
  await page.getByTestId('ai-memory-edit-scope').click()
  await expect(page.getByTestId('ai-memory-edit-scope-ISSUE')).not.toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  await page.getByTestId('ai-memory-edit-input').fill('이슈 메모 고침')
  await page.getByTestId('ai-memory-edit-submit').click()
  await mock.updates.waitFor()
  expect(mock.updates.lastBody()).toEqual({ content: '이슈 메모 고침' })
  expect(mock.updates.lastBody()).not.toHaveProperty('scope')
  await expect(issueGroup.getByTestId('ai-memory-content').first()).toHaveText('이슈 메모 고침')
})

test('직접 추가에서 범위를 고르면 그 범위로 만들어 새 묶음이 생긴다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, [memoryItem(3, { content: '첫째' })])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-add').click()
  await expect(page.getByTestId('ai-memory-add-scope')).toHaveText('공통 (모든 AI)')
  await page.getByTestId('ai-memory-add-scope').click()
  await page.getByTestId('ai-memory-add-scope-MAIL').click()
  await page.getByTestId('ai-memory-add-input').fill('메일 답장은 존댓말로')
  await page.getByTestId('ai-memory-add-submit').click()
  await mock.creates.waitFor()
  expect(mock.creates.lastBody()).toEqual({ kind: 'PREFERENCE', content: '메일 답장은 존댓말로', scope: 'MAIL' })
  await expect(page.locator('[data-testid="ai-memory-group"][data-scope="MAIL"]').getByTestId('ai-memory-content')).toHaveText(
    '메일 답장은 존댓말로',
  )
})

// WP-380: 날짜 표기는 KST 오늘(2026-10-14) 기준 — 브라우저 시간대·시계를 고정한다.
test.describe('기한 (WP-380)', () => {
  test.use({ timezoneId: 'Asia/Seoul' })
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.clock.setFixedTime(new Date('2026-10-14T03:00:00Z'))
  })

  test('기한은 메타 끝에 "…까지", 만료 행은 묶음 끝에 흐리게 + 삭제 예정일이고 한도에서 빠진다', async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, [
      memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true, updatedAt: '2026-10-12T12:00:00Z' }),
      memoryItem(5, { content: '이번 주는 결제 모듈 집중', expiresOn: '2026-10-24', expired: false, updatedAt: '2026-10-11T12:00:00Z' }),
      memoryItem(4, { content: '답은 존댓말로' }),
    ])
    await openMemorySettings(page)
    await expect(rows(page).getByTestId('ai-memory-content')).toHaveText(['이번 주는 결제 모듈 집중', '답은 존댓말로', '지난 출장 중'])
    await expect(rows(page).nth(0).getByTestId('ai-memory-meta')).toHaveText('AI가 저장 · 2026-10-11 · 10월 24일까지')
    await expect(rows(page).nth(2)).toHaveAttribute('data-expired', 'true')
    await expect(rows(page).nth(2).getByTestId('ai-memory-meta')).toContainText('만료됨 · 10월 10일까지 · 11월 10일에 지워져요')
    await expect(page.getByTestId('ai-memory-group-count')).toHaveText('2 / 50')
  })

  test('만료 행의 계속 기억은 clearExpiry, 기한 연장은 고른 날짜로 PATCH 한다', async ({ authenticatedPage: page }) => {
    const mock = await mockAiMemories(page, [
      memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true }),
      memoryItem(5, { content: '지난 스프린트', expiresOn: '2026-10-01', expired: true }),
    ])
    await openMemorySettings(page)
    const first = rows(page).filter({ hasText: '지난 출장 중' })
    await first.getByTestId('ai-memory-keep').click()
    await mock.updates.waitFor()
    expect(mock.updates.lastBody()).toEqual({ clearExpiry: true })
    await expect(rows(page).filter({ hasText: '지난 출장 중' })).not.toHaveAttribute('data-expired', 'true')

    const second = rows(page).filter({ hasText: '지난 스프린트' })
    await second.getByTestId('ai-memory-extend').click()
    await expect(page.getByTestId('ai-memory-extend-none')).toHaveCount(0)
    await page.getByTestId('ai-memory-extend-next-week').click()
    await mock.updates.waitFor(2)
    expect(mock.updates.lastBody()).toEqual({ expiresOn: '2026-10-21' })
  })

  // 되살리기 저장 중(목록 갱신 전)에는 「계속 기억」과 「기한 연장」이 함께 잠겨 두 번째 PATCH 가 겹치지 않는다.
  test('되살리기 저장 중에는 계속 기억과 기한 연장이 함께 잠긴다', async ({ authenticatedPage: page }) => {
    const mock = await mockAiMemories(page, [memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true })])
    await openMemorySettings(page)
    const list = gate()
    mock.holdNextList(list.p)
    const row = rows(page).first()
    await row.getByTestId('ai-memory-keep').click()
    await mock.updates.waitFor()
    await expect(row.getByTestId('ai-memory-keep')).toBeDisabled()
    await expect(row.getByTestId('ai-memory-extend')).toBeDisabled()
    list.release()
    await expect(rows(page).first()).not.toHaveAttribute('data-expired', 'true')
    expect(mock.updates.count()).toBe(1)
  })

  test('고치기에서 기한을 고르고 없앤다 — 오늘 이전 날짜는 고를 수 없다', async ({ authenticatedPage: page }) => {
    const mock = await mockAiMemories(page, [memoryItem(3, { content: '결제 모듈 집중' })])
    await openMemorySettings(page)
    await rows(page).first().getByTestId('ai-memory-edit').click()
    await expect(page.getByTestId('ai-memory-edit-expiry')).toHaveText('기한 없음')
    await page.getByTestId('ai-memory-edit-expiry').click()
    // data-day 는 day.date.toLocaleDateString()(en-US) — calendar-sidebar.spec 과 같은 방식.
    await expect(page.locator('button[data-day="10/13/2026"]')).toBeDisabled()
    await expect(page.locator('button[data-day="10/15/2026"]')).toBeEnabled()
    await page.getByTestId('ai-memory-edit-expiry-next-month').click()
    await expect(page.getByTestId('ai-memory-edit-expiry')).toHaveText('11월 14일까지')
    await page.getByTestId('ai-memory-edit-submit').click()
    await mock.updates.waitFor()
    expect(mock.updates.lastBody()).toEqual({ content: '결제 모듈 집중', expiresOn: '2026-11-14' })
    await expect(rows(page).first().getByTestId('ai-memory-expiry')).toHaveText('11월 14일까지')

    await rows(page).first().getByTestId('ai-memory-edit').click()
    await page.getByTestId('ai-memory-edit-expiry').click()
    await page.getByTestId('ai-memory-edit-expiry-none').click()
    await page.getByTestId('ai-memory-edit-submit').click()
    await mock.updates.waitFor(2)
    expect(mock.updates.lastBody()).toEqual({ content: '결제 모듈 집중', clearExpiry: true })
  })

  test('직접 추가에서 기한을 고르면 POST 에 expiresOn 을 싣는다', async ({ authenticatedPage: page }) => {
    const mock = await mockAiMemories(page, [])
    await openMemorySettings(page)
    await page.getByTestId('ai-memory-add').click()
    await page.getByTestId('ai-memory-add-expiry').click()
    await page.getByTestId('ai-memory-add-expiry-next-week').click()
    await page.getByTestId('ai-memory-add-input').fill('이번 주는 결제 모듈 집중')
    await page.getByTestId('ai-memory-add-submit').click()
    await mock.creates.waitFor()
    expect(mock.creates.lastBody()).toEqual({ kind: 'PREFERENCE', content: '이번 주는 결제 모듈 집중', expiresOn: '2026-10-21' })
  })

  test('만료 항목을 지우면 되돌리기가 없고, 기한 있는 항목은 되돌리기가 기한까지 다시 만든다', async ({ authenticatedPage: page }) => {
    const mock = await mockAiMemories(page, [
      memoryItem(6, { content: '지난 출장 중', expiresOn: '2026-10-10', expired: true }),
      memoryItem(5, { content: '이번 주는 결제 모듈 집중', expiresOn: '2026-10-24', expired: false, scope: 'ISSUE' }),
    ])
    await openMemorySettings(page)
    await rows(page).filter({ hasText: '지난 출장 중' }).getByTestId('ai-memory-delete').click()
    await mock.deletes.waitFor()
    await expect(page.getByText('메모리를 삭제했어요')).toBeVisible()
    await expect(page.getByRole('button', { name: '되돌리기' })).toHaveCount(0)

    await rows(page).filter({ hasText: '결제 모듈' }).getByTestId('ai-memory-delete').click()
    await mock.deletes.waitFor(2)
    await page.getByRole('button', { name: '되돌리기' }).click()
    await mock.creates.waitFor()
    expect(mock.creates.lastBody()).toEqual({
      kind: 'PREFERENCE',
      content: '이번 주는 결제 모듈 집중',
      scope: 'ISSUE',
      expiresOn: '2026-10-24',
    })
  })
})
