// 담당 팝오버의 시작 안내·경고 줄과 저장 본문(WP-2120) — 시작은 서버가 담당 지정과 함께 하므로 웹은 userIds 만 보낸다.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { AssigneePickerPopover } from './AssigneePickerPopover'

const API = '/api/v1'
const list = [{ id: 5, name: '데모 개발', enabled: true, activeVersionNo: 7, draftChanged: false }]
const members = [
  { userId: 1, username: 'me', name: '나', kind: 'HUMAN', isActive: true, role: 'MEMBER' },
  { userId: 3, username: 'developer14@iacloud.kr', name: '개발AI', kind: 'AGENT', isActive: true, role: 'MEMBER' },
  { userId: 4, username: 'dong', name: '동희', kind: 'HUMAN', isActive: true, role: 'MEMBER' },
]
const noRun = { runId: null, status: null, revision: 0, workflowId: null, versionNo: null, currentNode: null, outcomes: [], path: [], remainingNodeKeys: [], context: {} }

interface Opts {
  wfList?: object[]
  preview?: object | 'fail'
  closed?: boolean
}

function setup({ wfList = list, preview = { start: null, blocked: null, active: false, startRoles: [] }, closed = false }: Opts = {}) {
  const puts: Record<string, unknown>[] = []
  const previews: Record<string, unknown>[] = []
  renderScreen(
    <AssigneePickerPopover projectKey="WP" issueNumber={1} current={[{ id: 1, username: 'me', name: '나', kind: 'HUMAN' } as never]} issueId={7} projectId={9} closed={closed} />,
    {
      handlers: [
        http.get(`${API}/projects/WP/members`, () => HttpResponse.json(members)),
        http.get(`${API}/projects/9/workflows`, () => HttpResponse.json(wfList)),
        http.get(`${API}/issues/7/workflow`, () => HttpResponse.json(noRun)),
        http.post(`${API}/issues/7/workflow/assign-preview`, async ({ request }) => {
          previews.push((await request.json()) as Record<string, unknown>)
          return preview === 'fail' ? HttpResponse.json({ message: 'x' }, { status: 500 }) : HttpResponse.json(preview)
        }),
        http.put(`${API}/projects/WP/issues/1/assignees`, async ({ request }) => {
          puts.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json([])
        }),
      ],
    },
  )
  return { puts, previews, user: userEvent.setup() }
}

describe('담당 팝오버 시작 안내', () => {
  test('assigneePopover_startRolePick_showsStartHint', async () => {
    const { user, previews } = setup({ preview: { start: { workflowId: 5, workflowName: '데모 개발', stageName: '개발' }, blocked: null, active: false, startRoles: ['developer'] } })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    expect(await screen.findByText('▶ 지정하면 「데모 개발」이 개발 단계부터 시작돼요')).toBeInTheDocument()
    expect(previews.at(-1)).toEqual({ userIds: [1, 3] })
  })

  test('assigneePopover_nonMatchingAgent_showsWarning', async () => {
    const { user } = setup({ preview: { start: null, blocked: null, active: false, startRoles: ['developer'] } })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    expect(await screen.findByText('⚠ 워크플로우가 켜진 프로젝트라 developer14 는 이 할당으로 일하지 않아요 · 시작 조건: developer 역할')).toBeInTheDocument()
  })

  test('assigneePopover_blockedStart_showsCannotStartWarning', async () => {
    const { user } = setup({ preview: { start: { workflowId: 5, workflowName: '데모 개발', stageName: '개발' }, blocked: { message: '개발 단계 담당이 필요해요' }, active: false, startRoles: ['developer'] } })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    expect(await screen.findByText('⚠ 이 담당으로는 「데모 개발」을 시작할 수 없어 저장되지 않아요 · 개발 단계 담당이 필요해요')).toBeInTheDocument()
    expect(screen.queryByText(/지정하면/)).not.toBeInTheDocument()
  })

  test('assigneePopover_activeRun_nonMatchingAgent_showsNoWarning', async () => {
    const { user, previews } = setup({ preview: { start: null, blocked: null, active: true, startRoles: ['developer'] } })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await waitFor(() => expect(previews).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('assign-start-hint')).not.toBeInTheDocument()
  })

  test('assigneePopover_nonMatchingHuman_showsNoLine', async () => {
    const { user, previews } = setup({ preview: { start: null, blocked: null, active: false, startRoles: ['developer'] } })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '동희' }))
    await waitFor(() => expect(previews).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('assign-start-hint')).not.toBeInTheDocument()
  })

  test('assigneePopover_close_sendsOnlyUserIds', async () => {
    const { user, puts } = setup({ preview: { start: { workflowId: 5, workflowName: '데모 개발', stageName: '개발' }, blocked: null, active: false, startRoles: [] } })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await screen.findByTestId('assign-start-hint')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3] }]))
  })

  test('assigneePopover_previewFails_noLine_saveStillWorks', async () => {
    const { user, puts, previews } = setup({ preview: 'fail' })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await waitFor(() => expect(previews).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('assign-start-hint')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3] }]))
  })

  test('assigneePopover_removeOnly_doesNotAskPreview', async () => {
    const { user, previews, puts } = setup()
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '나' }))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [] }]))
    expect(previews).toEqual([])
  })

  test('assigneePopover_disabledProject_doesNotAskPreview', async () => {
    const { user, previews } = setup({ wfList: [] })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await new Promise((r) => setTimeout(r, 100))
    expect(previews).toEqual([])
    expect(screen.queryByTestId('assign-start-hint')).not.toBeInTheDocument()
  })

  test('assigneePopover_closedIssue_doesNotAskPreview', async () => {
    const { user, previews, puts } = setup({ closed: true })
    await user.click(await screen.findByTestId('assignee-picker-trigger'))
    await user.click(await screen.findByRole('checkbox', { name: '개발AI' }))
    await new Promise((r) => setTimeout(r, 100))
    expect(previews).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(puts).toEqual([{ userIds: [1, 3] }]))
  })
})
