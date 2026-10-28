// 노트 사이드바(스페이스 선택·만들기·삭제·멤버·트리 행 액션·이동 대화상자) — 화면 컴포넌트 테스트(WP-971, WP-995, WP-983).
// 폼 → payload, 응답 → 트리, 권한·조건부 렌더, 4xx 안내, 이동 주소는 브라우저 없이 판정되므로 아래 E2E 에서 옮겼다.
//   wiki-space-create · wiki-space-delete · wiki-members · wiki-tree · wiki-move-dialog(자기 하위 제외) · wiki-permissions(VIEWER 트리)
//   · wiki.spec(사이드바 삭제·스페이스 선택기)
// 끌어 옮기기(@input)·버튼 크기·터치 ⋯ 배치(@layout)는 E2E 에 남는다. 사이드바만 renderScreen 으로 띄운다(에디터 모듈을 불러오지 않는다).
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, onTestFinished, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { WikiMember, WikiPageSummary, WikiSpace } from '@/types/wiki'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../../e2e/factories/wiki.factory'
import { WikiSidebarRoutes } from './testkit-b3'

const PERSONAL = wikiSpace({ id: 1, type: 'PERSONAL', name: '내 노트', role: 'OWNER' })

type Opts = {
  path?: string
  spaces?: () => WikiSpace[]
  tree?: (spaceId: number) => WikiPageSummary[]
  handlers?: RequestHandler[]
}

/** 사이드바를 띄운다 — 스페이스·트리 조회는 함수로 받아 쓰기 뒤 재조회에 바뀐 값을 돌려줄 수 있다. */
function open({ path = '/wiki/spaces/1', spaces = () => [PERSONAL], tree = () => [], handlers = [] }: Opts = {}) {
  return renderScreen(<WikiSidebarRoutes />, {
    path,
    handlers: [
      ...handlers,
      http.get('/api/v1/wiki/spaces', () => HttpResponse.json(spaces())),
      http.get('/api/v1/wiki/spaces/:id/pages', ({ params }) => HttpResponse.json(tree(Number(params.id)))),
    ],
  })
}

/** 처리되지 않은 거부를 이 테스트 동안만 삼킨다(vitest 의 전역 감시를 잠시 떼었다가 되돌린다). */
function swallowRejections() {
  const listeners = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  const swallow = () => {}
  process.on('unhandledRejection', swallow)
  return () => {
    process.off('unhandledRejection', swallow)
    for (const l of listeners) process.on('unhandledRejection', l)
  }
}

/** 스페이스 선택 상자를 열어 「새 스페이스」 항목으로 만들기 대화상자를 띄운다. */
async function openCreateDialog(user: ReturnType<typeof renderScreen>['user']) {
  await user.click(await screen.findByRole('combobox'))
  await user.click(await screen.findByTestId('wiki-space-create-item'))
  return screen.findByTestId('wiki-space-create-dialog')
}

