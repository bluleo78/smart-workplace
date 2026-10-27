// 하위 태스크(SUBTASK) 도메인 — 페이지 테스트(WP-980).
// 인라인 추가 POST payload·목록 갱신, 행 hover 클래스, 부모 변경 PATCH, TASK → SUBTASK 유형 변경의 부모 번호 단계,
// 행 AI 배지와 상태배지 택일(WP-374), 응답 전 입력한 다음 제목 보존(WP-467)은 브라우저 없이 판정되므로
// e2e/pages/projects/subtasks.spec.ts 에서 옮겼다. 그 spec 에는 긴 부모 제목·보고자 말줄임(WP-805, @layout)이 남는다.
// 모바일 폭의 AI 배지는 subtasksMobile.test.tsx 가 본다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { openIssueDetail } from '@/test/kits/projects/openIssueDetail'
import { expectSubtaskBadges, subtaskBadgeChildren, TASK_SUMMARY } from '@/test/kits/projects/subtasks'

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeSubtaskType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember } from '../../../e2e/factories/project.factory'

const KEY = 'WP'
const ISSUES = `/api/v1/projects/${KEY}/issues`
const OWNER = [createMember({ userId: 1, username: 'me', name: 'Me', role: 'OWNER' })]
const parentRef = { number: 1, title: '부모 TASK', type: TASK_SUMMARY }
const asSubtask = (o: Parameters<typeof createIssue>[0]) => ({ ...createIssue(o), type: makeSubtaskType(), parent: parentRef })

/** 부모 TASK(#1) 상세 — 하위 목록(parent=1)은 children() 이 준다. POST 는 onCreate 가 처리한다. */
function openParent(children: () => ReturnType<typeof createIssue>[], onCreate?: (title: string) => Promise<unknown> | unknown) {
  return openIssueDetail({
    members: OWNER,
    detail: () =>
      createIssueDetail({ summary: { ...createIssue({ id: 1, number: 1, title: '부모 TASK' }), type: TASK_SUMMARY, childCount: children().length } }),
    handlers: [
      http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
      http.get(ISSUES, ({ request }) =>
        HttpResponse.json(createIssueSearchResponse(new URL(request.url).searchParams.get('parent') === '1' ? children() : [], null)),
      ),
      http.post(ISSUES, async ({ request }) => {
        const { title } = (await request.json()) as { title: string }
        return HttpResponse.json((await onCreate?.(title)) as never)
      }),
    ],
  })
}

