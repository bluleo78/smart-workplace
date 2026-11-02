// 새 이슈 대화상자의 「AI 에게 맡기기」(WP-1315) — 화면 테스트(renderScreen + MSW).
// 늘 보이는 한 줄 → 펼쳐 담당 AI·실행 일정 고르기 → 요약 글자 → 버튼이 「만들고 지금 실행」/「만들기만」으로 바뀜 →
// 만들기 POST → 실행 일정 PUT → (지금 실행이면) test-runs POST 차례와 본문, 일정 저장 실패 토스트를 본다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { renderCreateDialog } from '@/test/kits/projects/issueCreateDialogScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'

const KEY = 'WP'
const AGENTS = [
  { id: 5, username: 'my-ai', name: '도우미', personalAssistant: true },
  { id: 7, username: 'team-ai', name: '팀 AI', personalAssistant: false },
]

/** 서버로 나간 요청을 차례대로 — 「메서드 경로」와 본문. */
type Sent = { call: string; body: unknown }

/**
 * 대화상자를 열고 제목을 채운다. putStatus 가 2xx 가 아니면 실행 일정 저장이 그 상태로 실패한다. agentsGate 를 주면 담당 AI 후보 응답이 그
 * 약속이 풀릴 때까지 멈춘다(받는 중 상태를 본다).
 */
async function openCreate({
  putStatus = 200,
  agents = AGENTS,
  agentsGate,
}: { putStatus?: number; agents?: typeof AGENTS; agentsGate?: Promise<void> } = {}) {
  const sent: Sent[] = []
  const view = renderCreateDialog(KEY, [
    http.get(`/api/v1/projects/${KEY}/recurrence-agents`, async () => {
      sent.push({ call: 'GET agents', body: null })
      if (agentsGate) await agentsGate
      return HttpResponse.json(agents)
    }),
    http.post(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
      sent.push({ call: 'POST issue', body: await request.json() })
      return HttpResponse.json(createIssue({ number: 42, projectKey: KEY }), { status: 201 })
    }),
    http.put(`/api/v1/projects/${KEY}/issues/42/recurrence`, async ({ request }) => {
      sent.push({ call: 'PUT recurrence', body: await request.json() })
      if (putStatus >= 300) {
        return HttpResponse.json({ status: putStatus, message: '서버가 실행하는 AI 만 맡길 수 있습니다' }, { status: putStatus })
      }
      return HttpResponse.json({ rrule: 'FREQ=DAILY', time: '08:30', enabled: true, nextRunAt: null, consecutiveFailures: 0, lastRunAt: null, agentUserId: 5, agentName: '도우미' })
    }),
    http.post(`/api/v1/projects/${KEY}/issues/42/recurrence/test-runs`, () => {
      sent.push({ call: 'POST test-run', body: null })
      return new HttpResponse(null, { status: 202 })
    }),
  ])
  await view.user.click(await screen.findByRole('button', { name: '+ 새 태스크' }, { timeout: SCREEN_LOAD_TIMEOUT }))
  const dialog = await screen.findByRole('dialog', { name: '새 이슈' })
  await view.user.type(within(dialog).getByLabelText(/^제목/), '회의록 정리')
  return { ...view, sent, dialog }
}

