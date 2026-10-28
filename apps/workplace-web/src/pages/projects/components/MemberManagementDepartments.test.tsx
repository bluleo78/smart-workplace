// 팀 프로젝트 멤버의 조직도 부서(WP-1057) — 멤버 관리 섹션의 부서 행(「개발팀 · 12명 [조직]」, 역할은 멤버 글자로만 — 소유자 선택 없음,
// ▸ 로 하위 부서까지 구성원 펼치기, 확인 뒤 제거), 사람·조직 공통 선택 창으로 부서 추가(payload: role MEMBER 고정)·사람 추가(고른 역할),
// 내 그룹은 구성원을 한 명씩 펼쳐 더하기, 실효 멤버 목록 중 부서로만 들어온 사람(direct=false)은 표에 사람 행으로 보이지 않기,
// 그리고 담당자 후보에는 부서로 들어온 사람도 들어가는지를 MSW 로 본다. 개인/팀 모드 분기는 MemberManagement.test.tsx 가 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { MemberResponse, ProjectMemberGroup } from '@/types/project'
import type { UserGroupDetail, UserGroupMemberHit, UserGroupNode, UserGroupTree } from '@/types/userGroup'

import { createMember } from '../../../../e2e/factories/auth.factory'
import { AssigneePickerPopover } from './AssigneePickerPopover'
import { MemberManagement } from './MemberManagement'

const KEY = 'WP'
const API = `/api/v1/projects/${KEY}`

function groupNode(id: number, name: string, children: UserGroupNode[] = [], visibility: UserGroupNode['visibility'] = 'SHARED'): UserGroupNode {
  return { id, code: null, name, parentId: null, ownerId: null, visibility, sortOrder: 0, children }
}

/** 조직도 — 개발팀(10) 아래 백엔드(12), 디자인팀(20). 내 그룹 개발 스터디(30). */
const TREE: UserGroupTree = {
  shared: [groupNode(10, '개발팀', [groupNode(12, '백엔드')]), groupNode(20, '디자인팀')],
  personal: [groupNode(30, '개발 스터디', [], 'PERSONAL')],
}

const hit = (targetId: number, name: string, groupId: number, groupPath: string[]): UserGroupMemberHit => ({
  targetType: 'MEMBER', targetId, name, email: null, title: null, organization: null, groupId, groupPath,
})

/** 하위 조직 포함 구성원 — 개발팀은 직속 한지수(7)와 백엔드 이민호(9). */
const SUBTREE: Record<number, UserGroupMemberHit[]> = {
  10: [hit(7, '한지수', 10, []), hit(9, '이민호', 12, ['개발팀', '백엔드'])],
}

/** 내 그룹 개발 스터디(30) — 나(1, 이미 직접 멤버)와 최유진(8), 서도윤(11). */
const STUDY: UserGroupDetail = {
  id: 30, code: null, name: '개발 스터디', parentId: null, ownerId: 1, visibility: 'PERSONAL', sortOrder: 0,
  members: [1, 8, 11].map((id) => ({ targetType: 'MEMBER' as const, targetId: id, name: `사용자${id}`, email: null, title: null, organization: null })),
}

const member = (userId: number, name: string, role: MemberResponse['role'], direct: boolean): MemberResponse => ({
  userId, username: `u${userId}`, name, kind: 'HUMAN', role, createdAt: null, active: true, direct,
})

const DEV: ProjectMemberGroup = { groupId: 10, name: '개발팀', role: 'MEMBER', memberCount: 12 }

/**
 * 나(1, 소유자)·김하나(2, 직접 멤버), 부서로만 들어온 한지수(7, direct=false)가 실효 멤버인 팀 프로젝트의 멤버 섹션을 띄운다.
 * 받은 쓰기 요청을 모으고, 쓰면 서버 상태를 바꿔 다시 받은 목록이 반영되게 한다.
 */
