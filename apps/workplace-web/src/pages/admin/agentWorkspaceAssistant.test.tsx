// 설정 > 에이전트 — 공통 비서(AI 연결 및 모델) 화면 컴포넌트 테스트(WP-971, WP-966).
// 공통 비서 지정 프로브 실패 확인·취소, 해제 경고 확인·취소, 토큰 없음 게이트, 활성 토큰 없음 경고, 모델 목록·빈 목록·변경 실패 토스트,
// OpenAI 호환 연결의 이미지 입력 저장 규칙(모델을 바꾸면 vision:null)은 에이전트 상세의 AgentConnectionSection 하나로 판정되고,
// 진입 안내 배너 두 가지와 개인 비서 표시 토글(includePersonal 재조회)은 목록 화면(AgentManagementPage)으로 판정된다.
// e2e/pages/agent-workspace-assistant.spec.ts·workspace-assistant.spec.ts 에서 옮겼다 — 화면 배선(지정 → PUT)은
// agent-workspace-assistant.spec.ts 의 @wiring 1건이 지킨다. 둘 다 renderScreen 으로 띄운다(App 부팅·앱 셸 없이).
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'

import AgentManagementPage from '@/pages/admin/AgentManagementPage'
import { AgentConnectionSection } from '@/pages/admin/components/AgentConnectionSection'
import { MOCK_ADMIN_ROLE, MOCK_USER_ROLE } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { AgentResponse } from '@/types/agent'
import type { WorkspaceAssistant } from '@/types/assistant'
import type { ProviderCredentialMeta } from '@/types/providerCredential'

const AGENT_ID = 5
const ADMIN = { roles: [MOCK_ADMIN_ROLE, MOCK_USER_ROLE], isAdmin: true, refreshUser: vi.fn(async () => {}) }

const agent = (o: Partial<AgentResponse> = {}): AgentResponse =>
  ({
    id: AGENT_ID, username: 'ai_bot', name: 'AI 봇', email: 'ai@bot.local', kind: 'AGENT', isActive: true,
    createdAt: '2026-05-31T00:00:00Z', type: 'REGULAR', ownerName: null, ...o,
  }) as AgentResponse

const credential = (o: Partial<ProviderCredentialMeta> = {}): ProviderCredentialMeta => ({
  id: 1, provider: 'anthropic', baseUrl: null, label: 'ai-token', createdAt: '2026-05-31T00:00:00Z', lastUsedAt: null, ...o,
})

const unassigned = (): WorkspaceAssistant => ({ agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null })
const current = (o: Partial<WorkspaceAssistant> = {}): WorkspaceAssistant => ({
  agentUserId: AGENT_ID, agentName: 'AI 봇', hasActiveToken: true, model: 'claude-sonnet-4-6', thinkingDepth: 'NORMAL', ...o,
})

type Model = { id: string; label: string }

/**
 * 에이전트 상세의 「AI 연결 및 모델」 섹션을 띄운다. ws 는 요청마다 불러 PUT·DELETE 뒤 재조회를 서버처럼 반영한다.
 * 모델 목록은 models(배열 또는 상태 코드), 설정 PUT 은 settingsStatus 로 응답을 정한다. 쓰기 요청은 calls 에 모은다.
 */
