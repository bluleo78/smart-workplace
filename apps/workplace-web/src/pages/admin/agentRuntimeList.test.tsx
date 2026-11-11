// 설정 › 에이전트 목록의 실행 관련 세 열 「실행 방식 | 상태 | 실행 환경」(WP-1255 → WP-1513 에서 한 열을 셋으로, 배지는 WP-1281 의 runMode 기준)
// — 화면 컴포넌트 테스트. 칸 문구는 runMode 와 실행 요약(summaries)으로 갈린다: SERVER 는 「기본」·「—」·「—」, EXTERNAL 은 「외부」·마지막 접속 시각·「—」,
// WORKSPACE(Claude Code)는 방식 이름 배지 · 상태 알약 + 이슈 키·다음 확인·실패 사유 · 실행 환경 이름(기본 환경이어도).
// 「실행 방식」 옆 「계정」 열(WP-1513)은 계정 목록(GET /admin/agent-accounts)의 쓰는 AI 로 묶인 계정 이름을 보인다.
// 행을 누르면 시트가 아니라 상세 페이지(/settings/agents/:id)로 이동한다(상세 섹션은 agentDetailPage.test.tsx).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'
import type { AgentAccountResponse } from '@/types/agentAccount'

import { createAccount } from '../../test/kits/admin/agentAccounts'
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
  createAgent(26, { username: 'blocked', name: '차단봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
  createAgent(27, { username: 'off', name: '종료봇', runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
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

/** 계정 목록 — 23·24 는 API 키 계정(이메일 없음), 21(기본 AI)은 로그인 계정(이메일 있음). 나머지는 안 묶임. */
const ACCOUNTS: AgentAccountResponse[] = [
  createAccount({
    id: 1,
    label: 'Claude 팀 계정',
    agents: [
      { userId: 23, username: 'working', name: '작업봇' },
      { userId: 24, username: 'pending', name: '대기봇' },
    ],
  }),
  createAccount({
    id: 2,
    provider: 'chatgpt',
    label: 'ChatGPT 로그인',
    accountEmail: 'ai@example.com',
    agents: [{ userId: 21, username: 'plain', name: '기본봇' }],
  }),
]

/** 실패시킨 계정 목록 요청 수 — 실패 응답이 실제로 간 뒤의 화면을 보려고 센다. */
let accountFailures = 0

/** 목록 화면 — 에이전트 목록·요약·공통 비서·계정 목록 조회. failAccounts 면 계정 목록 요청이 그 상태로 실패한다. */
async function renderList(
  opts: { summaries?: typeof SUMMARIES; settings?: RuntimeApiOptions['settings']; accounts?: AgentAccountResponse[]; failAccounts?: number } = {},
) {
  const runtime = agentRuntimeApi({
    summaries: opts.summaries ?? SUMMARIES,
    settings: opts.settings,
    accounts: opts.accounts ?? ACCOUNTS,
  })
  const handlers = [
    // 실패 핸들러를 앞에 두어 키트의 계정 목록 핸들러보다 먼저 걸리게 한다.
    ...(opts.failAccounts
      ? [
          http.get('/api/v1/admin/agent-accounts', () => {
            accountFailures += 1
            return HttpResponse.json({ message: '권한 없음' }, { status: opts.failAccounts })
          }),
        ]
      : []),
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
const stateCell = (id: number) => screen.getByTestId(`agent-runtime-state-cell-${id}`)
const locationCell = (id: number) => screen.getByTestId(`agent-runtime-location-cell-${id}`)
const accountCell = (id: number) => screen.getByTestId(`agent-account-cell-${id}`)

test('「실행」 한 열 대신 「실행 방식 | 계정 | 상태 | 실행 환경」 열이고 나머지 열은 그대로다 (WP-1513)', async () => {
  await renderList()
  const table = screen.getByRole('table', { name: '에이전트 목록' })
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((h) => h.textContent)
  expect(headers).toEqual(['에이전트', '아이디', '유형', '실행 방식', '계정', '상태', '실행 환경', '생성일'])
})

test('「계정」 칸 — 묶인 계정 이름을 보이고, 이메일 없는 계정은 이름 전체를 title 로 (WP-1513)', async () => {
  await renderList()
  const account = await within(accountCell(23)).findByTestId('agent-account-23')
  expect(account).toHaveTextContent(/^Claude 팀 계정$/)
  expect(account).toHaveAttribute('title', 'Claude 팀 계정')
  // 한 계정을 여러 AI 가 쓰면 각 행에 같은 이름이 보인다.
  expect(within(accountCell(24)).getByTestId('agent-account-24')).toHaveTextContent('Claude 팀 계정')
})

test('「계정」 칸 — 로그인 계정이면 title 에 이름과 이메일, 기본 방식 AI 도 묶여 있으면 보인다 (WP-1513)', async () => {
  await renderList()
  const account = await within(accountCell(21)).findByTestId('agent-account-21')
  expect(account).toHaveTextContent(/^ChatGPT 로그인$/)
  expect(account).toHaveAttribute('title', 'ChatGPT 로그인 (ai@example.com)')
})

test('「계정」 칸 — 묶인 계정이 없으면 「—」 (WP-1513)', async () => {
  await renderList()
  await screen.findByTestId('agent-account-23')
  expect(accountCell(22)).toHaveTextContent(/^—$/)
  expect(screen.queryByTestId('agent-account-22')).not.toBeInTheDocument()
})

test('계정 목록을 못 읽으면 「계정」 칸은 모두 「—」이고 목록은 그대로 보인다 (WP-1513)', async () => {
  accountFailures = 0
  await renderList({ failAccounts: 403 })
  // 실패 응답이 간 뒤에도(받는 중이라 비어 있는 게 아니라) 「—」인지 본다.
  await waitFor(() => expect(accountFailures).toBeGreaterThan(0))
  // 목록·다른 열은 그대로.
  expect(cell(23)).toHaveTextContent(/^Claude Code$/)
  expect(screen.getByTestId('agent-row-27')).toBeInTheDocument()
  expect(accountCell(21)).toHaveTextContent(/^—$/)
  expect(accountCell(23)).toHaveTextContent(/^—$/)
  expect(screen.queryByTestId('agent-account-23')).not.toBeInTheDocument()
})

test('기본(SERVER) AI 는 「기본」만 보이고 상태·실행 환경 칸은 「—」다', async () => {
  await renderList()
  expect(cell(21)).toHaveTextContent(/^기본$/)
  expect(stateCell(21)).toHaveTextContent(/^—$/)
  expect(locationCell(21)).toHaveTextContent(/^—$/)
  expect(screen.queryByTestId('agent-runtime-status-21')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-key-status-21')).not.toBeInTheDocument()
})

test('외부 AI 는 「외부」, 상태 칸에 마지막 접속 시각(접속한 적이 없으면 「아직 접속 안 함」), 실행 환경은 「—」', async () => {
  await renderList()
  expect(cell(22)).toHaveTextContent(/^외부$/)
  expect(within(stateCell(22)).getByTestId('agent-key-status-22')).toHaveTextContent('마지막 접속 5분 전')
  expect(locationCell(22)).toHaveTextContent(/^—$/)
  expect(screen.queryByTestId('agent-runtime-status-22')).not.toBeInTheDocument()
  expect(screen.getByTestId('agent-key-status-28')).toHaveTextContent('아직 접속 안 함')
})

test('작업 중 — 「Claude Code」 배지(내부 표기 없음), 상태 칸에 알약·이슈 키(고정폭), 기본 실행 환경도 이름을 보인다', async () => {
  await renderList()
  expect(cell(23)).toHaveTextContent(/^Claude Code$/)
  expect(within(stateCell(23)).getByTestId('agent-runtime-status-23')).toHaveTextContent('작업 중')
  const detail = within(stateCell(23)).getByTestId('agent-runtime-detail-23')
  expect(detail).toHaveTextContent('WD-319')
  expect(detail).toHaveClass('font-mono')
  // 기본 위치(서버가 이름을 싣는다)여도 실행 환경 칸에 이름이 보인다(WP-1513).
  expect(within(locationCell(23)).getByTestId('agent-runtime-location-23')).toHaveTextContent('기본 클러스터')
  // 외부 키 사용 문구는 작업 공간 AI 에게는 없다(DB 가 EXTERNAL 이어도).
  expect(screen.queryByTestId('agent-key-status-23')).not.toBeInTheDocument()
})

test('적용 대기 AI 가 대기 중이면 「다음 확인 HH:mm」(KST)을 보인다', async () => {
  await renderList()
  expect(screen.getByTestId('agent-runtime-status-24')).toHaveTextContent('대기 중')
  expect(screen.getByTestId('agent-runtime-detail-24')).toHaveTextContent('다음 확인 12:30')
})

test('오류 — 알약 「오류」, 사유(빨간 글씨, 잘리면 title 로 전부), 지정한 위치 이름', async () => {
  await renderList()
  expect(screen.getByTestId('agent-runtime-status-25')).toHaveTextContent('오류')
  const detail = screen.getByTestId('agent-runtime-detail-25')
  expect(detail).toHaveTextContent('이미지를 받지 못했습니다 (ImagePullBackOff)')
  expect(detail).toHaveClass('text-destructive', 'truncate')
  expect(detail).toHaveAttribute('title', '이미지를 받지 못했습니다 (ImagePullBackOff)')
  expect(locationCell(25)).toHaveTextContent(/^PoC$/)
})

test('Works 실행 AI 라도 실행 위치 이름이 없으면(기본 위치 없음) 실행 환경 칸은 「—」다', async () => {
  await renderList({ summaries: [createSummary(23, { status: 'OFF', locationName: null })] })
  expect(locationCell(23)).toHaveTextContent(/^—$/)
  expect(screen.queryByTestId('agent-runtime-location-23')).not.toBeInTheDocument()
})

test('차단됨 — 알약 「차단됨」과 이슈 키', async () => {
  await renderList()
  expect(screen.getByTestId('agent-runtime-status-26')).toHaveTextContent('차단됨')
  expect(screen.getByTestId('agent-runtime-detail-26')).toHaveTextContent('WP-1203')
})

test('여러 칸이 일하면 「HR-2 외 1건」, title 에 키를 모두 (WP-1409)', async () => {
  await renderList()
  const detail = screen.getByTestId('agent-runtime-detail-40')
  expect(detail).toHaveTextContent('HR-2 외 1건')
  expect(detail).toHaveAttribute('title', 'HR-2, WP-1')
})

test('종료됨 — 알약만 있고 한 줄 설명은 없다', async () => {
  await renderList()
  expect(cell(27)).toHaveTextContent('Claude Code')
  expect(screen.getByTestId('agent-runtime-status-27')).toHaveTextContent('종료됨')
  expect(screen.queryByTestId('agent-runtime-detail-27')).not.toBeInTheDocument()
})

test('행을 누르면 시트 대신 상세 페이지(/settings/agents/:id)로 이동한다', async () => {
  const { user, location } = await renderList()
  await user.click(screen.getByTestId('agent-row-23'))
  expect(location()).toBe('/settings/agents/23')
})

test('「새 작업 받기」를 끈 AI 는 상태 칸에 「새 작업 안 받음」, 켠 AI 는 없다 (WP-1514)', async () => {
  await renderList({
    summaries: [
      createSummary(23, { status: 'RUNNING', agentState: 'WORKING', agentIssueKey: 'WD-319', acceptNewWork: false }),
      createSummary(24, { status: 'RUNNING', agentState: 'IDLE', acceptNewWork: true }),
    ],
  })
  expect(within(stateCell(23)).getByTestId('agent-new-work-paused-23')).toHaveTextContent('새 작업 안 받음')
  expect(within(stateCell(24)).queryByText('새 작업 안 받음')).not.toBeInTheDocument()
})

test('종료됐거나 종료 중인 AI 는 「새 작업 받기」가 꺼져 있어도 배지가 없다 (WP-1514)', async () => {
  await renderList({
    summaries: [
      createSummary(23, { status: 'OFF', acceptNewWork: false }),
      createSummary(24, { status: 'STOPPING', acceptNewWork: false }),
    ],
  })
  expect(within(stateCell(23)).queryByText('새 작업 안 받음')).not.toBeInTheDocument()
  expect(within(stateCell(24)).queryByText('새 작업 안 받음')).not.toBeInTheDocument()
})
