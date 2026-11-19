// 노트 「최근」(WP-1764) 휴대폰 폭 레이아웃 — 노트 목록 화면 맨 위 「최근」으로 들어가 긴 제목·긴 경로 행이 가로로 넘치지 않고
// 제목 / 경로 / 마지막 활동 세 줄로 쌓인다. 폭·넘침·줄 쌓임은 jsdom 이 잴 수 없는 기하라 E2E(@layout)로 본다.
// 묶음·문구·이동·복사 판정은 vitest(wikiRecent.test.tsx · wikiSidebar.test.tsx).
import type { Page } from '@playwright/test'

import type { WikiRecentPage } from '../../../src/types/wiki'
import { wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'

test.use({ viewport: { width: 390, height: 844 } })

const recent: WikiRecentPage = {
  items: [
    {
      pageId: 101,
      title: '2026년 하반기 제품 로드맵 검토 회의록 및 분기별 실행 계획과 담당자별 후속 조치 정리 최종본',
      spaceId: 1,
      spaceName: '디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀',
      ancestorTitles: ['2026년 사업계획 및 예산 편성 자료 모음', '경영진 보고용 최종본 보관 폴더'],
      lastAction: 'EDIT',
      lastAt: new Date(Date.now() - 600_000).toISOString(),
      url: 'http://localhost/wiki/spaces/1/pages/101',
    },
  ],
  nextCursor: null,
}

/** 노트 목록 화면(사이드바)과 「최근」 응답 모킹. */
async function mockWiki(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' })] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/1/pages', (r) => r.fulfill({ json: [wikiPageSummary({ id: 5, title: '노트 하나' })] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/recent', (r) => r.fulfill({ json: recent }))
}

test.describe('노트 최근 — 휴대폰 폭 @layout', () => {
  test('모바일 390px 최근 목록이 가로로 넘치지 않는다', async ({ authenticatedPage: page }) => {
    await mockWiki(page)
    // 모바일 노트 목록 화면 — 맨 위에 「최근」이 있다.
    await page.goto('/wiki/spaces/1')
    const entry = page.getByTestId('wiki-nav-recent')
    await expect(entry).toBeVisible()
    await entry.click()
    await expect(page).toHaveURL(/\/wiki\/recent$/)

    const row = page.getByTestId('wiki-recent-row-101')
    await expect(row).toBeVisible()
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth <= 390,
      list: (() => {
        const list = document.querySelector('[data-testid="wiki-recent-list"]') as HTMLElement
        return list.scrollWidth <= list.clientWidth
      })(),
      row: (() => {
        const r = document.querySelector('[data-testid="wiki-recent-row-101"]') as HTMLElement
        return r.scrollWidth <= r.clientWidth
      })(),
    }))
    expect(overflow).toEqual({ page: true, list: true, row: true })

    // 제목 / 경로 / 마지막 활동이 위에서 아래로 세 줄 — 같은 줄에 겹쳐 있지 않다.
    const title = await row.getByRole('link').boundingBox()
    const path = await page.getByTestId('wiki-recent-path-101').boundingBox()
    const activity = await page.getByTestId('wiki-recent-activity-mobile-101').boundingBox()
    expect(title && path && activity).toBeTruthy()
    expect(path!.y).toBeGreaterThanOrEqual(title!.y + title!.height - 1)
    expect(activity!.y).toBeGreaterThanOrEqual(path!.y + path!.height - 1)

    // ⋯ 단추가 화면 안에 있다.
    const menu = await page.getByTestId('wiki-recent-menu-101').boundingBox()
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(390)
  })
})
