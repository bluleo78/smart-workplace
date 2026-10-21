// WP-55 설정 > AI 비서 > 메모리 카드(데스크톱) — 위치·목록·배지·메타, 제자리 편집(카운트·300자 초과), 삭제 토스트 되돌리기, 직접 추가(빈 값·초과 비활성·종류),
// 모두 지우기 확인, 스위치 꺼짐(흐림 + 편집 가능), 빈 상태, 270개 주황·300개 가득 참, 저장 실패 토스트.
// WP-379: 범위 묶음(순서·소제목·묶음 카운트), 편집·추가의 범위, 가득 찬 범위.
// WP-380: 기한 표기, 만료 행(흐림·삭제 예정일·기한 연장·계속 기억), 편집·추가의 기한 고르기.
// WP-383: 고정 토글(맨 위·메타·10개면 막힘 + 툴팁·409 토스트), 20개 초과 검색칸, 행 인피니트 스크롤(처음 30행, 끝에 닿으면 +30).
import type { Page } from '@playwright/test'

import { memoryItem, mockAiMemories, openMemorySettings } from '../../fixtures/ai-memory-mock'
import { mockAiPreferences } from '../../fixtures/ai-suggestions-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
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
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('2 / 300')
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

// Review Focus 3(코드포인트 300자 기준·카운트 색)은 src/lib/aiMemory.test.ts 가 맡고, 초과 시 UI 막힘은 직접 추가 폼 테스트가 대표로 본다(WP-409).
// F-j: 추가 폼과 행 고치기를 함께 열어도 두 입력란의 접근성 이름이 다르다.
test('추가 폼과 제자리 고치기 입력란은 서로 다른 이름으로 읽힌다', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [memoryItem(3, { content: '첫째' })])
  await openMemorySettings(page)
  await page.getByTestId('ai-memory-add').click()
  await rows(page).first().getByTestId('ai-memory-edit').click()
  await expect(page.getByRole('textbox', { name: '기억할 내용', exact: true })).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: '메모리 내용', exact: true })).toHaveValue('첫째')
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
  mock.failNext(409, 'AI_MEMORY_FULL', '메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')
  await page.getByRole('button', { name: '되돌리기' }).click()
  await mock.creates.waitFor()
  await expect(page.getByText('메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')).toBeVisible()
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
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('2 / 300')
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

test('270개면 묶음 카운트가 주황이고 추가는 된다 — 행은 처음 30개만 그리고 끝에 닿으면 30개씩 더 그린다(더 보기 버튼 없음)', async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, many(270))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('270 / 300')
  await expect(page.getByTestId('ai-memory-group-count')).toHaveClass(/text-warning-text/)
  await expect(page.getByTestId('ai-memory-add')).toBeEnabled()
  await expect(page.getByTestId('ai-memory-group-full')).toHaveCount(0)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveCount(0)

  await expect(rows(page)).toHaveCount(30)
  // 목록 끝 sentinel 을 화면으로 가져오면 다음 30행이 이어진다.
  await page.getByTestId('ai-memory-sentinel').scrollIntoViewIfNeeded()
  await expect.poll(async () => await rows(page).count()).toBeGreaterThan(30)
  // 끝까지 내려가면 전부 그려지고 그 뒤로는 더 늘지 않는다.
  await expect
    .poll(async () => {
      await page.getByTestId('ai-memory-sentinel').scrollIntoViewIfNeeded()
      return await rows(page).count()
    })
    .toBe(270)
  await expect(page.getByTestId('ai-memory-group-more')).toHaveCount(0)
})

