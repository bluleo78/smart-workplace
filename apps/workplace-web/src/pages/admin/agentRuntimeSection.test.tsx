// 에이전트 상세 「실행 방식」 섹션(WP-1254) — 화면 컴포넌트 테스트.
// 기본 템플릿·작업 공간 템플릿(Claude Code) 고르기 → 저장 전에는 아무것도 바뀌지 않음, 저장/켜기 payload, 켜져 있을 때 잠금,
// 공통 비서 잠금, 상태 카드(작업 중·적용 대기·실패·꺼짐), 끄기·다시 시작, 외부로 되돌리기, 오류 토스트를 본다.
// AgentRuntimeSection 을 renderScreen 으로 직접 띄운다(드로어·목록은 거치지 않는다 — 목록은 agentRuntimeList.test.tsx).
import { screen, waitFor, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { renderScreen, type ScreenUser } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'

import {
  agentRuntimeApi,
  createAgent,
  createLocations,
  createObserved,
  createSetting,
} from '../../test/kits/admin/agentRuntime'
import { AgentRuntimeSection } from './components/AgentRuntimeSection'

type ApiOptions = Parameters<typeof agentRuntimeApi>[0]

/** 섹션을 띄우고 템플릿 카드가 그려질 때까지 기다린다. */
async function renderSection(agent: AgentResponse, opts: ApiOptions = {}) {
  const api = agentRuntimeApi(opts)
  const view = renderScreen(<AgentRuntimeSection agent={agent} />, { handlers: api.handlers })
  // 외부 AI 는 템플릿 카드가 없으니 세그먼트가 그려지면 준비된 것으로 본다.
  if (agent.runtime === 'EXTERNAL' && !opts.settings?.[agent.id]) await screen.findByTestId('agent-runtime-section')
  else await screen.findByTestId('agent-template-claude-code')
  return { ...view, ...api }
}

/** Radix Select 에서 옵션 이름으로 고른다. */
async function pickOption(user: ScreenUser, triggerTestId: string, option: string) {
  await user.click(screen.getByTestId(triggerTestId))
  await user.click(await screen.findByRole('option', { name: option }))
}

const server7 = createAgent(7) // 서버가 답하는 일반 AI(저장된 실행 설정 없음)

test('설정 없는 서버 AI — 내부·기본 카드가 선택돼 있고 작업 공간 설정은 없다', async () => {
  await renderSection(server7)
  expect(screen.getByTestId('agent-runtime-INTERNAL')).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByTestId('agent-template-default')).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByTestId('agent-template-claude-code')).toHaveAttribute('aria-checked', 'false')
  expect(screen.queryByTestId('agent-workspace-runtime')).not.toBeInTheDocument()
})

test('Claude Code 를 고르면 초안 칸(모델·대기열 기본값)이 뜨고 저장 전에는 요청이 없다', async () => {
  const { user, calls } = await renderSection(server7)
  await user.click(screen.getByTestId('agent-template-claude-code'))

  expect(await screen.findByTestId('agent-workspace-runtime')).toBeInTheDocument()
  expect(screen.getByTestId('agent-template-claude-code')).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByTestId('agent-runtime-config-model')).toHaveTextContent('Opus')
  expect(screen.getByTestId('agent-runtime-config-queue')).toHaveValue('AI 개발팀')
  // 저장된 설정이 없으니 상태는 꺼짐, 저장·취소 단추가 보인다.
  expect(screen.getByTestId('agent-runtime-status')).toHaveTextContent('꺼짐')
  expect(screen.getByTestId('agent-runtime-save')).toBeEnabled()
  expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument()
  expect(calls.saves).toEqual([])
  expect(calls.runtimes).toEqual([])
  expect(calls.settingDeletes).toBe(0)
})

test('초안 취소 — 기본 카드로 돌아가고 요청이 없다', async () => {
  const { user, calls } = await renderSection(server7)
  await user.click(screen.getByTestId('agent-template-claude-code'))
  await user.click(await screen.findByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByTestId('agent-workspace-runtime')).not.toBeInTheDocument())
  expect(screen.getByTestId('agent-template-default')).toHaveAttribute('aria-checked', 'true')
  expect(calls.saves).toEqual([])
})

