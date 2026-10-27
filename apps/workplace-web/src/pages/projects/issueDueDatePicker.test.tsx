// 이슈 상세 마감일 DatePicker(#284·WP-649·WP-725) — 페이지 테스트(WP-980).
// 날짜 선택·지우기 → PATCH payload → 트리거 문구, 해석 불가 날짜·마감 지남 표시는 브라우저 없이 판정되므로
// e2e/pages/projects/issue-due-date-picker.spec.ts 에서 옮겼다(그 spec 은 모두 옮겨 지웠다).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { openIssueDetail } from '@/test/kits/projects/openIssueDetail'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const PATH = '/api/v1/projects/WP/issues/1'

/** 마감일을 서버 상태로 들고 PATCH 를 반영하는 상세를 연다. 보낸 PATCH 본문은 patches 에 쌓는다. */
async function open(initialDueDate: string | null) {
  let due = initialDueDate
  const patches: Record<string, unknown>[] = []
  const view = await openIssueDetail({
    detail: () => createIssueDetail({ summary: createIssue({ id: 1, number: 1, dueDate: due }) }),
    handlers: [
      http.patch(PATH, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patches.push(body)
        if (typeof body.dueDate === 'string') due = body.dueDate
        if (body.clearDueDate === true) due = null
        return HttpResponse.json(createIssue({ id: 1, number: 1, dueDate: due }))
      }),
    ],
  })
  return { ...view, patches }
}

describe('이슈 상세 마감일 DatePicker (#284)', () => {
  // native date input 회귀 방지 — shadcn 트리거만 있고 미설정이면 「없음」.
  test('native input 이 없고 DatePicker 트리거가 「없음」으로 보인다', async () => {
    const { container } = await open(null)
    expect(screen.getByTestId('due-date-trigger')).toHaveTextContent('없음')
    expect(container.querySelector('input[type="date"]')).toBeNull()
  })

  test('날짜 선택 → PATCH {dueDate} + 팝오버 닫힘 + 트리거 반영', async () => {
    const { user, patches } = await open(null)
    await user.click(screen.getByTestId('due-date-trigger'))
    const popover = await screen.findByTestId('due-date-popover')
    const day15 = [...popover.querySelectorAll<HTMLButtonElement>('[data-slot="calendar"] button[data-day]')].find(
      (b) => b.textContent?.trim() === '15',
    )!
    await user.click(day15)
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].dueDate).toMatch(/^\d{4}-\d{2}-15$/)
    expect(patches[0].clearDueDate).toBeFalsy()
    await waitFor(() => expect(screen.queryByTestId('due-date-popover')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('due-date-trigger')).toHaveTextContent('15일'))
  })

  // WP-725: API 로 들어간 해석 불가 값에도 화면 전체가 깨지지 않고, 지우기로 고칠 수 있다.
  test('해석할 수 없는 마감일이 와도 화면이 열리고 지울 수 있다', async () => {
    const { user, patches } = await open('+10000-01-01')
    expect(screen.getByTestId('due-date-trigger')).toHaveTextContent('잘못된 날짜')
    await user.click(screen.getByTestId('due-date-clear'))
    await waitFor(() => expect(patches).toEqual([{ clearDueDate: true }]))
    await waitFor(() => expect(screen.getByTestId('due-date-trigger')).toHaveTextContent('없음'))
  })

  test('마감일 설정 상태에서 지우기 → PATCH {clearDueDate: true} + 「없음」 복원 + 지우기 버튼 사라짐', async () => {
    const { user, patches } = await open('2026-06-15')
    expect(screen.getByTestId('due-date-trigger')).toHaveTextContent('2026년 6월 15일')
    await user.click(screen.getByTestId('due-date-clear'))
    await waitFor(() => expect(patches.at(-1)?.clearDueDate).toBe(true))
    await waitFor(() => expect(screen.getByTestId('due-date-trigger')).toHaveTextContent('없음'))
    expect(screen.queryByTestId('due-date-clear')).not.toBeInTheDocument()
  })

  test('마감 지난 미완료 이슈는 빨간 날짜 + 「마감 지남」, 접근 이름에도 붙는다 (WP-649)', async () => {
    await open('2020-01-15')
    const trigger = screen.getByTestId('due-date-trigger')
    expect(trigger).toHaveTextContent('2020년 1월 15일')
    expect(within(trigger).getByTestId('due-date-overdue')).toHaveTextContent('· 마감 지남')
    expect(trigger).toHaveAccessibleName('마감일 선택: 2020년 1월 15일, 마감 지남')
    expect(within(trigger).getByText('2020년 1월 15일')).toHaveClass('text-destructive')
  })

  test('먼 미래 마감은 강조하지 않고, 접근 이름에 보이는 날짜가 붙는다 (WP-649·WP-853)', async () => {
    await open('2099-01-15')
    const trigger = screen.getByTestId('due-date-trigger')
    expect(trigger).toHaveTextContent('2099년 1월 15일')
    expect(within(trigger).queryByTestId('due-date-overdue')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '마감일 선택: 2099년 1월 15일' })).toBeInTheDocument()
  })
})
