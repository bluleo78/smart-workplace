// 모바일 노트 트리 행 액션(WP-237) — 휴대폰(<1024px, 터치)에선 hover ＋·⋯ 클러스터 대신 44px ⋯ 하나 → 액션 시트(하위 페이지 추가·삭제).
// 여기엔 ⋯ 크기·제목과의 배치·가로 넘침(@layout)만 남긴다 — 시트의 하위 페이지 추가(POST parentId)·삭제(DELETE) 요청은
// src/pages/mobile/wikiTreeActions.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

const SPACE = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
const TREE_PATH = /^\/api\/v1\/wiki\/spaces\/(\d+)\/pages$/
const PAGE_PATH = /^\/api\/v1\/wiki\/pages\/(\d+)$/

/** 공간 1개·페이지 1개 트리 모킹. */
async function mockWiki(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [SPACE] }))
  await page.route(
    (u) => TREE_PATH.test(u.pathname),
    (r) => r.fulfill({ json: [wikiPageSummary({ id: 101, title: '긴 제목의 개인 메모 페이지가 한 줄을 넘어가는 경우' })] }),
  )
  await page.route(
    (u) => PAGE_PATH.test(u.pathname),
    (r) => r.fulfill({ json: wikiPageDetail({ id: Number(PAGE_PATH.exec(new URL(r.request().url()).pathname)![1]), spaceId: 1, title: '개인 메모' }) }),
  )
}

test('⋯ 가 제목 옆에 44px 로 보이고 제목과 겹치지 않으며 가로로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockWiki(page)
  await page.goto('/wiki/spaces/1')
  const row = page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-101')
  const trigger = row.getByRole('button', { name: '페이지 메뉴' })
  await expect(trigger).toBeVisible()
  const t = (await trigger.boundingBox())!
  expect(t.width).toBeGreaterThanOrEqual(44)
  const title = (await row.getByRole('button', { name: '긴 제목의 개인 메모 페이지가 한 줄을 넘어가는 경우', exact: true }).boundingBox())!
  expect(title.x + title.width).toBeLessThanOrEqual(t.x)
  await expectNoHorizontalOverflow(page)
})