/** 행의 ⋯ 메뉴를 열어 항목을 고른다(호버로만 보이는 버튼이지만 DOM 에는 있다 — 호버 노출은 E2E 몫). */
async function rowMenu(user: ReturnType<typeof renderScreen>['user'], id: number, item: string) {
  const row = await screen.findByTestId(`wiki-tree-row-${id}`)
  await user.click(within(row).getByRole('button', { name: /페이지 메뉴$/ }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

// ── 스페이스 만들기(wiki-space-create) ─────────────────────────────────────────

test('드롭다운의 새 스페이스 → 이름만 POST 하고 새 스페이스로 이동하며 목록에 반영된다', async () => {
  let created: WikiSpace | null = null
  const posts: unknown[] = []
  const { user, location } = open({
    spaces: () => [PERSONAL, ...(created ? [created] : [])],
    handlers: [
      http.post('/api/v1/wiki/spaces', async ({ request }) => {
        const body = (await request.json()) as { name: string }
        posts.push(body)
        created = wikiSpace({ id: 5, type: 'TEAM', name: body.name, role: 'OWNER' })
        return HttpResponse.json(created)
      }),
    ],
  })
  await openCreateDialog(user)
  // placeholder 예시 문구는 「노트」 용어로 통일(#634).
  expect(screen.getByTestId('wiki-space-create-input')).toHaveAttribute('placeholder', '예: 제품팀 노트')
  await user.type(screen.getByTestId('wiki-space-create-input'), '제품팀 노트')
  await user.click(screen.getByTestId('wiki-space-create-confirm'))
  await waitFor(() => expect(location()).toBe('/wiki/spaces/5'))
  expect(posts).toEqual([{ name: '제품팀 노트' }])
  await user.click(await screen.findByRole('combobox'))
  expect(await screen.findByRole('option', { name: '제품팀 노트' })).toBeInTheDocument()
})

test('스페이스 이름이 비거나 공백뿐이면 만들기 버튼이 비활성이다', async () => {
  const { user } = open()
  await openCreateDialog(user)
  expect(screen.getByTestId('wiki-space-create-confirm')).toBeDisabled()
  await user.type(screen.getByTestId('wiki-space-create-input'), '   ')
  expect(screen.getByTestId('wiki-space-create-confirm')).toBeDisabled()
})

test('만들기 버튼을 같은 틱에 두 번 눌러도 생성 요청은 1번만 나간다', async () => {
  let posts = 0
  const { user, location } = open({
    handlers: [
      http.post('/api/v1/wiki/spaces', async ({ request }) => {
        posts++
        const { name } = (await request.json()) as { name: string }
        return HttpResponse.json(wikiSpace({ id: 5, name, role: 'OWNER' }))
      }),
    ],
  })
  await openCreateDialog(user)
  await user.type(screen.getByTestId('wiki-space-create-input'), '동시생성테스트공간')
  // React 가 disabled 를 반영하기 전에 두 번 — fireEvent 는 클릭마다 다시 그려 두 번째가 막히므로 원시 이벤트를 연달아 보낸다.
  const confirm = screen.getByTestId('wiki-space-create-confirm')
  act(() => {
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => expect(location()).toBe('/wiki/spaces/5'))
  expect(posts).toBe(1)
})

test('취소하고 다시 열면 이전 입력값이 남지 않는다', async () => {
  const { user } = open()
  await openCreateDialog(user)
  await user.type(screen.getByTestId('wiki-space-create-input'), '임시 테스트 스페이스')
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('wiki-space-create-dialog')).not.toBeInTheDocument())
  await openCreateDialog(user)
  expect(screen.getByTestId('wiki-space-create-input')).toHaveValue('')
})

test('이미 있는 이름이면 409 메시지를 인라인으로 보이고 대화상자를 유지한다(#696)', async () => {
  const { user, location } = open({
    handlers: [
      http.post('/api/v1/wiki/spaces', () =>
        HttpResponse.json({ message: '이미 존재하는 스페이스 이름입니다: 중복 스페이스' }, { status: 409 }),
      ),
    ],
  })
  await openCreateDialog(user)
  await user.type(screen.getByTestId('wiki-space-create-input'), '중복 스페이스')
  await user.click(screen.getByTestId('wiki-space-create-confirm'))
  expect(await screen.findByTestId('wiki-space-create-error')).toHaveTextContent('이미 존재하는 스페이스 이름입니다: 중복 스페이스')
  expect(screen.getByTestId('wiki-space-create-dialog')).toBeInTheDocument()
  expect(location()).toBe('/wiki/spaces/1')
})

test('스페이스 선택기는 shadcn Select(combobox)이고 다른 스페이스를 고르면 그 주소로 간다(#244)', async () => {
  const second = wikiSpace({ id: 2, type: 'PERSONAL', name: '두 번째 스페이스', role: 'OWNER' })
  const { user, location, container } = open({ spaces: () => [PERSONAL, second] })
  const trigger = await screen.findByRole('combobox')
  await waitFor(() => expect(trigger).toHaveTextContent('내 노트'))
  expect(container.querySelector('select')).toBeNull()
  await user.click(trigger)
  await user.click(await screen.findByRole('option', { name: '두 번째 스페이스' }))
  await waitFor(() => expect(location()).toBe('/wiki/spaces/2'))
})

// ── 스페이스 삭제(wiki-space-delete) ─────────────────────────────────────────

const TEAM = wikiSpace({ id: 2, name: '제품기획팀', role: 'OWNER' })
const TEAM_TREE = [
  wikiPageSummary({ id: 11, title: '제품 로드맵', position: 0 }),
  wikiPageSummary({ id: 12, parentId: 11, title: '2026 하반기', position: 0 }),
  wikiPageSummary({ id: 13, title: '회의록', position: 1 }),
]

/** 팀 스페이스(2)를 연 사이드바 — DELETE 응답 상태를 정하고, 성공하면 목록에서 팀이 빠진다. */
function openTeam(deleteStatus = 204, team: WikiSpace = TEAM) {
  let spaces: WikiSpace[] = [PERSONAL, team]
  const deletes: string[] = []
  const view = open({
    path: '/wiki/spaces/2',
    spaces: () => spaces,
    tree: (id) => (id === 2 ? TEAM_TREE : []),
    handlers: [
      http.delete('/api/v1/wiki/spaces/2', ({ request }) => {
        deletes.push(new URL(request.url).pathname)
        if (deleteStatus !== 204) return HttpResponse.json({ status: deleteStatus, message: '서버 오류' }, { status: deleteStatus })
        spaces = [PERSONAL]
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  return { ...view, deletes }
}

test('OWNER 가 ⋯ 메뉴에서 팀 스페이스를 지우면 페이지 수를 알린 뒤 DELETE 하고 /wiki 로 간다', async () => {
  const { user, location, deletes } = openTeam()
  await screen.findByText('회의록')
  await user.click(screen.getByTestId('wiki-space-menu'))
  await user.click(await screen.findByTestId('wiki-space-delete'))
  const dialog = await screen.findByTestId('wiki-space-delete-dialog')
  // 함께 지워지는 규모 — 하위 페이지까지 센 페이지 수와 스페이스 이름.
  expect(dialog).toHaveTextContent('"제품기획팀" 스페이스와 페이지 3개가 함께 영구 삭제됩니다')
  await user.click(within(dialog).getByTestId('wiki-space-delete-confirm'))
  expect(await screen.findByText('스페이스를 삭제했습니다')).toBeInTheDocument()
  expect(deletes).toEqual(['/api/v1/wiki/spaces/2'])
  // /wiki 의 첫 스페이스 이동은 wikiPage.test.tsx(WikiIndexRedirect)가 본다.
  await waitFor(() => expect(location()).toBe('/wiki'))
})

test('스페이스 삭제가 실패하면 서버 사유를 안내하고 확인 창을 남긴 채 그 스페이스에 머문다', async () => {
  const { user, location } = openTeam(500)
  await screen.findByText('회의록')
  await user.click(screen.getByTestId('wiki-space-menu'))
  await user.click(await screen.findByTestId('wiki-space-delete'))
  await user.click(await screen.findByTestId('wiki-space-delete-confirm'))
  expect(await screen.findByText('서버 오류')).toBeInTheDocument()
  expect(location()).toBe('/wiki/spaces/2')
  expect(screen.getByTestId('wiki-space-delete-confirm')).toBeEnabled()
})

test('팀 스페이스 OWNER 가 아니면 ⋯ 메뉴에 멤버만 있고 삭제는 없다', async () => {
  const { user } = openTeam(204, { ...TEAM, role: 'EDITOR' })
  await screen.findByText('회의록')
  await user.click(screen.getByTestId('wiki-space-menu'))
  expect(await screen.findByTestId('wiki-space-members')).toBeInTheDocument()
  expect(screen.queryByTestId('wiki-space-delete')).not.toBeInTheDocument()
})

// ── 스페이스 멤버(wiki-members) ─────────────────────────────────────────────

const teamSpace = (over: Partial<WikiSpace> = {}) => wikiSpace({ id: 1, type: 'TEAM', name: '팀 위키', role: 'OWNER', ...over })

test('OWNER 가 멤버를 검색해 추가하면 {userId, role: EDITOR} 를 POST 하고 목록에 반영한다', async () => {
  const members: WikiMember[] = [{ userId: 1, name: '나', role: 'OWNER' }]
  const adds: unknown[] = []
  const { user } = open({
    spaces: () => [teamSpace()],
    handlers: [
      http.get('/api/v1/wiki/spaces/1/members', () => HttpResponse.json(members)),
      http.post('/api/v1/wiki/spaces/1/members', async ({ request }) => {
        adds.push(await request.json())
        members.push({ userId: 2, name: '김편집', role: 'EDITOR' })
        return new HttpResponse(null, { status: 201 })
      }),
      // 멤버인 조직도 부서(WP-1052) — 없음. 추가 창(사람·조직 공통 선택 창)은 조직도를 받는다.
      http.get('/api/v1/wiki/spaces/1/member-groups', () => HttpResponse.json([])),
      http.get('/api/v1/user-groups', () => HttpResponse.json({ shared: [], personal: [] })),
      http.get('/api/v1/members', () =>
        HttpResponse.json({
          content: [
            { userId: 2, username: 'editor', email: 'e@x.com', name: '김편집', title: null, kind: 'HUMAN', active: true, membershipRole: 'MEMBER', membershipStatus: 'ACTIVE' },
          ],
          page: 0, size: 20, totalElements: 1, totalPages: 1,
        }),
      ),
    ],
  })
  await user.click(await screen.findByTestId('wiki-space-menu'))
  await user.click(await screen.findByTestId('wiki-space-members'))
  await screen.findByTestId('wiki-members-dialog')
  // 마지막 소유자(나)는 역할 변경이 잠기고, 역할은 한국어로 보인다.
  const mine = await screen.findByTestId('wiki-member-role-select-1')
  expect(mine).toBeDisabled()
  expect((mine as HTMLSelectElement).selectedOptions[0]).toHaveTextContent('소유자')
  await user.click(screen.getByTestId('wiki-member-add-trigger'))
  await screen.findByTestId('wiki-member-picker-search')
  await user.type(screen.getByLabelText('사람·팀 검색'), '김편집')
  // 검색어 결과가 오기 전(300ms debounce)의 사람 줄은 고를 수 없다 — 지금 검색어의 결과가 되어 고를 수 있을 때 누른다.
  await waitFor(() => expect(screen.getByTestId('wiki-member-picker-person-2')).not.toHaveAttribute('aria-disabled', 'true'))
  await user.click(screen.getByTestId('wiki-member-picker-person-2'))
  await waitFor(() => expect(adds).toEqual([{ userId: 2, role: 'EDITOR' }]))
  expect(await screen.findByTestId('wiki-member-row-2')).toHaveTextContent('김편집')
})

test('승격된 OWNER 의 내 행·생성자 행은 읽기 전용이고 다른 멤버 행만 편집할 수 있다(WP-656)', async () => {
  const members: WikiMember[] = [
    { userId: 9, name: '생성자', role: 'OWNER' },
    { userId: 1, name: '나', role: 'OWNER' },
    { userId: 3, name: '박열람', role: 'VIEWER' },
  ]
  const { user } = open({
    spaces: () => [teamSpace({ ownerId: 9 })],
    handlers: [
      http.get('/api/v1/wiki/spaces/1/members', () => HttpResponse.json(members)),
      http.get('/api/v1/wiki/spaces/1/member-groups', () => HttpResponse.json([])),
      http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
    ],
  })
  await user.click(await screen.findByTestId('wiki-space-menu'))
  await user.click(await screen.findByTestId('wiki-space-members'))
  expect(await screen.findByTestId('wiki-member-role-select-3')).toBeEnabled()
  expect(screen.getByTestId('wiki-member-role-select-1')).toBeDisabled()
  expect(screen.getByTestId('wiki-member-remove-1')).toBeDisabled()
  expect(screen.getByTestId('wiki-member-role-select-9')).toBeDisabled()
  expect(screen.getByTestId('wiki-member-remove-9')).toBeDisabled()
})

// ── 트리 행(wiki-tree · wiki.spec · wiki-permissions) ───────────────────────

test('하위 페이지 ＋ → POST {parentId, title: ""} 후 새 페이지로 이동하고 트리에 보인다(#596)', async () => {
  let created = false
  const creates: unknown[] = []
  const { user, location } = open({
    tree: () => [
      wikiPageSummary({ id: 1, title: '제품 문서' }),
      ...(created ? [wikiPageSummary({ id: 2, parentId: 1, title: '제목 없음' })] : []),
    ],
    handlers: [
      http.post('/api/v1/wiki/spaces/1/pages', async ({ request }) => {
        creates.push(await request.json())
        created = true
        return HttpResponse.json(wikiPageDetail({ id: 2, parentId: 1, title: '' }), { status: 201 })
      }),
    ],
  })
  const row = await screen.findByTestId('wiki-tree-row-1')
  await user.click(within(row).getByRole('button', { name: /하위 페이지 추가$/ }))
  // 「제목 없음」은 표시용 폴백일 뿐 — 저장 title 은 빈 문자열이다.
  await waitFor(() => expect(creates).toEqual([{ parentId: 1, title: '' }]))
  await waitFor(() => expect(location()).toBe('/wiki/spaces/1/pages/2'))
  expect(await screen.findByTestId('wiki-tree-row-2')).toBeInTheDocument()
})

test('사이드바 「새 페이지」는 최상위에 title "" 로 만든다(#596)', async () => {
  const creates: unknown[] = []
  const { user, location } = open({
    tree: () => [wikiPageSummary({ id: 1, title: '제품 문서' })],
    handlers: [
      http.post('/api/v1/wiki/spaces/1/pages', async ({ request }) => {
        creates.push(await request.json())
        return HttpResponse.json(wikiPageDetail({ id: 2, title: '' }), { status: 201 })
      }),
    ],
  })
  await screen.findByTestId('wiki-tree-row-1')
  await user.click(screen.getByRole('button', { name: '새 페이지' }))
  await waitFor(() => expect(creates).toEqual([{ parentId: null, title: '' }]))
  await waitFor(() => expect(location()).toBe('/wiki/spaces/1/pages/2'))
})

test('하위 페이지 생성이 400 이면 서버 사유를 토스트로 보인다(#758)', async () => {
  // 생성 훅(useCreateWikiPageAndOpen)은 mutateAsync 실패를 다시 던진다 — 브라우저에선 콘솔 오류일 뿐이라 이 테스트에서만 삼킨다.
  const restore = swallowRejections()
  onTestFinished(restore)
  const { user } = open({
    tree: () => [wikiPageSummary({ id: 1, title: '제품 문서' })],
    handlers: [
      http.post('/api/v1/wiki/spaces/1/pages', () =>
        HttpResponse.json({ status: 400, message: '다른 공간의 페이지를 부모로 지정할 수 없습니다: page=1' }, { status: 400 }),
      ),
    ],
  })
  const row = await screen.findByTestId('wiki-tree-row-1')
  await user.click(within(row).getByRole('button', { name: /하위 페이지 추가$/ }))
  expect(await screen.findByText('다른 공간의 페이지를 부모로 지정할 수 없습니다: page=1')).toBeInTheDocument()
})

test('열린 페이지 노드만 선택 표시(aria-current=page·bg-selected·selection-bar)를 갖는다(WP-368)', async () => {
  open({
    path: '/wiki/spaces/1/pages/1',
    tree: () => [wikiPageSummary({ id: 1, title: '제품 문서' }), wikiPageSummary({ id: 2, parentId: 1, title: '기획' })],
  })
  const picked = within(await screen.findByTestId('wiki-tree-row-1')).getByRole('button', { name: '제품 문서' })
  const other = within(screen.getByTestId('wiki-tree-row-2')).getByRole('button', { name: '기획' })
  expect(picked).toHaveAttribute('aria-current', 'page')
  expect(other).not.toHaveAttribute('aria-current')
  expect(picked.className).toMatch(/bg-selected/)
  expect(picked.className).toMatch(/selection-bar/)
  expect(other.className).not.toMatch(/bg-selected|selection-bar/)
})

test('부모의 접기/펼치기는 자손을 숨기고 다시 보이며 aria-expanded 로 상태를 알린다(WP-923)', async () => {
  const { user } = open({
    tree: () => [wikiPageSummary({ id: 1, title: '제품 문서' }), wikiPageSummary({ id: 2, parentId: 1, title: '기획' })],
  })
  await screen.findByTestId('wiki-tree-row-2')
  const collapse = screen.getByRole('button', { name: '제품 문서 접기' })
  expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await user.click(collapse)
  await waitFor(() => expect(screen.queryByTestId('wiki-tree-row-2')).not.toBeInTheDocument())
  const expand = screen.getByRole('button', { name: '제품 문서 펼치기' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  await user.click(expand)
  expect(await screen.findByTestId('wiki-tree-row-2')).toBeInTheDocument()
})

test('트리 행은 role=group 이고 열기 버튼 이름은 제목 그대로다(#801)', async () => {
  open({ tree: () => [wikiPageSummary({ id: 1, title: '제품 문서' })] })
  const row = await screen.findByTestId('wiki-tree-row-1')
  expect(row).toHaveAttribute('role', 'group')
  expect(within(row).getByRole('button', { name: '제품 문서' })).toBeInTheDocument()
})

test('행 ⋯ 삭제 — 취소하면 요청이 없고, 확인하면 DELETE 후 트리에서 사라진다', async () => {
  let deleted = false
  const deletes: string[] = []
  const { user } = open({
    tree: () => (deleted ? [] : [wikiPageSummary({ id: 200, title: '삭제 대상' })]),
    handlers: [
      http.delete('/api/v1/wiki/pages/:id', ({ request }) => {
        deletes.push(new URL(request.url).pathname)
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    ],
  })
  await rowMenu(user, 200, '삭제')
  await screen.findByTestId('wiki-delete-dialog')
  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('wiki-delete-dialog')).not.toBeInTheDocument())
  expect(deletes).toEqual([])
  await rowMenu(user, 200, '삭제')
  await user.click(within(await screen.findByTestId('wiki-delete-dialog')).getByRole('button', { name: '삭제' }))
  await waitFor(() => expect(deletes).toEqual(['/api/v1/wiki/pages/200']))
  await waitFor(() => expect(screen.queryByTestId('wiki-tree-row-200')).not.toBeInTheDocument())
})

test('삭제 확인 창 — 리프 페이지는 하위 경고가 없고, 하위가 있는 부모는 경고한다', async () => {
  const { user } = open({
    tree: () => [
      wikiPageSummary({ id: 1, title: '부모 페이지' }),
      wikiPageSummary({ id: 2, parentId: 1, title: '자식 페이지' }),
      wikiPageSummary({ id: 3, title: '리프 페이지', position: 1 }),
    ],
  })
  await rowMenu(user, 3, '삭제')
  const leaf = await screen.findByTestId('wiki-delete-dialog')
  expect(leaf).not.toHaveTextContent('하위 페이지도 함께 삭제되며')
  expect(leaf).toHaveTextContent('되돌릴 수 없습니다')
  await user.click(within(leaf).getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('wiki-delete-dialog')).not.toBeInTheDocument())
  await rowMenu(user, 1, '삭제')
  expect(await screen.findByTestId('wiki-delete-dialog')).toHaveTextContent('하위 페이지도 함께 삭제되며')
})

test('AI 생성 이력이 있는 페이지만 트리 제목 옆에 attribution 배지가 뜬다(#736)', async () => {
  open({
    tree: () => [
      wikiPageSummary({ id: 1, title: 'AI 이력 있음', aiLastUsedAt: '2026-07-20T00:00:00Z' }),
      wikiPageSummary({ id: 2, title: 'AI 이력 없음', position: 1 }),
    ],
  })
  expect(await screen.findByTestId('wiki-tree-ai-badge-1')).toBeInTheDocument()
  expect(screen.queryByTestId('wiki-tree-ai-badge-2')).not.toBeInTheDocument()
})

test('팀 노트 VIEWER 에게는 새 페이지·하위 페이지·행 메뉴가 없고, 행은 열 수 있는 그대로다(WP-602·WP-713)', async () => {
  open({
    spaces: () => [wikiSpace({ id: 1, type: 'TEAM', name: '팀 노트', ownerId: 9, role: 'VIEWER' })],
    tree: () => [wikiPageSummary({ id: 310, title: '문서' })],
  })
  const row = await screen.findByTestId('wiki-tree-row-310')
  expect(screen.queryByRole('button', { name: '새 페이지' })).not.toBeInTheDocument()
  expect(within(row).queryByRole('button', { name: /하위 페이지 추가$/ })).not.toBeInTheDocument()
  expect(within(row).queryByRole('button', { name: /페이지 메뉴$/ })).not.toBeInTheDocument()
  // 끌 수 없을 뿐 페이지는 열 수 있다 — dnd-kit 의 aria-disabled 가 행·열기 버튼을 「사용 불가」로 만들지 않는다.
  expect(row).toHaveAttribute('role', 'group')
  expect(row).not.toHaveAttribute('aria-disabled')
  expect(within(row).getByRole('button', { name: '문서' })).toBeEnabled()
})

// ── 이동 대화상자(wiki-move-dialog) ─────────────────────────────────────────

test('「이동…」 목록에는 자기 자신과 자기 하위 페이지가 없다 — 「회의록」을 옮길 때 그 아래 페이지들은 빠진다', async () => {
  const { user } = open({
    tree: () => [
      wikiPageSummary({ id: 1, parentId: null, position: 0, title: '회의록' }),
      wikiPageSummary({ id: 2, parentId: 1, position: 0, title: '2026년 10월 정기 회의' }),
      wikiPageSummary({ id: 3, parentId: 2, position: 0, title: '10월 23일 — 노트 협업 기능 회고와 다음 분기 우선순위 정리' }),
      wikiPageSummary({ id: 4, parentId: 1, position: 1, title: '11월' }),
      wikiPageSummary({ id: 5, parentId: null, position: 1, title: '설계 문서' }),
      wikiPageSummary({ id: 6, parentId: 5, position: 0, title: '노트 동시 편집 설계' }),
      wikiPageSummary({ id: 7, parentId: null, position: 2, title: '신규 입사자 온보딩 가이드' }),
    ],
  })
  await rowMenu(user, 1, '이동…')
  const dialog = await screen.findByTestId('wiki-move-dialog')
  expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual([
    '최상위지금 위치',
    '설계 문서',
    '노트 동시 편집 설계',
    '신규 입사자 온보딩 가이드',
  ])
})