test('공통 300개면 공통 묶음에 가득 참 경고, 추가는 열리고 기본 범위는 이슈이며 공통은 고를 수 없다', async ({ authenticatedPage: page }) => {
  const mock = await mockAiMemories(page, many(300))
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-group-count')).toHaveText('가득 참 · 300 / 300')
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
  mock.failNext(409, 'AI_MEMORY_FULL', '메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')
  await page.getByTestId('ai-memory-add').click()
  await page.getByTestId('ai-memory-add-input').fill('새 메모리')
  await page.getByTestId('ai-memory-add-submit').click()
  await expect(page.getByText('메모리가 가득 찼어요(최대 300개). 필요 없는 항목을 지워 주세요')).toBeVisible()
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
  const issues = Array.from({ length: 300 }, (_, i) => memoryItem(300 - i, { scope: 'ISSUE', content: `이슈 메모 ${300 - i}` }))
  const mock = await mockAiMemories(page, [memoryItem(400, { content: '공통 하나' }), ...issues])
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
    await expect(page.getByTestId('ai-memory-group-count')).toHaveText('2 / 300')
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

test.describe('고정·검색 (WP-383)', () => {
  test('핀을 누르면 PUT 으로 고정하고 묶음 맨 위로 올라가며 메타에 "고정"이 붙는다 — 다시 누르면 푼다', async ({ authenticatedPage: page }) => {
    const mock = await mockAiMemories(page, [
      memoryItem(3, { content: '가장 최신' }),
      memoryItem(2, { content: '중간' }),
      memoryItem(1, { content: '오래된 것' }),
    ])
    await openMemorySettings(page)
    const old = rows(page).filter({ hasText: '오래된 것' })
    await expect(old.getByTestId('ai-memory-pin')).toHaveAttribute('aria-pressed', 'false')
    await old.getByTestId('ai-memory-pin').click()
    await mock.pins.waitFor()
    expect(mock.pins.lastBody()).toEqual({ pinned: true })
    await expect(rows(page).getByTestId('ai-memory-content')).toHaveText(['오래된 것', '가장 최신', '중간'])
    await expect(rows(page).nth(0).getByTestId('ai-memory-pinned')).toBeVisible()
    await expect(rows(page).nth(0).getByTestId('ai-memory-meta')).toContainText('고정')
    await expect(rows(page).nth(0).getByTestId('ai-memory-pin')).toHaveAttribute('aria-pressed', 'true')

    await rows(page).nth(0).getByTestId('ai-memory-pin').click()
    await mock.pins.waitFor(2)
    expect(mock.pins.lastBody()).toEqual({ pinned: false })
    await expect(rows(page).getByTestId('ai-memory-content')).toHaveText(['가장 최신', '중간', '오래된 것'])
  })

  test('범위 고정이 10개면 고정 안 된 행의 핀이 막히고 툴팁으로 이유를 알린다 — 고정 풀기는 된다', async ({ authenticatedPage: page }) => {
    const pinnedTen = Array.from({ length: 10 }, (_, i) => memoryItem(20 - i, { pinned: true, content: `고정 ${i}` }))
    const mock = await mockAiMemories(page, [...pinnedTen, memoryItem(5, { content: '보통' })])
    await openMemorySettings(page)
    const plain = rows(page).filter({ hasText: '보통' })
    const blocked = plain.getByTestId('ai-memory-pin')
    // 막힌 핀도 이름 있는 버튼(aria-disabled)이라 읽기 도구가 이유(툴팁 설명)를 듣는다. 흐림(opacity)은 겹치지 않는다.
    await expect(blocked).toHaveAttribute('aria-disabled', 'true')
    await expect(blocked).toHaveAccessibleName('고정')
    expect(await blocked.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await blocked.hover()
    await expect(page.getByRole('tooltip')).toHaveText('이 범위는 고정이 10개까지예요')
    // 눌러도 요청하지 않는다 — aria-disabled 라 Playwright click 은 기다리기만 하므로 그 자리를 마우스로 직접 누른다.
    await blocked.scrollIntoViewIfNeeded()
    const box = await stableBox(blocked)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect(mock.pins.count()).toBe(0)
    await expect(rows(page).nth(0).getByTestId('ai-memory-pin')).toBeEnabled()
    await expect(rows(page).nth(0).getByTestId('ai-memory-pin')).toHaveAccessibleName('고정')
  })

  test('20개 넘으면 검색칸이 생기고 내용으로 거르며 묶음 카운트는 그대로다 — 맞는 게 없으면 안내한다', async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, [memoryItem(30, { content: '고양이를 좋아한다' }), ...many(20)])
    await openMemorySettings(page)
    const search = page.getByTestId('ai-memory-search')
    await search.fill('고양이')
    await expect(rows(page).getByTestId('ai-memory-content')).toHaveText(['고양이를 좋아한다'])
    await expect(page.getByTestId('ai-memory-group-count')).toHaveText('1개 일치 · 21 / 300')
    await search.fill('없는 말')
    // 조사는 검색어 받침에 맞춘다 — 「없는 말」은 받침 있음 → 「과」(WP-679)
    await expect(page.getByTestId('ai-memory-search-empty')).toHaveText("'없는 말'과 일치하는 메모리가 없어요.")
    await expect(rows(page)).toHaveCount(0)
    await search.fill('')
    await expect(rows(page)).toHaveCount(21)
  })

  test('질의를 바꾸면 인피니트 스크롤이 처음 30행으로 돌아간다', async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, many(100))
    await openMemorySettings(page)
    await expect(rows(page)).toHaveCount(30)
    await expect
      .poll(async () => {
        await page.getByTestId('ai-memory-sentinel').scrollIntoViewIfNeeded()
        return await rows(page).count()
      })
      .toBe(100)
    // "메모리" 는 모든 행에 맞는다 — 질의가 바뀌면 다시 30행부터.
    await page.getByTestId('ai-memory-search').fill('메모리')
    await expect(rows(page)).toHaveCount(30)
  })

  test('키 큰 화면에서는 스크롤하지 않아도 sentinel 이 보이는 동안 계속 30행씩 더 그린다', async ({ authenticatedPage: page }) => {
    // 100행(약 5,000px)이 한 화면에 다 들어가는 높이 — 교차 이벤트가 다시 오지 않아도 observer 가 다시 붙어 이어서 늘어야 한다.
    await page.setViewportSize({ width: 1280, height: 7000 })
    await mockAiMemories(page, many(100))
    await openMemorySettings(page)
    await expect(rows(page)).toHaveCount(100)
  })

  test('검색칸이 사라지면 질의도 버려서 다시 20개를 넘었을 때 숨은 필터가 되살아나지 않는다', async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, [memoryItem(30, { content: '고양이를 좋아한다' }), ...many(20)])
    await openMemorySettings(page)
    await page.getByTestId('ai-memory-search').fill('고양이')
    await rows(page).getByTestId('ai-memory-delete').click()
    await expect(page.getByTestId('ai-memory-search')).toHaveCount(0)
    await expect(rows(page)).toHaveCount(20)
    await page.getByRole('button', { name: '되돌리기' }).click()
    await expect(page.getByTestId('ai-memory-search')).toHaveValue('')
    await expect(rows(page)).toHaveCount(21)
  })

  test('고정이 409 로 거절되면 목록을 다시 읽어 다른 곳에서 바뀐 상태를 맞춘다', async ({ authenticatedPage: page }) => {
    const mock = await mockAiMemories(page, [memoryItem(2, { scope: 'ISSUE', content: '이슈 메모' })])
    await openMemorySettings(page)
    const lists = trackRequests(page, 'GET', '/api/v1/users/me/ai-memories')
    mock.failNext(409, 'AI_MEMORY_PIN_FULL', '이슈 메모리 고정은 최대 10개예요. 다른 고정을 풀어 주세요')
    await rows(page).getByTestId('ai-memory-pin').click()
    await expect(page.getByText('이슈 메모리 고정은 최대 10개예요. 다른 고정을 풀어 주세요')).toBeVisible()
    await expect(rows(page).getByTestId('ai-memory-pin')).toHaveAttribute('aria-pressed', 'false')
    await lists.waitFor()
  })

  test('직접 추가·모두 지우기는 목록 위 도구 줄에 있어 행이 늘어도 밀려나지 않는다', async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, many(100))
    await openMemorySettings(page)
    const add = await page.getByTestId('ai-memory-add').boundingBox()
    const clear = await page.getByTestId('ai-memory-clear').boundingBox()
    const firstRow = await rows(page).first().boundingBox()
    expect(add!.y).toBeLessThan(firstRow!.y)
    expect(clear!.y).toBeLessThan(firstRow!.y)
    // 검색칸과 같은 줄이다.
    const search = await page.getByTestId('ai-memory-search').boundingBox()
    expect(Math.abs(add!.y + add!.height / 2 - (search!.y + search!.height / 2))).toBeLessThan(4)
  })
})
