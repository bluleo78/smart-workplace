// 이슈 유형 — 새 이슈 다이얼로그 유형 드롭다운·검증, 설정의 유형 편집·삭제 이름 — 페이지 테스트(WP-980).
// 한국어 라벨(#126·#641), 부모 번호·본문 길이 zod 검증이 UI 오류로 보이고 요청이 안 나가는지(#159·WP-906·WP-929),
// 로딩 중 Select controlled 경고(#364), 유형 편집 PATCH·409 인라인 오류(#160·WP-660), 삭제 버튼 접근 이름(#779)은
// 브라우저 없이 판정되므로 e2e/pages/projects/issue-types.spec.ts 에서 옮겼다.
// 그 spec 에는 설정에서 유형을 만들고 이슈 상세에서 바꾸는 두 화면 흐름(@flow)이 남는다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test, vi } from 'vitest'

import { issueListHandlers, projectSettingsHandlers, recordRequests } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'

import { createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeIssueType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'WP'

/** 프로젝트 화면을 열고 「+ 새 태스크」 다이얼로그를 띄운다. */
async function openCreateDialog(extra: RequestHandler[] = []) {
  const requests = recordRequests()
  const view = renderPage(`/projects/${KEY}`, {
    handlers: [
      ...(extra ?? []),
      ...issueListHandlers({ issues: () => createIssueSearchResponse([]), extra: { types: systemTypes() } }),
    ],
  })
  await view.user.click(await screen.findByRole('button', { name: '+ 새 태스크' }, { timeout: PAGE_LOAD_TIMEOUT }))
  const dialog = await screen.findByRole('dialog')
  return { ...view, dialog, requests }
}

/** 유형 셀렉트를 열어 그 이름의 항목을 고른다. */
async function pickType(user: ReturnType<typeof renderPage>['user'], name: string) {
  await user.click(screen.getByTestId('create-type-select'))
  await user.click((await screen.findAllByRole('option', { name }))[0])
}

const createPosts = (requests: ReturnType<typeof recordRequests>) => requests.count('POST', `/api/v1/projects/${KEY}/issues`)

describe('새 이슈 다이얼로그 — 유형', () => {
  test('유형 드롭다운이 한국어 라벨로 보이고 영문 enum 원문은 없다 (#126)', async () => {
    const { user } = await openCreateDialog()
    await user.click(screen.getByTestId('create-type-select'))
    const listbox = await screen.findByRole('listbox')
    for (const name of ['태스크', '버그', '스토리', '기타', '하위 태스크']) {
      expect(within(listbox).getAllByRole('option', { name }).length).toBeGreaterThan(0)
    }
    expect(within(listbox).queryByRole('option', { name: 'TASK' })).not.toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'BUG' })).not.toBeInTheDocument()
  })

  test('유형을 에픽·버그로 바꿔도 다이얼로그 제목은 「새 이슈」로 고정된다 (#641)', async () => {
    const { user, dialog } = await openCreateDialog()
    expect(within(dialog).getByRole('heading', { name: '새 이슈' })).toBeInTheDocument()
    await pickType(user, '에픽')
    expect(within(dialog).getByRole('heading', { name: '새 이슈' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('heading', { name: '새 태스크' })).not.toBeInTheDocument()
    await pickType(user, '버그')
    expect(within(dialog).getByRole('heading', { name: '새 이슈' })).toBeInTheDocument()
  })

  test('하위 태스크인데 부모 번호를 비우고 생성하면 한국어 오류가 보이고 요청은 없다 (#159)', async () => {
    const { user, requests } = await openCreateDialog()
    fireEvent.change(document.getElementById('issue-title')!, { target: { value: '테스트 하위태스크' } })
    await pickType(user, '하위 태스크')
    expect(await screen.findByTestId('create-parent-number')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '생성' }))
    const error = await screen.findByText(/부모 이슈 번호/, { selector: 'p.text-destructive' })
    expect(error).not.toHaveTextContent('Invalid input')
    expect(error).not.toHaveTextContent('NaN')
    expect(createPosts(requests)).toBe(0)
  })

  test('부모 번호 0·소수·32비트 초과는 한국어 안내가 보이고 요청은 없다 (WP-906)', async () => {
    const { user, requests } = await openCreateDialog()
    fireEvent.change(document.getElementById('issue-title')!, { target: { value: '하위 번호 검증' } })
    await pickType(user, '하위 태스크')
    const parent = await screen.findByTestId('create-parent-number')
    for (const [value, message] of [
      ['0', '부모 이슈 번호는 1 이상의 정수여야 합니다'],
      ['1.5', '부모 이슈 번호는 1 이상의 정수여야 합니다'],
      ['2147483648', '부모 이슈 번호는 2147483647 이하여야 합니다'],
    ]) {
      fireEvent.change(parent, { target: { value } })
      await user.click(screen.getByRole('button', { name: '생성' }))
      await waitFor(() => expect(document.getElementById('create-parent-number-error')).toHaveTextContent(message))
    }
    expect(createPosts(requests)).toBe(0)
  })

  // WP-929: 본문 상한 초과로 「생성」하면 아무 반응 없이 멈추던 것 — 본문 아래 오류, POST 없음.
  test('본문이 50000자를 넘으면 오류 문구·aria-invalid 가 보이고 생성 요청은 나가지 않는다 (WP-929)', async () => {
    const { user, requests } = await openCreateDialog()
    fireEvent.change(document.getElementById('issue-title')!, { target: { value: '긴 본문' } })
    fireEvent.change(document.getElementById('issue-body')!, { target: { value: '가'.repeat(50001) } })
    await user.click(screen.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(document.getElementById('issue-body-error')).toHaveTextContent('본문은 50000자 이하여야 합니다'))
    expect(document.getElementById('issue-body')).toHaveAttribute('aria-invalid', 'true')
    expect(createPosts(requests)).toBe(0)
  })

  // #364: types 가 아직 pending 일 때 다이얼로그를 열면 Select 가 uncontrolled 로 마운트됐다가 controlled 로 바뀌며 경고를 냈다.
  test('types 로딩 중에 다이얼로그를 열어도 Select controlled/uncontrolled 경고가 없다 (#364)', async () => {
    // React 는 console.error, Radix useControllableState 는 console.warn 으로 알린다 — 둘 다 본다.
    const errors = vi.spyOn(console, 'error')
    const warns = vi.spyOn(console, 'warn')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const view = renderPage(`/projects/${KEY}`, {
      handlers: [
        http.get(`/api/v1/projects/${KEY}/types`, async () => {
          await gate
          await delay(0)
          return HttpResponse.json(systemTypes())
        }),
        ...issueListHandlers({ issues: () => createIssueSearchResponse([]) }),
      ],
    })
    await view.user.click(await screen.findByRole('button', { name: '+ 새 태스크' }, { timeout: PAGE_LOAD_TIMEOUT }))
    expect(await screen.findByTestId('create-type-select')).toBeInTheDocument()
    act(() => release())
    await waitFor(() => expect(screen.getByTestId('create-type-select')).toHaveTextContent('태스크'))
    const warnings = [...errors.mock.calls, ...warns.mock.calls]
      .map((c) => c.map(String).join(' '))
      .filter((m) => /is changing from (controlled|uncontrolled)/.test(m))
    errors.mockRestore()
    warns.mockRestore()
    expect(warnings).toEqual([])
  })
})

