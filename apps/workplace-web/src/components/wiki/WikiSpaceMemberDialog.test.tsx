// 노트 스페이스 멤버 창의 조직도 부서 멤버(WP-1052) — 부서 행(「개발팀 · 12명 [조직]」)·인원 수 머리글·역할 변경·제거·하위 포함 구성원 펼치기,
// 사람·조직 공통 선택 창으로 부서·사람 추가(payload), 이미 추가한 부서·사람 표시, 내 그룹 탭 없음·AI 에이전트 포함을 MSW 로 본다.
// 드라이브 공간 창에 부서 기능이 없는지는 SpaceMemberDialog.test.tsx 가 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { UserGroupMemberHit, UserGroupNode, UserGroupTree } from '@/types/userGroup'
import type { WikiMember, WikiMemberGroup } from '@/types/wiki'

import { createMember } from '../../../e2e/factories/auth.factory'
import { wikiSpace } from '../../../e2e/factories/wiki.factory'
import { WikiSpaceMemberDialog } from './WikiSpaceMemberDialog'

const SPACE = 4
const API = `/api/v1/wiki/spaces/${SPACE}`

function groupNode(id: number, name: string, children: UserGroupNode[] = [], visibility: UserGroupNode['visibility'] = 'SHARED'): UserGroupNode {
  return { id, code: null, name, parentId: null, ownerId: null, visibility, sortOrder: 0, children }
}

/** 조직도 — 개발팀(10) 아래 백엔드(12), 디자인팀(20). 내 그룹 개발 스터디(30)는 스페이스 선택 창에 보이지 않아야 한다. */
const TREE: UserGroupTree = {
  shared: [groupNode(10, '개발팀', [groupNode(12, '백엔드')]), groupNode(20, '디자인팀')],
  personal: [groupNode(30, '개발 스터디', [], 'PERSONAL')],
}

const hit = (targetId: number, name: string, groupId: number, groupPath: string[], targetType: 'MEMBER' | 'EXTERNAL' = 'MEMBER'): UserGroupMemberHit => ({
  targetType, targetId, name, email: null, title: null, organization: null, groupId, groupPath,
})

/** 하위 조직 포함 구성원(빈 검색어) — 개발팀은 직속 한지수(7)와 백엔드 이민호(9), 외부 연락처(99). */
const SUBTREE: Record<number, UserGroupMemberHit[]> = {
  10: [hit(7, '한지수', 10, []), hit(9, '이민호', 12, ['개발팀', '백엔드']), hit(99, '외부 협력사', 10, [], 'EXTERNAL')],
  12: [hit(9, '이민호', 12, [])],
  20: [],
}

/**
 * 나(1, 소유자)와 편집자 이서연(3), 부서 groups 를 가진 스페이스 멤버 창을 띄운다.
 * 받은 쓰기 요청(부서·사람 POST, 부서 PATCH·DELETE)과 사람 검색의 kind 를 모으고, 쓰면 서버 상태를 바꿔 다시 받은 목록이 반영되게 한다.
 */
