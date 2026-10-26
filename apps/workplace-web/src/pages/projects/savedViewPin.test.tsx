// 고정된 저장 뷰 삭제 → 사이드바 갱신(#614) — 페이지 테스트(WP-971).
// 삭제 뒤 상단 칩과 함께 사이드바 「고정된 뷰」 섹션도 사라지는지(pinnedViews 캐시 무효화)는 브라우저 없이 판정되므로
// e2e/pages/projects/saved-view-pin.spec.ts 에서 옮겼다. 그 spec 에는 고정 → 사이드바 → 이동 → 설정 화면의 여러 화면 흐름(@flow)과
// 호버로 연 메뉴의 앵커 좌표(@layout)가 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { PinnedSavedViewResponse, SavedViewResponse } from '@/types/savedView'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { createPageResponse } from '../../../e2e/fixtures/api-mock'

const KEY = 'WP'

test('고정된 뷰를 삭제하면 상단 칩과 사이드바 「고정된 뷰」 섹션이 함께 사라진다 (#614)', async () => {
  // 뷰가 이미 고정된 상태로 시작 — 삭제 뒤 저장 뷰·고정 뷰 목록이 모두 비고, 화면이 둘 다 다시 불러야 한다.
  let deleted = false
  const view: SavedViewResponse = {
    id: 10, name: '높은 우선순위', query: 'priority=HIGH', visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: true, createdAt: '', updatedAt: '',
  }
  const pinnedView: PinnedSavedViewResponse = {
    id: 10, projectId: 1, projectKey: KEY, projectName: '워크플레이스', name: '높은 우선순위', query: 'priority=HIGH', createdAt: '',
  }
  const { user } = renderPage(`/projects/${KEY}`, {
    handlers: [
      // 사이드바 프로젝트 목록 — 고정 뷰는 프로젝트 묶음 안에 보인다.
      http.get('/api/v1/projects', () => HttpResponse.json(createPageResponse([createProject({ id: 1, key: KEY, name: '워크플레이스' })]))),
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
      http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
      http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
      http.get(`/api/v1/projects/${KEY}/saved-views`, () => HttpResponse.json(deleted ? [] : [view])),
      http.delete(`/api/v1/projects/${KEY}/saved-views/10`, () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/v1/me/pinned-views', () => HttpResponse.json(deleted ? [] : [pinnedView])),
    ],
  })

  // 삭제 전 — 사이드바 고정 뷰 섹션에 보인다.
  expect(await screen.findByTestId('pinned-view-10', {}, { timeout: PAGE_LOAD_TIMEOUT })).toBeInTheDocument()
  expect(screen.getByTestId('sidebar-pinned-views')).toBeInTheDocument()

  // 칩 메뉴 › 삭제 → 확인 대화상자 → DELETE. (⋯ 는 호버 때만 보이지만 jsdom 은 투명도와 무관하게 누를 수 있다.)
  await user.click(await screen.findByTestId('view-chip-menu-10'))
  await user.click(await screen.findByTestId('view-delete-10'))
  const dialog = await screen.findByRole('alertdialog')
  await user.click(within(dialog).getByRole('button', { name: '삭제' }))

  // 삭제 뒤 — 상단 칩뿐 아니라 사이드바 고정 뷰 섹션도 바로 사라진다(pinnedViews 무효화).
  await waitFor(() => expect(screen.queryByTestId('view-chip-10')).not.toBeInTheDocument())
  await waitFor(() => expect(screen.queryByTestId('sidebar-pinned-views')).not.toBeInTheDocument())
})
