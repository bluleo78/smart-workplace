// 채널 멤버 패널의 조직도 부서·내 그룹(WP-1058) — 비공개 채널의 부서 행(「개발팀 · N명 [조직]」)·펼침(그 부서로 들어온 사람과 역할)·추가(POST {groupId})·제거,
// 사람 줄의 부서 안내(「개발팀에도 속함」·「개발팀으로 참여」)·내보내기 확인 문구·부서로만 들어온 사람의 역할 안내, 공개 채널은 부서를 숨기는 것,
// 내 그룹을 사람으로 풀어 초대(이미 직접 멤버는 빼고, 부서로만 들어온 사람은 초대해 직접 멤버로 고정)·부서로만 들어온 사람의 직접 초대,
// 부서 이름을 모를 때(부서 목록 실패) 줄 안내를 숨기고 내보내기 문구를 「조직도 부서로도」로 쓰는 것을 MSW 로 본다.
// 사람 초대·역할 변경·소유권 이전·나가기 같은 기존 패널 동작은 pages/chat/channelPage.test.tsx 「멤버 패널」이 채널 화면에서 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { ChannelMemberGroup, ChannelMemberResponse, ChannelRole, ChannelVisibility } from '@/types/messaging'
import type { UserGroupDetail, UserGroupNode, UserGroupTree } from '@/types/userGroup'

import { createMember } from '../../../e2e/factories/auth.factory'
import { createChannelMember } from '../../../e2e/factories/messaging.factory'
import { ChannelMembersPanel } from './ChannelMembersPanel'

const CID = 70
const API = `/api/v1/messaging/channels/${CID}`

function groupNode(id: number, name: string, children: UserGroupNode[] = [], visibility: UserGroupNode['visibility'] = 'SHARED'): UserGroupNode {
  return { id, code: null, name, parentId: null, ownerId: null, visibility, sortOrder: 0, children }
}

/** 조직도 — 개발팀(10)·디자인팀(20). 내 그룹 개발 스터디(30) 아래 하위 그룹 리뷰어(31). */
const TREE: UserGroupTree = {
  shared: [groupNode(10, '개발팀'), groupNode(20, '디자인팀')],
  personal: [groupNode(30, '개발 스터디', [groupNode(31, '리뷰어', [], 'PERSONAL')], 'PERSONAL')],
}

/**
 * 내 그룹 상세 — 개발 스터디는 이서연(3, 직접 멤버)·박민수(5, 부서로 들어온 멤버)·최유진(8)·외부 연락처(99),
 * 하위 리뷰어는 강하늘(11)·최유진(8, 중복).
 */
function groupDetail(id: number): UserGroupDetail {
  const person = (targetId: number, name: string, targetType: 'MEMBER' | 'EXTERNAL' = 'MEMBER') => ({
    targetType, targetId, name, email: null, title: null, organization: null,
  })
  const members =
    id === 30
      ? [person(3, '이서연'), person(5, '박민수'), person(8, '최유진'), person(99, '외부 협력사', 'EXTERNAL')]
      : [person(11, '강하늘'), person(8, '최유진')]
  return { id, code: null, name: id === 30 ? '개발 스터디' : '리뷰어', parentId: id === 30 ? null : 30, ownerId: 1, visibility: 'PERSONAL', sortOrder: 0, members }
}

const DEV: ChannelMemberGroup = { groupId: 10, name: '개발팀', memberCount: 3, addedAt: '2026-10-01T00:00:00Z' }
const PLAN: ChannelMemberGroup = { groupId: 40, name: '기획파트', memberCount: 1, addedAt: '2026-10-01T00:00:00Z' }

/**
 * 나(1, OWNER)·이서연(3, 직접 + 개발팀)·박민수(5, 개발팀으로만)·김하나(6, 개발팀으로만 · ADMIN)·정우(7, 직접만).
 * 실효 멤버 목록(중복 제외)이라 부서로만 들어온 사람도 한 줄이다.
 */
