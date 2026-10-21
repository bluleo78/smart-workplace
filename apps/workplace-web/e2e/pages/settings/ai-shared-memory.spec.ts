// WP-386 설정 › AI 비서 › 메모리 「공용 메모리」 탭(데스크톱) — 탭 전환·쿼리 딥링크, 공간 목록 묶음·개수·검색칸(10개 초과), 목록 인피니트 스크롤,
// 검색(서버 q), 직접 추가 payload, 권한별 고치기·지우기, 조직 읽기 전용, 행 메타(대화에서 뽑힌 항목은 이름 없음).
import type { Page } from '@playwright/test'

import { openMemorySettings } from '../../fixtures/ai-memory-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockSharedMemory, openSharedMemory, sharedItem, sharedSpace } from '../../fixtures/shared-memory-mock'

const ORG = sharedSpace({ type: 'ORG', id: null, key: null, name: '조직', label: '조직', canAdd: false, canManage: false })
const WP = sharedSpace({})
const NOTE = sharedSpace({ type: 'WIKI_SPACE', id: 3, key: null, name: '개발팀 노트', label: '개발팀 노트', canAdd: true })
const rows = (page: Page) => page.getByTestId('shared-memory-row')

test('탭을 바꾸면 쿼리가 바뀌고, 딥링크는 그 공간을 고른 채 연다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, { spaces: [ORG, WP, NOTE], items: { 'WIKI_SPACE:3': [sharedItem(1, { content: '용어집은 이 스페이스에 둔다' })] } })
  await openMemorySettings(page)
  await expect(page.getByTestId('ai-memory-toggle')).toBeVisible() // 기본은 내 메모리
  await page.getByRole('tab', { name: '공용 메모리' }).click()
  await expect(page).toHaveURL(/memoryTab=shared/)
  await expect(page.getByTestId('ai-memory-toggle')).toHaveCount(0) // 스위치는 내 메모리 탭에만
  await expect(page.getByTestId('ai-memory-card')).toContainText('팀이 함께 쓰는 메모리예요')

  await openSharedMemory(page, 'WIKI_SPACE:3')
  await expect(page.getByTestId('shared-space-item').and(page.locator('[aria-current="true"]'))).toHaveAttribute('data-space', 'WIKI_SPACE:3')
  await expect(page.getByTestId('shared-space-title')).toHaveText('개발팀 노트')
  await expect(rows(page)).toHaveText([/용어집은 이 스페이스에 둔다/])
  expect(mock.lists.lastUrl()?.searchParams.get('spaceType')).toBe('WIKI_SPACE')
  expect(mock.lists.lastUrl()?.searchParams.get('spaceId')).toBe('3')

  await page.getByTestId('shared-space-item').filter({ hasText: 'Smart Workplace(WP)' }).click()
  await expect(page).toHaveURL(/space=PROJECT%3A12/)
})

test('공간은 조직 지침·프로젝트·노트 스페이스로 묶이고 개수를 보이며, 10개를 넘으면 공간 검색칸이 생긴다', async ({ authenticatedPage: page }) => {
  await mockSharedMemory(page, { spaces: [ORG, WP, NOTE], items: { 'PROJECT:12': [sharedItem(1), sharedItem(2)] } })
  await openSharedMemory(page)
  const list = page.getByTestId('shared-space-list')
  // 시안 v2: 묶음 소제목은 「조직」, 그 안의 공간 이름이 「조직 지침」(거꾸로가 아니다).
  await expect(list.locator('p').first()).toHaveText('조직')
  await expect(page.getByTestId('shared-space-item').first()).toContainText('조직 지침')
  await expect(list).toContainText('프로젝트')
  await expect(list).toContainText('노트 스페이스')
  await expect(page.getByTestId('shared-space-item').filter({ hasText: 'Smart Workplace(WP)' })).toContainText('2')
  await expect(page.getByTestId('shared-space-search')).toHaveCount(0)

  const many = Array.from({ length: 11 }, (_, i) => sharedSpace({ id: 20 + i, key: `P${i}`, name: `프로젝트 ${i}`, label: `프로젝트 ${i}(P${i})` }))
  await mockSharedMemory(page, { spaces: [ORG, ...many] })
  await openSharedMemory(page)
  await page.getByTestId('shared-space-search').fill('P10')
  await expect(page.getByTestId('shared-space-item')).toHaveText([/프로젝트 10\(P10\)/])
})

