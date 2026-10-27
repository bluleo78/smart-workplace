// 연락처 사용자 그룹·조직도(사이드바 GroupTree + 본문 GroupContactView) — 화면 테스트(WP-971, WP-995, WP-966).
// 그룹·멤버 행 선택 표시, 그룹 선택 중 꺼진 퀵필터, 접기·수정·삭제 버튼 이름, 개인/공유 그룹 생성·수정·하위 추가·삭제 payload,
// 관리자 전용 노출, 400/409 오류 토스트·인라인 오류는 브라우저 없이 판정되므로 e2e/pages/contacts/user-groups.spec.ts 에서 옮겼다.
// 조직도 선택 → 트리·직속 멤버 배선(@wiring)과 긴 이름이 창 폭을 넘지 않는 것(@layout)은 그 E2E 가 지킨다.
// 사이드바 트리와 본문 그룹 뷰가 URL ?group 으로 이어지므로 모듈 레이아웃 + ContactsPage 를 renderScreen 으로 띄운다(testkit-b8).
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, test } from 'vitest'

import type { AuthContextValue } from '@/hooks/auth-context-value'
import { ADMIN, record, type Recorded, renderContacts } from '@/pages/contacts/testkit-b8'

import { page as makePage } from '../../../e2e/factories/contacts.factory'
import {
  personalDetail,
  personalNode,
  sharedDetail,
  sharedNode,
  tree,
} from '../../../e2e/factories/userGroups.factory'
import type { UserGroupTree } from '../../types/userGroup'

/** 연락처 목록(빈)·그룹 트리·그룹 10/20 상세 GET. 쓰기 핸들러는 테스트가 앞에 둔다(먼저 둔 핸들러가 우선). */
const base = (t: UserGroupTree = tree()): RequestHandler[] => [
  http.get('/api/v1/contacts', () => HttpResponse.json(makePage([]))),
  http.get('/api/v1/user-groups', () => HttpResponse.json(t)),
  http.get('/api/v1/user-groups/10', () => HttpResponse.json(sharedDetail())),
  http.get('/api/v1/user-groups/20', () => HttpResponse.json(personalDetail())),
]

/** /contacts 를 띄우고 그룹 트리가 그려질 때까지 기다린다. */
async function open(path: string, handlers: RequestHandler[], auth?: Partial<AuthContextValue>) {
  const view = renderContacts(path, { handlers, auth })
  await screen.findByTestId('group-node-10')
  return view
}

/** 「그룹 폼」의 이름 칸을 채우고 저장한다. */
async function saveName(user: ReturnType<typeof renderContacts>['user'], name: string) {
  await screen.findByTestId('group-form-dialog')
  fireEvent.change(screen.getByTestId('g-name'), { target: { value: name } })
  await user.click(screen.getByTestId('g-save'))
}

// ── 선택 표시·퀵필터·버튼 이름 ─────────────────────────────────────────────

// WP-368 — 고른 그룹 노드 행만 선택 표시(막대 + bg-selected), 다른 그룹으로 옮기면 따라간다. 개인 그룹 멤버 행도 같은 규칙.
// 그룹 노드는 사이드바 「보기」 항목이라 현재 위치를 aria-current="page" 로 알린다(WP-976 — 토글이 아니다).
test('그룹 트리·그룹 멤버 행 선택 표시 (WP-368)', async () => {
  const { user } = await open('/contacts', [
    ...base(),
    http.get('/api/v1/contacts/members/1', () =>
      HttpResponse.json({ id: 1, username: 'kim', name: '김멤버', email: 'kim@example.com', title: '팀장', kind: 'HUMAN', groups: [], isFavorite: false }),
    ),
  ])
  const node10 = screen.getByTestId('group-node-10')
  const node20 = screen.getByTestId('group-node-20')
  // 행 컨테이너 = 이름 버튼의 부모.
  const row10 = node10.parentElement!
  const row20 = node20.parentElement!
  await user.click(node10)
  expect(await screen.findByTestId('group-contact-view')).toBeInTheDocument()
  expect(row10).toHaveClass('bg-selected', 'selection-bar')
  expect(row20).not.toHaveClass('bg-selected')
  expect(node10).toHaveAttribute('aria-current', 'page')
  expect(node20).not.toHaveAttribute('aria-current')

  await user.click(node20)
  const memberRow = await screen.findByTestId('group-member-MEMBER-1')
  expect(row20).toHaveClass('bg-selected', 'selection-bar')
  expect(row10).not.toHaveClass('bg-selected')
  expect(node20).toHaveAttribute('aria-current', 'page')
  expect(node10).not.toHaveAttribute('aria-current')
  expect(memberRow).toHaveAttribute('aria-pressed', 'false')
  expect(memberRow).not.toHaveClass('bg-selected')
  await user.click(memberRow)
  await waitFor(() => expect(screen.getByTestId('group-member-MEMBER-1')).toHaveAttribute('aria-pressed', 'true'))
  expect(screen.getByTestId('group-member-MEMBER-1')).toHaveClass('bg-selected', 'selection-bar')
})

