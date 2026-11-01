// 설정 › 에이전트 목록 「실행」 열(WP-1255) — 화면 컴포넌트 테스트.
// 실행 요약(summaries)에 따라 셀 문구가 갈린다: 기본 템플릿 내부 AI 는 「내부」만, 외부는 키 사용 시각, 작업 공간 템플릿(Claude Code)은
// 「내부 · Claude Code」 + 상태 알약 + 이슈 키·다음 확인·실패 사유 + 기본이 아닌 위치 이름. 상세 드로어는 작업 공간 AI 의 AI 연결·키 섹션을 숨긴다.
import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'

import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import {
  agentRuntimeApi,
  createAgent,
  createObserved,
  createSetting,
  createSummary,
  type RuntimeApiOptions,
} from '../../test/kits/admin/agentRuntime'
import AgentManagementPage from './AgentManagementPage'

const AGENTS: AgentResponse[] = [
  createAgent(21, { username: 'plain', name: '기본봇' }),
  createAgent(22, { username: 'ext', name: '외부봇', runtime: 'EXTERNAL', lastKeyUsedAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
  // 작업 공간 템플릿 AI 는 DB 에 EXTERNAL 로 저장된다.
  createAgent(23, { username: 'working', name: '작업봇', runtime: 'EXTERNAL' }),
  createAgent(24, { username: 'pending', name: '대기봇', runtime: 'EXTERNAL' }),
  createAgent(25, { username: 'failed', name: '실패봇', runtime: 'EXTERNAL' }),
  createAgent(26, { username: 'blocked', name: '막힘봇', runtime: 'EXTERNAL' }),
  createAgent(27, { username: 'off', name: '꺼짐봇', runtime: 'EXTERNAL' }),
]

const SUMMARIES = [
  createSummary(23, { status: 'RUNNING', agentState: 'WORKING', agentIssueKey: 'WD-319' }),
  createSummary(24, { status: 'APPLY_PENDING', agentState: 'IDLE', agentNextCheckAt: '2026-11-02T03:30:00Z' }),
  createSummary(25, { status: 'FAILED', locationName: 'PoC', message: '이미지를 받지 못했습니다 (ImagePullBackOff)' }),
  createSummary(26, { status: 'RUNNING', agentState: 'BLOCKED', agentIssueKey: 'WP-1203' }),
  createSummary(27, { status: 'OFF' }),
]

const ROLE = createRole({ id: 3, name: 'AGENT', description: 'AI 에이전트', isSystem: true })

/** 목록 화면 — 에이전트 목록·요약·(드로어가 부르는) 계정·역할·키·AI 연결 조회. */
async function renderList(opts: { summaries?: typeof SUMMARIES; settings?: RuntimeApiOptions['settings'] } = {}) {
  const runtime = agentRuntimeApi({ summaries: opts.summaries ?? SUMMARIES, settings: opts.settings })
  const handlers = [
    http.get('/api/v1/admin/agents', () => HttpResponse.json(AGENTS)),
    http.get('/api/v1/admin/workspace-assistant', () =>
      HttpResponse.json({ agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null }),
    ),
    http.get('/api/v1/users/:id', ({ params }) => {
      const a = AGENTS.find((x) => x.id === Number(params.id))!
      return HttpResponse.json(createUserDetail({ id: a.id, username: a.username, name: a.name, kind: 'AGENT', roles: [ROLE] }))
    }),
    http.get('/api/v1/roles', () => HttpResponse.json([ROLE])),
    http.get('/api/v1/admin/agents/:id/keys', () => HttpResponse.json([])),
    ...runtime.handlers,
  ]
  const view = renderScreen(<AgentManagementPage />, { path: '/settings/agents', handlers })
  await screen.findByTestId('agent-row-21')
  return { ...view, ...runtime }
}

const cell = (id: number) => screen.getByTestId(`agent-runtime-cell-${id}`)

test('기본 템플릿 내부 AI 는 「내부」만 보이고 상태·키 사용 문구가 없다', async () => {
  await renderList()
  expect(cell(21)).toHaveTextContent(/^내부$/)
  expect(screen.queryByTestId('agent-runtime-status-21')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-key-status-21')).not.toBeInTheDocument()
})

test('외부 AI(실행 설정 없음)는 「외부」와 키 사용 시각을 보인다', async () => {
  await renderList()
  expect(cell(22)).toHaveTextContent('외부')
  expect(screen.getByTestId('agent-key-status-22')).toHaveTextContent('키 사용 5분 전')
  expect(screen.queryByTestId('agent-runtime-status-22')).not.toBeInTheDocument()
})

test('작업 중 — 「내부 · Claude Code」 배지, 알약, 이슈 키(고정폭), 위치 이름은 없다', async () => {
  await renderList()
  expect(cell(23)).toHaveTextContent('내부 · Claude Code')
  expect(screen.getByTestId('agent-runtime-status-23')).toHaveTextContent('작업 중')
  const detail = screen.getByTestId('agent-runtime-detail-23')
  expect(detail).toHaveTextContent('WD-319')
  expect(detail).toHaveClass('font-mono')
  expect(screen.queryByTestId('agent-runtime-location-23')).not.toBeInTheDocument()
  // 외부 키 사용 문구는 작업 공간 AI 에게는 없다(DB 가 EXTERNAL 이어도).
  expect(screen.queryByTestId('agent-key-status-23')).not.toBeInTheDocument()
})

test('적용 대기 AI 가 대기 중이면 「다음 확인 HH:mm」(KST)을 보인다', async () => {
  await renderList()
  expect(screen.getByTestId('agent-runtime-status-24')).toHaveTextContent('대기')
  expect(screen.getByTestId('agent-runtime-detail-24')).toHaveTextContent('다음 확인 12:30')
})

test('실패 — 알약 「실패」, 사유(빨간 글씨), 기본이 아닌 위치 이름', async () => {
  await renderList()
  expect(screen.getByTestId('agent-runtime-status-25')).toHaveTextContent('실패')
  const detail = screen.getByTestId('agent-runtime-detail-25')
  expect(detail).toHaveTextContent('이미지를 받지 못했습니다 (ImagePullBackOff)')
  expect(detail).toHaveClass('text-destructive')
  expect(screen.getByTestId('agent-runtime-location-25')).toHaveTextContent('PoC')
})

test('막힘 — 알약 「막힘」과 이슈 키', async () => {
  await renderList()
  expect(screen.getByTestId('agent-runtime-status-26')).toHaveTextContent('막힘')
  expect(screen.getByTestId('agent-runtime-detail-26')).toHaveTextContent('WP-1203')
})

test('꺼짐 — 알약만 있고 한 줄 설명은 없다', async () => {
  await renderList()
  expect(cell(27)).toHaveTextContent('내부 · Claude Code')
  expect(screen.getByTestId('agent-runtime-status-27')).toHaveTextContent('꺼짐')
  expect(screen.queryByTestId('agent-runtime-detail-27')).not.toBeInTheDocument()
})

test('작업 공간 AI 상세 — 실행 방식 섹션은 있고 AI 연결·키 섹션은 숨긴다', async () => {
  const { user } = await renderList({ settings: { 23: createSetting(23, { status: 'RUNNING', desired: 'RUN', observed: createObserved({ agentState: 'WORKING', agentIssueKey: 'WD-319' }) }) } })
  await user.click(screen.getByTestId('agent-row-23'))
  const drawer = await screen.findByTestId('agent-detail-drawer')
  await waitFor(() => expect(drawer).toContainElement(screen.getByTestId('agent-workspace-runtime')))
  expect(screen.queryByTestId('agent-connection-section')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-keys-block')).not.toBeInTheDocument()
})

test('외부 AI 상세 — 외부 연결 안내가 보이고 작업 공간 설정은 없다', async () => {
  const { user } = await renderList()
  await user.click(screen.getByTestId('agent-row-22'))
  await screen.findByTestId('agent-detail-drawer')
  expect(await screen.findByTestId('agent-work-loop-launch-command')).toBeInTheDocument()
  expect(screen.queryByTestId('agent-workspace-runtime')).not.toBeInTheDocument()
})

test('기본 템플릿 내부 AI 상세 — AI 연결·키 섹션이 그대로 보인다', async () => {
  const { user } = await renderList()
  await user.click(screen.getByTestId('agent-row-21'))
  await screen.findByTestId('agent-detail-drawer')
  expect(await screen.findByTestId('agent-connection-section')).toBeInTheDocument()
  expect(screen.getByTestId('agent-keys-block')).toBeInTheDocument()
})
