// 에이전트 상세 페이지(/settings/agents/:id, WP-1281) — 서버가 판정한 runMode(SERVER·WORKSPACE·EXTERNAL)와 유형(개인·공통)에 따라
// 어떤 섹션·묶음이 그려지는지, 실행 시작이 막히는 이유(맡는 프로젝트 0 등), 다음 교체 시각, 404 상태를 본다.
// 확인창·PUT payload 같은 섹션별 동작은 agentManagement.test.tsx, 설정 가이드 따라가기는 settingsGuide.test.tsx 가 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { formatDateMonthDayPadded } from '@/lib/formatters'
import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'
import type { AgentApiKey } from '@/types/agentKey'
import type { AgentRepoCredential } from '@/types/agentRuntime'

import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import {
  agentRuntimeApi,
  CLAUDE_TEMPLATE,
  CODEX_TEMPLATE,
  createAgent,
  createLocation,
  createObserved,
  createSetting,
  DEFAULT_TEMPLATE,
  PROJECTS,
  type RuntimeApiOptions,
  TEMPLATES,
} from '../../test/kits/admin/agentRuntime'
import AgentDetailPage from './AgentDetailPage'

const ROLE = createRole({ id: 3, name: 'AGENT', description: 'AI 에이전트', isSystem: true })

/** 섹션 앵커 id — 화면 SettingsSection 과 설정 가이드가 같은 값을 쓴다(AGENT_DETAIL_SECTION_IDS). */
const SECTION = ['agent-status', 'agent-profile', 'agent-roles', 'agent-work', 'agent-run', 'agent-repos', 'agent-danger'] as const

/** 지금 화면에 있는 섹션 id 들(화면 순서). */
const presentSections = () => SECTION.filter((id) => document.getElementById(id) != null)

const NOW_KEY: AgentApiKey = {
  id: 1, userId: 0, keyPrefix: 'ak_old', label: null, createdBy: null, createdAt: '2026-10-01T00:00:00Z',
  lastUsedAt: null, revokedAt: null, managed: true, expiresAt: '2026-11-30T12:00:00Z',
}

/** 저장소 토큰 메타 — 등록 11-02, 최근 사용은 5분 전(없으면 null). */
function repoCred(id: number, host: string, over: Partial<AgentRepoCredential> = {}): AgentRepoCredential {
  return { id, kind: host.includes('github') ? 'GITHUB' : 'GITLAB', host, createdAt: '2026-11-02T01:00:00Z', lastUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(), ...over }
}

interface Opts extends RuntimeApiOptions {
  agent: AgentResponse
  /** 접속 키 목록 */
  keys?: AgentApiKey[]
  /** 단건 조회 응답을 바꾼다(실패 흉내) — 없으면 agent 를 준다. */
  agentResponse?: () => Response
  /** 그린 뒤 기다릴 testid(기본 agent-detail-page). */
  readyTestId?: string
  /** 모델 목록(/admin/agents/:id/models) 응답 — 없으면 빈 목록(계정 없음 모양). */
  models?: () => Response
}

/** 상세 페이지 — 에이전트 한 명·계정·역할·키·공통 비서와 AI 실행 API 를 준다. */
async function renderDetail({ agent, keys = [], agentResponse, readyTestId = 'agent-detail-page', models, ...runtimeOpts }: Opts) {
  const runtime = agentRuntimeApi(runtimeOpts)
  /** 모델 목록 조회 횟수 — 계정 모델 칸이 없는 방식은 부르지 않는지 본다. */
  const modelCalls = { count: 0 }
  const handlers = [
    http.get('/api/v1/admin/agents/:id', ({ params }) =>
      agentResponse
        ? agentResponse()
        : Number(params.id) === agent.id
          ? HttpResponse.json(agent)
          : HttpResponse.json({ message: '없음' }, { status: 404 }),
    ),
    http.get('/api/v1/admin/workspace-assistant', () =>
      HttpResponse.json({
        agentUserId: agent.type === 'WORKSPACE' ? agent.id : null,
        agentName: agent.type === 'WORKSPACE' ? agent.name : null,
        hasActiveToken: false,
        model: null,
        thinkingDepth: null,
      }),
    ),
    http.get('/api/v1/users/:id', () =>
      HttpResponse.json(createUserDetail({ id: agent.id, username: agent.username, name: agent.name, kind: 'AGENT', roles: [ROLE] })),
    ),
    http.get('/api/v1/roles', () => HttpResponse.json([ROLE])),
    http.get('/api/v1/admin/agents/:id/keys', () => HttpResponse.json(keys)),
    http.get('/api/v1/admin/agents/:id/models', () => {
      modelCalls.count += 1
      return models ? models() : HttpResponse.json({ models: [] })
    }),
    ...runtime.handlers,
  ]
  const view = renderScreen(
    <AIAssistantProvider hotkeysEnabled={false}>
      <Routes>
        <Route path="/settings/agents/:id" element={<AgentDetailPage />} />
      </Routes>
    </AIAssistantProvider>,
    { path: `/settings/agents/${agent.id}`, handlers },
  )
  await screen.findByTestId(readyTestId)
  return { ...view, ...runtime, modelCalls }
}