// WP-898·WP-976 — 그룹을 고른 동안 「전체」 퀵필터는 현재 항목이 아니지만 잠기지 않고, 누르면 그룹 선택이 풀리며 「전체」가 현재 항목이 된다.
test('그룹을 고르면 「전체」는 현재 항목이 아니되 잠기지 않고, 누르면 그룹을 떠난다 (WP-898·WP-976)', async () => {
  const { user, location } = await open('/contacts', base())
  const all = screen.getByTestId('contact-filter-ALL')
  expect(all).toHaveAttribute('aria-current', 'page')
  expect(all).toHaveClass('bg-selected')

  await user.click(screen.getByTestId('group-node-10'))
  await screen.findByTestId('group-contact-view')
  expect(all).toBeEnabled()
  expect(all).not.toHaveAttribute('aria-current')
  expect(all).not.toHaveClass('bg-selected')
  expect(screen.getByTestId('contact-sidebar').querySelectorAll('[data-testid^="contact-filter-"][aria-current]')).toHaveLength(0)

  await user.click(all)
  await waitFor(() => expect(screen.queryByTestId('group-contact-view')).not.toBeInTheDocument())
  expect(all).toHaveAttribute('aria-current', 'page')
  expect(all).toHaveClass('bg-selected')
  expect(screen.getByTestId('group-node-10')).not.toHaveAttribute('aria-current')
  expect(location()).toBe('/contacts')
})

// WP-923: 접기·수정·삭제 버튼 이름에 그룹 이름이 들어가고, 접기 상태는 aria-expanded 로 전한다. 하위가 없으면 접기 버튼이 없다.
test('그룹 트리 — 접기·⋯ 버튼 이름에 그룹 이름이 들어간다', async () => {
  const { user } = await open(
    '/contacts',
    base(
      tree({
        shared: [sharedNode({ children: [sharedNode({ id: 11, name: '플랫폼팀', parentId: 10 })] })],
        personal: [personalNode()],
      }),
    ),
  )
  const collapse = screen.getByRole('button', { name: '개발본부 접기' })
  expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await user.click(collapse)
  expect(screen.queryByTestId('group-node-11')).not.toBeInTheDocument()
  const expand = screen.getByRole('button', { name: '개발본부 펼치기' })
  expect(expand).toHaveAttribute('aria-expanded', 'false')
  await user.click(expand)
  expect(screen.getByTestId('group-node-11')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^플랫폼팀 (접기|펼치기)$/ })).not.toBeInTheDocument()

  // 행 ⋯ 메뉴 버튼 이름에 그룹 이름이 들어간다(WP-978 — 수정·삭제는 이 메뉴 안으로 옮겼다).
  expect(screen.getByTestId('group-more-20')).toHaveAccessibleName('내 분류 더보기')
})

// ── 개인 그룹 ─────────────────────────────────────────────