const MEMBERS: ChannelMemberResponse[] = [
  createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
  createChannelMember({ userId: 3, name: '이서연', role: 'MEMBER', direct: true, viaGroupIds: [10] }),
  createChannelMember({ userId: 5, name: '박민수', role: 'MEMBER', direct: false, viaGroupIds: [10] }),
  createChannelMember({ userId: 6, name: '김하나', role: 'ADMIN', direct: false, viaGroupIds: [10] }),
  createChannelMember({ userId: 7, name: '정우', role: 'MEMBER' }),
]

/**
 * 멤버 패널을 연다 — 받은 쓰기 요청(사람·부서 POST, 부서 DELETE)과 멤버 부서 조회 수를 모으고, 쓰면 서버 상태를 바꿔 다시 받은 목록이 반영되게 한다.
 */
function openPanel({
  visibility = 'PRIVATE',
  myRole = 'OWNER',
  groups: initialGroups = [DEV],
  members: initialMembers = MEMBERS,
  groupsFail = false,
}: {
  visibility?: ChannelVisibility
  myRole?: ChannelRole
  groups?: ChannelMemberGroup[]
  members?: ChannelMemberResponse[]
  /** 멤버 부서 조회를 500 으로 — 부서 이름을 모르는 상태. */
  groupsFail?: boolean
} = {}) {
  let groups = [...initialGroups]
  let members = [...initialMembers]
  const writes: { method: string; path: string; body?: unknown }[] = []
  let groupReads = 0
  const view = renderScreen(
    <ChannelMembersPanel channelId={CID} myRole={myRole} visibility={visibility} open onOpenChange={() => {}} />,
    {
      handlers: [
        http.get(`${API}/members`, () => HttpResponse.json(members)),
        http.post(`${API}/members`, async ({ request }) => {
          const body = (await request.json()) as { userId: number }
          writes.push({ method: 'POST', path: 'members', body })
          members = [...members, createChannelMember({ userId: body.userId, name: `사용자${body.userId}` })]
          return new HttpResponse(null, { status: 201 })
        }),
        http.get(`${API}/member-groups`, () => {
          groupReads += 1
          return groupsFail ? HttpResponse.json({ message: '서버 오류' }, { status: 500 }) : HttpResponse.json(groups)
        }),
        http.post(`${API}/member-groups`, async ({ request }) => {
          const body = (await request.json()) as { groupId: number }
          writes.push({ method: 'POST', path: 'member-groups', body })
          const added = { groupId: body.groupId, name: body.groupId === 20 ? '디자인팀' : `조직${body.groupId}`, memberCount: 4, addedAt: '2026-10-29T00:00:00Z' }
          groups = [...groups, added]
          return HttpResponse.json(added, { status: 201 })
        }),
        http.delete(`${API}/member-groups/:groupId`, ({ params }) => {
          writes.push({ method: 'DELETE', path: `member-groups/${params.groupId}` })
          groups = groups.filter((g) => g.groupId !== Number(params.groupId))
          // 부서로만 들어온 사람은 함께 빠진다.
          members = members.filter((m) => m.direct !== false || !(m.viaGroupIds ?? []).includes(Number(params.groupId)))
          return new HttpResponse(null, { status: 204 })
        }),
        http.delete(`${API}/members/:userId`, ({ params }) => {
          writes.push({ method: 'DELETE', path: `members/${params.userId}` })
          members = members.filter((m) => m.userId !== Number(params.userId))
          return new HttpResponse(null, { status: 204 })
        }),
        http.get('/api/v1/members', () => {
          const content = [
            createMember({ userId: 3, username: 'seoyeon', name: '이서연' }),
            createMember({ userId: 5, username: 'minsu', name: '박민수' }),
            createMember({ userId: 8, username: 'yujin', name: '최유진' }),
          ]
          return HttpResponse.json({ content, page: 0, size: 20, totalElements: content.length, totalPages: 1 })
        }),
        http.get('/api/v1/user-groups', () => HttpResponse.json(TREE)),
        http.get('/api/v1/user-groups/:id', ({ params }) => HttpResponse.json(groupDetail(Number(params.id)))),
      ],
    },
  )
  return { ...view, writes, groupReads: () => groupReads }
}