describe('실행 방식별 섹션 구성', () => {
  test('SERVER(기본) — 저장소 섹션 없이 6개, 실행은 AI 계정·접속 키(발급 폼)이고 작업 설정·마지막 접속은 없다', async () => {
    await renderDetail({ agent: createAgent(100, { name: '내부봇', username: 'ai-dev' }) })
    await screen.findByTestId('agent-ai-account-group')
    expect(presentSections()).toEqual(['agent-status', 'agent-profile', 'agent-roles', 'agent-work', 'agent-run', 'agent-danger'])
    // 머리 배지는 방식 이름(기본)
    expect(screen.getByTestId('agent-detail-page')).toHaveTextContent('@ai-dev')
    expect(screen.getByRole('radio', { name: /기본/ })).toBeChecked()
    expect(screen.queryByTestId('agent-work-settings-group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-last-access')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-run-group')).not.toBeInTheDocument()
    expect(await screen.findByTestId('key-issue-form')).toBeInTheDocument()
    // 공통 비서 묶음 — 일반 AI 는 지정할 수 있다.
    expect(await screen.findByTestId('agent-assistant-group')).toBeInTheDocument()
  })

  test('WORKSPACE(Claude Code) — 상태에 실행 묶음, 실행에 AI 계정·작업 설정·접속 키(Works 가 관리), 저장소 섹션이 있다', async () => {
    const id = 200
    await renderDetail({
      agent: createAgent(id, { runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
      settings: { [id]: createSetting(id) },
      claudeFor: [id],
    })
    expect(await screen.findByTestId('agent-run-group')).toBeInTheDocument()
    await screen.findByTestId('agent-work-settings-group')
    expect(presentSections()).toEqual([...SECTION])
    expect(await screen.findByTestId('agent-ai-account-group')).toBeInTheDocument()
    expect(screen.getByTestId('agent-managed-keys-group')).toBeInTheDocument()
    // 접속 키는 Works 가 관리한다 — 발급 폼이 없다.
    expect(screen.queryByTestId('key-issue-form')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-last-access')).not.toBeInTheDocument()
    // 머리 배지 = 저장된 방식의 카드 제목
    expect(screen.getByTestId('agent-detail-page')).toHaveTextContent('Claude Code')
    // 작업 설정 칸은 방식 정의대로(모델·대기열 라벨 + 실행 환경)
    expect(screen.getByTestId('agent-runtime-config-model')).toBeInTheDocument()
    expect(screen.getByTestId('agent-runtime-config-queue')).toHaveValue('AI 개발팀')
    expect(screen.getByTestId('agent-runtime-location')).toBeInTheDocument()
    expect(await screen.findByTestId('agent-runtime-projects')).toHaveTextContent('WD')
  })

  test('EXTERNAL — 상태에 마지막 접속, 실행에 접속 키(발급 폼)·가이드 안내, 저장소 섹션이 있고 AI 계정·작업 설정은 없다', async () => {
    await renderDetail({ agent: createAgent(300, { runtime: 'EXTERNAL', runMode: 'EXTERNAL', username: 'ext' }) })
    expect(await screen.findByTestId('external-connect-card')).toBeInTheDocument()
    expect(presentSections()).toEqual([...SECTION])
    expect(screen.getByTestId('agent-last-access')).toHaveTextContent('아직 접속 안 함')
    expect(screen.queryByTestId('agent-ai-account-group')).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-work-settings-group')).not.toBeInTheDocument()
    expect(await screen.findByTestId('key-issue-form')).toBeInTheDocument()
  })

  test('EXTERNAL 에서 접속한 적이 있으면 마지막 접속을 상대 시각으로 보이고 연결 방법 안내는 없다', async () => {
    const used = { ...NOW_KEY, id: 5, managed: false, expiresAt: null, lastUsedAt: new Date(Date.now() - 5 * 60_000).toISOString() }
    await renderDetail({
      agent: createAgent(300, { runtime: 'EXTERNAL', runMode: 'EXTERNAL', lastKeyUsedAt: used.lastUsedAt }),
      keys: [used],
    })
    expect(await screen.findByTestId('agent-last-access')).toHaveTextContent('마지막 접속 5분 전')
    await screen.findByTestId('key-row-5')
    expect(screen.queryByTestId('external-connect-guide-hint')).not.toBeInTheDocument()
  })

  test('개인 비서 — 역할·저장소·위험 구역이 없고 사용 스위치는 「주인이 관리」로 막히며, 실행 카드는 기본으로 고정된다', async () => {
    await renderDetail({ agent: createAgent(400, { type: 'PERSONAL', ownerName: '홍길동', name: '홍길동의 비서' }) })
    await screen.findByTestId('agent-ai-account-group')
    expect(presentSections()).toEqual(['agent-status', 'agent-profile', 'agent-work', 'agent-run'])
    expect(screen.getByRole('switch', { name: '사용' })).toBeDisabled()
    expect(screen.getByTestId('agent-use-toggle')).toHaveTextContent('주인이 관리해요')
    expect(screen.getByTestId('agent-run-mode-lock')).toHaveTextContent('개인 비서는 기본 방식으로만 돌아요')
    expect(screen.getByTestId('agent-run-mode-EXTERNAL')).toBeDisabled()
    // 공통 비서 지정 블록 없음(예전 지정이 남지 않은 개인 비서)
    expect(screen.queryByTestId('agent-assistant-group')).not.toBeInTheDocument()
    // 맡은 일·지시는 보기만
    expect(screen.getByLabelText('맡은 일')).toBeDisabled()
    expect(screen.getByLabelText('지시')).toBeDisabled()
    expect(screen.queryByTestId('agent-duty-save')).not.toBeInTheDocument()
  })

  test('개인 비서의 키 안내 — 쓸 수 있는 키가 없으면 폐기하라는 말을 붙이지 않고, 남은 키가 있으면 붙인다(WP-1162)', async () => {
    const personal = createAgent(400, { type: 'PERSONAL', ownerName: '홍길동', name: '홍길동의 비서' })
    const { unmount } = await renderDetail({ agent: personal, keys: [] })
    const note = await screen.findByTestId('key-issue-blocked')
    await screen.findByText(/아직 발급한 키가 없어요/)
    expect(note).toHaveTextContent('개인 비서의 키는 관리자가 발급할 수 없어요.')
    expect(note).not.toHaveTextContent('폐기해 정리하세요')
    unmount()

    await renderDetail({ agent: personal, keys: [{ ...NOW_KEY, id: 7, managed: false, expiresAt: null }] })
    await waitFor(() => expect(screen.getByTestId('key-issue-blocked')).toHaveTextContent('남은 키로는 접속되지 않으니 폐기해 정리하세요.'))
  })

  test('공통 비서 — 실행 방식은 「기본」 고정(다른 카드는 막힘)이고 공통 비서 묶음에 지정됨이 보인다', async () => {
    await renderDetail({ agent: createAgent(500, { type: 'WORKSPACE', name: '공통봇' }) })
    expect(await screen.findByTestId('workspace-assistant-current')).toHaveTextContent('지정됨')
    expect(presentSections()).toEqual(['agent-status', 'agent-profile', 'agent-roles', 'agent-work', 'agent-run', 'agent-danger'])
    expect(screen.getByTestId('agent-run-mode-SERVER')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('agent-run-mode-EXTERNAL')).toBeDisabled()
    expect(screen.getByTestId('agent-run-mode-claude-code')).toBeDisabled()
    expect(screen.getByRole('switch', { name: '사용' })).toBeDisabled()
  })
})

describe('Works 실행 AI — 실행 시작 막힘·접속 키 교체 시각', () => {
  const id = 200
  const works = (over: Partial<Opts> = {}): Opts => ({
    agent: createAgent(id, { runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
    settings: { [id]: createSetting(id) },
    claudeFor: [id],
    // 기본 프로젝트(WD)의 저장소 호스트는 이미 연결된 상태 — 저장소 막힘은 따로 본다.
    repoCredentials: [repoCred(1, 'github.com')],
    ...over,
  })

  test('맡는 프로젝트가 0 이면 실행 시작이 막히고 이유를 보인다(WP-1281 결정)', async () => {
    await renderDetail(works({ projects: [] }))
    const start = await screen.findByTestId('agent-runtime-start')
    await waitFor(() => expect(screen.getByTestId('agent-runtime-checks')).toHaveTextContent('맡는 프로젝트'))
    expect(start).toBeDisabled()
    expect(screen.getByTestId('agent-run-group')).toHaveTextContent('맡는 프로젝트를 먼저 정해 주세요')
    expect(screen.getByRole('link', { name: '프로젝트에 추가하러 가기' })).toHaveAttribute('href', '/projects')
  })

  test('프로젝트가 있고 Claude 가 연결돼 있고 실행 환경에 자리가 있으면 실행 시작이 열리고 POST start 를 보낸다', async () => {
    const { user, calls } = await renderDetail(works({ projects: PROJECTS }))
    const start = await screen.findByTestId('agent-runtime-start')
    await waitFor(() => expect(start).toBeEnabled())
    expect(screen.getByTestId('agent-runtime-checks')).toHaveTextContent('맡는 프로젝트 1개')
    await user.click(start)
    await waitFor(() => expect(calls.actions).toEqual(['start']))
  })

  test('Claude 가 연결돼 있지 않으면 프로젝트가 있어도 「Claude 구독을 먼저 연결해 주세요」로 막힌다(프로젝트 0 보다 먼저)', async () => {
    await renderDetail(works({ claudeFor: [], projects: [] }))
    const start = await screen.findByTestId('agent-runtime-start')
    await waitFor(() => expect(screen.getByTestId('agent-run-group')).toHaveTextContent('Claude 구독을 먼저 연결해 주세요'))
    expect(start).toBeDisabled()
  })

  test('실행 환경에 자리가 없으면 「실행 환경에 여유가 없어요」로 막힌다', async () => {
    await renderDetail(works({ locations: [createLocation({ capacity: 3, used: 3 })] }))
    await waitFor(() => expect(screen.getByTestId('agent-run-group')).toHaveTextContent('실행 환경에 여유가 없어요'))
    expect(screen.getByTestId('agent-runtime-start')).toBeDisabled()
  })

  test('사용 중지된 AI 는 시작을 막는다 — 가장 먼저 「사용 중지된 AI 는 실행할 수 없어요」', async () => {
    await renderDetail(works({ agent: createAgent(id, { runtime: 'EXTERNAL', runMode: 'WORKSPACE', isActive: false }) }))
    await waitFor(() => expect(screen.getByTestId('agent-run-group')).toHaveTextContent('사용 중지된 AI 는 실행할 수 없어요'))
    expect(screen.getByTestId('agent-runtime-start')).toBeDisabled()
  })

  test('실행 중이면 시작 대신 다시 시작·실행 멈춤이 보이고, 상태 알약은 AI 보고(작업 중)를 따른다', async () => {
    const setting = createSetting(id, { status: 'RUNNING', desired: 'RUN', observed: createObserved({ agentState: 'WORKING', agentIssueKey: 'WD-319' }) })
    await renderDetail(works({ settings: { [id]: setting } }))
    expect(await screen.findByTestId('agent-runtime-status')).toHaveTextContent('작업 중')
    expect(screen.getByTestId('agent-runtime-detail')).toHaveTextContent('WD-319')
    expect(screen.getByTestId('agent-runtime-restart')).toBeInTheDocument()
    expect(screen.getByTestId('agent-runtime-stop')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-runtime-start')).not.toBeInTheDocument()
    // 실행 중에는 방식 카드를 바꿀 수 없다.
    expect(screen.getByTestId('agent-run-mode-lock')).toHaveTextContent('실행 중에는 바꿀 수 없어요')
  })

  test('여러 칸이 일하면 상태 카드에 현재 이슈 링크가 모두 보인다 (WP-1409)', async () => {
    const observed = createObserved({ agentState: 'WORKING', agentIssueKey: 'HR-2', agentIssueKeys: ['HR-2', 'WP-1'] })
    await renderDetail(works({ settings: { [id]: createSetting(id, { status: 'RUNNING', desired: 'RUN', observed }) } }))
    const detail = await screen.findByTestId('agent-runtime-detail')
    const links = within(detail).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['HR-2', 'WP-1'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/projects/HR/issues/2', '/projects/WP/issues/1'])
  })

  test('일하는 중 다시 시작 확인 창은 일하는 이슈를 모두 적는다 (WP-1409)', async () => {
    const observed = createObserved({ agentState: 'WORKING', agentIssueKey: 'HR-2', agentIssueKeys: ['HR-2', 'WP-1'] })
    const { user } = await renderDetail(works({ settings: { [id]: createSetting(id, { status: 'RUNNING', desired: 'RUN', observed }) } }))
    await user.click(await screen.findByTestId('agent-runtime-restart'))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('HR-2, WP-1')
    expect(dialog).toHaveTextContent('이어 받아요')
  })

  test('옛 서버 응답(agentIssueKeys 없음)이면 확인 창은 agentIssueKey 하나로 적는다 (WP-1409)', async () => {
    const observed = createObserved({ agentState: 'WORKING', agentIssueKey: 'WD-319' })
    const { user } = await renderDetail(works({ settings: { [id]: createSetting(id, { status: 'RUNNING', desired: 'RUN', observed }) } }))
    await user.click(await screen.findByTestId('agent-runtime-restart'))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('WD-319')
  })

  test('작업 화면 보기는 작업 공간이 떠 있을 때(실행 중·쉴 때 적용 대기)만 보인다 (WP-1277)', async () => {
    await renderDetail(works({ settings: { [id]: createSetting(id, { status: 'RUNNING', desired: 'RUN', observed: createObserved({ agentState: 'WORKING' }) }) } }))
    expect(await screen.findByTestId('agent-screen-open')).toHaveTextContent('작업 화면 보기')
  })

  test('꺼져 있거나 시작하는 중이면 작업 화면 보기가 없다', async () => {
    await renderDetail(works({ settings: { [id]: createSetting(id, { status: 'STARTING', desired: 'RUN' }) } }))
    expect(await screen.findByTestId('agent-runtime-status')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-screen-open')).not.toBeInTheDocument()
  })

  test('실행 환경이 사용량을 잴 수 없다고 알려 왔으면 CPU·메모리는 「알 수 없음」과 이유 한 줄, 잴 수 있으면 값만 보인다 (WP-1280)', async () => {
    const observed = createObserved({ agentState: 'WORKING', agentIssueKey: 'WD-319', cpuMillicores: 1200, memoryBytes: 3 * 1024 ** 3 })
    const blind = createSetting(id, { status: 'RUNNING', desired: 'RUN', observed, effectiveLocation: createLocation({ metricsAvailable: false }) })
    await renderDetail(works({ settings: { [id]: blind } }))
    const stats = await screen.findByTestId('agent-runtime-stats')
    expect(stats).toHaveTextContent('CPU알 수 없음')
    expect(stats).toHaveTextContent('메모리알 수 없음')
    expect(screen.getByTestId('agent-runtime-metrics-unavailable')).toHaveTextContent('이 실행 환경에는 사용량을 재는 metrics-server 가 없어요.')
  })

  test('사용량을 잴 수 있는 실행 환경이면 CPU·메모리 값이 보이고 이유 줄은 없다', async () => {
    const observed = createObserved({ agentState: 'WORKING', agentIssueKey: 'WD-319', cpuMillicores: 1200, memoryBytes: 3 * 1024 ** 3 })
    await renderDetail(works({ settings: { [id]: createSetting(id, { status: 'RUNNING', desired: 'RUN', observed }) } }))
    const stats = await screen.findByTestId('agent-runtime-stats')
    expect(stats).toHaveTextContent('1.2 코어')
    expect(stats).toHaveTextContent('3.0 GiB')
    expect(screen.queryByTestId('agent-runtime-metrics-unavailable')).not.toBeInTheDocument()
  })

  test('저장된 실행 환경은 꽉 찼어도 초안에서 「워크스페이스 기본」을 고르면 기본 환경 자리로 판정해 시작이 열린다', async () => {
    const locations = [
      createLocation({ id: 1, isDefault: true, capacity: 4, used: 1 }),
      createLocation({ id: 2, name: 'PoC', isDefault: false, capacity: 2, used: 2 }),
    ]
    const { user } = await renderDetail(works({ settings: { [id]: createSetting(id, { locationId: 2 }) }, locations }))
    await waitFor(() => expect(screen.getByTestId('agent-run-group')).toHaveTextContent('실행 환경에 여유가 없어요'))
    await user.click(screen.getByTestId('agent-runtime-location'))
    await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /워크스페이스 기본/ }))
    const start = await screen.findByRole('button', { name: '저장하고 실행 시작' })
    await waitFor(() => expect(start).toBeEnabled())
  })

  test('저장된 방식이 정의 목록에서 빠졌으면 「(지원 끝남)」 카드를 지금 방식으로 보이고 다른 방식으로 바꾸면 실행 설정을 지운다', async () => {
    const { user, calls } = await renderDetail(
      works({ settings: { [id]: createSetting(id, { templateName: 'old-runner', templateMissing: true }) } }),
    )
    const old = await screen.findByTestId('agent-run-mode-old-runner')
    expect(old).toHaveAttribute('aria-checked', 'true')
    expect(old).toHaveTextContent('old-runner (지원 끝남)')
    expect(screen.getByTestId('agent-run-mode-unsupported')).toBeInTheDocument()
    await user.click(screen.getByTestId('agent-run-mode-EXTERNAL'))
    await user.click(screen.getByTestId('agent-run-mode-apply'))
    await user.click(await screen.findByTestId('agent-run-mode-confirm-apply'))
    // 작업 공간에서 떠나는 길 — 실행 방식 PUT(EXTERNAL, 이미 그 값이라 아무것도 안 바뀜)이 아니라 실행 설정 삭제.
    await waitFor(() => expect(calls.settingDeletes).toBe(1))
    expect(calls.runtimes).toEqual([])
  })

  test('자동 발급 키가 아직 없으면 다음 교체 안내를 그리지 않는다', async () => {
    await renderDetail(works())
    await screen.findByTestId('agent-managed-keys-group')
    expect(screen.queryByTestId('agent-key-next-rotation')).not.toBeInTheDocument()
  })

  test('다음 교체 ○○ 무렵 — 가장 새로 받은 자동 발급 키의 만료 7일 전', async () => {
    const older = { ...NOW_KEY, id: 1, expiresAt: '2026-11-30T12:00:00Z' }
    const newest = { ...NOW_KEY, id: 2, expiresAt: '2026-12-20T12:00:00Z' }
    // 폐기된 더 새 키는 세지 않는다.
    const revoked = { ...NOW_KEY, id: 3, expiresAt: '2027-01-30T12:00:00Z', revokedAt: '2026-11-01T00:00:00Z' }
    await renderDetail({ ...works(), keys: [older, newest, revoked] })
    const note = await screen.findByTestId('agent-key-next-rotation')
    expect(note).toHaveTextContent(`다음 교체 ${formatDateMonthDayPadded('2026-12-13T12:00:00Z')} 무렵`)
    expect(note).not.toHaveTextContent(formatDateMonthDayPadded('2026-12-20T12:00:00Z'))
    expect(within(screen.getByTestId('agent-managed-keys-group')).getByText('Works 가 관리')).toBeInTheDocument()
  })
})

describe('Works 실행 AI — 저장소 연결(WP-1268)', () => {
  const id = 200
  const projects = [
    ...PROJECTS,
    { projectKey: 'WP', name: 'Works', repositoryUrl: 'git@github.com:a/wp.git', repositoryBranch: 'main', repositoryHost: 'github.com' },
    { projectKey: 'TTP', name: 'TTP', repositoryUrl: 'https://gitlab.iacloud.kr/t/ttp.git', repositoryBranch: 'main', repositoryHost: 'gitlab.iacloud.kr' },
  ]
  const works = (over: Partial<Opts> = {}): Opts => ({
    agent: createAgent(id, { runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
    settings: { [id]: createSetting(id) },
    claudeFor: [id],
    projects,
    repoCredentials: [repoCred(1, 'github.com')],
    ...over,
  })

  test('AI 계정 아래에 「저장소 연결」 묶음 — 필요한 호스트별로 연결됨·연결 안 됨 줄과 단추를 보인다', async () => {
    await renderDetail(works())
    const group = await screen.findByTestId('agent-repo-group')
    expect(group).toHaveTextContent('저장소 연결')
    expect(group).toHaveTextContent('바로 반영')
    const github = await screen.findByTestId('agent-repo-row-github.com')
    expect(github).toHaveTextContent('GitHub')
    expect(github).toHaveTextContent('WD · WP 프로젝트 저장소')
    expect(github).toHaveTextContent('최근 사용 5분 전')
    expect(within(github).getByTestId('agent-repo-reconnect-github.com')).toBeInTheDocument()
    expect(within(github).getByTestId('agent-repo-revoke-github.com')).toBeInTheDocument()
    const gitlab = screen.getByTestId('agent-repo-row-gitlab.iacloud.kr')
    expect(gitlab).toHaveTextContent('GitLab')
    expect(gitlab).toHaveTextContent('연결 안 됨')
    expect(gitlab).toHaveTextContent('TTP 프로젝트 저장소')
    expect(within(gitlab).getByTestId('agent-repo-connect-gitlab.iacloud.kr')).toBeInTheDocument()
    // 필요한 호스트 먼저, 호스트 순 — AI 계정 묶음 바로 아래.
    const order = screen.getAllByTestId(/^agent-(ai-account|repo|work-settings)-group$/).map((e) => e.dataset.testid)
    expect(order).toEqual(['agent-ai-account-group', 'agent-repo-group', 'agent-work-settings-group'])
  })

  test('최근 사용이 없으면 「없음」, 필요 없는데 등록된 호스트는 프로젝트 줄 없이 같은 모양으로 붙는다', async () => {
    await renderDetail(works({ repoCredentials: [repoCred(1, 'github.com', { lastUsedAt: null }), repoCred(2, 'ghe.example.com')] }))
    expect(await screen.findByTestId('agent-repo-row-github.com')).toHaveTextContent('최근 사용 없음')
    const extra = screen.getByTestId('agent-repo-row-ghe.example.com')
    expect(extra).not.toHaveTextContent('프로젝트 저장소')
    expect(within(extra).getByTestId('agent-repo-revoke-ghe.example.com')).toBeInTheDocument()
  })

  test('저장소 토큰이 필요 없는 방식(요구에 repo 없음)이면 묶음도 켜기 전 확인 항목도 없다', async () => {
    const template = { ...TEMPLATES[1], requires: ['claude'] }
    await renderDetail(works({ templates: [TEMPLATES[0], template] }))
    await screen.findByTestId('agent-ai-account-group')
    expect(screen.queryByTestId('agent-repo-group')).not.toBeInTheDocument()
    await screen.findByTestId('agent-runtime-checks')
    expect(screen.queryByTestId('agent-runtime-check-repos')).not.toBeInTheDocument()
  })

  test('연결하기 — 호스트는 고정, 토큰이 짧으면 저장이 닫혀 있고 저장하면 POST {kind, host, token}(공백 제거) 후 닫힌다', async () => {
    const { user, calls } = await renderDetail(works())
    await user.click(await screen.findByTestId('agent-repo-connect-gitlab.iacloud.kr'))
    const dialog = await screen.findByTestId('agent-repo-dialog')
    expect(within(dialog).getByTestId('agent-repo-host')).toHaveValue('gitlab.iacloud.kr')
    expect(within(dialog).getByTestId('agent-repo-host')).toHaveAttribute('readonly')
    expect(within(dialog).getByTestId('agent-repo-kind-gitlab')).toBeChecked()
    expect(dialog).toHaveTextContent('api·write_repository 범위의 토큰')
    const save = within(dialog).getByTestId('agent-repo-save')
    await user.type(within(dialog).getByTestId('agent-repo-token'), 'short')
    expect(save).toBeDisabled()
    await user.clear(within(dialog).getByTestId('agent-repo-token'))
    await user.type(within(dialog).getByTestId('agent-repo-token'), '  glpat-0123456789abcdefghij  ')
    await user.click(save)
    await waitFor(() => expect(calls.repoRegisters).toEqual([{ kind: 'GITLAB', host: 'gitlab.iacloud.kr', token: 'glpat-0123456789abcdefghij' }]))
    await waitFor(() => expect(screen.queryByTestId('agent-repo-dialog')).not.toBeInTheDocument())
    // 목록을 다시 읽어 그 호스트가 연결됨으로 바뀐다.
    await waitFor(() => expect(screen.getByTestId('agent-repo-row-gitlab.iacloud.kr')).toHaveTextContent('최근 사용 없음'))
  })

  test('다시 연결 — 대화상자를 열어 같은 호스트로 POST 하고 원문은 다시 열어도 비어 있다', async () => {
    const { user, calls } = await renderDetail(works())
    await user.click(await screen.findByTestId('agent-repo-reconnect-github.com'))
    let dialog = await screen.findByTestId('agent-repo-dialog')
    expect(dialog).toHaveTextContent('Contents·Pull requests 쓰기 권한이 있는 토큰')
    await user.type(within(dialog).getByTestId('agent-repo-token'), 'github_pat_0123456789abcdef')
    await user.click(within(dialog).getByTestId('agent-repo-save'))
    await waitFor(() => expect(calls.repoRegisters).toEqual([{ kind: 'GITHUB', host: 'github.com', token: 'github_pat_0123456789abcdef' }]))
    await waitFor(() => expect(screen.queryByTestId('agent-repo-dialog')).not.toBeInTheDocument())
    await user.click(screen.getByTestId('agent-repo-reconnect-github.com'))
    dialog = await screen.findByTestId('agent-repo-dialog')
    expect(within(dialog).getByTestId('agent-repo-token')).toHaveValue('')
  })

  test('+ 다른 호스트 추가 — 호스트를 적으면 종류를 짐작하고(직접 고른 종류는 존중), 형식이 틀리면 저장이 닫힌다', async () => {
    const { user, calls } = await renderDetail(works())
    await user.click(await screen.findByTestId('agent-repo-add'))
    const dialog = await screen.findByTestId('agent-repo-dialog')
    const host = within(dialog).getByTestId('agent-repo-host')
    await user.type(host, 'https://git.example.com')
    expect(within(dialog).getByTestId('agent-repo-save')).toBeDisabled()
    expect(dialog).toHaveTextContent('호스트 이름만 적어 주세요')
    await user.clear(host)
    await user.type(host, ' GHE.GitHub.example.com ')
    expect(within(dialog).getByTestId('agent-repo-kind-github')).toBeChecked()
    await user.click(within(dialog).getByTestId('agent-repo-kind-gitlab'))
    await user.clear(host)
    await user.type(host, 'github.acme.io')
    expect(within(dialog).getByTestId('agent-repo-kind-gitlab')).toBeChecked()
    await user.type(within(dialog).getByTestId('agent-repo-token'), 'tok_0123456789abcdef')
    await user.click(within(dialog).getByTestId('agent-repo-save'))
    await waitFor(() => expect(calls.repoRegisters).toEqual([{ kind: 'GITLAB', host: 'github.acme.io', token: 'tok_0123456789abcdef' }]))
  })

  test('연결 끊기 — 확인 창에서 취소하면 보내지 않고, 확인하면 DELETE 후 「연결 안 됨」이 된다', async () => {
    const { user, calls } = await renderDetail(works())
    await user.click(await screen.findByTestId('agent-repo-revoke-github.com'))
    const dialog = await screen.findByTestId('agent-repo-revoke-dialog')
    expect(dialog).toHaveTextContent('github.com 연결을 끊을까요?')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(calls.repoRevokes).toEqual([])
    await user.click(screen.getByTestId('agent-repo-revoke-github.com'))
    await user.click(await screen.findByTestId('agent-repo-revoke-confirm'))
    await waitFor(() => expect(calls.repoRevokes).toEqual([1]))
    await waitFor(() => expect(screen.getByTestId('agent-repo-row-github.com')).toHaveTextContent('연결 안 됨'))
  })

  test('등록이 실패하면 오류 알림을 띄우고 대화상자와 입력을 그대로 둔다', async () => {
    const { user } = await renderDetail(works({ failRepoRegister: { status: 400, message: '토큰 형식이 올바르지 않아요' } }))
    await user.click(await screen.findByTestId('agent-repo-connect-gitlab.iacloud.kr'))
    const dialog = await screen.findByTestId('agent-repo-dialog')
    await user.type(within(dialog).getByTestId('agent-repo-token'), 'glpat-0123456789abcdefghij')
    await user.click(within(dialog).getByTestId('agent-repo-save'))
    expect(await screen.findByText('토큰 형식이 올바르지 않아요')).toBeInTheDocument()
    expect(screen.getByTestId('agent-repo-dialog')).toBeInTheDocument()
    expect(within(screen.getByTestId('agent-repo-dialog')).getByTestId('agent-repo-token')).toHaveValue('glpat-0123456789abcdefghij')
  })

  test('켜기 전 확인 — 연결 안 된 호스트를 알리고 실행 시작을 「저장소를 먼저 연결해 주세요」로 막는다(Claude 다음·프로젝트 앞)', async () => {
    await renderDetail(works())
    const item = await screen.findByTestId('agent-runtime-check-repos')
    await waitFor(() => expect(item).toHaveTextContent('gitlab.iacloud.kr 가 연결돼 있지 않아요. 아래 실행 › 저장소 연결에서 연결해 주세요'))
    expect(screen.getByTestId('agent-runtime-start')).toBeDisabled()
    expect(screen.getByTestId('agent-run-group')).toHaveTextContent('저장소를 먼저 연결해 주세요')
    const checks = screen.getByTestId('agent-runtime-checks')
    const text = checks.textContent ?? ''
    expect(text.indexOf('Claude 연결')).toBeLessThan(text.indexOf('저장소 연결'))
    expect(text.indexOf('저장소 연결')).toBeLessThan(text.indexOf('맡는 프로젝트'))
  })

  test('호스트를 모두 연결하면 ✓ 로 바뀌고 실행 시작이 열린다', async () => {
    await renderDetail(works({ repoCredentials: [repoCred(1, 'github.com'), repoCred(2, 'gitlab.iacloud.kr')] }))
    const item = await screen.findByTestId('agent-runtime-check-repos')
    await waitFor(() => expect(within(item).getByLabelText('통과')).toBeInTheDocument())
    expect(item).not.toHaveTextContent('연결돼 있지 않아요')
    await waitFor(() => expect(screen.getByTestId('agent-runtime-start')).toBeEnabled())
  })
})

describe('작업 설정 「모델」 — 연결된 계정의 모델 목록(WP-1405)', () => {
  const id = 700
  const works = (over: Partial<Opts> = {}): Opts => ({
    agent: createAgent(id, { runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
    settings: { [id]: createSetting(id) },
    claudeFor: [id],
    ...over,
  })
  const live = () =>
    HttpResponse.json({
      provider: 'anthropic',
      models: [
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      ],
    })
  const hint = () => screen.queryByTestId('agent-runtime-config-model-hint')

  test('계정 목록을 받으면 별칭(최신) 뒤에 계정 모델이 보이고, 골라 저장하면 그 id 를 보낸다', async () => {
    const { user, calls } = await renderDetail(works({ models: live }))
    await user.click(await screen.findByTestId('agent-runtime-config-model'))
    const listbox = await screen.findByRole('listbox')
    await waitFor(() =>
      expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Opus(최신)',
        'Sonnet(최신)',
        'Claude Opus 5.5',
        'Claude Sonnet 5',
      ]),
    )
    expect(hint()).not.toBeInTheDocument()
    await user.click(within(listbox).getByRole('option', { name: 'Claude Sonnet 5' }))
    await user.click(screen.getByTestId('agent-runtime-save'))

    await waitFor(() => expect(calls.saves).toHaveLength(1))
    expect(calls.saves[0].config.model).toBe('claude-sonnet-5')
  })

  test('AI 계정이 연결돼 있지 않으면 「AI 계정을 연결하면」 안내를 보이고 모델 목록을 부르지 않는다', async () => {
    const { modelCalls } = await renderDetail(works({ claudeFor: [], models: live }))
    await waitFor(() => expect(hint()).toHaveTextContent('AI 계정을 연결하면 그 계정이 쓸 수 있는 모델이 보여요.'))
    expect(modelCalls.count).toBe(0)
  })

  test('연결된 계정 종류가 이 방식과 다르면(OpenAI 호환) 모델 목록을 부르지 않는다', async () => {
    const { modelCalls } = await renderDetail(works({ claudeFor: [], credentials: { [id]: 'opencode' }, models: live }))
    // 안내 문구는 순수 함수 테스트가 본다 — 여기서는 연결 종류로 조회를 막는 배선만 본다.
    await waitFor(() => expect(hint()).toHaveTextContent('맞지 않아'))
    expect(modelCalls.count).toBe(0)
  })

  test('계정 모델 칸이 없는 방식(정적 선택지만)은 모델 목록을 부르지 않는다', async () => {
    const staticTemplate = {
      ...CLAUDE_TEMPLATE,
      config: CLAUDE_TEMPLATE.config.map((f) => ({ ...f, optionsFrom: null })),
    }
    const { modelCalls } = await renderDetail(works({ templates: [DEFAULT_TEMPLATE, staticTemplate], models: live }))
    expect(await screen.findByTestId('agent-runtime-config-model')).toHaveTextContent('Opus(최신)')
    expect(hint()).not.toBeInTheDocument()
    expect(modelCalls.count).toBe(0)
  })

  test('정적 선택지 칸의 저장값이 템플릿에서 빠졌어도 트리거가 빈칸이 아니라 그 값으로 보인다', async () => {
    const staticTemplate = {
      ...CLAUDE_TEMPLATE,
      config: CLAUDE_TEMPLATE.config.map((f) => ({ ...f, optionsFrom: null })),
    }
    await renderDetail(
      works({
        templates: [DEFAULT_TEMPLATE, staticTemplate],
        settings: { [id]: createSetting(id, { config: { model: 'retired-model', queue: 'AI 개발팀' } }) },
      }),
    )
    expect(await screen.findByTestId('agent-runtime-config-model')).toHaveTextContent('retired-model')
    // 선택지만 늘었고 초안 값은 그대로라 저장하지 않은 변경이 생기지 않는다
    expect(screen.getByTestId('agent-runtime-save')).toBeDisabled()
  })
})

describe('찾을 수 없음·로딩', () => {
  test('없는 에이전트(404)는 찾을 수 없음 안내와 목록으로 돌아가기만 보이고 섹션이 없다', async () => {
    const runtime = agentRuntimeApi()
    renderScreen(
      <AIAssistantProvider hotkeysEnabled={false}>
        <Routes>
          <Route path="/settings/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </AIAssistantProvider>,
      {
        path: '/settings/agents/999',
        handlers: [http.get('/api/v1/admin/agents/:id', () => HttpResponse.json({ message: '없음' }, { status: 404 })), ...runtime.handlers],
      },
    )
    expect(await screen.findByTestId('agent-detail-notfound')).toHaveTextContent('에이전트를 찾을 수 없어요. 삭제됐거나 주소가 잘못됐어요.')
    expect(screen.getByRole('button', { name: '목록으로 돌아가기' })).toBeInTheDocument()
    expect(presentSections()).toEqual([])
    expect(screen.queryByTestId('agent-detail-page')).not.toBeInTheDocument()
  })

  test('404 가 아닌 실패(5xx)는 지워졌다고 하지 않고 불러오지 못함과 다시 시도를 보인다', async () => {
    let fail = true
    const agent = createAgent(100)
    const { user } = await renderDetail({
      agent,
      agentResponse: () => (fail ? HttpResponse.json({ message: '오류' }, { status: 500 }) : HttpResponse.json(agent)),
      readyTestId: 'agent-detail-error',
    })
    expect(screen.getByTestId('agent-detail-error')).toHaveTextContent('에이전트를 불러오지 못했습니다')
    expect(screen.queryByTestId('agent-detail-notfound')).not.toBeInTheDocument()
    fail = false
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('agent-detail-page')).toBeInTheDocument()
  })

  test('숫자가 아닌 id 주소도 요청 없이 찾을 수 없음이다', async () => {
    renderScreen(
      <AIAssistantProvider hotkeysEnabled={false}>
        <Routes>
          <Route path="/settings/agents/:id" element={<AgentDetailPage />} />
        </Routes>
      </AIAssistantProvider>,
      { path: '/settings/agents/abc', handlers: [] },
    )
    expect(await screen.findByTestId('agent-detail-notfound')).toBeInTheDocument()
  })
})

describe('로그인 정보로 일하는 방식의 AI 계정(WP-1296·1297)', () => {
  const id = 600
  const codex = (over: Partial<Opts> = {}): Opts => ({
    agent: createAgent(id, { runtime: 'EXTERNAL', runMode: 'WORKSPACE' }),
    settings: { [id]: createSetting(id, { templateName: 'codex' }) },
    templates: [...TEMPLATES, CODEX_TEMPLATE],
    repoCredentials: [repoCred(1, 'github.com')],
    ...over,
  })
  // 가짜 ChatGPT 로그인 정보 — 계정·만료는 서명 없는 JWT 가운데 부분에서 읽는다.
  const jwt = (p: object) => `h.${btoa(JSON.stringify(p)).replace(/=+$/, '')}.s`
  const loginInfo = JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { id_token: jwt({ email: 'ai-dev@example.com' }), access_token: jwt({ exp: 1_800_000_000 }), refresh_token: 'rt-fake' },
  })

  test('connectsWithLoginInfo_whenNotConnected', async () => {
    // 연결 전 — 이 방식의 계정 이름으로 안내하고, 실행 시작은 「ChatGPT 로그인」이 막는다
    const { user, calls } = await renderDetail(codex())
    const group = await screen.findByTestId('agent-ai-account-group')
    await waitFor(() => expect(group).toHaveTextContent('이 방식은 ChatGPT 로그인으로 일해요'))
    await waitFor(() => expect(screen.getByTestId('agent-run-group')).toHaveTextContent('ChatGPT 로그인을 먼저 연결해 주세요'))

    await user.click(within(group).getByTestId('oauth-token-register'))
    const dialog = await screen.findByTestId('login-info-dialog')
    expect(within(dialog).getByTestId('login-info-submit')).toBeDisabled()
    await user.click(within(dialog).getByTestId('login-info-text'))
    await user.paste(loginInfo)
    // 넣은 뒤에는 내용 대신 「넣었어요」만 보이고, 계정을 알려 준다
    expect(within(dialog).getByTestId('login-info-filled')).toHaveTextContent('로그인 정보를 넣었어요')
    expect(dialog).not.toHaveTextContent('rt-fake')
    expect(within(dialog).getByTestId('login-info-check')).toHaveTextContent('ChatGPT 로그인 정보예요 · ai-dev@example.com')
    await user.click(within(dialog).getByTestId('login-info-submit'))

    await waitFor(() => expect(calls.credentialRegisters).toEqual([{ provider: 'chatgpt', loginInfo }]))
    await waitFor(() => expect(screen.queryByTestId('login-info-dialog')).not.toBeInTheDocument())
    expect(await within(group).findByTestId('credential-account')).toHaveTextContent('ai-dev@example.com')
  })

  test('blocksSubmit_whenOtherProgramLoginInfo', async () => {
    // Gen:iA 로그인 정보를 넣으면 무엇을 넣었는지 알리고 연결을 막는다
    const { user, calls } = await renderDetail(codex())
    const group = await screen.findByTestId('agent-ai-account-group')
    await user.click(await within(group).findByTestId('oauth-token-register'))
    const dialog = await screen.findByTestId('login-info-dialog')
    await user.click(within(dialog).getByTestId('login-info-text'))
    await user.paste(JSON.stringify({ genia: { type: 'oauth', refresh: 'rt-fake' } }))
    expect(within(dialog).getByTestId('login-info-check')).toHaveTextContent('Gen:iA 로그인 정보예요 — ChatGPT 로그인 정보를 넣어 주세요.')
    expect(within(dialog).getByTestId('login-info-submit')).toBeDisabled()
    expect(calls.credentialRegisters).toEqual([])
  })

  test('keepsTextareaVisible_whenTyping', async () => {
    // 직접 타이핑하면 한 글자를 쳐도 칸이 그대로 보여 이어 쓸 수 있고, 「지우기」로 바뀌는 것은 붙여넣기·파일로 넣었을 때뿐이다
    const { user } = await renderDetail(codex())
    const group = await screen.findByTestId('agent-ai-account-group')
    await user.click(await within(group).findByTestId('oauth-token-register'))
    const dialog = await screen.findByTestId('login-info-dialog')
    const area = within(dialog).getByTestId('login-info-text')
    await user.type(area, '{{"a')
    expect(within(dialog).getByTestId('login-info-text')).toHaveValue('{"a')
    expect(within(dialog).queryByTestId('login-info-filled')).not.toBeInTheDocument()
    // 이어서 붙여 넣으면 요약으로 바뀌고, 「지우기」는 내용과 요약을 함께 비운다
    await user.paste('":1}')
    expect(within(dialog).getByTestId('login-info-filled')).toBeInTheDocument()
    // 타이핑한 앞부분과 붙여 넣은 글이 이어져 {"a":1} 로 읽힌다(읽지 못했어요가 아니라 다른 프로그램 파일로)
    expect(within(dialog).getByTestId('login-info-check')).toHaveTextContent('다른 프로그램의 파일 같아요')
    await user.click(within(within(dialog).getByTestId('login-info-filled')).getByRole('button', { name: '지우기' }))
    expect(within(dialog).getByTestId('login-info-text')).toHaveValue('')
    expect(within(dialog).queryByTestId('login-info-check')).not.toBeInTheDocument()
  })

  test('warnsMismatch_whenOtherAccountConnected', async () => {
    // Codex 인데 Claude 구독이 남아 있으면 맞지 않는다고 알리고 다시 연결을 앞세운다
    await renderDetail(codex({ credentials: { [id]: 'anthropic' } }))
    expect(await screen.findByTestId('credential-mismatch')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('agent-run-group')).toHaveTextContent('ChatGPT 로그인을 먼저 연결해 주세요'))
  })
})
