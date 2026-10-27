// 뷰칩 활성 판정(#599) — 페이지 테스트(WP-980).
// 리스트/보드 전환이 저장된 뷰 쿼리와 view 파라미터만으로 우연히 일치해 「전체」 대신 저장뷰가 활성으로 보이던 회귀를 막는다.
// 활성 판정은 URL 상태와 클래스(켜짐 모양)라 브라우저 없이 판정되므로 e2e/pages/projects/view-chip-view-toggle.spec.ts 에서 옮겼다.
// 칩 줄과 리스트/보드 전환이 한 화면이라 프로젝트 화면(ProjectDetailPage)만 renderScreen 으로 띄운다 — 앱 셸·인증 부팅은 건너뛴다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'
import { atRoute } from '@/test/kits/projects/atRoute'
import { API, expectToggleLook, issueSearch, KEY, projectMeta } from '@/test/kits/projects/listBoard'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { SavedViewResponse } from '@/types/savedView'

function open(path: string, views: SavedViewResponse[]) {
  return renderScreen(atRoute('/projects/:key', <ProjectDetailPage />), {
    path,
    handlers: [
      ...projectMeta(),
      http.get(`${API}/projects/${KEY}/saved-views`, () => HttpResponse.json(views)),
      http.get(`${API}/projects/${KEY}/views`, () => HttpResponse.json([])),
      issueSearch(() => []).handler,
      ...shellHandlers,
    ],
  })
}

const view = (query: string, name: string): SavedViewResponse => ({
  id: 1, name, query, visibility: 'PRIVATE', ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '',
})

/** 「전체」·저장뷰(1) 칩의 켜짐 모양을 함께 본다. */
function expectChips({ all, saved }: { all: boolean; saved: boolean }) {
  expectToggleLook(screen.getByTestId('view-chip-all'), all)
  expectToggleLook(screen.getByTestId('view-chip-1'), saved)
}

const viewButton = (name: string) => within(screen.getByRole('group', { name: '뷰 전환' })).getByRole('button', { name })

describe('뷰칩 활성 판정 (#599)', () => {
  test('필터 없이 view=board 인 저장뷰가 있어도 보드 전환 시 「전체」만 활성', async () => {
    // 필터 없이 view=board 만 저장된 뷰 — 리스트/보드 토글이 만드는 URL 과 우연히 충돌하는 경우.
    const { user, location } = open(`/projects/${KEY}`, [view('view=board', '탐색 테스트 뷰')])
    await screen.findByTestId('view-chip-1')
    expectChips({ all: true, saved: false })

    // 보드로 바꿔도 필터가 없으니 「전체」가 활성, 저장뷰는 비활성이다.
    await user.click(viewButton('보드'))
    await waitFor(() => expect(location()).toMatch(/view=board/))
    expectChips({ all: true, saved: false })

    // 다시 리스트로 바꿔도 같다.
    await user.click(viewButton('리스트'))
    await waitFor(() => expect(location()).not.toMatch(/view=board/))
    expectChips({ all: true, saved: false })
  })

  test('필터가 있는 저장뷰는 view 와 무관하게 필터 일치 시 활성', async () => {
    // priority=HIGH 필터를 가진 저장뷰 — view 파라미터 없이 저장됨(리스트에서 저장).
    const { user, location } = open(`/projects/${KEY}?priority=HIGH`, [view('priority=HIGH', 'HIGH 필터 뷰')])
    await screen.findByTestId('view-chip-1')
    expectChips({ all: false, saved: true })

    // 보드로 바꿔도(view 만 바뀜) 저장뷰가 계속 활성 — view 는 활성 판정에서 빠지는 축이다.
    await user.click(viewButton('보드'))
    await waitFor(() => expect(location()).toMatch(/view=board/))
    expect(location()).toMatch(/priority=HIGH/)
    expectChips({ all: false, saved: true })
  })
})
