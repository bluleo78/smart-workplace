// @vitest-environment jsdom
// happy-dom(화면 테스트 기본, WP-1002)과 날짜 칸·글자 수 제한·포커스 이동 처리가 달라 이 파일은 jsdom 에서 돈다.
// 저장된 뷰(칩 줄·저장 다이얼로그) — 페이지 테스트(WP-971).
// 뷰 저장 버튼 활성 조건, POST/PATCH payload(쿼리 유지), 칩 적용 → URL, 삭제 확인·취소, 이름 검증(빈 값·60자),
// 같은 조건 뷰 단일 활성(WP-473), 예전 status 조건 복원(WP-808), 소유자 모더레이션 권한(WP-655)은
// 브라우저 없이 판정되므로 e2e/pages/projects/saved-views.spec.ts 에서 옮겼다.
// 호버 때만 보이는 ⋯(@input)과 긴 이름 칩 말줄임 폭(@layout)은 E2E 에 남는다.
// 칩 줄·필터 바·목록 검색이 한 화면이라 프로젝트 화면(ProjectDetailPage)만 renderScreen 으로 띄운다 — 앱 셸·인증 부팅은 건너뛴다(WP-1002).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'
import { atRoute } from '@/test/kits/projects/atRoute'
import { API, type Call, projectScreen, toCall } from '@/test/kits/projects/projectScreens'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { SavedViewResponse } from '@/types/savedView'

const KEY = 'WP'
const VIEWS = `${API}/projects/${KEY}/saved-views`

const view = (id: number, name: string, over: Partial<SavedViewResponse> = {}): SavedViewResponse => ({
  id,
  name,
  query: 'priority=HIGH',
  visibility: 'PRIVATE',
  ownerId: 1,
  mine: true,
  pinned: false,
  createdAt: '',
  updatedAt: '',
  ...over,
})

/**
 * 프로젝트 목록을 저장된 뷰 views 와 함께 연다 — 뷰 쓰기(POST·PATCH·DELETE)는 views 에 반영하고 calls 에 쌓는다.
 * extra: 테스트별 핸들러(앞에 두어 우선).
 */