/** 멤버 추가 창을 연다 — 사람 탭이 보일 때까지. */
async function openPicker(user: ScreenUser) {
  await user.click(await screen.findByTestId('member-add-trigger'))
  await screen.findByTestId('channel-member-picker-tab-people')
}

describe('채널 멤버 패널 — 조직도 부서·내 그룹(WP-1058)', () => {
  test('비공개 채널은 부서 행을 「이름 · N명 [조직]」으로 보이고, 펼치면 그 부서로 들어온 사람만 역할 배지와 함께 보인다', async () => {
    const { user } = openPanel()
    const row = await screen.findByTestId('member-group-row-10')
    expect(row).toHaveTextContent('개발팀')
    expect(row).toHaveTextContent('· 3명')
    expect(row).toHaveTextContent('조직')
    expect(screen.queryByTestId('member-group-members-10')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('member-group-toggle-10'))
    const list = await screen.findByTestId('member-group-members-10')
    // 이서연(직접 + 부서)·박민수·김하나(부서로만) — 직접만인 정우와 나는 없다.
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['이서연멤버', '박민수멤버', '김하나관리자'])
    expect(screen.getByTestId('member-group-member-role-10-6')).toHaveTextContent('관리자')
    // 사람 목록은 실효 멤버 전부(멤버 수 = 줄 수) — 부서로만 들어온 사람도 한 줄, 역할도 그대로 보인다.
    for (const id of [1, 3, 5, 6, 7]) expect(screen.getByTestId(`member-row-${id}`)).toBeInTheDocument()
    expect(screen.getByTestId('member-role-select-6')).toHaveValue('ADMIN')
  })

  test('직접 초대 + 부서면 「개발팀에도 속함」, 부서로만이면 「개발팀으로 참여」, 부서와 무관하면 안내가 없다', async () => {
    openPanel()
    expect(await screen.findByTestId('member-via-3')).toHaveTextContent('개발팀에도 속함')
    expect(screen.getByTestId('member-via-5')).toHaveTextContent('개발팀으로 참여')
    expect(screen.queryByTestId('member-via-7')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-via-1')).not.toBeInTheDocument()
  })

  test('부서로만 들어온 사람의 역할 선택에만 「직접 초대하거나 관리자로 지정하면 부서와 상관없이 채널에 남습니다」를 붙인다(OWNER 만 본다)', async () => {
    openPanel()
    const hint = await screen.findByTestId('member-role-hint-5')
    expect(hint).toHaveTextContent('직접 초대하거나 관리자로 지정하면 부서와 상관없이 채널에 남습니다')
    expect(screen.getByRole('combobox', { name: '박민수 역할 변경' })).toHaveAccessibleDescription(
      '직접 초대하거나 관리자로 지정하면 부서와 상관없이 채널에 남습니다',
    )
    // 직접 초대한 사람(부서에도 속한 이서연 포함)에게는 없다.
    expect(screen.queryByTestId('member-role-hint-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-role-hint-7')).not.toBeInTheDocument()
  })

  test('ADMIN 은 역할을 바꿀 수 없어 역할 안내가 없고, 부서 제거·추가는 할 수 있다', async () => {
    openPanel({ myRole: 'ADMIN' })
    expect(await screen.findByTestId('member-group-remove-10')).toBeInTheDocument()
    expect(screen.getByTestId('member-add-trigger')).toBeInTheDocument()
    expect(screen.getByTestId('member-role-5')).toHaveTextContent('멤버')
    expect(screen.queryByTestId('member-role-hint-5')).not.toBeInTheDocument()
  })

  test('MEMBER 는 부서 행을 보기만 한다 — 제거·추가 버튼이 없다', async () => {
    openPanel({ myRole: 'MEMBER' })
    expect(await screen.findByTestId('member-group-row-10')).toBeInTheDocument()
    expect(screen.queryByTestId('member-group-remove-10')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-add-trigger')).not.toBeInTheDocument()
  })

  test('부서로도 들어온 사람을 내보내면 확인 문구가 「개발팀으로도 참여 중 — 내보내면 부서 대상에서도 제외됩니다」이고, 확인하면 DELETE', async () => {
    const { user, writes } = openPanel()
    await user.click(await screen.findByRole('button', { name: '박민수 제거' }))
    expect(await screen.findByTestId('member-remove-group-note')).toHaveTextContent('개발팀으로도 참여 중 — 내보내면 부서 대상에서도 제외됩니다')
    await user.click(screen.getByTestId('member-remove-confirm'))
    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', path: 'members/5' }]))
    await waitFor(() => expect(screen.queryByTestId('member-row-5')).not.toBeInTheDocument())
  })

  test('내보내기 확인 문구의 조사는 부서 이름 받침을 따르고(기획파트로도), 부서와 무관한 사람에게는 붙지 않는다', async () => {
    const { user } = openPanel({
      groups: [PLAN],
      members: [
        createChannelMember({ userId: 1, name: '나', role: 'OWNER' }),
        createChannelMember({ userId: 3, name: '이서연', role: 'MEMBER', direct: true, viaGroupIds: [40] }),
        createChannelMember({ userId: 7, name: '정우', role: 'MEMBER' }),
      ],
    })
    await user.click(await screen.findByRole('button', { name: '이서연 제거' }))
    expect(await screen.findByTestId('member-remove-group-note')).toHaveTextContent('기획파트로도 참여 중 — 내보내면 부서 대상에서도 제외됩니다')
    await user.click(screen.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('member-remove-confirm')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '정우 제거' }))
    expect(await screen.findByTestId('member-remove-confirm')).toBeInTheDocument()
    expect(screen.queryByTestId('member-remove-group-note')).not.toBeInTheDocument()
  })

  test('조직을 고르면 POST {groupId} 만 보내고 부서 행이 보인다 — 이미 멤버인 부서는 고를 수 없다', async () => {
    const { user, writes } = openPanel()
    await openPicker(user)
    expect(await screen.findByTestId('channel-member-picker-tab-departments')).toBeInTheDocument()
    await user.click(await screen.findByTestId('channel-member-picker-department-20'))
    await waitFor(() => expect(writes).toEqual([{ method: 'POST', path: 'member-groups', body: { groupId: 20 } }]))
    expect(await screen.findByTestId('member-group-row-20')).toHaveTextContent('디자인팀')
    expect(screen.getByTestId('channel-member-picker-department-10')).toHaveTextContent('이미 추가됨')
  })

  test('조직 제거는 확인 뒤에만 DELETE 하고, 부서로만 들어온 사람은 다시 받은 목록에서 빠진다', async () => {
    const { user, writes } = openPanel()
    await user.click(await screen.findByTestId('member-group-remove-10'))
    expect(await screen.findByText(/채널에서 조직 개발팀을\(를\) 제거할까요\?/)).toBeInTheDocument()
    expect(writes).toHaveLength(0)
    await user.click(screen.getByTestId('member-group-remove-confirm'))
    await waitFor(() => expect(writes).toEqual([{ method: 'DELETE', path: 'member-groups/10' }]))
    await waitFor(() => expect(screen.queryByTestId('member-group-row-10')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByTestId('member-row-5')).not.toBeInTheDocument())
    // 직접 초대한 사람은 남는다.
    expect(screen.getByTestId('member-row-3')).toBeInTheDocument()
  })

  test('공개 채널은 멤버 부서를 받지 않고, 추가 창에 조직 탭 없이 사람·내 그룹만 보인다', async () => {
    const { user, groupReads } = openPanel({ visibility: 'PUBLIC', groups: [DEV] })
    expect(await screen.findByTestId('member-row-3')).toBeInTheDocument()
    expect(screen.queryByTestId('member-group-row-10')).not.toBeInTheDocument()
    await openPicker(user)
    expect(screen.getByTestId('channel-member-picker-tab-groups')).toBeInTheDocument()
    expect(await screen.findByTestId('channel-member-picker-personal-group-30')).toBeInTheDocument()
    expect(screen.queryByTestId('channel-member-picker-tab-departments')).not.toBeInTheDocument()
    expect(screen.queryByTestId('channel-member-picker-department-10')).not.toBeInTheDocument()
    expect(groupReads()).toBe(0)
  })

  test('내 그룹을 고르면 하위 그룹까지 사람을 한 명씩 초대하고, 부서로만 들어온 사람은 초대(직접 멤버로 고정)·직접 멤버·중복·외부 연락처는 빼고 알린다', async () => {
    const { user, writes } = openPanel()
    await openPicker(user)
    await user.click(await screen.findByTestId('channel-member-picker-personal-group-30'))
    // 이서연(3, 직접 멤버)은 빼고, 박민수(5, 개발팀으로만)는 초대한다.
    await waitFor(() =>
      expect(writes).toEqual([
        { method: 'POST', path: 'members', body: { userId: 5 } },
        { method: 'POST', path: 'members', body: { userId: 8 } },
        { method: 'POST', path: 'members', body: { userId: 11 } },
      ]),
    )
    // 그룹 자체는 서버에 보내지 않는다 — 부서 POST 가 없다.
    expect(writes.some((w) => w.path === 'member-groups')).toBe(false)
    // 박민수(5)는 개발팀으로 들어와 있던 사람이라 새로 들어온 2명과 나눠 알린다 — 그룹은 풀어 직접 멤버로 고정하는 것이 규칙(WP-1186).
    expect(
      await screen.findByText('개발 스터디에서 2명 추가 · 부서로 있던 1명은 직접 멤버로 고정 (이미 있는 1명 제외)'),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('member-row-11')).toBeInTheDocument()
  })

  test('공개 채널에서도 내 그룹은 사람으로 풀어 초대한다', async () => {
    const { user, writes } = openPanel({
      visibility: 'PUBLIC',
      groups: [],
      members: [createChannelMember({ userId: 1, name: '나', role: 'OWNER' }), createChannelMember({ userId: 3, name: '이서연' })],
    })
    await openPicker(user)
    await user.click(await screen.findByTestId('channel-member-picker-personal-group-30'))
    await waitFor(() => expect(writes.map((w) => w.body)).toEqual([{ userId: 5 }, { userId: 8 }, { userId: 11 }]))
  })

  test('부서로만 들어온 사람은 선택 창에서 고를 수 있고 「개발팀으로 참여 중 — 초대하면 직접 멤버로 남습니다」가 붙으며, 고르면 POST {userId}', async () => {
    const { user, writes } = openPanel()
    await openPicker(user)
    const deptOnly = await screen.findByTestId('channel-member-picker-person-5')
    expect(deptOnly).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('channel-member-picker-person-note-5')).toHaveTextContent('개발팀으로 참여 중 — 초대하면 직접 멤버로 남습니다')
    // 직접 멤버는 그대로 막힌다.
    expect(screen.getByTestId('channel-member-picker-person-3')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('channel-member-picker-person-3')).toHaveTextContent('(이미 추가됨)')
    expect(screen.queryByTestId('channel-member-picker-person-note-8')).not.toBeInTheDocument()
    await user.click(deptOnly)
    await waitFor(() => expect(writes).toEqual([{ method: 'POST', path: 'members', body: { userId: 5 } }]))
  })

  test('부서 이름을 모르면(부서 목록 실패) 줄 안내를 숨기고, 내보내기 확인은 「조직도 부서로도 참여 중 — …」로 알린다', async () => {
    const { user } = openPanel({ groupsFail: true })
    expect(await screen.findByTestId('member-groups-error')).toHaveTextContent('조직 멤버를 불러오지 못했습니다')
    expect(screen.getByTestId('member-row-3')).toBeInTheDocument()
    expect(screen.queryByTestId('member-via-3')).not.toBeInTheDocument()
    expect(screen.queryByTestId('member-via-5')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '박민수 제거' }))
    expect(await screen.findByTestId('member-remove-group-note')).toHaveTextContent('조직도 부서로도 참여 중 — 내보내면 부서 대상에서도 제외됩니다')
  })
})