test('저장 — 고른 모델·대기열·위치가 PUT payload 로 가고 applyMode 는 없다', async () => {
  const { user, calls } = await renderSection(server7)
  await user.click(screen.getByTestId('agent-template-claude-code'))
  await pickOption(user, 'agent-runtime-config-model', 'Sonnet')
  const queue = screen.getByTestId('agent-runtime-config-queue')
  await user.clear(queue)
  await user.type(queue, 'AI 테스트팀')
  await pickOption(user, 'agent-runtime-location', 'PoC · 남은 자리 1')
  await user.click(screen.getByTestId('agent-runtime-save'))

  await waitFor(() => expect(calls.saves).toHaveLength(1))
  expect(calls.saves[0]).toEqual({
    templateName: 'claude-code',
    locationId: 2,
    config: { model: 'sonnet', queue: 'AI 테스트팀' },
  })
  expect(calls.saves[0].applyMode).toBeUndefined()
})

test('켜기 — 바뀐 설정을 먼저 저장하고 POST start 를 보낸다(Claude 연결이 있을 때)', async () => {
  const { user, calls } = await renderSection(server7, { claudeFor: [7] })
  await user.click(screen.getByTestId('agent-template-claude-code'))
  // Claude 연결 확인 항목이 통과여야 켤 수 있다.
  const checks = await screen.findByTestId('agent-runtime-checks')
  await waitFor(() => expect(within(checks).getAllByLabelText('통과')).toHaveLength(2))
  await user.click(screen.getByTestId('agent-runtime-start'))

  await waitFor(() => expect(calls.actions).toEqual(['start']))
  expect(calls.saves).toEqual([{ templateName: 'claude-code', locationId: null, config: { model: 'opus', queue: 'AI 개발팀' } }])
  expect(calls.order).toEqual(['PUT setting'])
})

test('꺼짐 — Claude 연결이 없으면 항목이 「필요」로 보이고 켜기가 막힌다', async () => {
  await renderSection(server7, { settings: { 7: createSetting(7) } })
  const checks = await screen.findByTestId('agent-runtime-checks')
  await waitFor(() => expect(within(checks).getAllByLabelText('필요')).toHaveLength(1))
  expect(checks).toHaveTextContent('Claude 연결')
  expect(within(checks).getByRole('button', { name: '연결하기' })).toBeInTheDocument()
  expect(checks).toHaveTextContent('운영 · 남은 자리 1 · CPU 4코어 · 메모리 8Gi 필요')
  expect(screen.getByTestId('agent-runtime-start')).toBeDisabled()
})

test('꺼짐 — 기본 위치에 남은 자리가 없으면 켜기가 막힌다', async () => {
  const locations = createLocations()
  locations[0].used = locations[0].capacity
  await renderSection(server7, { settings: { 7: createSetting(7) }, claudeFor: [7], locations })
  const checks = await screen.findByTestId('agent-runtime-checks')
  await waitFor(() => expect(checks).toHaveTextContent('남은 자리 0'))
  expect(within(checks).getAllByLabelText('필요')).toHaveLength(1)
  expect(screen.getByTestId('agent-runtime-start')).toBeDisabled()
})

test('꺼짐 + Claude 연결 있음 — 켜기가 열리고 바뀐 것이 없으면 저장 없이 start 만 보낸다', async () => {
  const { user, calls } = await renderSection(server7, { settings: { 7: createSetting(7) }, claudeFor: [7] })
  await waitFor(() => expect(screen.getByTestId('agent-runtime-start')).toBeEnabled())
  expect(screen.queryByTestId('agent-runtime-save')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('agent-runtime-start'))
  await waitFor(() => expect(calls.actions).toEqual(['start']))
  expect(calls.saves).toEqual([])
})