describe('설정 — 이슈 유형 관리', () => {
  const OWNER = [createMember({ userId: 1, username: 'me', name: 'Me', role: 'OWNER' })]

  test('유형 편집 — 이름·색상·아이콘을 함께 PATCH, 이름이 겹치면(409) 창을 연 채 인라인 오류 (#160·WP-660)', async () => {
    const custom = makeIssueType({ id: 99, name: '원래유형', colorToken: 'GREEN', icon: 'Circle', isSystem: false })
    const updates: unknown[] = []
    const { user } = renderPage(`/projects/${KEY}/settings`, {
      handlers: [
        http.all(`/api/v1/projects/${KEY}/types/99`, async ({ request }) => {
          const body = (await request.json()) as { name: string }
          updates.push(body)
          // 「다른유형」은 이미 있는 이름 — 서버는 409 와 문구로 거절한다.
          if (body.name === '다른유형') return HttpResponse.json({ status: 409, message: '이미 존재하는 유형 이름입니다: 다른유형' }, { status: 409 })
          Object.assign(custom, body)
          return HttpResponse.json(custom)
        }),
        ...projectSettingsHandlers(createProject({ key: KEY }), OWNER, { types: () => [custom] }),
      ],
    })
    const row = await screen.findByTestId('issue-type-row-99', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await user.click(within(row).getByRole('button', { name: '원래유형 편집' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('이슈 유형 편집')
    const input = within(dialog).getByLabelText('이름')
    expect(input).toHaveValue('원래유형')
    expect(within(dialog).getByTestId('meta-edit-color-GREEN')).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByTestId('meta-edit-icon-Circle')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(input, { target: { value: '다른유형' } })
    await user.click(within(dialog).getByTestId('meta-edit-color-PURPLE'))
    await user.click(within(dialog).getByTestId('meta-edit-icon-Star'))
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('이미 존재하는 유형 이름입니다: 다른유형')
    expect(dialog).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '새유형이름' } })
    await user.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(updates.at(-1)).toEqual({ name: '새유형이름', colorToken: 'PURPLE', icon: 'Star' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('issue-type-row-99')).toHaveTextContent('새유형이름'))
  })

  test('삭제 버튼 접근 이름이 유형별로 구분된다 (#779)', async () => {
    const a = makeIssueType({ id: 91, name: '디자인', colorToken: 'PURPLE', icon: 'Star', isSystem: false })
    const b = makeIssueType({ id: 92, name: '리서치', colorToken: 'GREEN', icon: 'Circle', isSystem: false })
    renderPage(`/projects/${KEY}/settings`, { handlers: projectSettingsHandlers(createProject({ key: KEY }), OWNER, { types: [a, b] }) })
    const rowA = await screen.findByTestId('issue-type-row-91', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(within(rowA).getByRole('button', { name: '디자인 삭제' })).toBeInTheDocument()
    expect(within(screen.getByTestId('issue-type-row-92')).getByRole('button', { name: '리서치 삭제' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '디자인 삭제' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '리서치 삭제' })).toHaveLength(1)
  })
})