describe('새 이슈 대화상자 — AI 에게 맡기기 (WP-1315)', () => {
  // 2026-11-02(월) 23:00Z = 11/3(화) 08:00 KST — 미리보기·요약 날짜를 고정한다(타이머는 그대로 돈다).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T23:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  test('줄은 늘 보이고 「안 함」, 후보는 펼칠 때만 받으며 버튼은 「생성」 하나다', async () => {
    const { sent, dialog } = await openCreate()
    const toggle = within(dialog).getByTestId('create-ai-handoff-toggle')
    expect(toggle).toHaveTextContent('AI 에게 맡기기')
    expect(toggle).toHaveTextContent('안 함')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByTestId('create-ai-handoff-panel')).toBeNull()
    expect(within(dialog).getByRole('button', { name: '생성' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '만들고 지금 실행' })).toBeNull()
    expect(sent.filter((s) => s.call === 'GET agents')).toHaveLength(0)
  })

  test('펼치면 내 AI 비서·한 번만이 기본 — 평일 08:30 으로 바꾸면 요약·다음 실행이 바뀌고 버튼이 둘로 나뉜다', async () => {
    const { user, dialog } = await openCreate()
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent('도우미 (내 AI 비서)'))
    expect(within(panel).getByRole('button', { name: '한 번만' })).toHaveAttribute('aria-pressed', 'true')
    // 한 번만 09:00 — 아직 08:00 이라 오늘(11/3).
    expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('내 AI 비서 · 한 번만 11/3(화) 09:00')
    expect(within(panel).getByTestId('create-ai-handoff-next')).toHaveTextContent('다음 실행 11/3(화) 09:00')
    expect(panel).toHaveTextContent('설명이 AI 에게 주는 지시가 됩니다. 확인받을 일도 설명에 적어 주세요.')

    await user.click(within(panel).getByRole('button', { name: '평일' }))
    fireEvent.change(within(panel).getByLabelText('실행 시각 (한국 시간)'), { target: { value: '08:30' } })
    expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('내 AI 비서 · ↻ 평일 08:30')
    expect(within(panel).getByTestId('create-ai-handoff-next')).toHaveTextContent('다음 실행 11/3(화) 08:30')

    expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '만들기만' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '생성' })).toBeNull()

    // 접어도 설정은 남아 요약이 보인다.
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    expect(within(dialog).queryByTestId('create-ai-handoff-panel')).toBeNull()
    expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('↻ 평일 08:30')
  })

  test('「만들고 지금 실행」은 만들기 → 실행 일정 저장(고른 AI) → 지금 실행 차례로 보내고 닫힌다', async () => {
    const { user, sent, dialog } = await openCreate()
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    // 담당 AI 를 팀 AI 로 바꾼다.
    await user.click(within(panel).getByRole('combobox', { name: '담당 AI' }))
    await user.click(await screen.findByRole('option', { name: '팀 AI' }))
    await user.click(within(panel).getByRole('button', { name: '매주' }))
    await user.click(within(panel).getByRole('button', { name: '수요일' }))
    expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('팀 AI · ↻ 매주 월·수 09:00')

    await user.click(within(dialog).getByRole('button', { name: '만들고 지금 실행' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).toBeNull())
    expect(sent.filter((s) => s.call !== 'GET agents')).toEqual([
      { call: 'POST issue', body: expect.objectContaining({ title: '회의록 정리' }) },
      { call: 'PUT recurrence', body: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', time: '09:00', agentUserId: 7 } },
      { call: 'POST test-run', body: null },
    ])
    expect(await screen.findByText('작업을 만들고 지금 실행을 시작했습니다 — 결과는 작업 채팅에 남습니다')).toBeInTheDocument()
  })

  test('「만들기만」은 일정까지 저장하고 지금 실행은 보내지 않는다 — 한 번만은 날짜 없이 보낸다', async () => {
    const { user, sent, dialog } = await openCreate()
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    await within(dialog).findByTestId('create-ai-handoff-panel')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '만들기만' })).toBeInTheDocument())

    await user.click(within(dialog).getByRole('button', { name: '만들기만' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).toBeNull())
    expect(sent.map((s) => s.call).filter((c) => c !== 'GET agents')).toEqual(['POST issue', 'PUT recurrence'])
    expect(sent.find((s) => s.call === 'PUT recurrence')?.body).toEqual({ rrule: 'FREQ=ONCE', time: '09:00', agentUserId: 5 })
    expect(await screen.findByText('작업을 만들고 실행 일정을 저장했습니다')).toBeInTheDocument()
  })

  test('실행 일정 저장이 실패하면 작업은 있다는 것과 이유를 알리고, 지금 실행은 보내지 않는다', async () => {
    const { user, sent, dialog } = await openCreate({ putStatus: 409 })
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeInTheDocument())

    await user.click(within(dialog).getByRole('button', { name: '만들고 지금 실행' }))
    expect(
      await screen.findByText('작업은 만들었지만 실행 일정을 저장하지 못했습니다 — 서버가 실행하는 AI 만 맡길 수 있습니다'),
    ).toBeInTheDocument()
    expect(sent.map((s) => s.call).filter((c) => c !== 'GET agents')).toEqual(['POST issue', 'PUT recurrence'])
    // 작업은 만들어졌으니 창은 닫힌다.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).toBeNull())
  })

  test('「맡기지 않기」를 누르면 「안 함」으로 돌아가 만들기만 보낸다', async () => {
    const { user, sent, dialog } = await openCreate()
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    await user.click(within(panel).getByRole('button', { name: '맡기지 않기' }))
    expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('안 함')
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).toBeNull())
    expect(sent.map((s) => s.call).filter((c) => c !== 'GET agents')).toEqual(['POST issue'])
  })

  test('매주에 요일을 모두 빼면 문구를 보이고 작업도 만들지 않는다', async () => {
    const { user, sent, dialog } = await openCreate()
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeInTheDocument())
    await user.click(within(panel).getByRole('button', { name: '매주' }))
    await user.click(within(panel).getByRole('button', { name: '월요일' }))
    await user.click(within(dialog).getByRole('button', { name: '만들고 지금 실행' }))
    expect(await within(panel).findByTestId('create-ai-handoff-error')).toHaveTextContent('요일을 하나 이상 고르세요')
    expect(sent.map((s) => s.call).filter((c) => c !== 'GET agents')).toEqual([])
  })

  test('맡길 수 있는 AI 가 없으면 안내를 보이고 버튼은 「생성」 그대로다 — 누르면 작업만 만든다', async () => {
    const { user, sent, dialog } = await openCreate({ agents: [] })
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    expect(await within(dialog).findByTestId('create-ai-handoff-no-agent')).toHaveTextContent('맡길 수 있는 AI 가 없습니다')
    expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('안 함')
    expect(within(dialog).queryByRole('button', { name: '만들고 지금 실행' })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '새 이슈' })).toBeNull())
    expect(sent.map((s) => s.call).filter((c) => c !== 'GET agents')).toEqual(['POST issue'])
  })

  test('담당 AI 후보를 받는 동안은 두 버튼을 잠그고 Enter 로도 만들지 않는다 — 받으면 풀린다', async () => {
    let release = () => {}
    const agentsGate = new Promise<void>((r) => (release = r))
    const { user, sent, dialog } = await openCreate({ agentsGate })
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))

    // 받는 중 — 요약·담당 AI 칸이 「불러오는 중…」, 버튼은 맡기기용 둘이지만 잠겨 있다(「생성」으로 돌아가 맡기기가 빠지지 않게).
    await waitFor(() => expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('불러오는 중…'))
    expect(within(dialog).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent('불러오는 중…')
    expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: '만들기만' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: '생성' })).toBeNull()
    // 제목 칸에서 Enter — 폼 제출이 나가도 만들지 않는다.
    await user.type(within(dialog).getByLabelText(/^제목/), '{Enter}')
    expect(sent.map((s) => s.call)).toEqual(['GET agents'])

    release()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '만들고 지금 실행' })).toBeEnabled())
    expect(within(dialog).getByRole('button', { name: '만들기만' })).toBeEnabled()
    expect(within(dialog).getByTestId('create-ai-handoff-summary')).toHaveTextContent('내 AI 비서 · 한 번만')
  })

  test('한 번만이면 지금 실행이 테스트 실행 한 번 + 정한 시각 한 번이라는 안내를 보인다', async () => {
    const { user, dialog } = await openCreate()
    await user.click(within(dialog).getByTestId('create-ai-handoff-toggle'))
    const panel = await within(dialog).findByTestId('create-ai-handoff-panel')
    expect(within(panel).getByTestId('create-ai-handoff-once-hint')).toHaveTextContent(
      '만들고 지금 실행하면 지금 테스트 실행을 한 번 하고, 정한 시각에 한 번 더 실행합니다.',
    )
    await user.click(within(panel).getByRole('button', { name: '매일' }))
    expect(within(panel).queryByTestId('create-ai-handoff-once-hint')).toBeNull()
  })
})
