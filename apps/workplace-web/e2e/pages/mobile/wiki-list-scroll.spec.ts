// 모바일 목록 스크롤 위치 복원(WP-1463) — 목록 → 상세 → 뒤로 오면 목록이 떠날 때의 스크롤 위치로 돌아온다.
// 모바일 list-detail 은 상세로 갈 때 목록 DOM 이 언마운트돼 돌아오면 맨 위였다. 복원 로직(useListScrollRestore)의
// 기록·인덱스·재시도는 vitest 가 지키고, 여기서는 실제 브라우저 레이아웃에서 스크롤 위치가 돌아오는지만 본다
// (jsdom 은 scrollTop·레이아웃을 잴 수 없어 @layout).
import type { Page } from '@playwright/test'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/mobile.fixture'

const SPACE = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
// 화면(390×844)보다 훨씬 긴 목록 — 끝까지 내려야 마지막 행이 보인다.
const PAGES = Array.from({ length: 60 }, (_, i) => wikiPageSummary({ id: 1000 + i, title: `페이지 ${i + 1}`, position: i }))
const LAST = PAGES[PAGES.length - 1]

const PAGE_PATH = /^\/api\/v1\/wiki\/pages\/(\d+)$/

/** 공간 1개·긴 페이지 트리·페이지 상세 모킹. */
async function mockWiki(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [SPACE] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/1/pages', (r) => r.fulfill({ json: PAGES }))
  await page.route(
    (u) => PAGE_PATH.test(u.pathname),
    (r) => {
      if (r.request().method() !== 'GET') return r.fallback()
      const id = Number(PAGE_PATH.exec(new URL(r.request().url()).pathname)![1])
      const summary = PAGES.find((p) => p.id === id)!
      return r.fulfill({ json: wikiPageDetail({ id, spaceId: 1, title: summary.title }) })
    },
  )
}

/** 목록 래퍼와 그 안의 요소 중 가장 큰 scrollTop — 어느 요소가 스크롤되든(래퍼·안쪽 nav) 위치를 잰다. */
function listScrollTop(page: Page) {
  return page.getByTestId('mobile-module-list').evaluate((root) => {
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
    return Math.max(...all.map((el) => el.scrollTop))
  })
}

test('노트 공간 목록을 끝까지 내려 마지막 페이지를 열고 뒤로 오면 목록이 그 위치로 돌아온다', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await mockWiki(page)
  await page.goto('/wiki/spaces/1')
  const list = page.getByTestId('mobile-module-list')
  const lastRow = list.getByTestId(`wiki-tree-row-${LAST.id}`)
  await lastRow.scrollIntoViewIfNeeded()
  await expect(lastRow).toBeInViewport()
  const before = await listScrollTop(page)
  expect(before).toBeGreaterThan(0)

  await lastRow.getByText(LAST.title).click()
  await expect(page).toHaveURL(new RegExp(`/wiki/spaces/1/pages/${LAST.id}$`))
  await expect(page.getByTestId('wiki-page-header')).toBeVisible()

  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/wiki\/spaces\/1$/)
  await expect(page.getByTestId('mobile-module-list').getByTestId(`wiki-tree-row-${LAST.id}`)).toBeInViewport()
  // 고해상도 화면에선 scrollTop 이 소수라 훅과 같은 1px 허용 오차로 본다.
  await expect.poll(async () => Math.abs((await listScrollTop(page)) - before)).toBeLessThan(1)
})
