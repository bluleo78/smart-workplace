// AI 실행(WP-1245 웨이브 D) 화면 테스트 도구 — 템플릿·위치·설정·요약 팩토리와 상태를 가진 MSW 핸들러.
// 실행 방식 섹션·에이전트 목록·실행 위치 화면 테스트가 같은 데이터 모양을 쓴다(시안 e2e 의 목 데이터와 같은 모양).
import { http, HttpResponse } from 'msw'

import type { AgentResponse } from '@/types/agent'
import type {
  AgentLocation,
  AgentRuntimeProject,
  AgentRuntimeSetting,
  AgentRuntimeSummary,
  AgentTemplate,
  PutAgentRuntimeSettingRequest,
} from '@/types/agentRuntime'

const API = '/api/v1'

/** 서버가 바로 답하는 「기본」 템플릿 — 설정 칸이 없다. */
export const DEFAULT_TEMPLATE: AgentTemplate = {
  name: 'default',
  version: '1',
  kind: 'SERVER',
  card: { title: '기본', description: '이슈·멘션에 바로 답합니다', skills: [] },
  image: null,
  requires: [],
  config: [],
  resources: null,
}

/** 작업 공간 템플릿 — 모델(select)·대기열 라벨(text) 두 칸, Claude 연결 필요. */
export const CLAUDE_TEMPLATE: AgentTemplate = {
  name: 'claude-code',
  version: '1',
  kind: 'WORKSPACE',
  card: { title: 'Claude Code', description: '작업 공간에서 개발·테스트하고 PR 을 올립니다', skills: ['개발', '테스트', 'PR'] },
  image: 'x',
  requires: ['claude', 'github'],
  config: [
    {
      key: 'model',
      label: '모델',
      type: 'select',
      options: [
        { value: 'opus', label: 'Opus' },
        { value: 'sonnet', label: 'Sonnet' },
      ],
      default: 'opus',
      required: true,
    },
    { key: 'queue', label: '대기열 라벨', type: 'text', options: [], default: 'AI 개발팀', required: false },
  ],
  resources: { cpuRequest: '4', memoryRequest: '8Gi', cpuLimit: '8', memoryLimit: '16Gi', workDisk: '50Gi' },
}

export const TEMPLATES: AgentTemplate[] = [DEFAULT_TEMPLATE, CLAUDE_TEMPLATE]

export function createLocation(overrides: Partial<AgentLocation> = {}): AgentLocation {
  return {
    id: 1,
    name: '운영',
    description: 'iacloud-prod · genia-agents 네임스페이스',
    isDefault: true,
    capacity: 4,
    used: 3,
    agents: [],
    settingCount: 0,
    connection: 'CONNECTED',
    lastSeenAt: new Date(Date.now() - 30_000).toISOString(),
    tokenPrefix: 'rt_8f2a',
    ...overrides,
  }
}

/** 운영(기본·연결됨 3/4) · PoC(끊김 1/2) · 사내 GPU(설치 대기 0/2). */
export function createLocations(): AgentLocation[] {
  return [
    createLocation(),
    createLocation({ id: 2, name: 'PoC', description: 'iacloud-poc-smart · agent-runner', isDefault: false, capacity: 2, used: 1, connection: 'DISCONNECTED', lastSeenAt: new Date(Date.now() - 42 * 60_000).toISOString(), tokenPrefix: 'rt_19cd' }),
    createLocation({ id: 3, name: '사내 GPU', description: null, isDefault: false, capacity: 2, used: 0, connection: 'PENDING', lastSeenAt: null, tokenPrefix: 'rt_c07e' }),
  ]
}

/** 저장된 실행 설정 — status·observed 만 바꿔 쓴다. 기본은 꺼짐(observed 없음). */
export function createSetting(
  agentUserId: number,
  overrides: Partial<AgentRuntimeSetting> = {},
): AgentRuntimeSetting {
  return {
    agentUserId,
    templateName: 'claude-code',
    templateVersion: '1',
    templateMissing: false,
    updateAvailable: false,
    locationId: null,
    effectiveLocation: createLocation(),
    config: { model: 'opus', queue: 'AI 개발팀' },
    desired: 'STOP',
    applyMode: 'IDLE',
    generation: 3,
    status: 'OFF',
    observed: null,
    ...overrides,
  }
}

/** runner 가 본 상태 — 켜진 지 72분·CPU 4.2 코어·메모리 3.2GiB 가 기본. */
export function createObserved(overrides: Partial<NonNullable<AgentRuntimeSetting['observed']>> = {}) {
  return {
    observedGeneration: 3,
    phase: 'Running',
    message: null,
    cpuMillicores: 4200,
    memoryBytes: 3.2 * 1024 ** 3,
    startedAt: new Date(Date.now() - 72 * 60_000).toISOString(),
    observedAt: new Date().toISOString(),
    agentState: null,
    agentIssueKey: null,
    agentNextCheckAt: null,
    ...overrides,
  }
}

export function createSummary(agentUserId: number, overrides: Partial<AgentRuntimeSummary> = {}): AgentRuntimeSummary {
  return {
    agentUserId,
    templateName: 'claude-code',
    templateTitle: 'Claude Code',
    status: 'OFF',
    agentState: null,
    agentIssueKey: null,
    agentNextCheckAt: null,
    locationName: null,
    message: null,
    ...overrides,
  }
}

