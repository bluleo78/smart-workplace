// 프로젝트 구성요소(WP-933) — 화면 컴포넌트·페이지 테스트(WP-971, WP-995).
// 설정의 편집·보관·복원·삭제 요청과 400 인라인 오류, 이슈 상세 피커의 PUT·보관 구성요소·400 토스트, 만들기 창의 자동 지정 안내·
// componentIds 실림, 비구성원 접수 창, 목록 필터의 component 파라미터·URL·열 칩, 구성요소가 없을 때 칸이 숨는 것은
// 브라우저 없이 판정되므로 e2e/pages/issue-components.spec.ts 에서 옮겼다. 설정 화면 배선(추가 → POST)은 그 spec 의 @wiring 이 지킨다.
// 분기 규칙 자체는 lib/issueComponents.test.ts·componentFacet.test.tsx·issueListColumnDefs.test.tsx, 훅을 끊은 분기는
// ComponentManagement.test.tsx·IssueComponentsField.test.tsx 가 맡는다 — 여기서는 MSW 로 api → 훅 → 화면을 지난다.
// 설정 섹션·상세 피커 칸·만들기 창은 renderScreen 으로 그 컴포넌트만 띄우고, 목록(필터 바·열 고르기·만들기 버튼이 한 화면)과
// 상세의 칩 갱신(피커 저장 뒤 상세 재조회가 칸에 다시 내려온다)·속성 레일 배치는 화면 전체가 있어야 해서 그 화면만
// renderProjectScreen·renderIssueDetailScreen 으로 띄운다(WP-1002 — App·인증 부팅·앱 셸 없이).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { IssueComponentsField } from '@/components/components/IssueComponentsField'
import { ComponentManagement } from '@/pages/projects/components/ComponentManagement'
import { IssueCreateDialog } from '@/pages/projects/components/IssueCreateDialog'
import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { renderProjectScreen } from '@/test/kits/projects/projectDetailScreen'
import { projectScreen } from '@/test/kits/projects/projectScreens'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { renderScreen } from '@/test/renderScreen'
import type { ComponentResponse } from '@/types/component'
import type { IssueResponse } from '@/types/issue'
import type { ProjectResponse } from '@/types/project'

import { createAssignee, createComponent, toComponentSummary } from '../../../e2e/factories/component.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { seedStatuses } from '../../../e2e/factories/projectStatus.factory'

const KEY = 'WP'
const BASE = `/api/v1/projects/${KEY}`
const PARK = createAssignee()
const MEMBERS = [
  createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
  createMember({ userId: 2, username: 'park', name: '박순', role: 'MEMBER', active: true }),
]

type Write = { method: string; path: string; body: unknown }

/**
 * 구성요소 서버 — 목록은 상태를 들고 있어 PATCH·DELETE 뒤 재조회가 바뀐 목록을 받는다(E2E setup 과 같다).
 * writes 는 쓰기 요청(메서드·경로·본문)을 순서대로 남긴다.
 */