test('목록은 30개씩 보이고 끝에 닿으면 다음 묶음을 커서로 이어 받는다', async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, { spaces: [WP], items: { 'PROJECT:12': Array.from({ length: 45 }, (_, i) => sharedItem(45 - i)) } })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(rows(page)).toHaveCount(30)
  await expect(page.getByRole('button', { name: /더 보기/ })).toHaveCount(0) // 「N개 더 보기」 버튼은 없다
  await page.getByTestId('shared-memory-sentinel').scrollIntoViewIfNeeded()
  await expect(rows(page)).toHaveCount(45)
  expect(mock.lists.urls().map((u) => u.searchParams.get('cursor'))).toEqual([null, '30'])
  await expect(page.getByTestId('shared-space-count')).toHaveText('45 / 50')
})

test('검색어는 서버 q 로 보내고 일치 개수·없음 문구를 보인다', async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, {
    spaces: [WP],
    items: { 'PROJECT:12': [sharedItem(1, { content: '배포는 API 먼저 한다' }), sharedItem(2, { content: '배포 전날 기능 동결' }), sharedItem(3, { content: '회의록은 당일에' })] },
  })
  await openSharedMemory(page, 'PROJECT:12')
  await page.getByTestId('shared-memory-search').fill('배포')
  await expect(rows(page)).toHaveCount(2)
  await expect(page.getByTestId('shared-memory-matched')).toHaveText('2개 일치')
  expect(mock.lists.lastUrl()?.searchParams.get('q')).toBe('배포')
  await page.getByTestId('shared-memory-search').fill('없는말')
  await expect(page.getByTestId('shared-memory-matched')).toHaveText("'없는말'과 일치하는 공용 메모리가 없어요.")
})

test('직접 추가는 그 공간으로 보내고 새 항목이 맨 위에 「내 이름 직접 추가」로 보인다', async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, { spaces: [WP], items: { 'PROJECT:12': [sharedItem(1)] } })
  await openSharedMemory(page, 'PROJECT:12')
  await page.getByTestId('shared-memory-add').click()
  await page.getByTestId('shared-memory-add-input').fill('  이슈 본문은 배경·할 일·완료 조건 순서로 쓴다 ')
  await page.getByTestId('shared-memory-add-submit').click()
  await mock.creates.waitFor()
  expect(mock.creates.lastBody()).toEqual({ spaceType: 'PROJECT', spaceId: 12, content: '이슈 본문은 배경·할 일·완료 조건 순서로 쓴다' })
  await expect(rows(page).first().getByTestId('shared-memory-content')).toHaveText('이슈 본문은 배경·할 일·완료 조건 순서로 쓴다')
  await expect(rows(page).first().getByTestId('shared-memory-meta')).toContainText('양동희 직접 추가')
  await expect(page.getByTestId('shared-space-item').filter({ hasText: 'Smart Workplace(WP)' })).toContainText('2')
})

test('고치기·지우기는 canEdit 인 행에만 보이고, 고치기는 PATCH·지우기는 DELETE 다', async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, {
    spaces: [WP],
    items: { 'PROJECT:12': [sharedItem(2, { content: '내가 요청한 규칙', origin: 'USER_REQUESTED', author: { name: '양동희' }, canEdit: true }), sharedItem(1, { content: '남의 규칙', origin: 'USER_ADDED', author: { name: '김철수' } })] },
  })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(rows(page).nth(0).getByTestId('shared-memory-edit')).toBeVisible()
  await expect(rows(page).nth(1).getByTestId('shared-memory-edit')).toHaveCount(0)
  await expect(rows(page).nth(1).getByTestId('shared-memory-delete')).toHaveCount(0)

  await rows(page).nth(0).getByTestId('shared-memory-edit').click()
  await page.getByTestId('shared-memory-edit-input').fill('고친 규칙')
  await page.getByTestId('shared-memory-edit-submit').click()
  await mock.updates.waitFor()
  expect(mock.updates.lastBody()).toEqual({ content: '고친 규칙' })
  await expect(rows(page).nth(0).getByTestId('shared-memory-content')).toHaveText('고친 규칙')

  await rows(page).nth(0).getByTestId('shared-memory-delete').click()
  await mock.deletes.waitFor()
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByText('지웠어요. 기록에서 되돌릴 수 있어요')).toBeVisible()
})