async function openWithViews(initial: SavedViewResponse[], { path = `/projects/${KEY}`, extra = [] }: { path?: string; extra?: RequestHandler[] } = {}) {
  const views = [...initial]
  const calls: Call[] = []
  const api = projectScreen(KEY)
  const page = renderScreen(atRoute('/projects/:key', <ProjectDetailPage />), {
    path,
    handlers: [
      ...extra,
      http.get(VIEWS, () => HttpResponse.json(views)),
      http.post(VIEWS, async ({ request }) => {
        const c = await toCall(request)
        calls.push(c)
        const b = c.body as SavedViewResponse
        const created = view(views.length + 1, b.name, { query: b.query, visibility: b.visibility })
        views.push(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.all(`${VIEWS}/:id`, async ({ request, params }) => {
        const c = await toCall(request)
        calls.push(c)
        const i = views.findIndex((v) => v.id === Number(params.id))
        if (request.method === 'DELETE') {
          views.splice(i, 1)
          return new HttpResponse(null, { status: 204 })
        }
        views[i] = { ...views[i], ...(c.body as Partial<SavedViewResponse>) }
        return HttpResponse.json(views[i])
      }),
      ...api.handlers,
      ...shellHandlers,
    ],
  })
  await screen.findByTestId('save-view-button')
  return { ...page, calls, api }
}

/** 우선순위 높음 필터를 건다(＋필터 → 우선순위 → 높음). */
async function applyHighPriority(user: ReturnType<typeof renderScreen>['user'], location: () => string) {
  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-priority'))
  await user.click(await screen.findByTestId('facet-value-priority-HIGH'))
  await user.keyboard('{Escape}')
  await waitFor(() => expect(location()).toMatch(/priority=HIGH/))
}

/** 칩의 ⋯ 메뉴를 연다(호버 노출은 E2E 가 본다 — 여기서는 메뉴 버튼을 바로 누른다). */
async function openChipMenu(user: ReturnType<typeof renderScreen>['user'], id: number) {
  await user.click(await screen.findByTestId(`view-chip-menu-${id}`))
}

describe('뷰 저장', () => {
  // #146: 필터가 없으면(전체) 저장 버튼 비활성, 필터를 걸면 활성, 「전체」 칩으로 해제하면 다시 비활성.
  test('필터가 없으면 「뷰 저장」이 비활성이고 필터를 걸면 활성, 「전체」로 해제하면 다시 비활성', async () => {
    const { user, location } = await openWithViews([])
    expect(screen.getByTestId('save-view-button')).toBeDisabled()
    await applyHighPriority(user, location)
    expect(screen.getByTestId('save-view-button')).toBeEnabled()
    await user.click(screen.getByTestId('view-chip-all'))
    await waitFor(() => expect(screen.getByTestId('save-view-button')).toBeDisabled())
  })

  // 저장 → POST {name, visibility: PRIVATE, query ⊃ priority=HIGH} → 칩 등장 → 전체로 해제 → 칩으로 복원 → 삭제 확인 → DELETE → 칩 사라짐.
  test('필터를 저장하면 POST 후 칩이 생기고, 칩으로 필터를 되살리며, 확인 뒤 삭제된다', async () => {
    const { user, location, calls } = await openWithViews([])
    await applyHighPriority(user, location)
    await user.click(screen.getByTestId('save-view-button'))
    await user.type(await screen.findByTestId('save-view-name'), '내 HIGH')
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'POST', body: { name: '내 HIGH', visibility: 'PRIVATE' } })
    expect((calls[0].body as { query: string }).query).toContain('priority=HIGH')
    expect(await screen.findByTestId('view-chip-1')).toHaveTextContent('내 HIGH')

    await user.click(screen.getByTestId('view-chip-all'))
    await waitFor(() => expect(location()).not.toMatch(/priority=HIGH/))
    await user.click(screen.getByTestId('view-chip-1'))
    await waitFor(() => expect(location()).toMatch(/priority=HIGH/))

    await openChipMenu(user, 1)
    await user.click(await screen.findByTestId('view-delete-1'))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.queryByTestId('view-chip-1')).not.toBeInTheDocument())
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: `${VIEWS}/1` })
  })

  // #184: 빈 이름 제출 → 필드 오류·다이얼로그 유지, 입력하면 오류가 사라진다.
  test('이름 없이 저장하면 「뷰 이름을 입력하세요」가 보이고, 입력하면 사라진다', async () => {
    const { user, location, calls } = await openWithViews([])
    await applyHighPriority(user, location)
    await user.click(screen.getByTestId('save-view-button'))
    await user.click(await screen.findByTestId('save-view-submit'))
    expect(await screen.findByTestId('save-view-name-error')).toHaveTextContent('뷰 이름을 입력하세요')
    expect(screen.getByTestId('save-view-name')).toBeInTheDocument()
    await user.type(screen.getByTestId('save-view-name'), '테스트')
    await waitFor(() => expect(screen.queryByTestId('save-view-name-error')).not.toBeInTheDocument())
    expect(calls).toHaveLength(0)
  })

  // WP-474: 이름은 서버 상한 60자 — 입력이 60자에서 멈추고, 그보다 긴 예전 이름은 저장 전에 필드 오류로 막는다.
  test('이름 입력은 60자에서 멈추고, 70자 예전 이름을 그대로 저장하려 하면 필드 오류로 막는다', async () => {
    const { user, calls } = await openWithViews([view(1, '가'.repeat(70))], { path: `/projects/${KEY}?priority=LOW` })
    await user.click(screen.getByTestId('save-view-button'))
    const name = await screen.findByTestId<HTMLInputElement>('save-view-name')
    await user.click(name)
    await user.paste('나'.repeat(120))
    expect(name).toHaveValue('나'.repeat(60))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('save-view-name')).not.toBeInTheDocument())

    await openChipMenu(user, 1)
    await user.click(await screen.findByTestId('view-edit-1'))
    await user.click(await screen.findByTestId('save-view-submit'))
    expect(await screen.findByTestId('save-view-name-error')).toHaveTextContent('뷰 이름은 60자 이하로 입력하세요')
    expect(screen.getByTestId('save-view-name')).toHaveAttribute('aria-invalid', 'true')
    expect(calls).toHaveLength(0)
  })
})

