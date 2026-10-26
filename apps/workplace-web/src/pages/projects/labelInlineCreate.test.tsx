// 이슈 라벨 선택기에서 없는 라벨을 그 자리에서 만들기(WP-394) — 페이지 테스트(WP-980).
// 만들기 행 → POST(GRAY) → 체크된 채 추가 → 닫으면 PUT 한 번, 40자 제한(WP-850), 빠른 두 번 클릭 1회 요청(WP-458),
// Enter 로 만들기·일부 겹침 중 Enter 무시, 생성 실패 안내는 요청·문구로 브라우저 없이 판정되므로
// e2e/pages/projects/label-inline-create.spec.ts 에서 옮겼다. 한글 조합 중 Enter(IME, @input)는 E2E 에 남는다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { LabelResponse } from '@/types/label'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { createLabel, toLabelSummary } from '../../../e2e/factories/label.factory'
import { createMember } from '../../../e2e/factories/project.factory'

const KEY = 'WP'
const LABELS = `/api/v1/projects/${KEY}/labels`
const ISSUE_LABELS = `/api/v1/projects/${KEY}/issues/1/labels`

/**
 * 이슈 상세 + 라벨 목록 목. 보는 사람(id 1)은 일반 MEMBER — 멤버도 라벨을 만들 수 있어야 한다.
 * createStatus 가 있으면 POST /labels 를 그 상태로 실패시킨다. 만든 라벨은 목록에 쌓여 재조회에도 보인다.
 */
async function openPicker({ createStatus }: { createStatus?: number } = {}) {
  const bug = createLabel({ id: 1, name: 'bug', colorToken: 'RED' })
  const labels: LabelResponse[] = [bug, createLabel({ id: 2, name: 'severity:minor', colorToken: 'YELLOW' })]
  const posts: unknown[] = []
  const puts: unknown[] = []
  const detail = createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '로그인 오류', labels: [toLabelSummary(bug)] }) })
  const view = renderPage(`/projects/${KEY}/issues/1`, {
    handlers: issueDetailHandlers({
      key: KEY,
      detail,
      members: [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'MEMBER' })],
      extra: [
        http.get(LABELS, () => HttpResponse.json(labels)),
        http.post(LABELS, async ({ request }) => {
          const body = (await request.json()) as { name: string; colorToken: 'GRAY' }
          posts.push(body)
          if (createStatus) return HttpResponse.json({ message: '프로젝트 멤버가 아닙니다' }, { status: createStatus })
          const created = createLabel({ id: 99, name: body.name, colorToken: body.colorToken, viewerCanManage: true })
          labels.push(created)
          return HttpResponse.json(created)
        }),
        http.put(ISSUE_LABELS, async ({ request }) => {
          puts.push(await request.json())
          return HttpResponse.json([])
        }),
      ],
    }),
  })
  // 접혀 있는 「분류」 그룹을 펼치고 라벨 선택기를 연다 — 목록이 뜬 뒤에만 만들기를 판단한다.
  const group = await screen.findByTestId('property-group-classification', {}, { timeout: PAGE_LOAD_TIMEOUT })
  await view.user.click(within(group).getByRole('button', { name: /분류/ }))
  await view.user.click(screen.getByTestId('label-picker-trigger'))
  const picker = await screen.findByTestId('label-picker')
  await within(picker).findByTestId('label-option-1')
  const search = within(picker).getByLabelText('라벨 검색') as HTMLInputElement
  return { ...view, picker, search, posts, puts }
}

describe('이슈 라벨 즉석 만들기', () => {
  test('없는 이름 → 만들기(공백 뺀 이름) → POST(GRAY) → 체크된 채 추가 → 닫으면 PUT 한 번', async () => {
    const { picker, search, posts, puts, user } = await openPicker()
    fireEvent.change(search, { target: { value: '  severity:major ' } })
    expect(within(picker).queryByText('결과 없음')).not.toBeInTheDocument()
    const create = within(picker).getByTestId('label-create-option')
    expect(create).toHaveTextContent(/^「severity:major」 라벨 만들기$/)
    await user.click(create)

    await waitFor(() => expect(posts).toEqual([{ name: 'severity:major', colorToken: 'GRAY' }]))
    await waitFor(() => expect(within(picker).getByLabelText('severity:major')).toBeChecked())
    expect(search).toHaveValue('')
    expect(within(picker).queryByTestId('label-create-option')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ labelIds: [1, 99] }]))
  })

  // WP-850: 검색어가 곧 새 라벨 이름이라 설정 화면 폼처럼 40자에서 입력이 멈춘다.
  test('라벨 이름은 40자에서 입력이 멈추고, 그 이름 그대로 만든다', async () => {
    const { search, posts, user } = await openPicker()
    await user.click(search)
    await user.paste('가'.repeat(41))
    expect(search).toHaveValue('가'.repeat(40))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(posts).toEqual([{ name: '가'.repeat(40), colorToken: 'GRAY' }]))
  })

  // WP-458: 두 번 클릭은 다시 그리기 전에 들어와 isPending 으로는 못 막는다 — 같은 틱 두 클릭에도 요청 한 번, 만든 라벨은 부착.
  test('만들기를 같은 틱에 두 번 눌러도 POST 는 한 번이고 만든 라벨이 이슈에 붙는다', async () => {
    const { picker, search, posts, puts, user } = await openPicker()
    fireEvent.change(search, { target: { value: 'infra' } })
    const create = within(picker).getByTestId('label-create-option')
    act(() => {
      create.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      create.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await waitFor(() => expect(within(picker).getByLabelText('infra')).toBeChecked())
    expect(posts).toHaveLength(1)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ labelIds: [1, 99] }]))
  })

  // 겹치는 라벨이 하나도 없을 때만 Enter 로 만든다 — 「sev」로 severity:minor 를 찾는 중이면 만들기 행 클릭만.
  test('Enter 로 만들고, 일부 겹치는 라벨이 보이는 중의 Enter 는 만들지 않는다', async () => {
    const { picker, search, posts, user } = await openPicker()
    fireEvent.change(search, { target: { value: '긴급' } })
    await user.click(search)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(posts).toEqual([{ name: '긴급', colorToken: 'GRAY' }]))
    await waitFor(() => expect(within(picker).getByLabelText('긴급')).toBeChecked())

    fireEvent.change(search, { target: { value: 'sev' } })
    expect(within(picker).getByTestId('label-option-2')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(within(picker).getByTestId('label-create-option')).toHaveTextContent(/^「sev」 라벨 만들기$/)
    expect(search).toHaveValue('sev')
    expect(posts).toHaveLength(1)
  })

  test('만들기가 실패하면 오류를 알리고 검색어를 남기며, 닫아도 라벨을 바꾸지 않는다', async () => {
    const { picker, search, puts, user } = await openPicker({ createStatus: 403 })
    fireEvent.change(search, { target: { value: 'ai-fix' } })
    await user.click(within(picker).getByTestId('label-create-option'))
    expect(await screen.findByText('프로젝트 멤버가 아닙니다')).toBeInTheDocument()
    expect(search).toHaveValue('ai-fix')
    expect(within(picker).getByTestId('label-create-option')).toBeEnabled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('label-picker')).not.toBeInTheDocument())
    expect(puts).toHaveLength(0)
  })
})
