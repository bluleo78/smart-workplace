// 모바일 노트 트리 행 액션(WP-237) — 휴대폰(<1024px, 터치)에선 hover ＋·⋯ 클러스터 대신 44px ⋯ 하나 → 액션 시트(하위 페이지 추가·삭제).
import type { Page } from '@playwright/test'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'

const SPACE = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })
const TREE_PATH = /^\/api\/v1\/wiki\/spaces\/(\d+)\/pages$/
const PAGE_PATH = /^\/api\/v1\/wiki\/pages\/(\d+)$/

/** 공간 1개·페이지 1개 트리·생성(POST)·삭제(DELETE) 모킹. 요청 본문/호출 여부를 state 로 돌려준다. */
async function mockWiki(page: Page) {
  const state: { createBody: unknown; deleted: number[] } = { createBody: null, deleted: [] }
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [SPACE] }))
  await page.route(
    (u) => TREE_PATH.test(u.pathname),
    (r) => {
      if (r.request().method() === 'POST') {
        state.createBody = r.request().postDataJSON()
        return r.fulfill({ json: wikiPageDetail({ id: 300, spaceId: 1, parentId: 101, title: '', body: '' }) })
      }
      return r.fulfill({ json: [wikiPageSummary({ id: 101, title: '긴 제목의 개인 메모 페이지가 한 줄을 넘어가는 경우' })] })
    },
  )
  await page.route(
    (u) => PAGE_PATH.test(u.pathname),
    (r) => {
      const id = Number(PAGE_PATH.exec(new URL(r.request().url()).pathname)![1])
      if (r.request().method() === 'DELETE') {
        state.deleted.push(id)
        return r.fulfill({ status: 204, body: '' })
      }
      return r.fulfill({ json: wikiPageDetail({ id, spaceId: 1, title: '개인 메모' }) })
    },
  )
  return state
}

test('⋯ 가 제목 옆에 44px 로 보이고, 시트에서 하위 페이지 추가(POST parentId)·삭제(DELETE) 한다', async ({
  authenticatedPage: page,
}) => {
  const wiki = await mockWiki(page)
  await page.goto('/wiki/spaces/1')
  const row = page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-101')
  const trigger = row.getByRole('button', { name: '페이지 메뉴' })
  await expect(trigger).toBeVisible()
  await expect(row.getByRole('button', { name: '하위 페이지' })).toHaveCount(0)
  const t = (await trigger.boundingBox())!
  expect(t.width).toBeGreaterThanOrEqual(44)
  const title = (await row.getByRole('button', { name: /긴 제목의 개인 메모/ }).boundingBox())!
  expect(title.x + title.width).toBeLessThanOrEqual(t.x)
  await expectNoHorizontalOverflow(page)

  // 하위 페이지 추가
  await trigger.tap()
  const sheet = page.getByTestId('wiki-tree-action-sheet')
  await expect(sheet).toBeVisible()
  await sheet.getByTestId('mobile-action-wiki-add-child').tap()
  await expect.poll(() => wiki.createBody).toEqual({ parentId: 101, title: '' })

  // 삭제 — 확인 다이얼로그를 거쳐 DELETE
  await page.goto('/wiki/spaces/1')
  await page.getByTestId('mobile-module-list').getByTestId('wiki-tree-row-101').getByRole('button', { name: '페이지 메뉴' }).tap()
  await page.getByTestId('wiki-tree-action-sheet').getByTestId('mobile-action-wiki-delete').tap()
  await page.getByTestId('wiki-delete-dialog').getByRole('button', { name: '삭제' }).tap()
  await expect.poll(() => wiki.deleted).toEqual([101])
})
