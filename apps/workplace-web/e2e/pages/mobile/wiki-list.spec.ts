// 모바일 노트 목록(WP-178·179·180) — 노트는 "공간 → 페이지" 2단 목록. /wiki 진입 시 공간을 골라 그 페이지 트리를 목록으로 보이고,
// 공간을 바꿔도 목록(페이지 트리)에 머물며, 페이지만 상세로 연다(이전엔 공간 미정 빈 목록 → 공간 선택 시 "새 페이지 만들기" 빈 상태).
import type { Page } from '@playwright/test'

import type { WikiPageSummary } from '../../../src/types/wiki'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

const PERSONAL = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
const TEAM = wikiSpace({ id: 2, type: 'TEAM', name: '팀 위키', role: 'OWNER' })
// 페이지가 하나도 없는 공간(WP-179 빈 상태).
const EMPTY = wikiSpace({ id: 3, type: 'TEAM', name: '빈 노트', role: 'OWNER' })
const TREES: Record<number, WikiPageSummary[]> = {
  1: [wikiPageSummary({ id: 101, title: '개인 메모' })],
  2: [wikiPageSummary({ id: 42, title: '팀 회의록' })],
  3: [],
}
const CREATED_PAGE_ID = 300

const TREE_PATH = /^\/api\/v1\/wiki\/spaces\/(\d+)\/pages$/
const PAGE_PATH = /^\/api\/v1\/wiki\/pages\/(\d+)$/

/**
 * 공간 3개·공간별 페이지 트리·페이지 상세·페이지 생성 모킹. 트리는 테스트마다 복사해 생성(POST)이 다른 테스트에 새지 않게 한다.
 * 페이지 상세의 소속 공간·제목은 트리에서 도출한다. state.hidden 에 넣은 공간 id 는 목록에서 사라진다(삭제·권한 상실).
 */
async function mockWiki(page: Page) {
  const trees = structuredClone(TREES)
  const state: { hidden: number[]; createBody: unknown } = { hidden: [], createBody: null }
  await page.route(
    (u) => u.pathname === '/api/v1/wiki/spaces',
    (r) => r.fulfill({ json: [PERSONAL, TEAM, EMPTY].filter((sp) => !state.hidden.includes(sp.id)) }),
  )
  await page.route(
    (u) => TREE_PATH.test(u.pathname),
    (r) => {
      const spaceId = Number(TREE_PATH.exec(new URL(r.request().url()).pathname)![1])
      if (r.request().method() === 'POST') {
        state.createBody = r.request().postDataJSON()
        trees[spaceId].push(wikiPageSummary({ id: CREATED_PAGE_ID, title: '' }))
        return r.fulfill({ json: wikiPageDetail({ id: CREATED_PAGE_ID, spaceId, title: '', body: '' }) })
      }
      return r.fulfill({ json: trees[spaceId] ?? [] })
    },
  )
  await page.route(
    (u) => PAGE_PATH.test(u.pathname),
    (r) => {
      if (r.request().method() !== 'GET') return r.fallback()
      const id = Number(PAGE_PATH.exec(new URL(r.request().url()).pathname)![1])
      const [spaceId, summary] = Object.entries(trees)
        .map(([sid, tree]) => [Number(sid), tree.find((p) => p.id === id)] as const)
        .find(([, found]) => found)!
      return r.fulfill({ json: wikiPageDetail({ id, spaceId, title: summary!.title }) })
    },
  )
  return state
}

/** 열람 기록이 남을 때까지 대기(WikiPageView 가 로드 완료 후 기록). */
async function waitForLastPageRecorded(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('wiki.lastVisitedPage:'))))
    .toBe(true)
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
  await waitForLastPageRecorded(page)

  await page.goto('/wiki')
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)
  await expect(page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-42')).toBeVisible()
})

test('페이지가 없는 공간은 빈 상태를 보이고, [새 페이지 만들기]로 루트 페이지를 만들어 연다(WP-179)', async ({
  authenticatedPage: page,
}) => {
  const wiki = await mockWiki(page)
  await page.goto('/wiki/spaces/3')
  const list = page.getByTestId('mobile-module-list')
  const empty = list.getByTestId('wiki-no-pages')
  await expect(empty).toBeVisible()
  await expect(empty).toContainText('아직 페이지가 없습니다')
  await expect(list.locator('nav')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await empty.getByTestId('wiki-no-pages-create').click()
  await expect.poll(() => wiki.createBody).toEqual({ parentId: null, title: '' })
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/3/pages/${CREATED_PAGE_ID}$`))
  await expect(page.getByTestId('wiki-page-header')).toBeVisible()
})

test('빈 공간의 [AI 초안으로 시작]은 페이지를 만들고 초안 토픽 입력을 띄운다(WP-179)', async ({ authenticatedPage: page }) => {
  const wiki = await mockWiki(page)
  await page.goto('/wiki/spaces/3')
  await page.getByTestId('wiki-no-pages-ai-draft').click()
  await expect.poll(() => wiki.createBody).toEqual({ parentId: null, title: '' })
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/3/pages/${CREATED_PAGE_ID}$`))
  await expect(page.getByRole('dialog').getByRole('textbox')).toBeVisible()
})

test('페이지를 열지 않고 공간만 바꿔도 다음 노트 진입은 그 공간 목록에서 시작한다(WP-180)', async ({ authenticatedPage: page }) => {
  await mockWiki(page)
  await page.goto('/wiki')
  await expect(page).toHaveURL(/\/wiki\/spaces\/1$/)
  const list = page.getByTestId('mobile-module-list')
  await list.getByRole('combobox').click()
  await page.getByRole('option', { name: '팀 위키' }).click()
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)

  // 새 문서 로드로 앱 재실행을 대신한다(기록은 localStorage).
  await page.goto('/wiki')
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)
  await expect(list.getByTestId('wiki-tree-row-42')).toBeVisible()
})

test('기억한 공간이 삭제·권한 상실로 사라졌으면 첫 공간 목록에서 시작한다(WP-180)', async ({ authenticatedPage: page }) => {
  const wiki = await mockWiki(page)
  await page.goto('/wiki/spaces/2')
  await expect(page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-42')).toBeVisible()

  wiki.hidden = [TEAM.id]
  await page.goto('/wiki')
  await expect(page).toHaveURL(/\/wiki\/spaces\/1$/)
  await expect(page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-101')).toBeVisible()
})

test('기억한 공간이 사라졌어도 마지막으로 본 페이지가 있으면 그 페이지의 공간 목록에서 시작한다(WP-180)', async ({
  authenticatedPage: page,
}) => {
  const wiki = await mockWiki(page)
  await page.goto('/wiki/spaces/2/pages/42')
  await expect(page.getByTestId('wiki-page-header')).toBeVisible()
  await waitForLastPageRecorded(page)
  // 페이지를 열지 않고 빈 노트로 공간만 바꾼 뒤, 그 공간이 사라진다.
  await page.goto('/wiki/spaces/3')
  await expect(page.getByTestId('wiki-no-pages')).toBeVisible()
  wiki.hidden = [EMPTY.id]

  await page.goto('/wiki')
  await expect(page).toHaveURL(/\/wiki\/spaces\/2$/)
  await expect(page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-42')).toBeVisible()
})