// 새 그룹: 이름 + 멤버 검색(contacts 목록 재사용, 300ms 디바운스) → 고른 멤버 칩 → 생성 POST(PERSONAL) 뒤 멤버 편입 POST.
test('개인 그룹 생성 + 멤버 편입 — 생성·편입 payload', async () => {
  const creates: Recorded[] = []
  const adds: Recorded[] = []
  const { user } = await open('/contacts', [
    http.get('/api/v1/contacts', ({ request }) =>
      HttpResponse.json(
        makePage(
          new URL(request.url).searchParams.get('search')
            ? [{ type: 'MEMBER', id: 1, name: '김멤버', email: 'kim@example.com', title: null, organization: null, isFavorite: false }]
            : [],
        ),
      ),
    ),
    http.post('/api/v1/user-groups', async ({ request }) => {
      await record(creates, request)
      return HttpResponse.json(personalDetail({ id: 99, name: '신규 그룹', members: [] }), { status: 201 })
    }),
    http.post('/api/v1/user-groups/99/members', async ({ request }) => {
      await record(adds, request)
      return HttpResponse.json(personalDetail({ id: 99, name: '신규 그룹' }))
    }),
    ...base(),
  ])
  await user.click(screen.getByTestId('group-create'))
  await screen.findByTestId('group-form-dialog')
  fireEvent.change(screen.getByTestId('g-name'), { target: { value: '신규 그룹' } })
  fireEvent.change(screen.getByTestId('g-member-search'), { target: { value: '김멤버' } })
  await user.click(await screen.findByTestId('g-member-result-MEMBER-1'))
  expect(screen.getByTestId('g-picked-remove-MEMBER-1')).toBeInTheDocument()
  await user.click(screen.getByTestId('g-save'))
  await waitFor(() => expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument())
  expect(creates[0].body).toMatchObject({ name: '신규 그룹', visibility: 'PERSONAL' })
  expect(adds[0].body).toMatchObject({ targetType: 'MEMBER', targetId: 1 })
})

// ── 관리자 조직도 편집 ─────────────────────────────────────────────

// 일반 사용자는 조직도 헤더 ＋ 도, 조직도 노드의 하위 추가·수정·삭제 액션도 없다(읽기 전용).
test('비-admin: 조직도 헤더 + 버튼과 노드 편집 액션이 없다', async () => {
  const { user } = await open('/contacts', base())
  expect(screen.queryByTestId('org-create')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('group-node-10'))
  await screen.findByTestId('group-contact-view')
  expect(screen.queryByTestId('org-add-10')).not.toBeInTheDocument()
  expect(screen.queryByTestId('org-edit-10')).not.toBeInTheDocument()
  expect(screen.queryByTestId('org-delete-10')).not.toBeInTheDocument()
})

test('admin: 조직도 헤더에서 최상위 공유 그룹 생성(SHARED·parentId null)', async () => {
  const creates: Recorded[] = []
  const { user } = await open(
    '/contacts',
    [
      http.post('/api/v1/user-groups', async ({ request }) => {
        await record(creates, request)
        return HttpResponse.json(sharedDetail({ id: 98, name: '신규 본부', members: [] }), { status: 201 })
      }),
      ...base(),
    ],
    ADMIN,
  )
  await user.click(screen.getByTestId('org-create'))
  await saveName(user, '신규 본부')
  await waitFor(() => expect(screen.queryByTestId('group-form-dialog')).not.toBeInTheDocument())
  expect(creates[0].body).toMatchObject({ name: '신규 본부', visibility: 'SHARED', parentId: null })
})

// #803 — 이름 중복(400 「이미 존재하는 그룹 이름입니다」)은 토스트에 더해 이름 칸 인라인 오류로 보이고 창이 남는다.
test('admin: 최상위 공유 그룹 이름 중복(400) → 인라인 에러 + 다이얼로그 유지 (#803)', async () => {
  const { user } = await open(
    '/contacts',
    [
      http.post('/api/v1/user-groups', () =>
        HttpResponse.json({ message: '이미 존재하는 그룹 이름입니다: 테스트그룹A' }, { status: 400 }),
      ),
      ...base(),
    ],
    ADMIN,
  )
  await user.click(screen.getByTestId('org-create'))
  await saveName(user, '테스트그룹A')
  await waitFor(() =>
    expect(document.getElementById('g-name-error')).toHaveTextContent('이미 존재하는 그룹 이름입니다: 테스트그룹A'),
  )
  expect(screen.getByTestId('group-form-dialog')).toBeInTheDocument()
})
