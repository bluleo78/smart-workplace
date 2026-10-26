// WP-386 설정 › AI 비서 › 메모리 「공용 메모리」 탭(데스크톱) — 탭 전환·쿼리 딥링크, 공간 목록 묶음·개수·검색칸(10개 초과), 목록 인피니트 스크롤,
// 검색(서버 q), 직접 추가 payload, 권한별 고치기·지우기, 조직 읽기 전용, 행 메타(대화에서 뽑힌 항목은 이름 없음).
// 여기엔 탭 전환·딥링크 배선(@wiring)과 인피니트 스크롤·좁은 폭 선택 상자(@layout)만 남는다. 공간 묶음·검색·추가·권한·메타·빈 공간·가득 참·
// 기록 대화상자는 src/pages/settings/shared/sharedMemory.test.tsx(화면 컴포넌트 테스트)가 지킨다.
import type { Page } from '@playwright/test'

import { openMemorySettings } from '../../fixtures/ai-memory-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockSharedMemory, openSharedMemory, sharedItem, sharedSpace } from '../../fixtures/shared-memory-mock'

const ORG = sharedSpace({ type: 'ORG', id: null, key: null, name: '조직', label: '조직', canAdd: false, canManage: false })
const WP = sharedSpace({})
const NOTE = sharedSpace({ type: 'WIKI_SPACE', id: 3, key: null, name: '개발팀 노트', label: '개발팀 노트', canAdd: true })
const rows = (page: Page) => page.getByTestId('shared-memory-row')

test('탭을 바꾸면 쿼리가 바뀌고, 딥링크는 그 공간을 고른 채 연다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

test('목록은 30개씩 보이고 끝에 닿으면 다음 묶음을 커서로 이어 받는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  const mock = await mockSharedMemory(page, { spaces: [WP], items: { 'PROJECT:12': Array.from({ length: 45 }, (_, i) => sharedItem(45 - i)) } })
  await openSharedMemory(page, 'PROJECT:12')
  await expect(rows(page)).toHaveCount(30)
  await expect(page.getByRole('button', { name: /더 보기/ })).toHaveCount(0) // 「N개 더 보기」 버튼은 없다
  await page.getByTestId('shared-memory-sentinel').scrollIntoViewIfNeeded()
  await expect(rows(page)).toHaveCount(45)
  expect(mock.lists.urls().map((u) => u.searchParams.get('cursor'))).toEqual([null, '30'])
  await expect(page.getByTestId('shared-space-count')).toHaveText('45 / 50')
})

test('설정 섹션의 입력 열이 좁은 노트북 폭에서는 공간을 선택 상자로 고르고, 넓으면 왼쪽 목록으로 고른다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
