// 「AI 에게 맡기기」 칸의 「지금 실행」(WP-1313) — 일정이 있으면 버튼이 보이고, 누르면 test-runs 를 POST 하고 「결과는 채팅에 남는다」 토스트와
// 함께 「실행 중…」으로 잠긴다. 남의 개인 비서 일정·읽기 전용 이슈는 잠그고 이유를 보이며, 서버 409 문구는 토스트로 보인다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { IssueRecurrence } from '@/types/issueRecurrence'

import { TaskRecurrenceField } from './TaskRecurrenceField'

const BASE = '/api/v1/projects/ME/issues/3/recurrence'

const recurrence = (over: Partial<IssueRecurrence> = {}): IssueRecurrence => ({
  rrule: 'FREQ=DAILY',
  time: '09:00',
  enabled: true,
  nextRunAt: null,
  consecutiveFailures: 0,
  lastRunAt: null,
  agentUserId: 9,
  agentName: '내 비서',
  editable: true,
  testRunning: false,
  ...over,
})

/** 이 일정으로 칸을 띄운다 — GET 은 매번 지금 값(state.r)을 돌려주고, POST 는 기록한 뒤 status 로 답한다. */
function setup(initial: IssueRecurrence | null, post: { status: number; message?: string } = { status: 202 }, disabled = false) {
  const state = { r: initial, posts: 0 }
  const view = renderScreen(<TaskRecurrenceField projectKey="ME" number={3} disabled={disabled} />, {
    handlers: [
      http.get(BASE, () => (state.r ? HttpResponse.json(state.r) : new HttpResponse(null, { status: 204 }))),
      http.post(`${BASE}/test-runs`, () => {
        state.posts += 1
        if (post.status !== 202) return HttpResponse.json({ message: post.message }, { status: post.status })
        // 서버는 실행 중으로 바뀐다 — 다시 받은 반복이 testRunning 을 싣는다.
        if (state.r) state.r = { ...state.r, testRunning: true }
        return new HttpResponse(null, { status: 202 })
      }),
    ],
  })
  return { ...view, state }
}

describe('TaskRecurrenceField 「지금 실행」(WP-1313)', () => {
  it('누르면 test-runs 를 보내고 토스트와 함께 「실행 중…」으로 잠긴다', async () => {
    const { user, state } = setup(recurrence())
    const button = await screen.findByTestId('task-recurrence-run-now')
    expect(button).toHaveTextContent('지금 실행')
    expect(button).toBeEnabled()

    await user.click(button)

    await waitFor(() => expect(state.posts).toBe(1))
    expect(await screen.findByText('지금 실행을 시작했습니다 — 결과는 채팅에 남습니다')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('task-recurrence-run-now')).toHaveTextContent('실행 중…'))
    expect(screen.getByTestId('task-recurrence-run-now')).toBeDisabled()
    expect(screen.getByTestId('task-recurrence-run-now-reason')).toHaveAccessibleName(/실행 중이에요/)
  })

  it('일정이 없으면 버튼이 없다', async () => {
    setup(null)
    await waitFor(() => expect(screen.getByTestId('task-recurrence-trigger')).toBeEnabled())
    expect(screen.queryByTestId('task-recurrence-run-now')).toBeNull()
  })

  it('남의 개인 비서 일정은 잠그고 주인만 실행할 수 있다고 알린다', async () => {
    const { user, state } = setup(recurrence({ editable: false, agentName: '앨리스 비서' }))
    const button = await screen.findByTestId('task-recurrence-run-now')
    expect(button).toBeDisabled()
    expect(screen.getByTestId('task-recurrence-run-now-reason')).toHaveAccessibleName('다른 사람의 개인 비서 일정이라 그 주인만 실행할 수 있어요')
    await user.click(button).catch(() => {})
    expect(state.posts).toBe(0)
  })

  it('이슈를 고칠 수 없는 사람에게는 잠근다', async () => {
    setup(recurrence(), { status: 202 }, true)
    expect(await screen.findByTestId('task-recurrence-run-now')).toBeDisabled()
    expect(screen.getByTestId('task-recurrence-run-now-reason')).toHaveAccessibleName(/고칠 수 있는 사람만/)
  })

  it('서버가 409(이미 실행 중)면 그 문구를 토스트로 보인다', async () => {
    const { user } = setup(recurrence(), { status: 409, message: '이미 실행 중입니다 — 결과가 채팅에 남은 뒤 다시 실행하세요' })
    await user.click(await screen.findByTestId('task-recurrence-run-now'))
    expect(await screen.findByText('이미 실행 중입니다 — 결과가 채팅에 남은 뒤 다시 실행하세요')).toBeInTheDocument()
  })
})