describe('SUBTASK', () => {
  test('비SUBTASK 진입 → 자식 섹션·「상위 에픽」 슬롯 → 인라인 추가 POST payload + 목록 갱신 + StatusBadge', async () => {
    const requests = recordRequests()
    let created: ReturnType<typeof asSubtask>[] = []
    const { user } = await openParent(
      () => created,
      (title) => {
        const child = asSubtask({ id: 100 + created.length, number: 100 + created.length, title })
        created = [...created, child]
        return child
      },
    )
    expect(await screen.findByTestId('issue-children-section')).toBeInTheDocument()
    expect(screen.getAllByTestId('issue-parent-slot')).toHaveLength(1)
    expect(screen.getByTestId('issue-parent-slot')).toHaveTextContent('상위 에픽')
    // 섹션 제목이 한국어(#133), 빈 상태는 안내 문구 없이 추가 입력만.
    expect(screen.getByRole('heading', { name: '하위 태스크', level: 3 })).toBeInTheDocument()
    expect(screen.queryByText('하위 태스크가 없습니다')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('child-add-input'), { target: { value: '첫 자식' } })
    await user.click(within(screen.getByTestId('child-add-form')).getByRole('button', { name: '추가' }))
    await waitFor(() => expect(requests.bodies('POST', ISSUES)).toEqual([{ title: '첫 자식', typeId: 5, parentNumber: 1 }]))
    const row = await screen.findByTestId('child-row-100')
    expect(row).toHaveTextContent('첫 자식')
    // 상태 배지는 시맨틱 StatusBadge(type=pending) — raw Badge variant 회귀(#668).
    expect(row.querySelector('[data-status]')).toHaveAttribute('data-status', 'pending')
  })

  test('하위 태스크 행 컨테이너에 hover:bg-accent/50 클래스가 붙는다 (#305)', async () => {
    await openParent(() => [asSubtask({ id: 10, number: 10, title: '자식 태스크' })])
    expect(await screen.findByTestId('child-row-10')).toHaveClass('hover:bg-accent/50')
  })

  // WP-467 — 응답을 기다리는 동안 친 다음 제목을 첫 생성 응답이 지우면 안 된다.
  test('첫 생성 응답 전에 입력한 다음 제목이 그대로 남아 이어서 추가된다', async () => {
    const requests = recordRequests()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let n = 0
    const { user } = await openParent(
      () => [],
      async (title) => {
        const num = 100 + n++
        if (num === 100) await gate
        return { ...createIssue({ id: num, number: num, title }), type: makeSubtaskType() }
      },
    )
    const input = await screen.findByTestId('child-add-input')
    fireEvent.change(input, { target: { value: 'Alpha' } })
    await user.type(input, '{Enter}')
    await waitFor(() => expect(requests.count('POST', ISSUES)).toBe(1))
    // 첫 응답 전에 다음 제목을 친다.
    fireEvent.change(input, { target: { value: 'Bravo' } })
    act(() => release())
    expect(await screen.findByText('하위 태스크를 추가했습니다')).toBeInTheDocument()
    expect(input).toHaveValue('Bravo')
    await user.type(input, '{Enter}')
    await waitFor(() => expect(requests.count('POST', ISSUES)).toBe(2))
    await waitFor(() => expect(requests.bodies('POST', ISSUES).map((b) => (b as { title: string }).title)).toEqual(['Alpha', 'Bravo']))
    await waitFor(() => expect(input).toHaveValue(''))
  })

  test('SUBTASK 진입 → 부모 슬롯 「변경」 → 비우면 저장 불가(WP-745), 15 저장 → PATCH payload + 슬롯 갱신', async () => {
    const requests = recordRequests()
    let parent = { number: 12, title: '부모 12', type: TASK_SUMMARY }
    const detail = () => createIssueDetail({ body: '', summary: createIssue({ id: 5, number: 5, title: '자식 SUBTASK', type: makeSubtaskType(), parent }) })
    const { user } = await openIssueDetail({
      number: 5,
      members: OWNER,
      detail,
      handlers: [
        http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
        http.patch(`${ISSUES}/5/parent`, async ({ request }) => {
          const { parentNumber } = (await request.json()) as { parentNumber: number }
          parent = { number: parentNumber, title: `부모 ${parentNumber}`, type: TASK_SUMMARY }
          return HttpResponse.json(detail())
        }),
      ],
    })
    expect(screen.getByTestId('parent-badge-12')).toBeInTheDocument()
    expect(screen.getByTestId('issue-parent-edit')).toHaveTextContent(/^변경$/)
    await user.click(screen.getByTestId('issue-parent-edit'))
    expect(await screen.findByTestId('issue-parent-picker')).toBeInTheDocument()
    const input = screen.getByTestId('parent-number-input')
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('parent-save')).toBeDisabled()
    fireEvent.change(input, { target: { value: '15' } })
    await user.click(screen.getByTestId('parent-save'))
    await waitFor(() => expect(requests.bodies('PATCH', `${ISSUES}/5/parent`)).toEqual([{ parentNumber: 15 }]))
    await waitFor(() => expect(screen.queryByTestId('issue-parent-picker')).not.toBeInTheDocument())
    expect(await screen.findByTestId('parent-badge-15')).toBeInTheDocument()
  })

  // WP-745: 유형을 SUBTASK 로 바꾸면 바로 저장하지 않고 부모 번호를 받아 유형·부모를 한 요청으로 보낸다.
  test('TASK → SUBTASK 유형 변경은 부모 번호를 받아 PATCH /type 에 함께 보낸다(PATCH /parent 없음)', async () => {
    const requests = recordRequests()
    let converted = false
    const detail = () =>
      createIssueDetail({
        body: '',
        summary: {
          ...createIssue({ id: 7, number: 7, title: '바꿀 TASK' }),
          type: converted ? makeSubtaskType() : makeTaskType(),
          parent: converted ? { number: 3, title: '부모 3', type: makeTaskType() } : null,
        },
      })
    const { user } = await openIssueDetail({
      number: 7,
      members: OWNER,
      detail,
      handlers: [
        http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
        http.patch(`${ISSUES}/7/type`, () => {
          converted = true
          return HttpResponse.json(detail())
        }),
      ],
    })
    await user.click(screen.getByTestId('issue-type-trigger'))
    await user.click(await screen.findByTestId('issue-type-option-5'))
    expect(await screen.findByTestId('issue-type-subtask-parent')).toBeInTheDocument()
    expect(screen.getByTestId('issue-type-parent-save')).toBeDisabled()
    expect(requests.count('PATCH', `${ISSUES}/7/type`)).toBe(0)
    fireEvent.change(screen.getByTestId('issue-type-parent-input'), { target: { value: '3' } })
    await user.click(screen.getByTestId('issue-type-parent-save'))
    await waitFor(() => expect(requests.bodies('PATCH', `${ISSUES}/7/type`)).toEqual([{ typeId: 5, parentNumber: 3 }]))
    expect(requests.count('PATCH', `${ISSUES}/7/parent`)).toBe(0)
    await waitFor(() => expect(screen.queryByTestId('issue-type-picker')).not.toBeInTheDocument())
    expect(await screen.findByTestId('parent-badge-3')).toBeInTheDocument()
  })

  // WP-374 — 행당 배지는 하나: 열린 행에 AI 배지가 있으면 그것, 그 외(끝난 행·AI 관여 없는 열린 행)는 상태배지.
  test('하위 태스크 행 — AI 관여 열린 행은 AI 배지, 그 외는 상태배지 (데스크톱)', async () => {
    await openParent(subtaskBadgeChildren)
    await expectSubtaskBadges()
  })
})