function openDialog(initialGroups: WikiMemberGroup[] = [], role: 'OWNER' | 'EDITOR' = 'OWNER') {
  let groups = [...initialGroups]
  let members: WikiMember[] = [
    { userId: 1, name: '나', role: 'OWNER' },
    { userId: 3, name: '이서연', role: 'EDITOR' },
  ]
  const writes: { method: string; path: string; body?: unknown }[] = []
  const kinds: string[] = []
  const subtreeCalls: number[] = []
  const view = renderScreen(
    <WikiSpaceMemberDialog space={wikiSpace({ id: SPACE, name: '제품팀 노트', ownerId: 1, role })} open onOpenChange={() => {}} />,
    {
      handlers: [
        http.get(`${API}/members`, () => HttpResponse.json(members)),
        http.post(`${API}/members`, async ({ request }) => {
          const body = (await request.json()) as { userId: number; role: WikiMember['role'] }
          writes.push({ method: 'POST', path: 'members', body })
          members = [...members, { userId: body.userId, name: `사용자${body.userId}`, role: body.role }]
          return new HttpResponse(null, { status: 201 })
        }),
        http.get(`${API}/member-groups`, () => HttpResponse.json(groups)),
        http.post(`${API}/member-groups`, async ({ request }) => {
          const body = (await request.json()) as { groupId: number; role: WikiMemberGroup['role'] }
          writes.push({ method: 'POST', path: 'member-groups', body })
          const added = { groupId: body.groupId, name: body.groupId === 20 ? '디자인팀' : `조직${body.groupId}`, role: body.role, memberCount: 4 }
          groups = [...groups, added]
          return HttpResponse.json(added, { status: 201 })
        }),
        http.patch(`${API}/member-groups/:groupId`, async ({ params, request }) => {
          const body = (await request.json()) as { role: WikiMemberGroup['role'] }
          writes.push({ method: 'PATCH', path: `member-groups/${params.groupId}`, body })
          groups = groups.map((g) => (g.groupId === Number(params.groupId) ? { ...g, role: body.role } : g))
          return HttpResponse.json(groups.find((g) => g.groupId === Number(params.groupId)))
        }),
        http.delete(`${API}/member-groups/:groupId`, ({ params }) => {
          writes.push({ method: 'DELETE', path: `member-groups/${params.groupId}` })
          groups = groups.filter((g) => g.groupId !== Number(params.groupId))
          return new HttpResponse(null, { status: 204 })
        }),
        http.get('/api/v1/wiki/spaces', () => HttpResponse.json([])),
        http.get('/api/v1/members', ({ request }) => {
          kinds.push(new URL(request.url).searchParams.get('kind') ?? '')
          const content = [
            createMember({ userId: 3, username: 'seoyeon', name: '이서연' }),
            createMember({ userId: 8, username: 'yujin', name: '최유진', department: '디자인팀' }),
            createMember({ userId: 50, username: 'ai-dev', name: 'AI 개발자1', kind: 'AGENT' }),
          ]
          return HttpResponse.json({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
        }),
        http.get('/api/v1/user-groups', () => HttpResponse.json(TREE)),
        http.get('/api/v1/user-groups/:id/members/search', ({ params }) => {
          subtreeCalls.push(Number(params.id))
          return HttpResponse.json(SUBTREE[Number(params.id)] ?? [])
        }),
      ],
    },
  )
  return { ...view, writes, kinds, subtreeCalls }
}

const DEV: WikiMemberGroup = { groupId: 10, name: '개발팀', role: 'EDITOR', memberCount: 12 }

/** 멤버 추가 창을 열고 검색창을 돌려준다. */
async function openPicker(user: ScreenUser) {
  await user.click(await screen.findByTestId('wiki-member-add-trigger'))
  return screen.findByLabelText('사람·팀 검색')
}

describe('노트 스페이스 멤버 — 조직도 부서(WP-1052)', () => {
  test('부서 행은 「이름 · N명 [조직]」과 역할(편집자·보기 전용만)로 보이고, 머리글은 사람 수와 조직 수를 함께 센다', async () => {
    openDialog([DEV])
    const row = await screen.findByTestId('wiki-member-group-row-10')
    expect(row).toHaveTextContent('개발팀')
    expect(row).toHaveTextContent('· 12명')
    expect(row).toHaveTextContent('조직')
    expect(screen.getByTestId('wiki-member-count')).toHaveTextContent('멤버 2명 · 조직 1')
    const select = within(row).getByTestId('wiki-member-group-role-select-10')
    expect(select).toHaveValue('EDITOR')
    // 소유자는 고를 수 없다 — 멤버 관리 권한을 부서 전체에 주지 않는다.
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['편집자', '보기 전용'])
  })

  test('부서가 없으면 머리글은 사람 수만 보인다', async () => {
    openDialog()
    await screen.findByTestId('wiki-member-row-3')
    expect(screen.getByTestId('wiki-member-count')).toHaveTextContent(/^멤버 2명$/)
  })

  test('소유자가 아니면 부서 역할은 글자로만 보이고 바꾸거나 뺄 수 없다', async () => {
    openDialog([{ ...DEV, role: 'VIEWER' }], 'EDITOR')
    expect(await screen.findByTestId('wiki-member-group-role-10')).toHaveTextContent('보기 전용')
    expect(screen.queryByTestId('wiki-member-group-role-select-10')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wiki-member-group-remove-10')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wiki-member-add-trigger')).not.toBeInTheDocument()
  })

  test('부서 역할을 바꾸면 PATCH 로 보내고 다시 받은 역할이 보인다', async () => {
    const { user, writes } = openDialog([DEV])
    await user.selectOptions(await screen.findByTestId('wiki-member-group-role-select-10'), 'VIEWER')
    await waitFor(() => expect(writes).toEqual([{ method: 'PATCH', path: 'member-groups/10', body: { role: 'VIEWER' } }]))
    await waitFor(() => expect(screen.getByTestId('wiki-member-group-role-select-10')).toHaveValue('VIEWER'))
  })

  test('부서 제거는 확인 뒤에만 DELETE 하고, 목록과 머리글에서 빠진다', async () => {
    const { user, writes } = openDialog([DEV])
    await user.click(await screen.findByTestId('wiki-member-group-remove-10'))
    expect(await screen.findByText(/조직 개발팀을\(를\) 제거할까요\?/)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    await user.click(screen.getByTestId('wiki-member-remove-confirm'))
    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', path: 'member-groups/10' }]))
    await waitFor(() => expect(screen.queryByTestId('wiki-member-group-row-10')).not.toBeInTheDocument())
    expect(screen.getByTestId('wiki-member-count')).toHaveTextContent(/^멤버 2명$/)
  })

  test('부서 행 ▸ 는 하위 부서까지 지금 사람 구성원을 펼치고(외부 연락처 제외), 하위 부서 사람은 그 아래 소속을 함께 보인다', async () => {
    const { user, subtreeCalls } = openDialog([DEV])
    const toggle = await screen.findByTestId('wiki-member-group-toggle-10')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // 펼치기 전에는 구성원을 받지 않는다.
    expect(subtreeCalls).toEqual([])
    await user.click(toggle)
    const list = await screen.findByTestId('wiki-member-group-members-10')
    expect(await within(list).findByText('한지수')).toBeInTheDocument()
    expect(within(list).getByText('이민호').closest('li')).toHaveTextContent('백엔드')
    expect(within(list).getByText('이민호').closest('li')).not.toHaveTextContent('개발팀')
    expect(within(list).queryByText('외부 협력사')).not.toBeInTheDocument()
    expect(subtreeCalls).toEqual([10])
    await user.click(toggle)
    await waitFor(() => expect(screen.queryByTestId('wiki-member-group-members-10')).not.toBeInTheDocument())
  })

  test('멤버 추가 창은 사람·조직 탭만(내 그룹 없음) 두고, 사람 후보에 AI 에이전트도 넣는다', async () => {
    const { user, kinds } = openDialog()
    await openPicker(user)
    expect(await screen.findByTestId('wiki-member-picker-tab-departments')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-member-picker-tab-people')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-member-picker-tab-groups')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wiki-member-picker-personal-groups')).not.toBeInTheDocument()
    expect(screen.queryByTestId('wiki-member-picker-personal-group-30')).not.toBeInTheDocument()
    // 사람 검색은 에이전트까지(kind=ALL) — AI 에게도 스페이스 일을 맡길 수 있게.
    expect(await screen.findByTestId('wiki-member-picker-person-50')).toHaveTextContent('에이전트')
    expect(kinds.every((k) => k === 'ALL')).toBe(true)
    // 이미 멤버인 이서연은 고를 수 없다.
    expect(screen.getByTestId('wiki-member-picker-person-3')).toHaveAttribute('aria-disabled', 'true')
  })

  test('조직을 고르면 부서 자체를 편집자로 POST 하고, 추가된 부서 행이 보이며 선택 창에서는 「이미 추가됨」이 된다', async () => {
    const { user, writes } = openDialog()
    await openPicker(user)
    await user.click(await screen.findByTestId('wiki-member-picker-department-20'))
    await waitFor(() => expect(writes).toEqual([{ method: 'POST', path: 'member-groups', body: { groupId: 20, role: 'EDITOR' } }]))
    expect(await screen.findByTestId('wiki-member-group-row-20')).toHaveTextContent('디자인팀')
    await waitFor(() => expect(screen.getByTestId('wiki-member-picker-department-20')).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByTestId('wiki-member-picker-department-20')).toHaveTextContent('(이미 추가됨)')
  })

  test('사람을 고르면 그 사람을 편집자로 멤버 POST 한다', async () => {
    const { user, writes } = openDialog()
    await openPicker(user)
    await user.click(await screen.findByTestId('wiki-member-picker-person-8'))
    await waitFor(() => expect(writes).toEqual([{ method: 'POST', path: 'members', body: { userId: 8, role: 'EDITOR' } }]))
  })

  test('이미 멤버인 부서의 하위 부서는 「상위 부서에 포함됨」, 펼친 구성원은 하위 부서 사람까지 「조직에 포함됨」이다', async () => {
    const { user } = openDialog([DEV])
    await openPicker(user)
    await user.click(await screen.findByTestId('wiki-member-picker-expand-10'))
    expect(await screen.findByTestId('wiki-member-picker-department-12')).toHaveTextContent('상위 부서에 포함됨')
    // 선택 창의 펼침도 하위 부서 구성원까지 — 추가한 뒤 목록과 같은 범위.
    const sub = await screen.findByTestId('wiki-member-picker-member-10-9')
    expect(sub).toHaveTextContent('백엔드')
    expect(sub).toHaveTextContent('조직에 포함됨')
    expect(sub).toHaveAttribute('aria-disabled', 'true')
  })
})
