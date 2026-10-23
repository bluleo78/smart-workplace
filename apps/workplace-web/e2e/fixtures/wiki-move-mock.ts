// 노트 「이동…」(WP-839) E2E 공용 모킹 — 실제 노트처럼 긴 제목을 섞은 3단계 트리와 옮기기(PATCH) 기록.
import type { Page } from '@playwright/test'

import type { WikiPageSummary } from '../../src/types/wiki'
import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../factories/wiki.factory'
import { trackRequests } from './requests'

const SPACE = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' })
const TREE_PATH = /^\/api\/v1\/wiki\/spaces\/1\/pages$/
const PAGE_PATH = /^\/api\/v1\/wiki\/pages\/(\d+)$/
const MOVE_PATH = /^\/api\/v1\/wiki\/pages\/(\d+)\/move$/

// 실제 노트처럼 긴 제목을 섞은 3단계 트리.
const TREE: WikiPageSummary[] = [
  wikiPageSummary({ id: 1, parentId: null, position: 0, title: '회의록' }),
  wikiPageSummary({ id: 2, parentId: 1, position: 0, title: '2026년 10월 정기 회의' }),
  wikiPageSummary({ id: 3, parentId: 2, position: 0, title: '10월 23일 — 노트 협업 기능 회고와 다음 분기 우선순위 정리' }),
  wikiPageSummary({ id: 4, parentId: 1, position: 1, title: '11월' }),
  wikiPageSummary({ id: 5, parentId: null, position: 1, title: '설계 문서' }),
  wikiPageSummary({ id: 6, parentId: 5, position: 0, title: '노트 동시 편집 설계' }),
  wikiPageSummary({ id: 7, parentId: null, position: 2, title: '신규 입사자 온보딩 가이드' }),
]

/** 공간·트리·페이지·옮기기(PATCH) 모킹 — 옮기기 요청 기록을 돌려준다. */
export async function mockWikiMoveTree(page: Page) {
  const moves = trackRequests(page, 'PATCH', MOVE_PATH)
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [SPACE] }))
  await page.route((u) => TREE_PATH.test(u.pathname), (r) => r.fulfill({ json: TREE }))
  await page.route((u) => MOVE_PATH.test(u.pathname), (r) => r.fulfill({ status: 204, body: '' }))
  await page.route(
    (u) => PAGE_PATH.test(u.pathname),
    (r) => {
      const id = Number(PAGE_PATH.exec(new URL(r.request().url()).pathname)![1])
      return r.fulfill({ json: wikiPageDetail({ id, spaceId: 1, title: TREE.find((p) => p.id === id)?.title ?? '' }) })
    },
  )
  await page.route('**/api/v1/wiki/pages/*/backlinks', (r) => r.fulfill({ json: [] }))
  await page.route('**/api/v1/wiki/pages/*/mentions', (r) => r.fulfill({ json: [] }))
  return moves
}
