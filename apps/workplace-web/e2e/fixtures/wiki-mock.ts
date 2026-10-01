// 노트 스페이스 0개 → 생성 흐름 모킹(WP-143) — 데스크톱·모바일 빈 상태 spec 이 공유한다.
import type { Page } from '@playwright/test'

import type { WikiSpace } from '../../src/types/wiki'
import { wikiSpace } from '../factories/wiki.factory'

/**
 * 스페이스 목록은 POST 전엔 비어 있고, POST 후엔 새로 만든 스페이스 1개(id=newSpaceId)를 돌려준다.
 * 스페이스별 페이지 트리는 항상 빈 목록. POST payload 는 반환한 state.postBody 로 확인한다.
 */
export async function mockWikiNoSpaces(page: Page, newSpaceId: number) {
  const state: { created: WikiSpace | null; postBody: unknown } = { created: null, postBody: null }
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => {
    if (r.request().method() === 'POST') {
      state.postBody = r.request().postDataJSON()
      state.created = wikiSpace({ id: newSpaceId, name: (state.postBody as { name: string }).name, role: 'OWNER' })
      return r.fulfill({ json: state.created })
    }
    return r.fulfill({ json: state.created ? [state.created] : [] })
  })
  await page.route((u) => /^\/api\/v1\/wiki\/spaces\/\d+\/pages$/.test(u.pathname), (r) => r.fulfill({ json: [] }))
  return state
}
