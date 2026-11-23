// 워크플로우 시작 창과 담당 창의 「지정하고 바로 시작」(WP-1989).
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { AssigneePickerPopover } from './AssigneePickerPopover'
import { StartWorkflowDialog } from './StartWorkflowDialog'

const API = '/api/v1'
const list = [
  { id: 5, name: 'AI 개발 흐름', enabled: true, activeVersionNo: 7, draftChanged: false },
  { id: 6, name: '버그 빠른 처리', enabled: true, activeVersionNo: 2, draftChanged: false },
]
const noRun = { runId: null, status: null, revision: 0, workflowId: null, versionNo: null, currentNode: null, outcomes: [], path: [], remainingNodeKeys: [], context: {} }
const started = { ...noRun, runId: 1, status: 'RUNNING', currentNode: { key: 'triage', name: '분류', type: 'task', roleKey: null, assignees: [{ id: 2, username: 'a', name: '팀장AI', kind: 'AGENT' }], enteredAt: new Date().toISOString(), nodeRunStatus: 'ACTIVE', instructions: null } }

describe('워크플로우 시작 창', () => {
  test('startDialog_previewsStartNode_andBlocksNoMatch', async () => {
    const posts: Record<string, unknown>[] = []
    const onOpenChange = vi.fn()
    renderScreen(
      <StartWorkflowDialog open onOpenChange={onOpenChange} issueId={7} projectKey="WP" projectId={9} issueTitle="제목" assignees={[{ id: 2, name: '팀장AI', kind: 'AGENT' }]} />,
      {
        handlers: [
          http.get(`${API}/projects/9/workflows`, () => HttpResponse.json(list)),
          http.post(`${API}/issues/7/workflow/start`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>
            posts.push(body)
            if (body.workflowId === 6) {
              return HttpResponse.json({ errors: { code: 'WORKFLOW_NO_START_MATCH' }, message: '담당자의 역할에 맞는 시작 조건이 없습니다.' }, { status: 422 })
            }
            return HttpResponse.json(started)
          }),
        ],
      },
    )
    const user = userEvent.setup()
    expect(await screen.findByText('분류 에서 시작해요')).toBeInTheDocument()
    expect(screen.getByText(/팀장AI 에게 바로 알림이 가요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '시작' })).toBeEnabled()
    await user.click(screen.getByRole('radio', { name: /버그 빠른 처리/ }))
    expect(await screen.findByText('담당자의 역할에 맞는 시작 조건이 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '시작' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /AI 개발 흐름/ }))
    await screen.findByText('분류 에서 시작해요')
    await user.click(screen.getByRole('button', { name: '시작' }))
    await waitFor(() => expect(posts.filter((p) => !p.dryRun)).toEqual([{ workflowId: 5 }]))
    // 시작에 성공하면 창이 닫힌다.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})

describe('시작 창 미리보기 새로 읽기', () => {
  test('startDialog_reopen_refetchesPreview_andBlocksStartUntilFresh', async () => {
    let previews = 0
    let node = 'triage'
    let hold = null as (() => void) | null
    // renderScreen 의 rerender 는 공급자를 잃으므로, 여닫기를 호스트 안 상태로 두고 setter 를 밖으로 꺼낸다.
    let setOpen: (o: boolean) => void = () => {}
    function Host() {
      const [open, set] = useState(true)
      setOpen = set
      return <StartWorkflowDialog open={open} onOpenChange={set} issueId={7} projectKey="WP" projectId={9} issueTitle="제목" assignees={[]} />
    }
    renderScreen(<Host />, {
      handlers: [
        http.get(`${API}/projects/9/workflows`, () => HttpResponse.json([list[0]])),
        http.post(`${API}/issues/7/workflow/start`, async () => {
          previews++
          if (previews > 1) await new Promise<void>((res) => { hold = res })
          return HttpResponse.json({ ...started, currentNode: { ...started.currentNode, key: node, name: node } })
        }),
      ],
    })
    expect(await screen.findByText('triage 에서 시작해요')).toBeInTheDocument()
    // 닫았다가 응답이 바뀐 상태로 다시 연다 — 옛 미리보기로 시작이 눌리면 안 된다.
    await userEvent.setup().click(screen.getByRole('button', { name: '취소' }))
    node = 'review'
    act(() => setOpen(true))
    await waitFor(() => expect(previews).toBe(2))
    expect(screen.getByRole('button', { name: '시작' })).toBeDisabled()
    hold!()
    expect(await screen.findByText('review 에서 시작해요')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '시작' })).toBeEnabled())
  })
})

describe('담당 창 지정하고 바로 시작', () => {
  const members = [
    { userId: 1, username: 'me', name: '나', kind: 'HUMAN', isActive: true, role: 'MEMBER' },
    { userId: 3, username: 'dev', name: '개발AI', kind: 'AGENT', isActive: true, role: 'MEMBER' },
  ]
  function setup(wfList: object[], puts: Record<string, unknown>[], run: object = noRun, onRunFetched?: () => void, failStart: boolean | { status: number; code?: string } = false, closed = false) {
    renderScreen(
      <AssigneePickerPopover projectKey="WP" issueNumber={1} current={[{ id: 1, username: 'me', name: '나', kind: 'HUMAN' } as never]} issueId={7} projectId={9} closed={closed} />,
      {
        handlers: [
          http.get(`${API}/projects/WP/members`, () => HttpResponse.json(members)),
          http.get(`${API}/projects/9/workflows`, () => HttpResponse.json(wfList)),
          http.get(`${API}/issues/7/workflow`, () => {
            onRunFetched?.()
            return HttpResponse.json(run)
          }),
          http.put(`${API}/projects/WP/issues/1/assignees`, async ({ request }) => {
            const body = (await request.json()) as Record<string, unknown>
            puts.push(body)
            if (failStart === true && body.startWorkflowId != null) {
              return HttpResponse.json({ errors: { code: 'WORKFLOW_NO_START_MATCH' }, message: '담당자의 역할에 맞는 시작 조건이 없습니다.' }, { status: 422 })
            }
            // 담당 변경 자체 오류(WORKFLOW_ 아닌 코드) 또는 409 등 다른 WORKFLOW_ 거절 — 시작이 실린 PUT 만 거절한다.
            if (typeof failStart === 'object' && (failStart.code?.startsWith('WORKFLOW_') !== true || body.startWorkflowId != null)) {
              return HttpResponse.json({ errors: failStart.code ? { code: failStart.code } : {}, message: '거절됨' }, { status: failStart.status })
            }
            return HttpResponse.json([])
          }),
        ],
      },
    )
  }

  test('assignDialog_enabledProject_defaultsToAssignAndStart', async () => {
    const puts: Record<string, unknown>[] = []
    setup(list, puts)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    const box = await screen.findByRole('checkbox', { name: '지정하고 바로 시작' })
    expect(box).toBeChecked()
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3], startWorkflowId: 5 }]))
  })

  test('assignDialog_startRejected_retriesAssigneesOnly_andWarns', async () => {
    const puts: Record<string, unknown>[] = []
    setup(list, puts, noRun, undefined, true)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await screen.findByRole('checkbox', { name: '지정하고 바로 시작' })
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await user.keyboard('{Escape}')
    // 시작이 거절되면 시작 없이 담당만 다시 저장한다.
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3], startWorkflowId: 5 }, { userIds: [1, 3] }]))
    expect(await screen.findByText('담당은 지정했어요 — 워크플로우는 시작하지 못했어요: 담당자의 역할에 맞는 시작 조건이 없습니다.')).toBeInTheDocument()
  })

  test('assignDialog_startRejected409_retriesAssigneesOnly_andWarns', async () => {
    const puts: Record<string, unknown>[] = []
    setup(list, puts, noRun, undefined, { status: 409, code: 'WORKFLOW_ISSUE_CLOSED' })
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await screen.findByRole('checkbox', { name: '지정하고 바로 시작' })
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3], startWorkflowId: 5 }, { userIds: [1, 3] }]))
    expect(await screen.findByText(/담당은 지정했어요 — 워크플로우는 시작하지 못했어요/)).toBeInTheDocument()
  })

  test('assignDialog_assigneeChangeItself403_noResend_showsFailure', async () => {
    const puts: Record<string, unknown>[] = []
    setup(list, puts, noRun, undefined, { status: 403, code: 'FORBIDDEN' })
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await screen.findByRole('checkbox', { name: '지정하고 바로 시작' })
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toHaveLength(1))
    // 재전송이 없음을 확인할 시간을 준다.
    await new Promise((r) => setTimeout(r, 100))
    expect(puts).toEqual([{ userIds: [1, 3], startWorkflowId: 5 }])
    expect(await screen.findByText(/담당자 저장에 실패했습니다|거절됨/)).toBeInTheDocument()
  })

  test('assignDialog_closedIssue_noCheckbox_noStart', async () => {
    const puts: Record<string, unknown>[] = []
    setup(list, puts, noRun, undefined, false, true)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await screen.findByRole('checkbox', { name: '개발AI' })
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByRole('checkbox', { name: '지정하고 바로 시작' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: '개발AI' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3] }]))
  })

  test('assignDialog_uncheck_omitsStart', async () => {
    const puts: Record<string, unknown>[] = []
    setup(list, puts)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '지정하고 바로 시작' }))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3] }]))
  })

  test('assignDialog_removeOnly_omitsStart', async () => {
    const puts: Record<string, unknown>[] = []
    setup(list, puts)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    expect(await screen.findByRole('checkbox', { name: '지정하고 바로 시작' })).toBeChecked()
    await user.click(await screen.findByRole('checkbox', { name: '나' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [] }]))
  })

  test('assignDialog_runningFlow_noCheckbox', async () => {
    const puts: Record<string, unknown>[] = []
    let runFetched = false
    setup(list, puts, { ...noRun, runId: 3, status: 'RUNNING' }, () => {
      runFetched = true
    })
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await screen.findByRole('checkbox', { name: '개발AI' })
    // 실행 조회 응답이 온 뒤에 부재를 단언해야 「조회 전이라 숨김」과 「RUNNING 이라 숨김」을 가른다.
    await waitFor(() => expect(runFetched).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('checkbox', { name: '지정하고 바로 시작' })).not.toBeInTheDocument()
  })

  test('assignDialog_disabledProject_noCheckbox', async () => {
    const puts: Record<string, unknown>[] = []
    setup([], puts)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await screen.findByRole('checkbox', { name: '개발AI' })
    expect(screen.queryByRole('checkbox', { name: '지정하고 바로 시작' })).not.toBeInTheDocument()
  })
})
