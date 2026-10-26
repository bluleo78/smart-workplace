// 이슈 의존성(차단 관계, Phase 4b) — 페이지 테스트(WP-971).
// 409(DEPENDENCY_CYCLE) 토스트와 창·고른 이슈 유지, 링크 행의 상태 이름(WP-869), 선행 이슈보다 이른 마감일 경고(#669),
// 미완료 선행이 있을 때 완료 전환 확인창(#827)은 브라우저 없이 판정되므로 e2e/pages/projects/dependencies.spec.ts 에서 옮겼다.
// 관계 추가 → POST → 행 → 제거의 배선(@wiring), 호버·키보드 포커스 때만 보이는 제거 버튼(@input), 좁은 레일의 2줄 배치(@layout)는 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueLinkSummary, IssueResponse } from '@/types/issue'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'
import { statusFieldsOf } from '../../../e2e/factories/projectStatus.factory'

const KEY = 'WP'
const ISSUE = `/api/v1/projects/${KEY}/issues/1`
const taskType = makeTaskType()

type User = ReturnType<typeof renderPage>['user']

/** 이슈 상세 — summary() 를 매 GET 마다 읽는다. extra 는 쓰기 핸들러. */
async function openIssue(summary: () => IssueResponse, extra: ReturnType<typeof http.get>[] = []) {
  const view = renderPage(`/projects/${KEY}/issues/1`, {
    handlers: [
      ...extra,
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ id: 1, key: KEY }))),
      http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json([createMember({ userId: 1, role: 'OWNER' })])),
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(`/api/v1/projects/${KEY}/fields`, () => HttpResponse.json([])),
      http.get(ISSUE, () => HttpResponse.json(createIssueDetail({ summary: summary(), body: '' }))),
      ...['watchers', 'labels', 'attachments', 'children'].map((sub) => http.get(`${ISSUE}/${sub}`, () => HttpResponse.json([]))),
      http.get(`/api/v1/projects/${KEY}/issues`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
    ],
  })
  await screen.findByTestId('issue-status-select', {}, { timeout: PAGE_LOAD_TIMEOUT })
  return view
}

/** 「관계」 그룹을 펼친다 — 기본 접힘(#343). 접혀 있으면 이름에 배지 수가 붙는다. */
async function openRelations(user: User) {
  await user.click(within(screen.getByTestId('property-group-relations')).getByRole('button', { name: /^관계(\s*\d+)?$/ }))
}

/**
 * Radix Select 에서 항목을 고른다 — jsdom 에 포인터 캡처가 없어 키보드로 열고, 항목은 click 으로 고른다
 * (포인터 종류가 mouse 가 아닌 click 은 Radix 가 터치 선택으로 받는다). 같은 선택 상태를 레이아웃 없이 만든다.
 */
async function pickOption(user: User, trigger: HTMLElement, name: string) {
  trigger.focus()
  await user.keyboard('{Enter}')
  fireEvent.click(await screen.findByRole('option', { name }))
}

const base = (over: Partial<IssueResponse> = {}): IssueResponse => ({
  ...createIssue({ id: 1, number: 1, title: 'task A' }),
  type: taskType,
  blockedBy: [],
  blocks: [],
  blocked: false,
  ...over,
})

