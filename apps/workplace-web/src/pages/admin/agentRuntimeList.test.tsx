// 설정 › 에이전트 목록 「실행」 열(WP-1255, 배지는 WP-1281 에서 서버 판정 runMode 기준) — 화면 컴포넌트 테스트.
// 셀 문구는 runMode 와 실행 요약(summaries)으로 갈린다: SERVER 는 「기본」만, EXTERNAL 은 「외부」+ 마지막 접속 시각,
// WORKSPACE(Claude Code)는 방식 이름 배지 + 상태 알약 + 이슈 키·다음 확인·실패 사유 + 기본이 아닌 실행 환경 이름.
// 행을 누르면 시트가 아니라 상세 페이지(/settings/agents/:id)로 이동한다(상세 섹션은 agentDetailPage.test.tsx).
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'

import {
  agentRuntimeApi,
  createAgent,
  createSummary,
  type RuntimeApiOptions,
} from '../../test/kits/admin/agentRuntime'
import AgentManagementPage from './AgentManagementPage'

const AGENTS: AgentResponse[] = [
  createAgent(21, { username: 'plain', name: '기본봇' }),
  // 외부인데 아직 한 번도 접속하지 않은 AI
  createAgent(28, { username: 'fresh', name: '새외부봇', runtime: 'EXTERNAL', runMode: 'EXTERNAL' }),
  createAgent(22, { username: 'ext', name: '외부봇', runtime: 'EXTERNAL', runMode: 'EXTERNAL', lastKeyUsedAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
  // 작업 공간 AI 는 DB 에 EXTERNAL 로 저장되지만 서버가 runMode=WORKSPACE 로 판정해 내려준다.
  createAgent(23, { username: 'working', name: '작업봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
  createAgent(24, { username: 'pending', name: '대기봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
  createAgent(25, { username: 'failed', name: '실패봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
  createAgent(26, { username: 'blocked', name: '막힘봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
  createAgent(27, { username: 'off', name: '꺼짐봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
  createAgent(40, { username: 'multi', name: '다칸봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
]

const SUMMARIES = [
  createSummary(23, { status: 'RUNNING', agentState: 'WORKING', agentIssueKey: 'WD-319' }),
  createSummary(24, { status: 'APPLY_PENDING', agentState: 'IDLE', agentNextCheckAt: '2026-11-02T03:30:00Z' }),
  createSummary(25, { status: 'FAILED', locationName: 'PoC', message: '이미지를 받지 못했습니다 (ImagePullBackOff)' }),
  createSummary(26, { status: 'RUNNING', agentState: 'BLOCKED', agentIssueKey: 'WP-1203' }),
  createSummary(27, { status: 'OFF' }),
  createSummary(40, { status: 'RUNNING', agentState: 'WORKING', agentIssueKey: 'HR-2', agentIssueKeys: ['HR-2', 'WP-1'] }),
]

/** 목록 화면 — 에이전트 목록·요약·공통 비서 조회. */
async function renderList(opts: { summaries?: typeof SUMMARIES; settings?: RuntimeApiOptions['settings'] } = {}) {
  const runtime = agentRuntimeApi({ summaries: opts.summaries ?? SUMMARIES, settings: opts.settings })
  const handlers = [
    http.get('/api/v1/admin/agents', () => HttpResponse.json(AGENTS)),
    http.get('/api/v1/admin/workspace-assistant', () =>
      HttpResponse.json({ agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null }),
    ),
    ...runtime.handlers,
  ]
  const view = renderScreen(<AgentManagementPage />, { path: '/settings/agents', handlers })
  await screen.findByTestId('agent-row-21')
  return { ...view, ...runtime }
}

const cell = (id: number) => screen.getByTestId(`agent-runtime-cell-${id}`)

test('기본(SERVER) AI 는 「기본」만 보이고 상태·접속 문구가 없다', async () => {
  await renderList()
  expect(cell(21)).toHaveTextContent(/^기본$/)
  expect(screen.queryByTestId('agent-runtime-status-21')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-key-status-21')).not.toBeInTheDocument()
})

test('외부 AI 는 「외부」와 마지막 접속 시각을 보이고, 접속한 적이 없으면 「아직 접속 안 함」이다', async () => {
  await renderList()
  expect(cell(22)).toHaveTextContent('외부')
  expect(screen.getByTestId('agent-key-status-22')).toHaveTextContent('마지막 접속 5분 전')
  expect(screen.queryByTestId('agent-runtime-status-22')).not.toBeInTheDocument()
  expect(screen.getByTestId('agent-key-status-28')).toHaveTextContent('아직 접속 안 함')
})

test('작업 중 — 「Claude Code」 배지(내부 표기 없음), 알약, 이슈 키(고정폭), 위치 이름은 없다', async () => {
  await renderList()
  expect(cell(23)).toHaveTextContent('Claude Code')
  expect(cell(23)).not.toHaveTextContent('내부')
  expect(screen.getByTestId('agent-runtime-status-23')).toHaveTextContent('작업 중')
  const detail = screen.getByTestId('agent-runtime-detail-23')
  expect(detail).toHaveTextContent('WD-319')
  expect(detail).toHaveClass('font-mono')
  expect(screen.queryByTestId('agent-runtime-location-23')).not.toBeInTheDocument()
  // 외부 키 사용 문구는 작업 공간 AI 에게는 없다(DB 가 EXTERNAL 이어도).
  expect(screen.queryByTestId('agent-key-status-23')).not.toBeInTheDocument()
})

test('적용 대기 AI 가 쉬는 중이면 「다음 확인 HH:mm」(KST)을 보인다', async () => {
  await renderList()
  expect(screen.getByTestId('agent-runtime-status-24')).toHaveTextContent('쉬는 중')
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

test('여러 칸이 일하면 「HR-2 외 1건」, title 에 키를 모두 (WP-1409)', async () => {
  await renderList()
  const detail = screen.getByTestId('agent-runtime-detail-40')
  expect(detail).toHaveTextContent('HR-2 외 1건')
  expect(detail).toHaveAttribute('title', 'HR-2, WP-1')
})

test('꺼짐 — 알약만 있고 한 줄 설명은 없다', async () => {
  await renderList()
  expect(cell(27)).toHaveTextContent('Claude Code')
  expect(screen.getByTestId('agent-runtime-status-27')).toHaveTextContent('꺼짐')
  expect(screen.queryByTestId('agent-runtime-detail-27')).not.toBeInTheDocument()
})

test('행을 누르면 시트 대신 상세 페이지(/settings/agents/:id)로 이동한다', async () => {
  const { user, location } = await renderList()
  await user.click(screen.getByTestId('agent-row-23'))
  expect(location()).toBe('/settings/agents/23')
})