describe('뷰 수정·삭제', () => {
  // #188: 삭제 확인창에 뷰 이름, 취소하면 닫히고 요청 없이 칩이 남는다.
  test('삭제 확인창은 뷰 이름을 보이고, 취소하면 요청 없이 칩이 남는다', async () => {
    const { user, calls } = await openWithViews([view(1, '취소테스트뷰')])
    await openChipMenu(user, 1)
    await user.click(await screen.findByTestId('view-delete-1'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('취소테스트뷰')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(calls).toHaveLength(0)
    expect(screen.getByTestId('view-chip-1')).toBeInTheDocument()
  })

  // ⋯ → 수정: 기존 이름 프리필, 이름·가시성(PRIVATE→SHARED) 변경 → PATCH {name, query 유지, visibility} → 칩에 새 이름·공유 아이콘.
  test('수정하면 PATCH 에 새 이름·SHARED 와 기존 쿼리가 실리고 칩에 공유 표시가 붙는다', async () => {
    const { user, calls } = await openWithViews([view(1, '원래이름')])
    expect(await screen.findByTestId('view-chip-1')).toHaveTextContent('원래이름')
    await openChipMenu(user, 1)
    await user.click(await screen.findByTestId('view-edit-1'))
    const name = await screen.findByTestId('save-view-name')
    expect(name).toHaveValue('원래이름')
    await user.clear(name)
    await user.type(name, '수정된이름')
    await user.click(screen.getByTestId('save-view-shared'))
    await user.click(screen.getByTestId('save-view-submit'))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { name: '수정된이름', query: 'priority=HIGH', visibility: 'SHARED' } })
    await waitFor(() => expect(screen.getByTestId('view-chip-1')).toHaveTextContent('수정된이름'))
    expect(within(screen.getByTestId('view-chip-1')).getByLabelText('공유')).toBeInTheDocument()
  })

  // WP-655: 프로젝트 소유자는 다른 멤버의 공유 뷰를 삭제만 할 수 있다(수정·고정은 뷰 소유자 전용).
  test('프로젝트 소유자에게 남의 공유 뷰 ⋯ 메뉴는 삭제만 있고, 확인하면 DELETE 가 나간다', async () => {
    const others = view(7, 'A의 공유 뷰', { visibility: 'SHARED', ownerId: 2, mine: false })
    const { user, calls } = await openWithViews([others], { extra: [membersWithMyRole('OWNER')] })
    await openChipMenu(user, 7)
    expect(await screen.findByTestId('view-delete-7')).toBeInTheDocument()
    expect(screen.queryByTestId('view-edit-7')).not.toBeInTheDocument()
    expect(screen.queryByTestId('view-pin-7')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('view-delete-7'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('A의 공유 뷰')
    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(calls).toEqual([expect.objectContaining({ method: 'DELETE', path: `${VIEWS}/7` })]))
  })

  test('일반 멤버에게는 남의 공유 뷰 ⋯ 메뉴가 없다', async () => {
    const others = view(7, 'A의 공유 뷰', { visibility: 'SHARED', ownerId: 2, mine: false })
    await openWithViews([others], { extra: [membersWithMyRole('MEMBER')] })
    expect(await screen.findByTestId('view-chip-7')).toBeInTheDocument()
    expect(screen.queryByTestId('view-chip-menu-7')).not.toBeInTheDocument()
  })
})

describe('뷰 적용', () => {
  // WP-473: 조건이 같은 뷰가 여럿이어도 고른 하나만 눌림.
  test('조건이 같은 뷰가 여럿이면 고른 뷰 하나만 활성이다', async () => {
    const { user, location } = await openWithViews([view(1, '첫 뷰'), view(2, '둘째 뷰'), view(3, '셋째 뷰')])
    await user.click(await screen.findByTestId('view-chip-2'))
    await waitFor(() => expect(location()).toMatch(/priority=HIGH/))
    expect(screen.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('view-chip-1')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByTestId('view-chip-3'))
    await waitFor(() => expect(screen.getByTestId('view-chip-3')).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByTestId('view-chip-2')).toHaveAttribute('aria-pressed', 'false')
  })

  // WP-808: 예전 뷰의 status 조건은 「상태 범주」 칩·status 파라미터로 복원된다(statusId 아님).
  test('예전 뷰의 status 조건은 상태 범주 칩과 status 파라미터로 복원된다', async () => {
    const { user, location, api } = await openWithViews([view(1, '진행 중 보기', { query: 'status=IN_PROGRESS' })])
    await user.click(await screen.findByTestId('view-chip-1'))
    await waitFor(() => expect(location()).toMatch(/status=IN_PROGRESS/))
    const chip = await screen.findByTestId('filter-chip-status')
    expect(chip).toHaveTextContent('상태 범주:')
    expect(chip).toHaveTextContent('진행 중')
    expect(screen.queryByTestId('filter-chip-statusId')).not.toBeInTheDocument()
    await waitFor(() => expect(api.searches.at(-1)?.searchParams.get('status')).toBe('IN_PROGRESS'))
    expect(api.searches.at(-1)?.searchParams.get('statusId')).toBeNull()
  })
})

/** WP-655: 프로젝트 멤버 목록 — 로그인한 사용자(id 1)의 역할을 정한다. */
function membersWithMyRole(role: 'OWNER' | 'MEMBER') {
  return http.get(`${API}/projects/${KEY}/members`, () =>
    HttpResponse.json([
      { userId: 1, username: 'me@test.local', name: '나', kind: 'HUMAN', role, createdAt: '' },
      { userId: 2, username: 'a@test.local', name: '멤버A', kind: 'HUMAN', role: 'MEMBER', createdAt: '' },
    ]),
  )
}
