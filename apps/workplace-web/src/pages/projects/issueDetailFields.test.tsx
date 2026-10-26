// 이슈 상세 사이드 필드(담당자·구독·시작일·마일스톤·상태·상위 에픽·하위 이슈) — 페이지 테스트(WP-971).
// 피커 선택 → PATCH/PUT/POST payload, 응답 → 화면 반영, 실패 토스트, 조건부 렌더(비활성 구성원·AGENT 배지·완료 에픽 안내)는
// 브라우저 없이 판정되므로 e2e/pages/projects/{assignees,watch,issue-start-date-milestone,epic-hierarchy,projects,issue-list}.spec.ts 에서 옮겼다.
// 긴 이름 한 줄(@layout)·키보드 구독 뒤 포커스 유지(@input)는 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueDetailSubHandlers } from '@/test/kits/projects/issueDetailStubs'
import { API, type Call, projectScreen, toCall } from '@/test/kits/projects/projectScreens'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueDetailResponse, IssueResponse } from '@/types/issue'
import type { MilestoneResponse } from '@/types/milestone'
import type { UserSummary } from '@/types/user'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createAgentMember, createMember } from '../../../e2e/factories/project.factory'
import { statusFieldsOf, withCustomStatuses } from '../../../e2e/factories/projectStatus.factory'


const KEY = 'WP'
const ISSUE = `${API}/projects/${KEY}/issues/1`

const USER1: UserSummary = { id: 1, username: 'testuser', name: '테스트 사용자', kind: 'HUMAN' }
const USER2: UserSummary = { id: 2, username: 'second', name: '두번째 멤버', kind: 'HUMAN' }
const OWNER1 = createMember({ userId: 1, username: USER1.username, name: USER1.name, role: 'OWNER' })

/**
 * 이슈 1 상세를 띄운다 — detail 은 가변(ref.current)이라 쓰기 핸들러가 바꾸면 재조회에 반영된다.
 * members: 프로젝트 멤버(담당자 피커·권한), extra: 테스트별 핸들러(앞에 두어 우선한다).
 */