export function createAgent(id: number, overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    id,
    username: `agent${id}`,
    email: null,
    name: `AI ${id}`,
    isActive: true,
    createdAt: '2026-10-20T00:00:00Z',
    type: 'REGULAR',
    ownerName: null,
    runtime: 'INTERNAL',
    runMode: 'SERVER',
    description: null,
    instructions: null,
    lastKeyUsedAt: null,
    ...overrides,
  }
}

export const PROJECTS: AgentRuntimeProject[] = [
  { projectKey: 'WD', name: 'Gen:iA Data', repositoryUrl: 'https://github.com/bluleo78/smart-fire-hub.git', repositoryBranch: 'main' },
]

/** 요청 기록 — 쓰기 요청 본문·경로를 순서대로 모은다. */
export interface RuntimeCalls {
  /** PUT /admin/agents/:id/runtime-setting 본문 */
  saves: PutAgentRuntimeSettingRequest[]
  /** DELETE /admin/agents/:id/runtime-setting 횟수 */
  settingDeletes: number
  /** POST /admin/agents/:id/runtime-setting/{start|stop|restart} */
  actions: string[]
  /** PUT /admin/agents/:id/runtime 본문(실행 방식 INTERNAL/EXTERNAL) */
  runtimes: { runtime: string }[]
  /** 호출 순서 — 「삭제 → 실행 방식 PUT」처럼 순서를 볼 때 */
  order: string[]
}

export interface RuntimeApiOptions {
  /** 에이전트 id → 저장된 설정. 없으면 404(기본·외부). */
  settings?: Record<number, AgentRuntimeSetting>
  summaries?: AgentRuntimeSummary[]
  locations?: AgentLocation[]
  templates?: AgentTemplate[]
  projects?: AgentRuntimeProject[]
  /** Claude(anthropic) AI 연결이 있는 에이전트 id — 그 밖은 404. */
  claudeFor?: number[]
  /** 설정 PUT·시작 등 쓰기를 이 상태로 실패시킨다(메시지 포함). */
  failWrites?: { status: number; message: string }
}

/**
 * AI 실행 관련 API 전부 — 템플릿·설정(조회·저장·삭제·켜기/끄기/다시 시작)·요약·프로젝트·위치 조회와 에이전트 실행 방식 PUT.
 * 쓰기 요청은 calls 에 모은다. 저장·삭제는 settings 에 반영해 재조회에 보인다.
 */
export function agentRuntimeApi(opts: RuntimeApiOptions = {}) {
  const settings = { ...(opts.settings ?? {}) }
  const claudeFor = opts.claudeFor ?? []
  const calls: RuntimeCalls = { saves: [], settingDeletes: 0, actions: [], runtimes: [], order: [] }
  const fail = () =>
    opts.failWrites
      ? HttpResponse.json({ message: opts.failWrites.message }, { status: opts.failWrites.status })
      : null

  const handlers = [
    http.get(`${API}/admin/agent-templates`, () => HttpResponse.json(opts.templates ?? TEMPLATES)),
    http.get(`${API}/admin/agent-runtime-summaries`, () => HttpResponse.json(opts.summaries ?? [])),
    http.get(`${API}/admin/agent-locations`, () => HttpResponse.json(opts.locations ?? createLocations())),
    http.get(`${API}/admin/agents/:id/runtime-setting/projects`, () => HttpResponse.json(opts.projects ?? PROJECTS)),
    http.get(`${API}/admin/agents/:id/runtime-setting`, ({ params }) => {
      const s = settings[Number(params.id)]
      return s ? HttpResponse.json(s) : HttpResponse.json({ message: '없음' }, { status: 404 })
    }),
    http.put(`${API}/admin/agents/:id/runtime-setting`, async ({ params, request }) => {
      const body = (await request.json()) as PutAgentRuntimeSettingRequest
      calls.saves.push(body)
      calls.order.push('PUT setting')
      const err = fail()
      if (err) return err
      const id = Number(params.id)
      settings[id] = { ...(settings[id] ?? createSetting(id)), templateName: body.templateName, locationId: body.locationId, config: body.config }
      return HttpResponse.json(settings[id])
    }),
    http.delete(`${API}/admin/agents/:id/runtime-setting`, ({ params }) => {
      calls.settingDeletes += 1
      calls.order.push('DELETE setting')
      delete settings[Number(params.id)]
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/admin/agents/:id/runtime-setting/:action`, ({ params }) => {
      calls.actions.push(String(params.action))
      const err = fail()
      if (err) return err
      return HttpResponse.json(settings[Number(params.id)] ?? createSetting(Number(params.id)))
    }),
    http.put(`${API}/admin/agents/:id/runtime`, async ({ request }) => {
      calls.runtimes.push((await request.json()) as { runtime: string })
      calls.order.push('PUT runtime')
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(`${API}/admin/agents/:id/provider-credential`, ({ params }) =>
      claudeFor.includes(Number(params.id))
        ? HttpResponse.json({ id: 1, provider: 'anthropic', baseUrl: null, label: null, createdAt: '2026-10-20T00:00:00Z', lastUsedAt: null })
        : HttpResponse.json({ message: '없음' }, { status: 404 }),
    ),
  ]
  return { handlers, calls, settings }
}
