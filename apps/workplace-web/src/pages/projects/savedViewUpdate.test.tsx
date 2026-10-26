// 저장된 뷰 필터 갱신(#777)·남의 공유 뷰(WP-654) — 페이지 테스트(WP-971).
// 뷰 저장 → 필터 변경(dirty) → 「뷰 업데이트」가 같은 id 로 PATCH 하고 query 에 현재 필터를 담는지, 저장 버튼 비활성 조건,
// 남의 공유 뷰에서는 「새 뷰로 저장」만 보이는지는 브라우저 없이 판정되므로 e2e/pages/projects/saved-view-update.spec.ts 에서 옮겼다
// (그 spec 은 지웠다). E2E 의 새로고침 뒤 유지는 서버 흉내(views 배열)를 다시 받는 것이라 화면을 다시 띄워 같은 것을 본다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { SavedViewResponse } from '@/types/savedView'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'
const VIEWS = `/api/v1/projects/${KEY}/saved-views`

type Write = { method: string; path: string; body: { name: string; query: string; visibility: SavedViewResponse['visibility'] } }

/** 프로젝트·이슈 목록·저장된 뷰 — views 배열을 서버 상태로 쓰고 POST·PATCH 를 반영한다. 쓰기 요청은 writes 에 쌓는다. */
function viewApi(views: SavedViewResponse[]) {
  const writes: Write[] = []
  const handlers = [
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject())),
    http.get(`/api/v1/projects/${KEY}/views`, () => HttpResponse.json([])),
    http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json(createIssueSearchResponse([], null))),
    http.get(VIEWS, () => HttpResponse.json(views)),
    http.post(VIEWS, async ({ request }) => {
      const body = (await request.json()) as Write['body']
      writes.push({ method: 'POST', path: VIEWS, body })
      const created: SavedViewResponse = { id: views.length + 1, ...body, ownerId: 1, mine: true, pinned: false, createdAt: '', updatedAt: '' }
      views.push(created)
      return HttpResponse.json(created, { status: 201 })
    }),
    http.patch(`${VIEWS}/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Write['body']
      writes.push({ method: 'PATCH', path: `${VIEWS}/${params.id}`, body })
      const i = views.findIndex((v) => v.id === Number(params.id))
      views[i] = { ...views[i], ...body }
      return HttpResponse.json(views[i])
    }),
  ]
  return { handlers, writes }
}

/**
 * 브라우저 주소를 라우터 주소에 맞춘다 — renderPage 는 MemoryRouter 라 window.location 이 처음 주소에 머무는데,
 * 목록 화면 일부는 지금 주소를 window.location 으로 읽어(liveSearchParams, WP-955) 다시 쓰므로 그대로 두면 고른 필터가 지워진다.
 * 실제 브라우저에서는 둘이 늘 같다 — 주소가 바뀐 직후마다 맞춘다.
 */
function syncBrowserUrl(location: string) {
  window.history.replaceState(window.history.state, '', location)
}

/** 「+ 필터 › 우선순위 › 값」을 고르고 팝오버를 닫은 뒤, 주소에 값이 들어가면 브라우저 주소도 맞춘다. */
async function addPriority(user: ReturnType<typeof renderPage>['user'], value: string, location: () => string) {
  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-priority'))
  await user.click(await screen.findByTestId(`facet-value-priority-${value}`))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(priorities(location())).toContain(value))
  syncBrowserUrl(location())
}

/** 주소의 priority 값(순서 무관). */
const priorities = (location: string) => new URLSearchParams(location.split('?')[1] ?? '').get('priority')?.split(',').sort() ?? []

describe('저장된 뷰 갱신', () => {
  test('필터를 바꾸면 「뷰 업데이트」가 같은 id 로 PATCH 하고, 다시 띄워도 갱신된 필터가 복원된다 (#777)', async () => {
    const views: SavedViewResponse[] = []
    const api = viewApi(views)
    const first = renderPage(`/projects/${KEY}`, { handlers: api.handlers })
    const { user, location } = first
    await screen.findByTestId('add-filter-trigger', {}, { timeout: PAGE_LOAD_TIMEOUT })

    // 1) 필터(HIGH) 적용 후 뷰 저장 → POST.
    await addPriority(user, 'HIGH', location)
    await waitFor(() => expect(priorities(location())).toEqual(['HIGH']))
    await user.click(screen.getByTestId('save-view-button'))
    await user.click(await screen.findByTestId('save-view-name'))
    await user.paste('내 뷰')
    await user.click(screen.getByTestId('save-view-submit'))
    expect(await screen.findByTestId('view-chip-1')).toHaveTextContent('내 뷰')
    expect(api.writes.map((w) => w.method)).toEqual(['POST'])

    // 2) 저장 직후(필터 미변경) — 저장할 변경이 없어 저장 버튼 비활성, 업데이트 버튼 없음.
    await waitFor(() => expect(screen.getByTestId('save-view-button')).toBeDisabled())
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()

    // 3) 필터 변경(HIGH + MID) → dirty → 「뷰 업데이트」 등장.
    await addPriority(user, 'MID', location)
    await waitFor(() => expect(priorities(location())).toEqual(['HIGH', 'MID']))
    await user.click(await screen.findByTestId('update-view-button'))

    // 4) 같은 id(1)로 PATCH — 재생성(POST)이 아니고 query 는 지금 필터.
    await waitFor(() => expect(api.writes).toHaveLength(2))
    const patch = api.writes[1]
    expect(patch).toMatchObject({ method: 'PATCH', path: `${VIEWS}/1`, body: { name: '내 뷰' } })
    expect(patch.body.query).toMatch(/priority=/)
    expect(patch.body.query).toContain('HIGH')
    expect(patch.body.query).toContain('MID')

    // 5) 업데이트 뒤 다시 미변경 상태 — 저장 버튼 비활성으로 돌아온다.
    await waitFor(() => expect(screen.getByTestId('save-view-button')).toBeDisabled())

    // 6) 화면을 다시 띄워도(새로고침) 뷰 id 는 1이고, 칩을 누르면 갱신된 필터가 복원된다.
    first.unmount()
    const again = renderPage(`/projects/${KEY}`, { handlers: api.handlers })
    expect(await screen.findByTestId('view-chip-1', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('내 뷰')
    expect(priorities(again.location())).toEqual([])
    await again.user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(priorities(again.location())).toEqual(['HIGH', 'MID']))
  })

  // WP-654 — 남이 만든 공유 뷰는 소유자만 고칠 수 있다(서버 403). 조건을 바꿔도 「뷰 업데이트」 대신 「새 뷰로 저장」만 보인다.
  test('남의 공유 뷰를 고치면 「뷰 업데이트」 없이 「새 뷰로 저장」만 보이고 PATCH 하지 않는다 (WP-654)', async () => {
    const shared: SavedViewResponse = {
      id: 7, name: '남의 팀 뷰', query: 'priority=HIGH', visibility: 'SHARED', ownerId: 99, mine: false, pinned: false, createdAt: '', updatedAt: '',
    }
    const api = viewApi([shared])
    const { user, location } = renderPage(`/projects/${KEY}?${shared.query}`, { handlers: api.handlers })
    expect(await screen.findByTestId('view-chip-7', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent('남의 팀 뷰')
    await addPriority(user, 'MID', location)
    await waitFor(() => expect(priorities(location())).toEqual(['HIGH', 'MID']))

    const save = screen.getByTestId('save-view-button')
    expect(save).toBeEnabled()
    expect(save).toHaveTextContent('새 뷰로 저장')
    expect(screen.queryByTestId('update-view-button')).not.toBeInTheDocument()
    expect(api.writes).toEqual([])
  })
})