test('조직 지침은 관리자가 아니면 읽기만 — 추가 버튼·행 아이콘이 없다', async ({ authenticatedPage: page }) => {
  await mockSharedMemory(page, { spaces: [ORG], items: { ORG: [sharedItem(1, { content: '고객 이름은 문서에 쓰지 않는다', origin: 'USER_ADDED', author: { name: '관리자' } })] } })
  await openSharedMemory(page, 'ORG')
  await expect(page.getByTestId('shared-space-title')).toHaveText('조직 지침')
  await expect(page.getByTestId('shared-memory-full-hint')).toHaveCount(0)
  await expect(page.getByTestId('shared-space-hint')).toContainText('관리자만 바꿀 수 있어요')
  await expect(page.getByTestId('shared-memory-add')).toHaveCount(0)
  await expect(page.getByTestId('shared-memory-edit')).toHaveCount(0)
})

test('행 메타 — 요청·직접 추가는 이름, AI 정리·대화에서 기억은 이름 없이', async ({ authenticatedPage: page }) => {
  await mockSharedMemory(page, {
    spaces: [WP],
    items: {
      'PROJECT:12': [
        sharedItem(4, { origin: 'USER_REQUESTED', author: { name: '김철수' }, updatedAt: '2026-10-14T12:00:00Z' }),
        sharedItem(3, { origin: 'USER_ADDED', author: { name: '이영희' }, updatedAt: '2026-10-13T12:00:00Z' }),
        sharedItem(2, { origin: 'AI_CLEANED', updatedAt: '2026-10-12T12:00:00Z' }),
        sharedItem(1, { origin: 'AI_EXTRACTED', updatedAt: '2026-10-11T12:00:00Z' }),
      ],
    },
  })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(page.getByTestId('shared-memory-meta')).toHaveText([
    '김철수 요청 · 2026-10-14',
    '이영희 직접 추가 · 2026-10-13',
    'AI가 정리 · 2026-10-12',
    '대화에서 AI가 기억 · 2026-10-11',
  ])
})

test('읽을 공간이 하나도 없으면 안내만 보인다', async ({ authenticatedPage: page }) => {
  await mockSharedMemory(page, { spaces: [] })
  await openSharedMemory(page)
  await expect(page.getByTestId('shared-memory-tab')).toContainText('아직 볼 수 있는 공용 메모리 공간이 없어요')
})

test('가득 찬 공간은 추가 버튼이 꺼지고 이유 한 줄을 보인다(읽기 전용 공간엔 없다)', async ({ authenticatedPage: page }) => {
  const full = Array.from({ length: 50 }, (_, i) => sharedItem(i + 1))
  await mockSharedMemory(page, { spaces: [sharedSpace({ count: 50 })], items: { 'PROJECT:12': full } })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(page.getByTestId('shared-space-count')).toHaveText('50 / 50')
  await expect(page.getByTestId('shared-memory-add')).toBeDisabled()
  await expect(page.getByTestId('shared-memory-full-hint')).toHaveText(/가득 찼어요 — 지우거나 합친 뒤 추가할 수 있어요/)
  await expect(page.getByTestId('shared-memory-add')).toHaveAttribute('aria-describedby', 'shared-memory-full-hint')

  // 한 칸 남으면 안내는 사라지고 버튼이 켜진다.
  await mockSharedMemory(page, { spaces: [sharedSpace({ count: 49 })], items: { 'PROJECT:12': full.slice(1) } })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(page.getByTestId('shared-memory-add')).toBeEnabled()
  await expect(page.getByTestId('shared-memory-full-hint')).toHaveCount(0)
})

test('설정 섹션의 입력 열이 좁은 노트북 폭에서는 공간을 선택 상자로 고르고, 넓으면 왼쪽 목록으로 고른다', async ({ authenticatedPage: page }) => {
  await mockSharedMemory(page, { spaces: [ORG, WP, NOTE], items: { 'PROJECT:12': [sharedItem(1, { content: '배포는 API 먼저 올린다' })] } })
  // 1100px — 두 단 섹션의 입력 열(약 500px)이 공간 목록 + 목록 두 칸을 담기엔 좁다.
  await page.setViewportSize({ width: 1100, height: 800 })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(page.getByTestId('shared-space-select')).toBeVisible()
  await expect(page.getByTestId('shared-space-list')).toBeHidden()
  await expect(page.getByTestId('shared-space-title')).toBeHidden() // 이름은 선택 상자가 보인다
  await page.getByTestId('shared-space-select').click()
  await page.getByRole('option', { name: /개발팀 노트/ }).click()
  await expect(page).toHaveURL(/space=WIKI_SPACE%3A3/)

  // 넓히면 왼쪽 목록 두 칸으로 돌아온다.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByTestId('shared-space-list')).toBeVisible()
  await expect(page.getByTestId('shared-space-select')).toBeHidden()
  await expect(page.getByTestId('shared-space-title')).toHaveText('개발팀 노트')
})