async function openDetail(
  detail: IssueDetailResponse,
  { members = [OWNER1], extra = [], search }: { members?: ReturnType<typeof createMember>[]; extra?: RequestHandler[]; search?: (url: URL) => IssueResponse[] } = {},
) {
  const ref = { current: detail }
  const calls: Call[] = []
  const view = renderPage(`/projects/${KEY}/issues/1`, {
    handlers: [
      ...extra,
      http.get(`${API}/projects/${KEY}/members`, () => HttpResponse.json(members)),
      http.get(`${API}/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      ...issueDetailSubHandlers({ key: KEY, number: 1, detail: () => ref.current }),
      ...projectScreen(KEY, { search }).handlers,
    ],
  })
  await screen.findByTestId('issue-title-heading', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return { ...view, ref, calls }
}

const detailWith = (summary: Partial<IssueResponse>, rest: Partial<IssueDetailResponse> = {}) =>
  createIssueDetail({ summary: createIssue({ id: 1, number: 1, ...summary }), ...rest })

describe('담당자(다중)', () => {
  // 빈 상태에서 두 명을 체크하고 닫으면 PUT {userIds:[1,2]} 한 번, 토스트, 사이드바에 두 사람이 이름·아바타로 보인다.
  test('미지정에서 두 명을 고르고 닫으면 PUT {userIds:[1,2]} 와 토스트, 상세에 두 사람이 보인다', async () => {
    const puts: unknown[] = []
    const members = [OWNER1, createMember({ userId: 2, username: USER2.username, name: USER2.name, role: 'MEMBER' })]
    const { user, ref } = await openDetail(detailWith({ title: '담당자 미지정', assignees: [] }), {
      members,
      extra: [
        http.put(`${ISSUE}/assignees`, async ({ request }) => {
          const { userIds } = (await request.json()) as { userIds: number[] }
          puts.push({ userIds })
          const updated = [USER1, USER2].filter((u) => userIds.includes(u.id))
          ref.current = { ...ref.current, summary: { ...ref.current.summary, assignees: updated } }
          return HttpResponse.json(updated)
        }),
      ],
    })
    expect(screen.getByTestId('issue-assignees')).toHaveTextContent('미지정')
    // 접근 이름에 보이는 값이 붙는다(WP-853).
    expect(screen.getByRole('button', { name: '담당자 편집: 미지정' })).toBeInTheDocument()

    await user.click(screen.getByTestId('assignee-picker-trigger'))
    await screen.findByTestId('assignee-picker')
    await user.click(screen.getByTestId(`assignee-option-${USER1.id}`))
    await user.click(screen.getByTestId(`assignee-option-${USER2.id}`))
    await user.keyboard('{Escape}')

    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 2] }]))
    expect(await screen.findByText('담당자를 저장했습니다')).toBeInTheDocument()
    expect(await screen.findByTestId(`issue-assignee-${USER1.id}`)).toHaveTextContent(USER1.name)
    expect(screen.getByTestId(`issue-assignee-${USER2.id}`)).toHaveTextContent(USER2.name)
    expect(screen.getByTestId('assignee-picker-trigger')).toHaveAccessibleName(`담당자 편집: ${USER1.name}, ${USER2.name}`)
    expect(screen.getAllByTestId(`user-avatar-${USER1.id}`).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId(`user-avatar-${USER2.id}`).length).toBeGreaterThan(0)
  })

  // 기존 담당자를 모두 해제하면 PUT {userIds:[]} 와 미지정 표시.
  test('기존 담당자를 모두 해제하면 PUT {userIds:[]} 와 「미지정」으로 돌아간다', async () => {
    const puts: unknown[] = []
    const { user, ref } = await openDetail(detailWith({ title: '담당자 보유', assignees: [USER1] }), {
      extra: [
        http.put(`${ISSUE}/assignees`, async ({ request }) => {
          puts.push(await request.json())
          ref.current = { ...ref.current, summary: { ...ref.current.summary, assignees: [] } }
          return HttpResponse.json([])
        }),
      ],
    })
    expect(screen.getByTestId(`issue-assignee-${USER1.id}`)).toBeInTheDocument()
    await user.click(screen.getByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByTestId(`assignee-option-${USER1.id}`))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [] }]))
    expect(await screen.findByText('담당자를 저장했습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('issue-assignees')).toHaveTextContent('미지정'))
  })

  // Phase 5(#20): AGENT 멤버는 피커에서 data-agent·AgentBadge 로 사람과 구분된다.
  test('AGENT 멤버는 피커 항목에 data-agent 와 AI 배지가 붙고 사람 멤버에는 없다', async () => {
    const { user } = await openDetail(detailWith({ assignees: [] }), {
      members: [OWNER1, createAgentMember({ userId: 99, username: 'ai-agent', name: 'AI Agent' })],
    })
    await user.click(screen.getByTestId('assignee-picker-trigger'))
    const human = await screen.findByTestId(`assignee-option-${USER1.id}`)
    expect(human).not.toHaveAttribute('data-agent', 'true')
    expect(within(human).queryByTestId('agent-badge')).not.toBeInTheDocument()
    const agent = screen.getByTestId('assignee-option-99')
    expect(agent).toHaveAttribute('data-agent', 'true')
    expect(within(agent).getByTestId('agent-badge')).toBeInTheDocument()
  })

  // WP-487: 비활성 구성원은 후보에서 빠지고, 이미 담당 중이면 「비활성」 표시로 남아 해제만 된다(다시 체크 불가).
  test('비활성 구성원은 후보에서 빠지고, 담당 중인 비활성 구성원은 「비활성」 표시로 해제만 된다', async () => {
    const puts: unknown[] = []
    const { user } = await openDetail(detailWith({ assignees: [{ id: 3, username: 'left', name: '퇴사자', kind: 'HUMAN' }] }), {
      members: [
        createMember({ userId: 1, username: USER1.username, name: USER1.name, role: 'OWNER', active: true }),
        createMember({ userId: 2, username: USER2.username, name: USER2.name, role: 'MEMBER', active: false }),
        createMember({ userId: 3, username: 'left', name: '퇴사자', role: 'MEMBER', active: false }),
      ],
      extra: [
        http.put(`${ISSUE}/assignees`, async ({ request }) => {
          puts.push(await request.json())
          return HttpResponse.json([])
        }),
      ],
    })
    await user.click(screen.getByTestId('assignee-picker-trigger'))
    expect(await screen.findByTestId(`assignee-option-${USER1.id}`)).toBeInTheDocument()
    expect(screen.queryByTestId(`assignee-option-${USER2.id}`)).not.toBeInTheDocument()
    const kept = screen.getByTestId('assignee-option-3')
    expect(within(kept).getByTestId('assignee-option-3-inactive')).toHaveTextContent('비활성')
    await user.click(within(kept).getByRole('checkbox'))
    await waitFor(() => expect(within(kept).getByRole('checkbox')).toBeDisabled())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [] }]))
  })
})

describe('구독(watch)', () => {
  // 구독 토글 → POST(구독)/DELETE(해제), aria-pressed·aria-label 이 바뀐다.
  test('구독을 누르면 POST 후 「구독 중」, 다시 누르면 DELETE 후 「구독」', async () => {
    let watchers: { userId: number; username: string; name: string }[] = []
    const calls: string[] = []
    const { user } = await openDetail(detailWith({ title: 'watch 대상' }), {
      extra: [
        http.get(`${ISSUE}/watchers`, () => HttpResponse.json(watchers)),
        http.post(`${ISSUE}/watch`, () => {
          calls.push('POST')
          watchers = [{ userId: 1, username: 'testuser', name: '테스트 사용자' }]
          return new HttpResponse(null, { status: 204 })
        }),
        http.delete(`${ISSUE}/watch`, () => {
          calls.push('DELETE')
          watchers = []
          return new HttpResponse(null, { status: 204 })
        }),
      ],
    })
    const btn = screen.getByTestId('watch-toggle')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(btn).toHaveAttribute('aria-label', '구독')
    await user.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'))
    expect(btn).toHaveAttribute('aria-label', '구독 중')
    await user.click(btn)
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'))
    expect(btn).toHaveAttribute('aria-label', '구독')
    expect(calls).toEqual(['POST', 'DELETE'])
  })

  // 구독 변경이 500 이면 실패 토스트.
  test('구독 변경이 실패하면 「구독 상태를 변경하지 못했습니다」 토스트', async () => {
    const { user } = await openDetail(detailWith({}), {
      extra: [http.post(`${ISSUE}/watch`, () => HttpResponse.json({ status: 500, message: '' }, { status: 500 }))],
    })
    await user.click(screen.getByTestId('watch-toggle'))
    expect(await screen.findByText('구독 상태를 변경하지 못했습니다')).toBeInTheDocument()
  })
})

describe('시작일·마일스톤 피커 (#620)', () => {
  const milestone = (id: number, name: string): MilestoneResponse => ({
    id,
    projectId: 1,
    name,
    dueDate: '2026-08-01',
    description: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  })

  /** PATCH 를 받아 시작일·마일스톤을 반영하는 상세. */
  async function openWithPatch(initial: Partial<IssueResponse> = {}) {
    const patches: Record<string, unknown>[] = []
    const state = { startDate: initial.startDate ?? null, milestoneId: initial.milestoneId ?? null }
    const summary = () => createIssue({ id: 1, number: 1, ...state })
    const view = await openDetail(createIssueDetail({ summary: summary() }), {
      extra: [
        http.get(`${API}/projects/${KEY}/milestones`, () => HttpResponse.json([milestone(1, 'v1.0 출시'), milestone(2, 'v2.0 출시')])),
        http.get(ISSUE, () => HttpResponse.json(createIssueDetail({ summary: summary() }))),
        http.patch(ISSUE, async ({ request }) => {
          const p = (await request.json()) as Record<string, unknown>
          patches.push(p)
          if (typeof p.startDate === 'string') state.startDate = p.startDate
          if (p.clearStartDate === true) state.startDate = null
          if (typeof p.milestoneId === 'number') state.milestoneId = p.milestoneId
          if (p.clearMilestone === true) state.milestoneId = null
          return HttpResponse.json(summary())
        }),
      ],
    })
    return { ...view, patches }
  }

  // 달력에서 10일을 고르면 PATCH {startDate: YYYY-MM-10} 이고 트리거·접근 이름이 그 날짜로 바뀐다.
  test('시작일을 고르면 PATCH {startDate} 가 나가고 트리거가 그 날짜로 바뀐다', async () => {
    const { user, patches } = await openWithPatch()
    const trigger = screen.getByTestId('start-date-trigger')
    expect(trigger).toHaveTextContent('없음')
    expect(screen.getByRole('button', { name: '시작일 선택: 없음' })).toBeInTheDocument()
    await user.click(trigger)
    const pop = await screen.findByTestId('start-date-popover')
    const day10 = [...pop.querySelectorAll<HTMLButtonElement>('[data-slot="calendar"] button[data-day]')].find((b) => b.textContent === '10')!
    await user.click(day10)
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].startDate).toMatch(/^\d{4}-\d{2}-10$/)
    expect(patches[0].clearStartDate).toBeFalsy()
    await waitFor(() => expect(screen.queryByTestId('start-date-popover')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('start-date-trigger')).toHaveTextContent('10일'))
    expect(screen.getByTestId('start-date-trigger')).toHaveAccessibleName(/^시작일 선택: \d{4}년 \d{1,2}월 10일$/)
  })

  // 마일스톤을 고르면 PATCH {milestoneId}, 트리거·접근 이름이 그 이름으로.
  test('마일스톤을 고르면 PATCH {milestoneId:2} 가 나가고 트리거가 「v2.0 출시」가 된다', async () => {
    const { user, patches } = await openWithPatch()
    expect(screen.getByTestId('milestone-picker-trigger')).toHaveTextContent('없음')
    expect(screen.getByRole('button', { name: '마일스톤 선택: 없음' })).toBeInTheDocument()
    await user.click(screen.getByTestId('milestone-picker-trigger'))
    await user.click(await screen.findByTestId('milestone-option-2'))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].milestoneId).toBe(2)
    expect(patches[0].clearMilestone).toBeFalsy()
    await waitFor(() => expect(screen.getByTestId('milestone-picker-trigger')).toHaveTextContent('v2.0 출시'))
    expect(screen.getByTestId('milestone-picker-trigger')).toHaveAccessibleName('마일스톤 선택: v2.0 출시')
    expect(screen.queryByTestId('milestone-picker-popover')).not.toBeInTheDocument()
  })

  // 연결된 마일스톤 행만 선택 표시(WP-368), 「없음」을 고르면 PATCH {clearMilestone:true}.
  test('연결된 마일스톤만 선택 표시되고, 해제하면 PATCH {clearMilestone:true} 후 「없음」', async () => {
    const { user, patches } = await openWithPatch({ milestoneId: 1 })
    await waitFor(() => expect(screen.getByTestId('milestone-picker-trigger')).toHaveTextContent('v1.0 출시'))
    await user.click(screen.getByTestId('milestone-picker-trigger'))
    expect(await screen.findByTestId('milestone-option-1')).toHaveClass('bg-selected', 'selection-bar')
    expect(screen.getByTestId('milestone-option-2')).not.toHaveClass('bg-selected')
    await user.click(screen.getByTestId('milestone-option-clear'))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].clearMilestone).toBe(true)
    await waitFor(() => expect(screen.getByTestId('milestone-picker-trigger')).toHaveTextContent('없음'))
  })
})

describe('상태 선택', () => {
  /** 상태를 바꾸면 응답·재조회가 새 상태를 돌려주는 상세. */
  async function openStatus(statuses = withCustomStatuses('대기', '검토 중'), initial: Partial<IssueResponse> = { status: 'IN_PROGRESS' }) {
    const patches: Record<string, unknown>[] = []
    let summary = createIssue({ id: 1, number: 1, title: '상태 바꿀 작업', ...initial })
    let history: IssueDetailResponse['history'] = []
    const view = await openDetail(createIssueDetail({ summary }), {
      extra: [
        http.get(`${API}/projects/${KEY}/statuses`, () => HttpResponse.json(statuses)),
        http.get(ISSUE, () => HttpResponse.json(createIssueDetail({ summary, history }))),
        http.patch(ISSUE, async ({ request }) => {
          const p = (await request.json()) as Record<string, unknown>
          patches.push(p)
          const from = summary.status
          summary = { ...summary, ...statusFieldsOf(p.statusId as number), ...(p.statusId === 12 ? { statusId: 12, statusName: '검토 중' } : {}) }
          history = [
            { id: 1, actorId: 1, actorName: 'Tester', actorKind: 'HUMAN', eventType: 'STATUS_CHANGED', fromValue: from, toValue: summary.status, createdAt: new Date().toISOString() },
          ]
          return HttpResponse.json(createIssueDetail({ summary, history }))
        }),
      ],
    })
    return { ...view, patches }
  }

  // WP-808: 선택지는 프로젝트 상태 이름(사용자 정의 포함) 순서, 고르면 PATCH 본문은 statusId(범주 status 아님).
  test('사용자 정의 상태 「검토 중」을 고르면 PATCH 본문이 statusId=12 이고 선택이 그 이름으로 바뀐다', async () => {
    const { user, patches } = await openStatus()
    const select = screen.getByTestId('issue-status-select')
    expect(select).toHaveTextContent('진행 중')
    await user.click(select)
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['할 일', '진행 중', '대기', '검토 중', '완료', '취소'])
    await user.click(screen.getByRole('option', { name: '검토 중' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].statusId).toBe(12)
    expect(patches[0]).not.toHaveProperty('status')
    await waitFor(() => expect(screen.getByTestId('issue-status-select')).toHaveTextContent('검토 중'))
  })

  // 필드 변경 성공 토스트(#323)와 활동 탭의 한국어 상태 변경 라벨.
  test('상태를 바꾸면 「이슈 필드가 업데이트되었습니다」 토스트와 이력 탭에 「할 일 → 진행 중」이 보인다', async () => {
    const { user, patches } = await openStatus(undefined, { status: 'TODO' })
    await user.click(screen.getByRole('combobox', { name: '상태' }))
    await user.click(await screen.findByRole('option', { name: '진행 중' }))
    await waitFor(() => expect(patches).toEqual([{ statusId: 2 }]))
    expect(await screen.findByText('이슈 필드가 업데이트되었습니다')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /이력/ }))
    expect(await screen.findByText('상태 변경')).toBeInTheDocument()
    expect(screen.getByText(/할 일\s*→\s*진행 중/)).toBeInTheDocument()
  })
})

describe('에픽 계층', () => {
  const epicType = makeEpicType()

  // EPIC 상세: 부모 슬롯 없음, 하위 유형 셀렉트가 기본값(태스크)으로 채워져 바로 추가 가능(#605),
  // POST {title,typeId,parentNumber} → 하위 행과 진행률 0/1.
  test('에픽 상세에서 하위 이슈를 추가하면 POST {title,typeId:1,parentNumber:1} 후 하위 행과 진행률 0/1 이 보인다', async () => {
    const children: IssueResponse[] = []
    const posts: unknown[] = []
    const detail = () =>
      createIssueDetail({
        summary: createIssue({ id: 1, number: 1, title: '에픽 1', type: epicType, childCount: children.length, childDoneCount: 0 }),
        body: '',
      })
    const { user } = await openDetail(detail(), {
      search: (url) => (url.searchParams.get('parent') === '1' ? children : []),
      extra: [
        http.get(ISSUE, () => HttpResponse.json(detail())),
        http.post(`${API}/projects/${KEY}/issues`, async ({ request }) => {
          const p = (await request.json()) as { title: string; typeId: number; parentNumber: number }
          posts.push(p)
          const child = createIssue({ id: 100, number: 100, title: p.title, parent: { number: 1, title: '에픽 1', type: epicType } })
          children.push(child)
          return HttpResponse.json(child)
        }),
      ],
    })
    expect(await screen.findByTestId('issue-children-section')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-parent-slot')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '하위 이슈', level: 3 })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('epic-child-type-select')).toHaveTextContent('태스크'))

    await user.type(screen.getByTestId('child-add-input'), '첫 스토리')
    const add = within(screen.getByTestId('child-add-form')).getByRole('button', { name: '추가' })
    expect(add).toBeEnabled()
    await user.click(add)
    await waitFor(() => expect(posts).toEqual([{ title: '첫 스토리', typeId: 1, parentNumber: 1 }]))
    expect(await screen.findByTestId('child-row-100')).toHaveTextContent('첫 스토리')
    await waitFor(() => expect(screen.getByTestId('child-progress-text')).toHaveTextContent('0/1'))
  })

  // WP-689: 완료 에픽에는 미완료 하위를 넣을 수 없다 — 추가 입력 대신 다시 열라는 안내.
  test('완료 에픽 상세는 하위 추가 입력 대신 「다시 열면 추가할 수 있습니다」 안내를 보인다', async () => {
    const child = createIssue({ id: 2, number: 2, title: '끝난 하위', status: 'DONE', parent: { number: 1, title: '끝난 에픽', type: epicType } })
    await openDetail(detailWith({ title: '끝난 에픽', status: 'DONE', type: epicType, childCount: 1, childDoneCount: 1 }), {
      search: (url) => (url.searchParams.get('parent') === '1' ? [child] : []),
    })
    expect(await screen.findByTestId('child-row-2')).toBeInTheDocument()
    expect(screen.getByTestId('child-add-done-epic-hint')).toHaveTextContent(
      '완료된 에픽에는 하위 이슈를 추가할 수 없습니다. 에픽을 다시 열면 추가할 수 있습니다.',
    )
    expect(screen.queryByTestId('child-add-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('child-add-input')).not.toBeInTheDocument()
  })

  // 일반 이슈: 「상위 에픽」 슬롯에 번호를 넣어 저장하면 PATCH /parent {parentNumber:5}, 배지가 새 에픽으로.
  test('일반 이슈의 상위 에픽 슬롯에서 5 를 저장하면 PUT /parent {parentNumber:5} 후 에픽 배지가 보인다', async () => {
    const parentCalls: Call[] = []
    let parent: IssueResponse['parent'] = null
    const detail = () => createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '일반 이슈', parent }) })
    const { user } = await openDetail(detail(), {
      extra: [
        http.get(ISSUE, () => HttpResponse.json(detail())),
        http.all(`${ISSUE}/parent`, async ({ request }) => {
          parentCalls.push(await toCall(request))
          parent = { number: 5, title: '분기 에픽', type: epicType }
          return HttpResponse.json(detail())
        }),
      ],
    })
    expect(screen.getByTestId('issue-parent-slot')).toBeInTheDocument()
    expect(screen.getByText('상위 에픽')).toBeInTheDocument()
    expect(screen.getByTestId('epic-parent-empty')).toBeInTheDocument()
    await user.click(screen.getByTestId('issue-parent-edit'))
    await user.type(await screen.findByTestId('parent-number-input'), '5')
    await user.click(screen.getByTestId('parent-save'))
    await waitFor(() => expect(parentCalls.map((c) => c.body)).toEqual([{ parentNumber: 5 }]))
    expect(await screen.findByTestId('parent-badge-5')).toHaveTextContent('분기 에픽')
    expect(screen.queryByTestId('issue-parent-picker')).not.toBeInTheDocument()
  })
})