describe('의존성', () => {
  test('사이클이 생기는 차단(409)은 서버 문구 토스트를 띄우고 창과 고른 이슈를 그대로 둔다', async () => {
    let posts = 0
    const { user } = await openIssue(() => base(), [
      http.post(`${ISSUE}/dependencies`, () => {
        posts++
        return HttpResponse.json({ code: 'DEPENDENCY_CYCLE', message: '의존성 사이클이 발생합니다' }, { status: 409 })
      }),
      http.get('/api/v1/issues/lookup', () => HttpResponse.json([{ projectKey: KEY, number: 7, title: '이슈 7', status: 'TODO', type: taskType }])),
    ])
    await openRelations(user)
    await user.click(await screen.findByTestId('issue-relation-add'))
    await screen.findByTestId('issue-relation-dialog')
    // 고르기 전엔 추가 버튼이 꺼져 있다(요청 없음).
    expect(screen.getByTestId('issue-relation-submit')).toBeDisabled()
    await pickOption(user, screen.getByTestId('issue-relation-type-select'), '차단됨 (선행 필요)')
    await user.click(screen.getByTestId('issue-relation-search'))
    await user.paste('#7')
    await user.click(await screen.findByTestId(`issue-relation-result-${KEY}-7`))
    expect(posts).toBe(0)
    await user.click(screen.getByTestId('issue-relation-submit'))

    expect(await screen.findByText('의존성 사이클이 발생합니다')).toBeInTheDocument()
    expect(posts).toBe(1)
    expect(screen.getByTestId('issue-relation-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('issue-relation-selected')).toHaveTextContent('#7')
    expect(screen.getByTestId('issue-relation-submit')).toBeEnabled()
    expect(screen.queryByTestId('issue-link-row-7')).not.toBeInTheDocument()
  })

  // WP-869 — 링크 행이 범주 라벨(「진행 중」)만 보여 사용자 정의 상태(「검토 중」)를 알 수 없었다.
  test('링크 행은 상태 이름을 글자 대신 상태 색 아이콘의 이름으로 알리고, 이름이 없는 옛 응답은 범주 라벨 (WP-869·WP-991)', async () => {
    const blockedBy: IssueLinkSummary[] = [
      { number: 5, title: '결제 모듈 환불 처리', status: 'IN_PROGRESS', statusId: 12, statusName: '검토 중', statusColor: 'PURPLE', type: taskType, dueDate: null },
      { number: 6, title: '옛 응답 선행', status: 'DONE', type: taskType, dueDate: null },
    ]
    const { user } = await openIssue(() => base({ blockedBy, blocked: true }))
    await openRelations(user)
    const row = await screen.findByTestId('issue-link-row-5')
    const status = screen.getByTestId('issue-link-status-5')
    // 한 줄 관계(WP-991) — 상태 이름은 글자로 그리지 않고 아이콘이 이름으로 알린다(툴팁은 IssueLinkRow.test·E2E 가 본다).
    expect(row).not.toHaveTextContent('검토 중')
    expect(row).not.toHaveTextContent('진행 중')
    expect(within(status).getByRole('img', { name: '상태: 검토 중' })).toBeInTheDocument()
    // 아이콘은 사용자 정의 상태 색(PURPLE) — 범주 색이 아니다.
    expect(status.querySelectorAll('svg.text-purple-700')).toHaveLength(1)
    // 같은 프로젝트 이슈는 키를 「#5」 로 줄인다(WP-887).
    expect(within(row).getByText('#5', { exact: true })).toBeInTheDocument()
    expect(within(screen.getByTestId('issue-link-status-6')).getByRole('img', { name: '상태: 완료' })).toBeInTheDocument()
  })

  // #669 — 미완료 선행 이슈의 마감일보다 이른 마감일은 경고만 하고(soft) 저장은 그대로 한다.
  test('선행 이슈 마감일보다 이른 마감일을 고르면 PATCH 는 나가고 인라인 경고가 보이며, 다시 띄워도 유지된다 (#669)', async () => {
    // 다음 달 1일 — 이번 달의 어떤 날짜보다도 늦다(월 경계 안전).
    const next = new Date()
    next.setMonth(next.getMonth() + 1, 1)
    const blockerDue = next.toISOString().slice(0, 10)
    const blocker: IssueLinkSummary = { number: 21, title: '결제 모듈', status: 'IN_PROGRESS', type: taskType, dueDate: blockerDue }
    let due: string | null = null
    const patches: Array<Record<string, unknown>> = []
    const handlers = [
      http.patch(ISSUE, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patches.push(body)
        if (typeof body.dueDate === 'string') due = body.dueDate
        return HttpResponse.json(base({ dueDate: due }))
      }),
    ]
    const summary = () => base({ dueDate: due, blockedBy: [blocker], blocked: true })
    const first = await openIssue(summary, handlers)
    expect(screen.queryByTestId('due-date-warning')).not.toBeInTheDocument()
    await first.user.click(screen.getByTestId('due-date-trigger'))
    const popover = await screen.findByTestId('due-date-popover')
    const day10 = [...popover.querySelectorAll<HTMLButtonElement>('[data-slot="calendar"] button[data-day]')].find((b) => b.textContent === '10')!
    await first.user.click(day10)
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(typeof patches[0].dueDate).toBe('string')
    expect(await screen.findByTestId('due-date-warning')).toHaveTextContent(blockerDue)

    // 다시 띄워도(새로고침) 저장된 값과 경고가 그대로다.
    first.unmount()
    await openIssue(summary, handlers)
    await waitFor(() => expect(screen.getByTestId('due-date-trigger')).toHaveTextContent('10일'))
    expect(screen.getByTestId('due-date-warning')).toBeInTheDocument()
  })

  // #827 — 미완료 선행이 있을 때 「완료」로 바꾸면 확인창. 취소는 그대로, 확인은 PATCH(서버 차단 없음 — soft 경고).
  test('미완료 선행이 있으면 완료 전환에 확인창(완료된 선행은 목록 밖) — 취소는 미변경, 확인은 PATCH, 다른 전환은 바로 PATCH (#827)', async () => {
    // 상태 선택은 프로젝트 상태 id 를 보낸다(WP-808) — 시드 id 3 완료, 4 취소. 응답·재조회는 그 id 의 상태 필드로.
    let statusId = 1
    const patches: Array<{ statusId?: number }> = []
    const blockedBy: IssueLinkSummary[] = [
      { number: 21, title: '결제 모듈 환불 처리 간헐적 실패', status: 'IN_PROGRESS', type: taskType, dueDate: null },
      { number: 22, title: '이미 끝난 선행', status: 'DONE', type: taskType, dueDate: null },
    ]
    const summary = () => base({ ...statusFieldsOf(statusId), blockedBy, blocked: statusId !== 3 })
    const { user } = await openIssue(summary, [
      http.patch(ISSUE, async ({ request }) => {
        const body = (await request.json()) as { statusId?: number }
        patches.push(body)
        if (body.statusId != null) statusId = body.statusId
        return HttpResponse.json(summary())
      }),
    ])
    const select = screen.getByTestId('issue-status-select')
    expect(select).toHaveTextContent('할 일')

    // 1) 완료 → 확인창, 아직 PATCH 없음. 미완료 선행 1건만 목록에.
    await pickOption(user, select, '완료')
    const dialog = await screen.findByTestId('status-done-blocked-dialog')
    expect(dialog).toHaveTextContent('선행 이슈 1건이 아직 완료되지 않았습니다')
    const list = screen.getByTestId('status-done-blocked-list')
    expect(list).toHaveTextContent(`${KEY}-21`)
    expect(list).not.toHaveTextContent(`${KEY}-22`)
    expect(patches).toEqual([])

    // 2) 취소 → 닫힘, 상태 유지, PATCH 없음.
    await user.click(screen.getByTestId('status-done-blocked-cancel'))
    await waitFor(() => expect(screen.queryByTestId('status-done-blocked-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-status-select')).toHaveTextContent('할 일')
    expect(patches).toEqual([])

    // 3) 다시 완료 → 확인 → statusId 3 으로 PATCH, 화면 반영.
    await pickOption(user, screen.getByTestId('issue-status-select'), '완료')
    await user.click(await screen.findByTestId('status-done-blocked-confirm'))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].statusId).toBe(3)
    await waitFor(() => expect(screen.getByTestId('issue-status-select')).toHaveTextContent('완료'))

    // 4) 완료가 아닌 전환(취소)은 확인창 없이 바로 PATCH.
    await pickOption(user, screen.getByTestId('issue-status-select'), '취소')
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1].statusId).toBe(4)
    expect(screen.queryByTestId('status-done-blocked-dialog')).not.toBeInTheDocument()
  })
})
