// 개인 작업 반복 편집기의 매월 여러 날짜(WP-1117) — API·AI 로 저장된 「1,15」를 열면 나머지 날짜를 알리고, 그대로 저장해도 빠지지 않는다.
// 서버 저장 배선(PUT 요청)은 e2e personal-project 반복 시트 테스트가 본다 — 여기서는 저장 훅을 끊고 보내는 값만 본다.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { IssueRecurrence } from '@/types/issueRecurrence'

import { TaskRecurrenceEditor } from './TaskRecurrenceEditor'

const saved = vi.hoisted(() => ({ bodies: [] as unknown[] }))
// 담당 AI 후보(WP-1314) — 테스트마다 바꾼다. agentsCalls 는 후보 조회가 켜졌는지(enabled) 기록한다.
const agents = vi.hoisted(() => ({
  options: [] as { id: number; username: string; name: string | null; personalAssistant: boolean }[],
  enabledCalls: [] as boolean[],
  loading: false,
}))
vi.mock('@/hooks/queries/useIssueRecurrence', () => ({
  useSaveIssueRecurrence: () => ({
    isPending: false,
    mutate: (body: unknown, opts?: { onSuccess?: () => void }) => {
      saved.bodies.push(body)
      opts?.onSuccess?.()
    },
  }),
  useDeleteIssueRecurrence: () => ({ isPending: false, mutate: vi.fn() }),
  useIssueRecurrenceAgents: (_k: string, _n: number, enabled = true) => {
    agents.enabledCalls.push(enabled)
    if (enabled && agents.loading) return { data: undefined, isSuccess: false, isError: false, isLoading: true }
    return enabled
      ? { data: agents.options, isSuccess: true, isError: false, isLoading: false }
      : { data: undefined, isSuccess: false, isError: false, isLoading: false }
  },
}))

const recurrence = (rrule: string): IssueRecurrence => ({
  rrule,
  time: '09:00',
  enabled: true,
  nextRunAt: null,
  consecutiveFailures: 0,
  lastRunAt: null,
  agentUserId: 9,
  agentName: '비서',
})

/** 이 반복 규칙으로 편집기를 연다. */
const open = (rrule: string, onDone = vi.fn()) =>
  renderWithProviders(<TaskRecurrenceEditor projectKey="ME" number={3} recurrence={recurrence(rrule)} onDone={onDone} />)

describe('TaskRecurrenceEditor 매월 여러 날짜(WP-1117)', () => {
  beforeEach(() => {
    saved.bodies = []
    agents.options = []
    agents.enabledCalls = []
    agents.loading = false
  })

  it('「1,15」를 열면 1일을 편집하고 15일도 반복한다고 알리며, 그대로 저장하면 두 날짜를 모두 보낸다', async () => {
    const onDone = vi.fn()
    open('FREQ=MONTHLY;BYMONTHDAY=1,15', onDone)
    expect(screen.getByRole('spinbutton', { name: '날짜' })).toHaveValue(1)
    expect(screen.getByTestId('task-recurrence-other-monthdays')).toHaveTextContent('15일에도 반복합니다')

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(saved.bodies).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=1,15', time: '09:00', agentUserId: 9 }])
    expect(onDone).toHaveBeenCalled()
  })

  it('편집 날짜를 나머지 날짜와 같게 바꾸면 안내가 사라지고 한 날짜로 저장한다', async () => {
    open('FREQ=MONTHLY;BYMONTHDAY=1,15')
    const day = screen.getByRole('spinbutton', { name: '날짜' })
    await userEvent.clear(day)
    await userEvent.type(day, '15')
    expect(screen.queryByTestId('task-recurrence-other-monthdays')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(saved.bodies).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', time: '09:00', agentUserId: 9 }])
  })

  it('「1일만 반복」을 누르면 나머지 날짜를 빼고 1일로만 저장한다', async () => {
    open('FREQ=MONTHLY;BYMONTHDAY=1,15')
    await userEvent.click(screen.getByRole('button', { name: '1일만 반복' }))
    expect(screen.queryByTestId('task-recurrence-other-monthdays')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(saved.bodies).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', time: '09:00', agentUserId: 9 }])
  })

  it('나머지 날짜가 29~31일이면 없는 달을 건너뛴다고 알린다', () => {
    open('FREQ=MONTHLY;BYMONTHDAY=1,31')
    expect(screen.getByTestId('task-recurrence-monthday-hint')).toBeInTheDocument()
  })

  it('날짜가 하나뿐이면 안내를 보이지 않는다', () => {
    open('FREQ=MONTHLY;BYMONTHDAY=15')
    expect(screen.queryByTestId('task-recurrence-other-monthdays')).toBeNull()
  })
})

// WP-1314: 담당 AI 고르기 — 새 일정은 후보 첫째(내 AI 비서)로, 고른 AI 를 agentUserId 로 보낸다. 남의 개인 비서 일정은 읽기 전용.
describe('TaskRecurrenceEditor 담당 AI(WP-1314)', () => {
  beforeEach(() => {
    saved.bodies = []
    agents.options = [
      { id: 5, username: 'my-ai', name: '내 비서', personalAssistant: true },
      { id: 7, username: 'team-ai', name: '팀 AI', personalAssistant: false },
    ]
    agents.enabledCalls = []
    agents.loading = false
  })

  it('후보를 불러오는 중에는 저장을 막는다', async () => {
    agents.loading = true
    renderWithProviders(<TaskRecurrenceEditor projectKey="TM" number={3} recurrence={null} onDone={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '매일' }))
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('새 일정은 내 AI 비서가 기본이고, 그대로 저장하면 agentUserId 5 를 보낸다', async () => {
    renderWithProviders(<TaskRecurrenceEditor projectKey="TM" number={3} recurrence={null} onDone={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: '담당 AI' })).toHaveTextContent('내 비서 (내 AI 비서)')
    await userEvent.click(screen.getByRole('button', { name: '매일' }))
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(saved.bodies).toEqual([{ rrule: 'FREQ=DAILY', time: '09:00', agentUserId: 5 }])
  })

  it('후보가 없으면 안내를 보이고 저장을 막는다', async () => {
    agents.options = []
    renderWithProviders(<TaskRecurrenceEditor projectKey="TM" number={3} recurrence={null} onDone={vi.fn()} />)
    expect(screen.getByTestId('task-recurrence-no-agent')).toHaveTextContent('맡길 수 있는 AI 가 없어요')
    await userEvent.click(screen.getByRole('button', { name: '매일' }))
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('남의 개인 비서 일정은 읽기 전용 — 안내, 입력 잠금, 저장·끄기 없음, 후보도 받지 않는다', () => {
    renderWithProviders(
      <TaskRecurrenceEditor
        projectKey="TM"
        number={3}
        recurrence={{ ...recurrence('FREQ=DAILY'), agentName: '앨리스 비서', editable: false }}
        onDone={vi.fn()}
      />,
    )
    expect(screen.getByTestId('task-recurrence-locked')).toHaveTextContent('앨리스 비서은(는) 다른 사람의 개인 비서라 주인만')
    expect(screen.getByRole('combobox', { name: '담당 AI' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '매주' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '저장' })).toBeNull()
    expect(screen.queryByRole('button', { name: '일정 끄기' })).toBeNull()
    expect(screen.getByRole('button', { name: '닫기' })).toBeEnabled()
    expect(agents.enabledCalls.every((e) => e === false)).toBe(true)
  })
})