function openSection(initialGroups: ProjectMemberGroup[] = [], canManage = true) {
  let groups = [...initialGroups]
  let members: MemberResponse[] = [
    member(1, '나', 'OWNER', true),
    member(2, '김하나', 'MEMBER', true),
    ...(initialGroups.length > 0 ? [member(7, '한지수', 'MEMBER', false)] : []),
  ]
  const writes: { method: string; path: string; body?: unknown }[] = []
  const view = renderScreen(<MemberManagement projectKey={KEY} canManage={canManage} />, {
    path: `/projects/${KEY}/settings`,
    handlers: [
      http.get(`${API}/members`, () => HttpResponse.json(members)),
      http.post(`${API}/members`, async ({ request }) => {
        const body = (await request.json()) as { userId: number; role: MemberResponse['role'] }
        writes.push({ method: 'POST', path: 'members', body })
        const added = member(body.userId, `사용자${body.userId}`, body.role, true)
        members = [...members, added]
        return HttpResponse.json(added, { status: 201 })
      }),
      http.get(`${API}/member-groups`, () => HttpResponse.json(groups)),
      http.post(`${API}/member-groups`, async ({ request }) => {
        const body = (await request.json()) as { groupId: number; role: string }
        writes.push({ method: 'POST', path: 'member-groups', body })
        const added: ProjectMemberGroup = { groupId: body.groupId, name: body.groupId === 20 ? '디자인팀' : `조직${body.groupId}`, role: 'MEMBER', memberCount: 4 }
        groups = [...groups, added]
        return HttpResponse.json(added, { status: 201 })
      }),
      http.delete(`${API}/member-groups/:groupId`, ({ params }) => {
        writes.push({ method: 'DELETE', path: `member-groups/${params.groupId}` })
        groups = groups.filter((g) => g.groupId !== Number(params.groupId))
        // 부서로만 들어와 있던 사람은 실효 멤버에서도 빠진다.
        members = members.filter((m) => m.direct !== false)
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('/api/v1/members', () => {
        const content = [
          createMember({ userId: 2, username: 'hana', name: '김하나' }),
          createMember({ userId: 8, username: 'yujin', name: '최유진', department: '디자인팀' }),
          createMember({ userId: 50, username: 'ai-dev', name: 'AI 개발자1', kind: 'AGENT' }),
        ]
        return HttpResponse.json({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
      }),
      http.get('/api/v1/user-groups', () => HttpResponse.json(TREE)),
      http.get('/api/v1/user-groups/:id/members/search', ({ params }) => HttpResponse.json(SUBTREE[Number(params.id)] ?? [])),
      http.get('/api/v1/user-groups/:id', () => HttpResponse.json(STUDY)),
    ],
  })
  return { ...view, writes }
}

/** 멤버 추가 창을 열고 검색창을 돌려준다. */
async function openPicker(user: ScreenUser) {
  await user.click(await screen.findByTestId('member-add-trigger'))
  return screen.findByLabelText('사람·팀 검색')
}

describe('프로젝트 멤버 — 조직도 부서(WP-1057)', () => {
  test('부서 행은 「이름 · N명 [조직]」과 역할 「멤버」 글자로만 보이고(소유자 선택 없음), 부서로만 들어온 사람은 사람 행으로 보이지 않는다', async () => {
    openSection([DEV])
    const row = await screen.findByTestId('member-group-row-10')
    expect(row).toHaveTextContent('개발팀')
    expect(row).toHaveTextContent('· 12명')
    expect(row).toHaveTextContent('조직')
    expect(within(row).getByTestId('member-group-role-10')).toHaveTextContent('멤버')
    // 부서 행에는 역할 선택이 없다 — 소유자를 고를 길이 없다.
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(row).queryByText('소유자')).not.toBeInTheDocument()
    // 사람 행은 직접 멤버만 — 역할 선택이 있다. 부서로만 들어온 한지수(7)는 사람 행이 없다.
    expect(await screen.findByRole('combobox', { name: '김하나 역할' })).toBeInTheDocument()
    expect(screen.queryByTestId('member-remove-7')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '한지수 역할' })).not.toBeInTheDocument()
  })

  test('부서 행 ▸ 는 하위 부서까지 지금 구성원을 펼치고 다시 누르면 접는다', async () => {
    const { user } = openSection([DEV])
    const toggle = await screen.findByTestId('member-group-toggle-10')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    const list = await screen.findByTestId('member-group-members-10')
    expect(await within(list).findByText('한지수')).toBeInTheDocument()
    expect(within(list).getByText('이민호').closest('li')).toHaveTextContent('백엔드')
    await user.click(toggle)
    await waitFor(() => expect(screen.queryByTestId('member-group-members-10')).not.toBeInTheDocument())
  })

  test('조직을 고르면 고른 역할(소유자)과 무관하게 부서를 멤버(MEMBER)로 POST 하고, 부서 행이 보이며 선택 창에서는 「이미 추가됨」이 된다', async () => {
    const { user, writes } = openSection()
    // 사람 역할을 소유자로 골라 둬도 조직에는 소유자를 주지 않는다.
    await user.click(await screen.findByLabelText('역할'))
    await user.click(await screen.findByRole('option', { name: '소유자' }))
    await openPicker(user)
    await user.click(await screen.findByTestId('project-member-picker-department-20'))
    await waitFor(() => expect(writes).toEqual([{ method: 'POST', path: 'member-groups', body: { groupId: 20, role: 'MEMBER' } }]))
    expect(await screen.findByTestId('member-group-row-20')).toHaveTextContent('디자인팀')
    await waitFor(() => expect(screen.getByTestId('project-member-picker-department-20')).toHaveAttribute('aria-disabled', 'true'))
  })

  test('사람을 고르면 고른 역할로 멤버 POST 하고, 사람 후보에는 AI 에이전트도 있다', async () => {
    const { user, writes } = openSection()
    await openPicker(user)
    expect(await screen.findByTestId('project-member-picker-person-50')).toHaveTextContent('에이전트')
    // 이미 직접 멤버인 김하나는 고를 수 없다.
    expect(screen.getByTestId('project-member-picker-person-2')).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByTestId('project-member-picker-person-8'))
    await waitFor(() => expect(writes).toEqual([{ method: 'POST', path: 'members', body: { userId: 8, role: 'MEMBER' } }]))
  })

  test('내 그룹을 고르면 그룹 행을 두지 않고 구성원을 한 명씩(이미 멤버인 나는 빼고) 멤버 POST 한다', async () => {
    const { user, writes } = openSection()
    await openPicker(user)
    await user.click(await screen.findByTestId('project-member-picker-personal-group-30'))
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', path: 'members', body: { userId: 8, role: 'MEMBER' } },
        { method: 'POST', path: 'members', body: { userId: 11, role: 'MEMBER' } },
      ]),
    )
    expect(writes.some((w) => w.path === 'member-groups')).toBe(false)
    expect(await screen.findByText('개발 스터디에서 2명 추가 (이미 있는 1명 제외)')).toBeInTheDocument()
  })

  test('부서 제거는 확인 뒤에만 DELETE 하고 목록에서 빠진다', async () => {
    const { user, writes } = openSection([DEV])
    await user.click(await screen.findByTestId('member-group-remove-10'))
    expect(await screen.findByText(/조직 개발팀을\(를\) 제거할까요\?/)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    await user.click(screen.getByTestId('member-group-remove-confirm'))
    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', path: 'member-groups/10' }]))
    await waitFor(() => expect(screen.queryByTestId('member-group-row-10')).not.toBeInTheDocument())
  })

  test('관리 권한이 없으면 부서 행은 보이되 제거·추가 버튼이 없다', async () => {
    openSection([DEV], false)
    expect(await screen.findByTestId('member-group-row-10')).toBeInTheDocument()
    expect(screen.queryByTestId('member-group-remove-10')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-add-trigger')).not.toBeInTheDocument()
  })

  test('담당자 후보에는 부서로 들어온 사람(direct=false)도 직접 멤버처럼 들어간다', async () => {
    const { user } = renderScreen(<AssigneePickerPopover projectKey={KEY} issueNumber={1} current={[]} />, {
      path: `/projects/${KEY}/issues/1`,
      handlers: [
        http.get(`${API}/members`, () =>
          HttpResponse.json([member(1, '나', 'OWNER', true), member(7, '한지수', 'MEMBER', false)]),
        ),
      ],
    })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    expect(await screen.findByTestId('assignee-option-7')).toHaveTextContent('한지수')
    expect(screen.getByTestId('assignee-option-1')).toBeInTheDocument()
  })

  test('빈 상태 「멤버가 없습니다」는 조직 목록을 받은 뒤에만 — 받는 중·실패면 보이지 않고, 실패는 따로 알린다', async () => {
    // 직접 멤버가 없고 부서로만 들어온 사람만 있는 프로젝트 — 조직 목록이 응답하기 전·실패하면 비어 보이면 안 된다.
    let respond: 'pending' | 'error' | 'empty' = 'pending'
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    renderScreen(<MemberManagement projectKey={KEY} />, {
      path: `/projects/${KEY}/settings`,
      handlers: [
        http.get(`${API}/members`, () => HttpResponse.json([member(7, '한지수', 'MEMBER', false)])),
        http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
        http.get(`${API}/member-groups`, async () => {
          if (respond === 'pending') await gate
          if (respond === 'error') return HttpResponse.json({ message: 'boom' }, { status: 500 })
          return HttpResponse.json([])
        }),
      ],
    })
    // 멤버 표는 그려졌지만 조직 목록은 아직 — 빈 상태가 없다.
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.queryByText('멤버가 없습니다')).not.toBeInTheDocument()
    // 실패하면 빈 상태 대신 실패 안내.
    respond = 'error'
    release()
    expect(await screen.findByTestId('member-groups-error', {}, { timeout: 5000 })).toHaveTextContent('조직 멤버를 불러오지 못했습니다')
    expect(screen.queryByText('멤버가 없습니다')).not.toBeInTheDocument()
  })

  test('빈 상태 「멤버가 없습니다」는 직접 멤버도 조직도 없다고 받은 뒤에 보인다', async () => {
    renderScreen(<MemberManagement projectKey={KEY} />, {
      path: `/projects/${KEY}/settings`,
      handlers: [
        http.get(`${API}/members`, () => HttpResponse.json([])),
        http.get('/api/v1/members', () => HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 })),
        http.get(`${API}/member-groups`, () => HttpResponse.json([])),
      ],
    })
    expect(await screen.findByText('멤버가 없습니다')).toBeInTheDocument()
    expect(screen.queryByTestId('member-groups-error')).not.toBeInTheDocument()
  })
})