test('작업 중 — 상태 알약·이슈 링크·자원 통계가 보이고 끄기·다시 시작이 나온다', async () => {
  const setting = createSetting(7, {
    status: 'RUNNING',
    desired: 'RUN',
    observed: createObserved({ agentState: 'WORKING', agentIssueKey: 'WD-319' }),
  })
  await renderSection(server7, { settings: { 7: setting } })
  await screen.findByTestId('agent-runtime-stats')
  expect(screen.getByTestId('agent-runtime-status')).toHaveTextContent('작업 중')
  const link = screen.getByTestId('agent-runtime-detail')
  expect(link).toHaveTextContent('WD-319')
  expect(link).toHaveAttribute('href', '/projects/WD/issues/319')
  const stats = screen.getByTestId('agent-runtime-stats')
  expect(stats).toHaveTextContent('4.2 코어')
  expect(stats).toHaveTextContent('3.2 / 16 GiB')
  expect(stats).toHaveTextContent('1시간 12분')
  expect(screen.getByTestId('agent-runtime-restart')).toBeInTheDocument()
  expect(screen.getByTestId('agent-runtime-stop')).toBeInTheDocument()
  expect(screen.queryByTestId('agent-runtime-start')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-runtime-checks')).not.toBeInTheDocument()
})

test('켜져 있는 동안 — 외부 세그먼트와 기본 카드는 비활성이고 이유 툴팁이 뜬다', async () => {
  const setting = createSetting(7, { status: 'RUNNING', desired: 'RUN', observed: createObserved({ agentState: 'IDLE' }) })
  const { user } = await renderSection(server7, { settings: { 7: setting } })
  await screen.findByTestId('agent-runtime-stats')
  expect(screen.getByTestId('agent-runtime-EXTERNAL')).toBeDisabled()
  expect(screen.getByTestId('agent-template-default')).toBeDisabled()
  // 지금 고른 쪽은 그대로 눌려 있다.
  expect(screen.getByTestId('agent-runtime-INTERNAL')).toBeEnabled()
  expect(screen.getByTestId('agent-template-claude-code')).toHaveAttribute('aria-checked', 'true')
  // 막힌 단추를 감싼 span 이 포커스를 받아 이유를 보인다.
  await user.tab()
  const wrap = screen.getByTestId('agent-runtime-EXTERNAL').parentElement as HTMLElement
  wrap.focus()
  expect((await screen.findAllByText('켜져 있는 동안에는 바꿀 수 없어요. 먼저 끄세요.')).length).toBeGreaterThan(0)
})

test('켜져 있을 때 설정을 바꾸면 「다음 대기 때 적용」이 붙고 저장은 applyMode 없이 간다', async () => {
  const setting = createSetting(7, { status: 'RUNNING', desired: 'RUN', observed: createObserved({ agentState: 'IDLE' }) })
  const { user, calls } = await renderSection(server7, { settings: { 7: setting } })
  await screen.findByTestId('agent-runtime-stats')
  expect(screen.queryByTestId('agent-runtime-save')).not.toBeInTheDocument()
  await pickOption(user, 'agent-runtime-config-model', 'Sonnet')
  expect(screen.getByText('다음 대기 때 적용')).toBeInTheDocument()
  await user.click(screen.getByTestId('agent-runtime-save'))
  await waitFor(() => expect(calls.saves).toHaveLength(1))
  expect(calls.saves[0]).toEqual({ templateName: 'claude-code', locationId: null, config: { model: 'sonnet', queue: 'AI 개발팀' } })
})

test('적용 대기 — 안내와 「지금 적용」이 NOW 로 같은 설정을 다시 보낸다', async () => {
  const setting = createSetting(7, {
    status: 'APPLY_PENDING',
    desired: 'RUN',
    config: { model: 'opus', queue: 'AI 테스트팀' },
    observed: createObserved({ agentState: 'IDLE', agentNextCheckAt: '2026-11-02T03:30:00Z' }),
  })
  const { user, calls } = await renderSection(server7, { settings: { 7: setting } })
  const box = await screen.findByTestId('agent-runtime-apply-pending')
  expect(box).toHaveTextContent('쉴 때 적용됩니다')
  expect(screen.getByTestId('agent-runtime-status')).toHaveTextContent('대기')
  expect(screen.getByTestId('agent-runtime-detail')).toHaveTextContent('다음 확인 12:30')
  await user.click(screen.getByTestId('agent-runtime-apply-now'))
  await waitFor(() => expect(calls.saves).toHaveLength(1))
  expect(calls.saves[0]).toEqual({
    templateName: 'claude-code',
    locationId: null,
    config: { model: 'opus', queue: 'AI 테스트팀' },
    applyMode: 'NOW',
  })
})

test('실패(원하는 상태 RUN) — 사유가 빨간 글씨로 보이고 「다시 켜기」는 POST start(서버가 다시 만든다), 끄기도 보인다', async () => {
  const setting = createSetting(7, {
    status: 'FAILED',
    desired: 'RUN',
    observed: createObserved({ message: '이미지를 받지 못했습니다 (ImagePullBackOff)', phase: 'Pending', cpuMillicores: null, memoryBytes: null }),
  })
  const { user, calls } = await renderSection(server7, { settings: { 7: setting }, claudeFor: [7] })
  const detail = await screen.findByTestId('agent-runtime-detail')
  expect(detail).toHaveTextContent('이미지를 받지 못했습니다 (ImagePullBackOff)')
  expect(detail).toHaveClass('text-destructive')
  expect(screen.getByTestId('agent-runtime-status')).toHaveTextContent('실패')
  const start = screen.getByTestId('agent-runtime-start')
  expect(start).toHaveTextContent('다시 켜기')
  await waitFor(() => expect(start).toBeEnabled())
  // 자리는 이미 잡혀 있어 확인 항목이 없다. 켜기는 서버가 실패한 AI 를 다시 만든다(RUN·FAILED 면 generation+1).
  expect(screen.queryByTestId('agent-runtime-checks')).not.toBeInTheDocument()
  expect(screen.getByTestId('agent-runtime-stop')).toBeEnabled()
  // 원하는 상태가 RUN 이면 서버가 템플릿·실행 방식 변경을 409 로 막으니 화면도 막는다.
  expect(screen.getByTestId('agent-runtime-EXTERNAL')).toBeDisabled()
  await user.click(start)
  await waitFor(() => expect(calls.actions).toEqual(['start']))
})

test('끄기·다시 시작 — 각각 POST stop·restart', async () => {
  const setting = createSetting(7, { status: 'RUNNING', desired: 'RUN', observed: createObserved({ agentState: 'WORKING', agentIssueKey: 'WD-1' }) })
  const { user, calls } = await renderSection(server7, { settings: { 7: setting } })
  await user.click(await screen.findByTestId('agent-runtime-stop'))
  await waitFor(() => expect(calls.actions).toEqual(['stop']))
  await user.click(screen.getByTestId('agent-runtime-restart'))
  await waitFor(() => expect(calls.actions).toEqual(['stop', 'restart']))
})

test('공통 비서(WORKSPACE) — Claude Code 카드와 외부 세그먼트가 잠기고 이유가 보인다', async () => {
  const assistant = createAgent(2, { type: 'WORKSPACE' })
  const { calls } = await renderSection(assistant)
  expect(screen.getByTestId('agent-template-claude-code')).toBeDisabled()
  expect(screen.getByTestId('agent-runtime-EXTERNAL')).toBeDisabled()
  expect(screen.getByTestId('agent-runtime-description')).toHaveTextContent('공통 비서·개인 비서로 지정된 AI는')
  // 이미 고른 기본 카드는 그대로 선택돼 있다.
  expect(screen.getByTestId('agent-template-default')).toHaveAttribute('aria-checked', 'true')
  expect(calls.saves).toEqual([])
})

test('외부로 바꾸기 — 저장된 설정을 DELETE 로 지우기만 한다(DB 는 이미 EXTERNAL)', async () => {
  const { user, calls } = await renderSection(server7, { settings: { 7: createSetting(7) } })
  await waitFor(() => expect(screen.getByTestId('agent-workspace-runtime')).toBeInTheDocument())
  await user.click(screen.getByTestId('agent-runtime-EXTERNAL'))
  // 요청 하나 — 둘로 나누면 중간 실패 때 어긋나고, INTERNAL 을 거치면 그 사이 서버 AI 가 이슈를 가져간다.
  await waitFor(() => expect(calls.settingDeletes).toBe(1))
  expect(calls.order).toEqual(['DELETE setting'])
  expect(calls.runtimes).toEqual([])
})

test('꺼진 작업 공간 AI 에서 기본 카드 — 실행 방식 INTERNAL PUT 하나만(설정은 서버가 같은 트랜잭션에서 지운다)', async () => {
  const { user, calls } = await renderSection(server7, { settings: { 7: createSetting(7) } })
  await waitFor(() => expect(screen.getByTestId('agent-workspace-runtime')).toBeInTheDocument())
  await user.click(screen.getByTestId('agent-template-default'))
  await waitFor(() => expect(calls.runtimes).toEqual([{ runtime: 'INTERNAL' }]))
  expect(calls.order).toEqual(['PUT runtime'])
})

test('외부 AI(설정 없음)를 내부로 바꾸면 기본 카드가 선택된 INTERNAL PUT 만 간다', async () => {
  const external = createAgent(8, { runtime: 'EXTERNAL' })
  const { user, calls } = await renderSection(external)
  expect(screen.getByTestId('agent-runtime-EXTERNAL')).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByTestId('agent-template-default')).not.toBeInTheDocument()
  await user.click(screen.getByTestId('agent-runtime-INTERNAL'))
  await waitFor(() => expect(calls.runtimes).toEqual([{ runtime: 'INTERNAL' }]))
  expect(calls.settingDeletes).toBe(0)
})

