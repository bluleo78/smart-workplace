// 드라이브 팀 공간 멤버 창의 조직도 부서·내 그룹(WP-1056) — 부서 행(「개발팀 · 12명 [조직]」)·역할(편집자·보기 전용만) 변경·제거,
// 사람·조직·내 그룹 선택 창으로 부서 추가(부서 자체를 편집자로 POST)와 내 그룹 펼치기(지금 구성원을 사람 멤버로, 이미 멤버는 빼고)를 MSW 로 본다.
// 부서 행 펼치기·이미 추가됨 표시 같은 공통 화면 규칙은 노트(WikiSpaceMemberDialog.test.tsx)가 같은 SpaceMemberDialog 로 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { DriveMember, DriveMemberGroup, DriveSpace } from '@/types/drive'
import type { UserGroupDetail, UserGroupNode, UserGroupTree } from '@/types/userGroup'

import { createMember } from '../../../e2e/factories/auth.factory'
import { DriveSpaceMemberDialog } from './DriveSpaceMemberDialog'

const SPACE = 2
const API = `/api/v1/drive/spaces/${SPACE}`

function groupNode(id: number, name: string, children: UserGroupNode[] = [], visibility: UserGroupNode['visibility'] = 'SHARED'): UserGroupNode {
  return { id, code: null, name, parentId: null, ownerId: null, visibility, sortOrder: 0, children }
}

/** 조직도 — 개발팀(10)·디자인팀(20). 내 그룹 개발 스터디(30) 아래 하위 그룹 리뷰어(31). */
const TREE: UserGroupTree = {
  shared: [groupNode(10, '개발팀'), groupNode(20, '디자인팀')],
  personal: [groupNode(30, '개발 스터디', [groupNode(31, '리뷰어', [], 'PERSONAL')], 'PERSONAL')],
}

/** 내 그룹 상세 — 개발 스터디는 이서연(3, 이미 멤버)·최유진(8)·외부 연락처(99), 하위 리뷰어는 강하늘(11)·최유진(8, 중복). */
function groupDetail(id: number): UserGroupDetail {
  const person = (targetId: number, name: string, targetType: 'MEMBER' | 'EXTERNAL' = 'MEMBER') => ({
    targetType, targetId, name, email: null, title: null, organization: null,
  })
  const members =
    id === 30
      ? [person(3, '이서연'), person(8, '최유진'), person(99, '외부 협력사', 'EXTERNAL')]
      : [person(11, '강하늘'), person(8, '최유진')]
  return { id, code: null, name: id === 30 ? '개발 스터디' : '리뷰어', parentId: id === 30 ? null : 30, ownerId: 1, visibility: 'PERSONAL', sortOrder: 0, members }
}

const teamSpace = (role: DriveSpace['role'] = 'OWNER'): DriveSpace => ({
  id: SPACE, type: 'TEAM', name: '제품기획팀', ownerId: 1, role, archived: false, createdAt: '2026-06-01T00:00:00Z',
})

/**
 * 나(1, 소유자)와 편집자 이서연(3), 부서 groups 를 가진 드라이브 팀 공간 멤버 창을 띄운다.
 * 받은 쓰기 요청(사람·부서 POST, 부서 PATCH·DELETE)을 모으고, 쓰면 서버 상태를 바꿔 다시 받은 목록이 반영되게 한다.
 */
