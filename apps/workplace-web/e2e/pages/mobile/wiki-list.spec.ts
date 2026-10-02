// 모바일 노트 목록(WP-178) — 노트는 "공간 → 페이지" 2단 목록. /wiki 진입 시 공간을 골라 그 페이지 트리를 목록으로 보이고,
// 공간을 바꿔도 목록(페이지 트리)에 머물며, 페이지만 상세로 연다(이전엔 공간 미정 빈 목록 → 공간 선택 시 "새 페이지 만들기" 빈 상태).
import type { Page } from '@playwright/test'

import type { WikiPageSummary } from '../../../src/types/wiki'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

const PERSONAL = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
const TEAM = wikiSpace({ id: 2, type: 'TEAM', name: '팀 위키', role: 'OWNER' })
const TREES: Record<number, WikiPageSummary[]> = {
  1: [wikiPageSummary({ id: 101, title: '개인 메모' })],
  2: [wikiPageSummary({ id: 42, title: '팀 회의록' })],
}

const TREE_PATH = /^\/api\/v1\/wiki\/spaces\/(\d+)\/pages$/
const PAGE_PATH = /^\/api\/v1\/wiki\/pages\/(\d+)$/

/** 공간 2개·공간별 페이지 트리·페이지 상세 모킹. 페이지 상세의 소속 공간·제목은 TREES 에서 도출한다. */
async function mockWiki(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [PERSONAL, TEAM] }))
  await page.route(
    (u) => TREE_PATH.test(u.pathname),
    (r) => r.fulfill({ json: TREES[Number(TREE_PATH.exec(new URL(r.request().url()).pathname)![1])] ?? [] }),
  )
  await page.route(
    (u) => PAGE_PATH.test(u.pathname),
    (r) => {
      if (r.request().method() !== 'GET') return r.fallback()
      const id = Number(PAGE_PATH.exec(new URL(r.request().url()).pathname)![1])
      const [spaceId, summary] = Object.entries(TREES)
        .map(([sid, tree]) => [Number(sid), tree.find((p) => p.id === id)] as const)
        .find(([, found]) => found)!
      return r.fulfill({ json: wikiPageDetail({ id, spaceId, title: summary!.title }) })
    },
  )
}

test('기록 없이 노트 진입 → 첫 공간이 선택되고 그 페이지 트리가 목록으로 보인다(탭바 유지)', async ({ authenticatedPage: page }) => {
  await mockWiki(page)
  await page.goto('/wiki')
  await expect(page).toHaveURL(/\/wiki\/spaces\/1$/)
  const list = page.getByTestId('mobile-module-list')
  await expect(list.getByRole('combobox')).toHaveText('내 위키')
  await expect(list.getByTestId('wiki-tree-row-101')).toBeVisible()
  await expect(page.getByTestId('wiki-empty-state')).toHaveCount(0)
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('공간을 바꾸면 목록에 머물러 그 공간의 페이지 트리를 보이고, 페이지는 상세로 열고 뒤로가기로 트리에 돌아온다', async ({
  authenticatedPage: page,
}) => {
  await mockWiki(page)
  await page.goto('/wiki')
  const list = page.getByTestId('mobile-module-list')
  await expect(list.getByTestId('wiki-tree-row-101')).toBeVisible()

  await list.getByRole('combobox').click()
  await page.getByRole('option', { name: '팀 위키' }).click()
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)
  await expect(list.getByTestId('wiki-tree-row-42')).toBeVisible()
  await expect(page.getByTestId('wiki-empty-state')).toHaveCount(0)
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()

  await list.getByTestId('wiki-tree-row-42').getByText('팀 회의록').click()
  await expect(page).toHaveURL(/\/wiki\/spaces\/2\/pages\/42$/)
  await expect(page.getByTestId('mobile-module-list')).toHaveCount(0)
  await expect(page.getByTestId('wiki-page-header')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)

  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)
  await expect(page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-42')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
})

test('마지막으로 본 페이지가 있으면 노트 진입 시 그 페이지가 아니라 그 페이지가 속한 공간의 목록에서 시작한다', async ({
  authenticatedPage: page,
}) => {
  await mockWiki(page)
  await page.goto('/wiki/spaces/2/pages/42')
  await expect(page.getByTestId('wiki-page-header')).toBeVisible()
  // 열람 기록이 남을 때까지 대기(WikiPageView 가 로드 완료 후 기록).
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('wiki.lastVisitedPage:'))))
    .toBe(true)

  await page.goto('/wiki')
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)
  await expect(page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-42')).toBeVisible()
})