function openSection(opts: {
  ws: WorkspaceAssistant
  credential: ProviderCredentialMeta | null
  models?: Model[] | 502
  provider?: string
  settingsStatus?: number
}) {
  let ws = opts.ws
  const calls = { put: [] as unknown[], del: 0, settings: [] as unknown[], modelGets: 0 }
  const handlers = [
    http.get('/api/v1/admin/workspace-assistant', () => HttpResponse.json(ws)),
    http.put('/api/v1/admin/workspace-assistant', async ({ request }) => {
      calls.put.push(await request.json())
      ws = { ...ws, agentUserId: AGENT_ID, agentName: 'AI 봇', hasActiveToken: true }
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete('/api/v1/admin/workspace-assistant', () => {
      calls.del++
      ws = { ...ws, agentUserId: null }
      return new HttpResponse(null, { status: 204 })
    }),
    http.put('/api/v1/admin/workspace-assistant/settings', async ({ request }) => {
      const body = (await request.json()) as { model?: string; vision?: boolean | null }
      calls.settings.push(body)
      if (opts.settingsStatus && opts.settingsStatus >= 400) {
        return HttpResponse.json({ message: '서버 오류가 발생했습니다.' }, { status: opts.settingsStatus })
      }
      // 서버처럼 — 모델을 바꾸면 vision 은 null, vision 만 보내면 지금 모델에 저장.
      ws = { ...ws, ...(body.model !== undefined && { model: body.model, vision: null }), ...('vision' in body && { vision: body.vision ?? null }) }
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/admin/agents/:id/provider-credential', () =>
      opts.credential ? HttpResponse.json(opts.credential) : HttpResponse.json({ message: '없음' }, { status: 404 }),
    ),
    http.get('/api/v1/admin/agents/:id/models', () => {
      calls.modelGets++
      if (opts.models === 502) return HttpResponse.json({ message: '모델 목록 조회에 실패했습니다.' }, { status: 502 })
      return HttpResponse.json({ provider: opts.provider ?? 'anthropic', models: opts.models ?? [] })
    }),
  ]
  const view = renderScreen(<AgentConnectionSection agentUserId={AGENT_ID} />, { path: `/settings/agents?agent=${AGENT_ID}`, handlers, auth: ADMIN })
  return { ...view, calls }
}

/** Radix Select 를 키보드로 열고 이름이 name 인 옵션을 고른다 — jsdom 은 포인터로 연 목록이 레이아웃 없이 바로 닫힌다. */
async function pick(user: UserEvent, trigger: HTMLElement, name: string) {
  // 모델 목록이 오기 전에는 선택기가 비활성이다 — 활성이 된 뒤 연다.
  await waitFor(() => expect(trigger).toBeEnabled())
  trigger.focus()
  await user.keyboard('{Enter}')
  const option = await screen.findByRole('option', { name })
  option.focus()
  await user.keyboard('{Enter}')
}

const toggle = () => screen.getByTestId('agent-connection-assistant-toggle')

describe('공통 비서 지정·해제(#643)', () => {
  // 지정 전 모델 프로브가 실패(502)해도 바로 지정하지 않고 강제 확인을 묻는다 — 취소하면 PUT 없이 꺼진 채로 남는다.
  test('지정 → 모델 프로브 502 → 강제 확인 대화상자, 취소하면 지정되지 않는다', async () => {
    const { user, calls } = openSection({ ws: unassigned(), credential: credential(), models: 502 })
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(toggle()).not.toBeChecked()
    await user.click(toggle())
    expect(await screen.findByTestId('workspace-assistant-force-set-dialog')).toBeInTheDocument()
    expect(calls.put).toHaveLength(0)
    await user.click(screen.getByTestId('workspace-assistant-force-set-cancel'))
    await waitFor(() => expect(screen.queryByTestId('workspace-assistant-force-set-dialog')).not.toBeInTheDocument())
    expect(calls.put).toHaveLength(0)
    expect(toggle()).not.toBeChecked()
  })

  // 프로브가 모델 0개여도 강제 확인을 거친다 — 「그래도 지정」 뒤에야 PUT { agentUserId }.
  test('지정 → 모델 0개 → 강제 확인 뒤에만 PUT agentUserId 를 보낸다', async () => {
    const { user, calls } = openSection({ ws: unassigned(), credential: credential(), models: [] })
    await waitFor(() => expect(toggle()).toBeEnabled())
    await user.click(toggle())
    await screen.findByTestId('workspace-assistant-force-set-dialog')
    expect(calls.put).toHaveLength(0)
    await user.click(screen.getByTestId('workspace-assistant-force-set-confirm'))
    await waitFor(() => expect(calls.put).toEqual([{ agentUserId: AGENT_ID }]))
  })

  // 지금 공통 비서를 끄면 영향 경고를 먼저 묻는다 — 확인하면 DELETE 1회.
  test('현재 공통 비서를 끄면 경고 확인 뒤 DELETE 를 1번 보낸다', async () => {
    const { user, calls } = openSection({ ws: current(), credential: credential(), models: [] })
    expect(await screen.findByTestId('workspace-assistant-current')).toBeInTheDocument()
    await waitFor(() => expect(toggle()).toBeChecked())
    await user.click(toggle())
    expect(await screen.findByTestId('workspace-assistant-clear-confirm-dialog')).toBeInTheDocument()
    expect(calls.del).toBe(0)
    await user.click(screen.getByTestId('workspace-assistant-clear-confirm-confirm'))
    await waitFor(() => expect(calls.del).toBe(1))
  })

  // 경고에서 취소하면 DELETE 없이 켜진 채로 남는다.
  test('해제 경고에서 취소하면 DELETE 없이 토글이 켜진 채다', async () => {
    const { user, calls } = openSection({ ws: current(), credential: credential(), models: [] })
    await waitFor(() => expect(toggle()).toBeChecked())
    await user.click(toggle())
    await screen.findByTestId('workspace-assistant-clear-confirm-dialog')
    await user.click(screen.getByTestId('workspace-assistant-clear-confirm-cancel'))
    await waitFor(() => expect(screen.queryByTestId('workspace-assistant-clear-confirm-dialog')).not.toBeInTheDocument())
    expect(calls.del).toBe(0)
    expect(toggle()).toBeChecked()
  })

  // 자격증명이 없는(404) 에이전트는 지정할 수 없다 — 토글 비활성 + 토큰 안내.
  test('토큰 없는 에이전트는 지정 토글이 비활성이고 토큰 안내를 보인다', async () => {
    openSection({ ws: unassigned(), credential: null })
    expect(await screen.findByTestId('workspace-assistant-token-gate')).toBeInTheDocument()
    expect(toggle()).toBeDisabled()
  })

  // 공통 비서로 지정됐지만 토큰이 회수된 상태 — 현재 배지와 경고를 함께 보인다.
  test('공통 비서인데 활성 토큰이 없으면 현재 배지와 경고를 보인다', async () => {
    openSection({ ws: current({ hasActiveToken: false }), credential: null })
    expect(await screen.findByTestId('workspace-assistant-current')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-assistant-warn')).toBeInTheDocument()
  })
})

describe('공통 비서 모델·이미지 입력', () => {
  // #198 — 모델 변경 PUT 실패가 조용히 지나가지 않는다.
  test('모델 변경 API 실패 시 오류 토스트를 보이고 성공 토스트는 없다', async () => {
    const { user } = openSection({
      ws: current(), credential: credential(), settingsStatus: 500,
      models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }, { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }],
    })
    await pick(user, await screen.findByTestId('workspace-assistant-model'), 'Claude Opus 4.8')
    expect(await screen.findByText('서버 오류가 발생했습니다.')).toBeInTheDocument()
    expect(screen.queryByText('설정을 변경했습니다.')).not.toBeInTheDocument()
  })

  // Task12 — 모델 옵션은 GET /admin/agents/{id}/models 응답 그대로.
  test('모델 선택기 옵션이 서버 모델 목록을 그대로 보인다', async () => {
    const { user, calls } = openSection({
      ws: current(), credential: credential(), provider: 'opencode',
      models: [{ id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' }],
    })
    const trigger = await screen.findByTestId('workspace-assistant-model')
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(calls.modelGets).toBeGreaterThan(0)
    trigger.focus()
    await user.keyboard('{Enter}')
    const list = await screen.findByRole('listbox')
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['GPT-OSS 120B'])
  })

  // 모델 목록이 비면 선택기는 비활성이고 안내 문구를 보인다.
  test('모델 목록이 비면 선택기가 비활성이고 안내를 보인다', async () => {
    openSection({ ws: current(), credential: credential(), models: [] })
    expect(await screen.findByTestId('workspace-assistant-model-empty')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-assistant-model')).toBeDisabled()
  })

  // WP-250 — OpenAI 호환 공통 비서: 이미지 입력만 바꾸면 지금 모델에 저장, 모델을 바꾸면 vision:null 로 자동 감지에서 시작.
  test('opencode 공통 비서 — 이미지 입력만 바꾸면 { vision }, 모델을 바꾸면 { model, vision: null } 이고 자동 감지로 보인다', async () => {
    const { user, calls } = openSection({
      ws: current({ model: 'openai/gpt-4.1', vision: false }),
      credential: credential({ provider: 'opencode', baseUrl: 'https://api.example.com/v1', label: 'oc' }),
      provider: 'opencode',
      models: [{ id: 'openai/gpt-4.1', label: 'GPT-4.1' }, { id: 'openai/my-vl', label: 'My VL' }],
    })
    const vision = await screen.findByTestId('workspace-assistant-vision')
    await waitFor(() => expect(vision).toHaveTextContent('볼 수 없음'))
    await pick(user, vision, '볼 수 있음')
    await waitFor(() => expect(calls.settings).toEqual([{ vision: true }]))
    await waitFor(() => expect(screen.getByTestId('workspace-assistant-vision')).toHaveTextContent('볼 수 있음'))
    await pick(user, screen.getByTestId('workspace-assistant-model'), 'My VL')
    await waitFor(() => expect(calls.settings.at(-1)).toEqual({ model: 'openai/my-vl', vision: null }))
    // 이전 모델의 「볼 수 있음」 이 새 모델로 옮겨지지 않는다.
    await waitFor(() => expect(screen.getByTestId('workspace-assistant-vision')).toHaveTextContent('자동 감지'))
  })

  // Claude 연결은 이미지 입력 선택이 없다.
  test('Claude 공통 비서는 이미지 입력 선택을 보이지 않는다', async () => {
    openSection({ ws: current(), credential: credential(), models: [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }] })
    expect(await screen.findByTestId('workspace-assistant-model')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-assistant-vision')).not.toBeInTheDocument()
  })
})

describe('에이전트 목록 — 안내 배너·개인 비서 표시', () => {
  /** 목록 화면을 띄운다 — agents(includePersonal) 로 목록 응답을 정하고, 목록 조회의 includePersonal 값을 모은다. */
  function openList(agents: (includePersonal: boolean) => AgentResponse[]) {
    const includes: (string | null)[] = []
    const handlers = [
      http.get('/api/v1/admin/workspace-assistant', () => HttpResponse.json(unassigned())),
      http.get('/api/v1/admin/agents', ({ request }) => {
        const include = new URL(request.url).searchParams.get('includePersonal')
        includes.push(include)
        return HttpResponse.json(agents(include === 'true'))
      }),
    ]
    return { ...renderScreen(<AgentManagementPage />, { path: '/settings/agents', handlers, auth: ADMIN }), includes }
  }

  // 에이전트는 있는데 공통 비서가 없으면 「지정하라」 안내만 — 「에이전트 추가」 안내는 아니다.
  test('에이전트가 있고 공통 비서가 없으면 지정 안내 배너를 보인다', async () => {
    openList(() => [agent()])
    expect(await screen.findByTestId('workspace-assistant-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-roster-empty')).not.toBeInTheDocument()
  })

  // 에이전트가 하나도 없으면 「먼저 추가하라」 안내 — 지정 안내는 아니다.
  test('에이전트가 없으면 에이전트 추가 안내 배너를 보인다', async () => {
    openList(() => [])
    expect(await screen.findByTestId('agent-roster-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('workspace-assistant-empty')).not.toBeInTheDocument()
  })

  // 개인 비서는 기본 표시 — 아이디는 @ 없이, 유형은 일반/개인+소유자. 토글을 끄면 includePersonal 없이(개인 비서 제외) 다시 불러 숨긴다.
  test('개인 비서 표시 토글 — 기본 표시(유형·소유자, @ 없는 아이디), 끄면 includePersonal 없이 재조회해 숨긴다', async () => {
    const wsAgent = agent({ username: 'ws_bot', name: 'WS 봇' })
    const personal = agent({ id: 9, username: '__assistant_u1', name: '개인 비서', type: 'PERSONAL', ownerName: '양동희' })
    const { user, includes } = openList((include) => (include ? [personal, wsAgent] : [wsAgent]))
    const row5 = await screen.findByTestId('agent-row-5')
    expect(screen.getByTestId('agent-row-9')).toBeInTheDocument()
    expect(row5).toHaveTextContent('ws_bot')
    expect(row5).not.toHaveTextContent('@ws_bot')
    expect(screen.getByTestId('agent-type-5')).toHaveTextContent('일반')
    expect(screen.getByTestId('agent-type-9')).toHaveTextContent('개인')
    expect(screen.getByTestId('agent-type-9')).toHaveTextContent('양동희')
    expect(includes).toEqual(['true'])
    await user.click(screen.getByTestId('include-personal-toggle'))
    await waitFor(() => expect(screen.queryByTestId('agent-row-9')).not.toBeInTheDocument())
    expect(screen.getByTestId('agent-row-5')).toBeInTheDocument()
    expect(includes).toEqual(['true', null])
  })
})