test('맡는 프로젝트 — 키·이름·저장소(브랜치)를 보이고, 없으면 안내', async () => {
  const { user } = await renderSection(server7)
  await user.click(screen.getByTestId('agent-template-claude-code'))
  const projects = await screen.findByTestId('agent-runtime-projects')
  await waitFor(() => expect(projects).toHaveTextContent('Gen:iA Data'))
  expect(projects).toHaveTextContent('WD')
  expect(projects).toHaveTextContent('bluleo78/smart-fire-hub (main)')
})

test('맡는 프로젝트가 없으면 안내 문구', async () => {
  const { user } = await renderSection(server7, { projects: [] })
  await user.click(screen.getByTestId('agent-template-claude-code'))
  expect(await screen.findByText('맡는 프로젝트가 없어요.')).toBeInTheDocument()
})

test('저장이 409 로 실패하면 서버 메시지 토스트가 뜬다', async () => {
  const { user } = await renderSection(server7, { failWrites: { status: 409, message: '켜져 있는 AI 의 실행 위치는 바꿀 수 없습니다' } })
  await user.click(screen.getByTestId('agent-template-claude-code'))
  await user.click(screen.getByTestId('agent-runtime-save'))
  expect(await screen.findByText('켜져 있는 AI 의 실행 위치는 바꿀 수 없습니다')).toBeInTheDocument()
})

test('다시 시작이 500 으로 실패하면 서버 메시지 토스트가 뜨고 성공 토스트는 없다', async () => {
  const setting = createSetting(7, { status: 'RUNNING', desired: 'RUN', observed: createObserved({ agentState: 'IDLE' }) })
  const { user } = await renderSection(server7, { settings: { 7: setting }, failWrites: { status: 500, message: 'runner 가 응답하지 않습니다' } })
  await user.click(await screen.findByTestId('agent-runtime-restart'))
  expect(await screen.findByText('runner 가 응답하지 않습니다')).toBeInTheDocument()
  expect(screen.queryByText('AI 를 다시 시작합니다')).not.toBeInTheDocument()
})
