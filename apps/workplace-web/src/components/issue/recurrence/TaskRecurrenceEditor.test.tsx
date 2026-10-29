// 개인 작업 반복 편집기의 매월 여러 날짜(WP-1117) — API·AI 로 저장된 「1,15」를 열면 나머지 날짜를 알리고, 그대로 저장해도 빠지지 않는다.
// 서버 저장 배선(PUT 요청)은 e2e personal-project 반복 시트 테스트가 본다 — 여기서는 저장 훅을 끊고 보내는 값만 본다.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'
import type { IssueRecurrence } from '@/types/issueRecurrence'

import { TaskRecurrenceEditor } from './TaskRecurrenceEditor'

const saved = vi.hoisted(() => ({ bodies: [] as unknown[] }))
vi.mock('@/hooks/queries/useIssueRecurrence', () => ({
  useSaveIssueRecurrence: () => ({
    isPending: false,
    mutate: (body: unknown, opts?: { onSuccess?: () => void }) => {
      saved.bodies.push(body)
      opts?.onSuccess?.()
    },
  }),
  useDeleteIssueRecurrence: () => ({ isPending: false, mutate: vi.fn() }),
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
  })

  it('「1,15」를 열면 1일을 편집하고 15일도 반복한다고 알리며, 그대로 저장하면 두 날짜를 모두 보낸다', async () => {
    const onDone = vi.fn()
    open('FREQ=MONTHLY;BYMONTHDAY=1,15', onDone)
    expect(screen.getByRole('spinbutton', { name: '날짜' })).toHaveValue(1)
    expect(screen.getByTestId('task-recurrence-other-monthdays')).toHaveTextContent('15일에도 반복합니다')

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(saved.bodies).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=1,15', time: '09:00' }])
    expect(onDone).toHaveBeenCalled()
  })

  it('편집 날짜를 나머지 날짜와 같게 바꾸면 안내가 사라지고 한 날짜로 저장한다', async () => {
    open('FREQ=MONTHLY;BYMONTHDAY=1,15')
    const day = screen.getByRole('spinbutton', { name: '날짜' })
    await userEvent.clear(day)
    await userEvent.type(day, '15')
    expect(screen.queryByTestId('task-recurrence-other-monthdays')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(saved.bodies).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', time: '09:00' }])
  })

  it('「1일만 반복」을 누르면 나머지 날짜를 빼고 1일로만 저장한다', async () => {
    open('FREQ=MONTHLY;BYMONTHDAY=1,15')
    await userEvent.click(screen.getByRole('button', { name: '1일만 반복' }))
    expect(screen.queryByTestId('task-recurrence-other-monthdays')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(saved.bodies).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', time: '09:00' }])
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
