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

import { createRole, createUserDetail } from '../../../e2e/factories/auth.factory'
import {
  agentRuntimeApi,
  createAgent,
  createLocation,
  createObserved,
  createSetting,
  PROJECTS,
  type RuntimeApiOptions,
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

interface Opts extends RuntimeApiOptions {
  agent: AgentResponse
  /** 접속 키 목록 */
  keys?: AgentApiKey[]
  /** 단건 조회 응답을 바꾼다(실패 흉내) — 없으면 agent 를 준다. */
  agentResponse?: () => Response
  /** 그린 뒤 기다릴 testid(기본 agent-detail-page). */
  readyTestId?: string
}

/** 상세 페이지 — 에이전트 한 명·계정·역할·키·공통 비서와 AI 실행 API 를 준다. */
async function renderDetail({ agent, keys = [], agentResponse, readyTestId = 'agent-detail-page', ...runtimeOpts }: Opts) {
  const runtime = agentRuntimeApi(runtimeOpts)
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
    http.get('/api/v1/admin/agents/:id/models', () => HttpResponse.json({ models: [] })),
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
  return { ...view, ...runtime }
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

  test('Claude 가 연결돼 있지 않으면 프로젝트가 있어도 「Claude 를 먼저 연결해 주세요」로 막힌다(프로젝트 0 보다 먼저)', async () => {
    await renderDetail(works({ claudeFor: [], projects: [] }))
    const start = await screen.findByTestId('agent-runtime-start')
    await waitFor(() => expect(screen.getByTestId('agent-run-group')).toHaveTextContent('Claude 를 먼저 연결해 주세요'))
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