function componentServer(initial: ComponentResponse[]) {
  let list = [...initial]
  const writes: Write[] = []
  const record = async (request: Request) => {
    const text = await request.text()
    const w = { method: request.method, path: new URL(request.url).pathname, body: text ? JSON.parse(text) : null }
    writes.push(w)
    return w
  }
  const handlers: RequestHandler[] = [
    http.get(`${BASE}/components`, () => HttpResponse.json(list)),
    http.patch(`${BASE}/components/:id`, async ({ request, params }) => {
      const { body } = await record(request)
      list = list.map((c) => (c.id === Number(params.id) ? { ...c, ...(body as Partial<ComponentResponse>) } : c))
      return HttpResponse.json(list.find((c) => c.id === Number(params.id)))
    }),
    http.delete(`${BASE}/components/:id`, async ({ request, params }) => {
      await record(request)
      list = list.filter((c) => c.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { handlers, writes, record }
}

/** 설정의 구성요소 섹션만 띄운다(OWNER — 관리 가능). 편집 창은 구성원 목록을 담당자 후보로 부른다. */
function renderSection(components: ComponentResponse[], extra: RequestHandler[] = []) {
  const server = componentServer(components)
  const view = renderScreen(<ComponentManagement projectKey={KEY} canManage />, {
    path: `/projects/${KEY}/settings`,
    handlers: [...extra, ...server.handlers, http.get(`${BASE}/members`, () => HttpResponse.json(MEMBERS))],
  })
  return { ...view, ...server }
}

describe('설정 — 구성요소 관리', () => {
  // 바뀐 필드만 PATCH(이름만 고치면 이름만), 보관 → 사용 중에서 빠지고 「보관한 구성요소 1개 보기」, 복원 → 다시 사용 중. 사용 중 행엔 삭제가 없다.
  test('편집은 바뀐 필드만 PATCH 로 가고, 보관 → 보관한 목록에서 복원한다', async () => {
    const { user, writes } = renderSection([
      createComponent({ id: 5, name: 'Compute', description: '기존 설명', defaultAssignee: PARK }),
    ])
    expect(await screen.findByTestId('component-row-5')).toHaveTextContent('Compute')

    await user.click(screen.getByRole('button', { name: 'Compute 편집' }))
    const input = await screen.findByTestId('component-name-input')
    await user.clear(input)
    await user.paste('Compute Core')
    await user.click(screen.getByTestId('component-save'))
    await waitFor(() => expect(writes).toEqual([{ method: 'PATCH', path: `${BASE}/components/5`, body: { name: 'Compute Core' } }]))
    await waitFor(() => expect(screen.queryByTestId('component-edit-dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('component-row-5')).toHaveTextContent('Compute Core'))

    expect(screen.queryByRole('button', { name: 'Compute Core 삭제' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Compute Core 보관' }))
    await waitFor(() => expect(writes.at(-1)?.body).toEqual({ archived: true }))
    expect(await screen.findByTestId('component-empty')).toBeInTheDocument()
    const toggle = screen.getByTestId('component-archived-toggle')
    expect(toggle).toHaveTextContent('보관한 구성요소 1개 보기')
    await user.click(toggle)
    expect(await screen.findByTestId('component-row-5')).toHaveTextContent('Compute Core')

    await user.click(screen.getByRole('button', { name: 'Compute Core 복원' }))
    await waitFor(() => expect(writes.at(-1)?.body).toEqual({ archived: false }))
    await waitFor(() => expect(screen.queryByTestId('component-archived-toggle')).not.toBeInTheDocument())
    expect(screen.getByTestId('component-row-5')).toHaveTextContent('Compute Core')
  })

  test('삭제는 보관한 구성요소에서만 — 확인창이 이슈 수를 알리고 DELETE 가 간다', async () => {
    const { user, writes } = renderSection([createComponent({ id: 6, name: '옛 영역', archived: true, issueCount: 3 })])
    await user.click(await screen.findByTestId('component-archived-toggle'))
    await user.click(await screen.findByRole('button', { name: '옛 영역 삭제' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('3')
    await user.click(screen.getByTestId('component-delete-confirm'))

    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', path: `${BASE}/components/6`, body: null }]))
    expect(await screen.findByText('구성요소를 삭제했어요')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('component-row-6')).not.toBeInTheDocument())
  })

  // 이름 중복 400 — 코드가 아니라 서버 문구가 편집 창 안에 보이고, 창과 입력은 남아 고쳐 다시 저장할 수 있다.
  test('추가 400 오류 문구가 편집 창 안에 보이고 창·입력이 남는다', async () => {
    const { user } = renderSection(
      [createComponent({ id: 1, name: 'Compute' })],
      [
        http.post(`${BASE}/components`, () =>
          HttpResponse.json(
            { status: 400, message: '같은 이름의 구성요소가 이미 있습니다', errors: { code: 'COMPONENT_NAME_TAKEN' } },
            { status: 400 },
          ),
        ),
      ],
    )
    await user.click(await screen.findByTestId('component-add'))
    await user.click(await screen.findByTestId('component-name-input'))
    await user.paste('compute')
    await user.click(screen.getByTestId('component-save'))

    expect(await screen.findByTestId('component-edit-error')).toHaveTextContent('같은 이름의 구성요소가 이미 있습니다')
    expect(screen.getByTestId('component-edit-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('component-name-input')).toHaveValue('compute')
  })
})

describe('이슈 상세 — 구성요소 칸', () => {
  // 피커는 닫을 때 한 번만 PUT 하고, 상세 재조회가 붙은 칩을 돌려준다. 칸은 속성 레일의 상태·담당 묶음 안(담당자 아래)에 놓인다.
  // 저장 뒤 칩이 바뀌는 것은 상세 재조회 → 레일 → 칸으로 내려오는 값이라 상세 화면 전체(renderIssueDetailScreen)로 본다.
  test('담당자 아래 피커로 붙이면 닫을 때 PUT 본문이 componentIds 를 담고 칩이 바뀐다', async () => {
    const compute = createComponent({ id: 1, name: 'Compute' })
    const storage = createComponent({ id: 2, name: 'Storage' })
    const net = createComponent({ id: 3, name: 'Network' })
    const all = [compute, storage, net]
    let attached = [toComponentSummary(compute)]
    const puts: unknown[] = []
    const issue = () => createIssue({ id: 1, number: 1, title: '결제 모듈 개편', components: attached })
    const { user } = renderIssueDetailScreen(`/projects/${KEY}/issues/1`, {
      handlers: [
        http.get(`${BASE}/components`, () => HttpResponse.json(all)),
        http.put(`${BASE}/issues/1/components`, async ({ request }) => {
          const { componentIds } = (await request.json()) as { componentIds: number[] }
          puts.push({ componentIds })
          attached = all.filter((c) => componentIds.includes(c.id)).map(toComponentSummary)
          return HttpResponse.json(attached)
        }),
        ...issueDetailHandlers({ members: MEMBERS, detail: () => createIssueDetail({ summary: issue() }) }),
      ],
    })
    const group = await screen.findByTestId('property-group-status-people', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    const field = await within(group).findByTestId('issue-components-field')
    expect(within(field).getByTestId('issue-components')).toHaveTextContent('Compute')

    await user.click(within(field).getByTestId('component-picker-trigger'))
    const picker = await screen.findByTestId('component-picker')
    expect(within(within(picker).getByTestId('component-option-1')).getByRole('checkbox')).toBeChecked()
    await user.click(within(within(picker).getByTestId('component-option-3')).getByRole('checkbox'))
    expect(puts).toEqual([])
    await user.keyboard('{Escape}')

    await waitFor(() => expect(puts).toEqual([{ componentIds: [1, 3] }]))
    expect(await screen.findByText('구성요소를 저장했어요')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('issue-components')).toHaveTextContent('Network'))
    expect(screen.getByTestId('issue-components')).toHaveTextContent('Compute')
    expect(screen.getByTestId('issue-components')).not.toHaveTextContent('Storage')
    expect(puts).toHaveLength(1)
  })

  // 사용 중 구성요소가 없는 프로젝트에선 상세에 칸이 없다 — 목록 응답을 받은 뒤에 판정한다(받기 전엔 판정 자체를 미룬다).
  test('구성요소가 없으면 상세에 구성요소 칸이 없다', async () => {
    let served = false
    renderScreen(<IssueComponentsField projectKey={KEY} issueNumber={1} current={[]} />, {
      handlers: [
        http.get(`${BASE}/components`, () => {
          served = true
          return HttpResponse.json([])
        }),
      ],
    })
    await waitFor(() => expect(served).toBe(true))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('issue-components-field')).not.toBeInTheDocument()
  })

  // 피커엔 사용 중 + 이 이슈에 붙은 보관만(「보관됨」, 체크됨) — 안 붙은 보관은 없다. 붙이기 400 은 코드가 아니라 서버 문구를 토스트로.
  test('보관된 구성요소는 붙은 것만 피커에 「보관됨」으로 남고, 붙이기 400 은 서버 문구 토스트로 보인다', async () => {
    const active = createComponent({ id: 1, name: 'Compute' })
    const attachedArchived = createComponent({ id: 2, name: '옛 영역', archived: true })
    const otherArchived = createComponent({ id: 3, name: '폐기 영역', archived: true })
    const { user } = renderScreen(
      <IssueComponentsField projectKey={KEY} issueNumber={1} current={[toComponentSummary(attachedArchived)]} />,
      {
        handlers: [
          http.get(`${BASE}/components`, () => HttpResponse.json([active, attachedArchived, otherArchived])),
          http.put(`${BASE}/issues/1/components`, () =>
            HttpResponse.json(
              { status: 400, message: '보관된 구성요소는 새로 붙일 수 없습니다', errors: { code: 'COMPONENT_ARCHIVED' } },
              { status: 400 },
            ),
          ),
        ],
      },
    )
    await user.click(await screen.findByTestId('component-picker-trigger'))
    const picker = await screen.findByTestId('component-picker')
    expect(within(picker).getByTestId('component-option-1')).toBeInTheDocument()
    const archived = within(picker).getByTestId('component-option-2')
    expect(archived).toHaveTextContent('보관됨')
    expect(within(archived).getByRole('checkbox')).toBeChecked()
    expect(within(picker).queryByTestId('component-option-3')).not.toBeInTheDocument()

    await user.click(within(within(picker).getByTestId('component-option-1')).getByRole('checkbox'))
    await user.keyboard('{Escape}')
    expect(await screen.findByText('보관된 구성요소는 새로 붙일 수 없습니다')).toBeInTheDocument()
    expect(screen.queryByText('COMPONENT_ARCHIVED')).not.toBeInTheDocument()
  })
})

describe('만들기 창 — 구성요소', () => {
  /** 만들기 창만 띄운다. 이슈 POST 본문은 posts 에 남는다. project 로 비구성원(OPEN) 화면을 만든다. */
  function renderCreate(components: ComponentResponse[], project: Partial<ProjectResponse> = {}) {
    const posts: Record<string, unknown>[] = []
    const served = { components: false }
    const view = renderScreen(<IssueCreateDialog projectKey={KEY} open onOpenChange={() => {}} />, {
      path: `/projects/${KEY}`,
      handlers: [
        http.post(`${BASE}/issues`, async ({ request }) => {
          posts.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(createIssue({ id: 2, number: 2, title: '새 이슈' }), { status: 201 })
        }),
        http.get(`${BASE}/components`, () => {
          served.components = true
          return HttpResponse.json(components)
        }),
        http.get(`${BASE}/members`, () => HttpResponse.json(MEMBERS)),
        http.get(`${BASE}/types`, () => HttpResponse.json(systemTypes())),
        http.get(`${BASE}/statuses`, () => HttpResponse.json(seedStatuses())),
        ...projectScreen(KEY, { project: createProject({ key: KEY, ...project }) }).handlers,
      ],
    })
    return { ...view, posts, served }
  }

  /** 제목 칸을 채운다. */
  async function title(user: ReturnType<typeof renderScreen>['user'], value: string) {
    await user.click(await screen.findByLabelText(/^제목/))
    await user.paste(value)
  }

  /** 피커에서 구성요소 하나를 체크하고 닫는다. */
  async function pick(user: ReturnType<typeof renderScreen>['user'], id: number) {
    await user.click(screen.getByTestId('component-picker-trigger'))
    await user.click(within(await screen.findByTestId(`component-option-${id}`)).getByRole('checkbox'))
    await user.keyboard('{Escape}')
  }

  // 담당자 없는 Docs 만 고르면 안내가 없고, 담당자가 있는 Compute 를 더하면 「만들면 Compute 담당 박순 님이 맡아요」. 고른 것은 목록 순서로 실린다.
  test('구성요소를 고르면 자동 지정 안내가 보이고 POST 에 componentIds 가 실린다', async () => {
    const { user, posts } = renderCreate([
      createComponent({ id: 1, name: 'Compute', defaultAssignee: PARK }),
      createComponent({ id: 2, name: 'Docs' }),
    ])
    await screen.findByTestId('create-components-field')
    await title(user, '컴퓨트 장애 확인')
    await pick(user, 2)
    await waitFor(() => expect(screen.getByTestId('create-components')).toHaveTextContent('Docs'))
    expect(screen.queryByTestId('create-component-assign-hint')).not.toBeInTheDocument()
    await pick(user, 1)
    await waitFor(() => expect(screen.getByTestId('create-components')).toHaveTextContent('Compute'))
    expect(screen.getByTestId('create-component-assign-hint')).toHaveTextContent('만들면 Compute 담당 박순 님이 맡아요')

    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toMatchObject({ title: '컴퓨트 장애 확인', componentIds: [1, 2] })
  })

  test('구성요소를 안 고르면 POST 에 componentIds 가 없다', async () => {
    const { user, posts } = renderCreate([createComponent({ id: 1, name: 'Compute' })])
    await screen.findByTestId('create-components-field')
    await title(user, '그냥 이슈')
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).not.toHaveProperty('componentIds')
  })

  // OPEN 프로젝트의 비구성원은 접수만 — 같은 구성요소 데이터라도 칸·안내가 없고 POST 에도 없다(구성원일 때 칸이 보이는 것은 위 두 테스트가 양성 대조).
  test('비구성원이면 접수 안내만 보이고 구성요소 칸이 없으며 POST 에 componentIds 가 없다', async () => {
    const { user, posts, served } = renderCreate([createComponent({ id: 1, name: 'Compute', defaultAssignee: PARK })], {
      type: 'OPEN',
      viewerIsMember: false,
    })
    expect(await screen.findByTestId('create-intake-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('create-components-field')).not.toBeInTheDocument()
    expect(screen.queryByTestId('create-component-assign-hint')).not.toBeInTheDocument()
    await title(user, '접수 문의')
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).not.toHaveProperty('componentIds')
    // 제출까지 끝난 뒤에도 칸이 없고, 비구성원 창은 구성요소 목록을 부르지도 않는다 — 응답 전의 「없음」 으로 거짓 통과하지 않게 끝에서 다시 본다.
    expect(screen.queryByTestId('create-components-field')).not.toBeInTheDocument()
    expect(served.components).toBe(false)
  })
})

describe('이슈 목록 — 구성요소 필터·열', () => {
  /**
   * 목록(그룹 없음)을 띄우고 첫 행과 구성요소 응답이 도착한 뒤를 돌려준다 — 그 전의 「없다」 는 판정 전이라 의미가 없다.
   * 필터 바·열 고르기·만들기 버튼이 한 화면에 있어 프로젝트 상세 화면(renderProjectScreen)으로 띄운다.
   */
  async function openList(components: ComponentResponse[], issue: Partial<IssueResponse> = {}, query = '') {
    let served = false
    const screenApi = projectScreen(KEY, {
      search: () => [createIssue({ id: 1, number: 1, title: '결제 모듈 개편', ...issue })],
    })
    const view = renderProjectScreen(`/projects/${KEY}?group=none${query}`, {
      handlers: [
        http.get(`${BASE}/components`, () => {
          served = true
          return HttpResponse.json(components)
        }),
        http.get(`${BASE}/members`, () => HttpResponse.json(MEMBERS)),
        http.get(`${BASE}/types`, () => HttpResponse.json(systemTypes())),
        ...screenApi.handlers,
      ],
    })
    await screen.findByTestId('issue-row-1', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await waitFor(() => expect(served).toBe(true))
    // 응답이 그려질 틈을 준다.
    await new Promise((r) => setTimeout(r, 0))
    /** 에픽 패널 조회(type=…)를 뺀 이슈 목록 검색. */
    const searches = () => screenApi.searches.filter((u) => !u.searchParams.has('type'))
    return { ...view, searches }
  }

  /** 필터 후보·열 후보·만들기 창의 구성요소 칸 유무를 본다 — 숨김·노출 테스트가 같은 선택자를 써서 숨김 단언이 거짓 통과하지 않게 한다. */
  async function expectVisibility(user: ReturnType<typeof renderIssueDetailScreen>['user'], shown: boolean) {
    const check = (id: string) =>
      shown ? expect(screen.getByTestId(id)).toBeInTheDocument() : expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    // 구성요소 facet 은 「더 보기」 소속(WP-1020).
    await user.click(screen.getByTestId('quick-filter-more'))
    await screen.findByTestId('quick-filter-more-facet-status')
    check('quick-filter-more-facet-component')
    await user.keyboard('{Escape}')
    await user.click(screen.getByTestId('issue-column-picker'))
    await screen.findByTestId('issue-column-option-assignee')
    check('issue-column-option-components')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '+ 새 태스크' }))
    const dialog = await screen.findByRole('dialog', { name: '새 이슈' })
    await within(dialog).findByLabelText(/^제목/)
    if (shown) expect(await within(dialog).findByTestId('create-components-field')).toBeInTheDocument()
    else expect(within(dialog).queryByTestId('create-components-field')).not.toBeInTheDocument()
  }

  test('구성요소가 없으면 필터 후보·열 후보·만들기 창에 구성요소가 없다', async () => {
    const { user } = await openList([])
    await expectVisibility(user, false)
  })

  test('사용 중 구성요소가 있으면 같은 자리(필터 후보·열 후보·만들기 창)에 나타난다', async () => {
    const { user } = await openList([createComponent({ id: 1, name: 'Compute' })])
    await expectVisibility(user, true)
  })

  // 필터: 고르면 목록 요청 component=1,2 와 URL·칩, 풀고 「구성요소 없음」 → none. 사용 중 값 뒤에 「보관됨」 머리글과 보관 값.
  // 열: 기본 열이 아니라 켜야 셀이 생기고, 칩 2개까지 + 나머지 +N.
  test('필터는 component 파라미터·URL 에 실리고(없음은 none), 보관됨 묶음이 뒤에 오며, 열을 켜면 칩 2개 + +N 이 보인다', async () => {
    const comps = [
      createComponent({ id: 1, name: 'Compute' }),
      createComponent({ id: 2, name: 'Storage' }),
      createComponent({ id: 3, name: 'Network' }),
      createComponent({ id: 4, name: '옛 영역', archived: true }),
    ]
    const { user, location, searches } = await openList(comps, { components: comps.slice(0, 3).map(toComponentSummary) })
    expect(searches().at(-1)?.searchParams.has('component')).toBe(false)

    await openQuickFacet(user, 'component')
    // 다른 facet 처럼 이슈 수는 보이지 않는다.
    expect(await screen.findByTestId('facet-value-component-1')).toHaveTextContent(/^Compute$/)
    const order = Array.from(
      document.querySelectorAll('[data-testid="facet-value-component-3"], [data-testid="facet-group-component-보관됨"], [data-testid="facet-value-component-4"]'),
    ).map((el) => el.getAttribute('data-testid'))
    expect(order).toEqual(['facet-value-component-3', 'facet-group-component-보관됨', 'facet-value-component-4'])
    await user.click(screen.getByTestId('facet-value-component-1'))
    await user.click(screen.getByTestId('facet-value-component-2'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(location()).toMatch(/component=1(%2C|,)2/))
    await waitFor(() => expect(searches().at(-1)?.searchParams.get('component')).toBe('1,2'))
    expect(screen.getByTestId('quick-filter-component')).toHaveAttribute('data-active', 'true')

    await user.click(screen.getByTestId('quick-filter-component-remove'))
    await waitFor(() => expect(location()).not.toMatch(/component=/))
    await openQuickFacet(user, 'component')
    await user.click(await screen.findByTestId('facet-value-component-none'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(location()).toMatch(/component=none/))
    await waitFor(() => expect(searches().at(-1)?.searchParams.get('component')).toBe('none'))

    expect(screen.queryByTestId('issue-row-1-components')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('issue-column-picker'))
    await user.click(await screen.findByTestId('issue-column-option-components'))
    await user.keyboard('{Escape}')
    const cell = await screen.findByTestId('issue-row-1-components')
    expect(cell).toHaveTextContent('Compute')
    expect(cell).toHaveTextContent('Storage')
    expect(cell).not.toHaveTextContent('Network')
    expect(cell).toHaveTextContent('+1')
    expect(screen.getByRole('columnheader', { name: '구성요소' })).toBeInTheDocument()
  })

  // 새로고침과 같다 — 주소의 필터가 첫 목록 요청부터 실리고 칩이 보인다.
  test('주소에 component 필터가 있으면 첫 목록 요청부터 그 파라미터가 실린다', async () => {
    const { searches } = await openList(
      [createComponent({ id: 1, name: 'Compute' }), createComponent({ id: 2, name: 'Storage' })],
      {},
      '&component=1,2',
    )
    expect(searches().length).toBeGreaterThan(0)
    expect(searches().every((u) => u.searchParams.get('component') === '1,2')).toBe(true)
    await waitFor(() => expect(screen.getByTestId('quick-filter-component')).toHaveAttribute('data-active', 'true'))
  })
})