function openDialog(initialGroups: DriveMemberGroup[] = [], role: DriveSpace['role'] = 'OWNER') {
  let groups = [...initialGroups]
  let members: DriveMember[] = [
    { userId: 1, name: '나', role: 'OWNER' },
    { userId: 3, name: '이서연', role: 'EDITOR' },
  ]
  const writes: { method: string; path: string; body?: unknown }[] = []
  // 추가를 거절할 사람(부분 실패 확인용).
  const rejectUserIds = new Set<number>()
  const view = renderScreen(<DriveSpaceMemberDialog space={teamSpace(role)} open onOpenChange={() => {}} />, {
    handlers: [
      http.get(`${API}/members`, () => HttpResponse.json(members)),
      http.post(`${API}/members`, async ({ request }) => {
        const body = (await request.json()) as { userId: number; role: DriveMember['role'] }
        writes.push({ method: 'POST', path: 'members', body })
        if (rejectUserIds.has(body.userId)) return HttpResponse.json({ message: '추가할 수 없는 사용자입니다' }, { status: 403 })
        members = [...members, { userId: body.userId, name: `사용자${body.userId}`, role: body.role }]
        return new HttpResponse(null, { status: 201 })
      }),
      http.get(`${API}/member-groups`, () => HttpResponse.json(groups)),
      http.post(`${API}/member-groups`, async ({ request }) => {
        const body = (await request.json()) as { groupId: number; role: DriveMemberGroup['role'] }
        writes.push({ method: 'POST', path: 'member-groups', body })
        const added = { groupId: body.groupId, name: body.groupId === 20 ? '디자인팀' : `조직${body.groupId}`, role: body.role, memberCount: 4 }
        groups = [...groups, added]
        return HttpResponse.json(added, { status: 201 })
      }),
      http.patch(`${API}/member-groups/:groupId`, async ({ params, request }) => {
        const body = (await request.json()) as { role: DriveMemberGroup['role'] }
        writes.push({ method: 'PATCH', path: `member-groups/${params.groupId}`, body })
        groups = groups.map((g) => (g.groupId === Number(params.groupId) ? { ...g, role: body.role } : g))
        return HttpResponse.json(groups.find((g) => g.groupId === Number(params.groupId)))
      }),
      http.delete(`${API}/member-groups/:groupId`, ({ params }) => {
        writes.push({ method: 'DELETE', path: `member-groups/${params.groupId}` })
        groups = groups.filter((g) => g.groupId !== Number(params.groupId))
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/v1/drive/spaces', () => HttpResponse.json([])),
      http.get(`/api/v1/drive/spaces/${SPACE}`, () => HttpResponse.json(teamSpace(role))),
      http.get('/api/v1/members', () => {
        const content = [
          createMember({ userId: 3, username: 'seoyeon', name: '이서연' }),
          createMember({ userId: 8, username: 'yujin', name: '최유진', department: '디자인팀' }),
        ]
        return HttpResponse.json({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
      }),
      http.get('/api/v1/user-groups', () => HttpResponse.json(TREE)),
      http.get('/api/v1/user-groups/:id', ({ params }) => HttpResponse.json(groupDetail(Number(params.id)))),
    ],
  })
  /** 창을 연 뒤 다른 소유자가 멤버를 바꾼 것처럼 서버 명단만 바꾼다(화면 캐시는 그대로). */
  const setServerMembers = (next: DriveMember[]) => {
    members = next
  }
  return { ...view, writes, rejectUserIds, setServerMembers }
}

const DEV: DriveMemberGroup = { groupId: 10, name: '개발팀', role: 'EDITOR', memberCount: 12 }

/** 멤버 추가 창을 연다. */
async function openPicker(user: ScreenUser) {
  await user.click(await screen.findByTestId('drive-member-add-trigger'))
  await screen.findByTestId('drive-member-picker-tab-departments')
}

describe('드라이브 팀 공간 멤버 — 조직도 부서·내 그룹(WP-1056)', () => {
  test('부서 행은 「이름 · N명 [조직]」과 역할(편집자·보기 전용만)로 보이고, 머리글은 사람 수와 조직 수를 함께 센다', async () => {
    openDialog([DEV])
    const row = await screen.findByTestId('drive-member-group-row-10')
    expect(row).toHaveTextContent('개발팀')
    expect(row).toHaveTextContent('· 12명')
    expect(row).toHaveTextContent('조직')
    expect(screen.getByTestId('drive-member-count')).toHaveTextContent('멤버 2명 · 조직 1')
    const select = within(row).getByTestId('drive-member-group-role-select-10')
    expect(select).toHaveValue('EDITOR')
    // 소유자는 고를 수 없다 — 멤버 관리 권한을 부서 전체에 주지 않는다.
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['편집자', '보기 전용'])
  })

  test('소유자가 아니면 부서 역할은 글자로만 보이고 바꾸거나 뺄 수 없다', async () => {
    openDialog([{ ...DEV, role: 'VIEWER' }], 'EDITOR')
    expect(await screen.findByTestId('drive-member-group-role-10')).toHaveTextContent('보기 전용')
    expect(screen.queryByTestId('drive-member-group-role-select-10')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-member-group-remove-10')).not.toBeInTheDocument()
    expect(screen.queryByTestId('drive-member-add-trigger')).not.toBeInTheDocument()
  })

  test('부서 역할을 바꾸면 PATCH 로 보내고, 제거는 확인 뒤에만 DELETE 해 목록에서 빠진다', async () => {
    const { user, writes } = openDialog([DEV])
    await user.selectOptions(await screen.findByTestId('drive-member-group-role-select-10'), 'VIEWER')
    await waitFor(() => expect(writes).toEqual([{ method: 'PATCH', path: 'member-groups/10', body: { role: 'VIEWER' } }]))
    await waitFor(() => expect(screen.getByTestId('drive-member-group-role-select-10')).toHaveValue('VIEWER'))

    await user.click(screen.getByTestId('drive-member-group-remove-10'))
    expect(await screen.findByText(/조직 개발팀을\(를\) 제거할까요\? .*이 공간의 파일을 더는 볼 수 없어요/)).toBeInTheDocument()
    expect(writes).toHaveLength(1)
    await user.click(screen.getByTestId('drive-member-remove-confirm'))
    await waitFor(() => expect(writes[1]).toEqual({ method: 'DELETE', path: 'member-groups/10' }))
    await waitFor(() => expect(screen.queryByTestId('drive-member-group-row-10')).not.toBeInTheDocument())
  })

  test('조직을 고르면 부서 자체를 편집자로 POST 하고 부서 행이 보인다', async () => {
    const { user, writes } = openDialog()
    await openPicker(user)
    await user.click(await screen.findByTestId('drive-member-picker-department-20'))
    await waitFor(() => expect(writes).toEqual([{ method: 'POST', path: 'member-groups', body: { groupId: 20, role: 'EDITOR' } }]))
    expect(await screen.findByTestId('drive-member-group-row-20')).toHaveTextContent('디자인팀')
  })

  test('내 그룹을 고르면 하위 그룹까지 지금 사람 구성원을 사람 멤버(편집자)로 풀어 더하고, 이미 멤버·중복·외부 연락처는 빼고 알린다', async () => {
    const { user, writes } = openDialog()
    await openPicker(user)
    await user.click(await screen.findByTestId('drive-member-picker-personal-group-30'))
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', path: 'members', body: { userId: 8, role: 'EDITOR' } },
        { method: 'POST', path: 'members', body: { userId: 11, role: 'EDITOR' } },
      ]),
    )
    // 그룹 자체는 멤버로 남지 않는다 — 부서 POST 가 없고 부서 행도 없다.
    expect(screen.queryByTestId('drive-member-group-row-30')).not.toBeInTheDocument()
    expect(await screen.findByText('개발 스터디에서 2명 추가 (이미 있는 1명 제외)')).toBeInTheDocument()
  })

  test('내 그룹 펼치기는 화면 캐시가 아니라 방금 받은 멤버 명단으로 걸러, 그사이 소유자가 된 사람을 편집자로 덮어쓰지 않는다', async () => {
    const { user, writes, setServerMembers } = openDialog()
    await screen.findByTestId('drive-member-row-3')
    // 창을 연 뒤 다른 소유자가 최유진(8)을 소유자로 넣었다 — 이 창의 명단에는 아직 없다.
    setServerMembers([
      { userId: 1, name: '나', role: 'OWNER' },
      { userId: 3, name: '이서연', role: 'EDITOR' },
      { userId: 8, name: '최유진', role: 'OWNER' },
    ])
    await openPicker(user)
    await user.click(await screen.findByTestId('drive-member-picker-personal-group-30'))
    expect(await screen.findByText('개발 스터디에서 1명 추가 (이미 있는 2명 제외)')).toBeInTheDocument()
    expect(writes).toEqual([{ method: 'POST', path: 'members', body: { userId: 11, role: 'EDITOR' } }])
  })

  test('일부를 추가하지 못하면 성공 안내 대신 몇 명을 못 더했는지 알린다', async () => {
    const { user, writes, rejectUserIds } = openDialog()
    rejectUserIds.add(11)
    await openPicker(user)
    await user.click(await screen.findByTestId('drive-member-picker-personal-group-30'))
    expect(await screen.findByText('개발 스터디에서 1명 추가 (이미 있는 1명 제외) — 1명은 추가하지 못했습니다')).toBeInTheDocument()
    expect(writes).toHaveLength(2)
    expect(screen.queryByText('개발 스터디에서 2명 추가 (이미 있는 1명 제외)')).not.toBeInTheDocument()
  })
})
