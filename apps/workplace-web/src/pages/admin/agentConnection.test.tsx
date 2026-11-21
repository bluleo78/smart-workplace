// 에이전트 상세 「AI 연결 및 모델」 섹션 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 자격증명 등록(anthropic 토큰·opencode 프로브 → 모델 선택)·재발급·회수·짧은 토큰·서버 400·provider 뱃지는
// 폼 → payload, 응답 → 화면이라 브라우저 없이 판정되므로 e2e/pages/admin/oauth-token.spec.ts 에서 옮겼다.
// 이미지 입력 선택의 TC 스크린샷 2건(@layout)은 E2E 에 남고, /settings/agents 화면 배선은 agents.spec.ts 의 @wiring 이 지킨다.
// 섹션을 가진 가장 작은 컴포넌트(AgentConnectionSection)만 renderScreen 으로 띄운다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PROBE_MODELS_EMPTY } from '@/lib/probeModelsError'
import { renderScreen } from '@/test/renderScreen'

import { AgentConnectionSection } from './components/AgentConnectionSection'

const AGENT_ID = 100
const CREDENTIAL = `/api/v1/admin/agents/${AGENT_ID}/provider-credential`
const PROBE = '/api/v1/admin/agents/models/probe'
const BEDROCK_URL = 'https://bedrock-mantle.us-east-1.api.aws/openai/v1'

// 32자 이상 토큰 더미(64자)와 짧은 토큰(16자).
const VALID_TOKEN_64 = 'sk-ant-oat-' + 'a'.repeat(53)
const SHORT_TOKEN_16 = 'sk-ant-oat-short'

interface CredentialMeta {
  id: number
  provider: 'anthropic' | 'opencode'
  baseUrl: string | null
  label: string | null
  createdAt: string
  lastUsedAt: string | null
}

const ANTHROPIC_META: CredentialMeta = {
  id: 7,
  provider: 'anthropic',
  baseUrl: null,
  label: 'prod',
  createdAt: '2026-05-26T11:23:00Z',
  lastUsedAt: null,
}

/** POST 응답 — 성공·일반 400·「워크스페이스 ID 가 필요한 키」 400(WP-1496). */
type PostStatus = 200 | 400 | 'needWorkspace'

/** 서버가 워크스페이스 ID 없이 쓸 수 없는 키를 거절할 때의 ErrorResponse(WP-1496). */
const NEED_WORKSPACE_MESSAGE = '이 키는 Anthropic 워크스페이스 ID 가 필요합니다. Anthropic 콘솔 Workspaces 에서 ID 를 확인해 넣어 주세요.'
const NEED_WORKSPACE_BODY = {
  status: 400,
  error: 'Bad Request',
  message: '입력값 검증에 실패했습니다',
  errors: { workspaceId: NEED_WORKSPACE_MESSAGE },
  timestamp: '2026-11-11T06:00:00Z',
  path: CREDENTIAL,
}

/**
 * 자격증명 GET/POST/DELETE 를 한 상태로 다룬다 — POST 는 메타를 바꾸고 DELETE 는 지운다(재조회에 반영).
 * posts·deletes 에 요청 본문·횟수를 모은다. 공통 비서는 미지정(모델 목록 조회 없음).
 */
function credentialApi(initial: CredentialMeta | null, { postStatus = 200 }: { postStatus?: PostStatus } = {}) {
  const state = { current: initial, posts: [] as unknown[], deletes: 0 }
  const handlers = [
    http.get('/api/v1/admin/workspace-assistant', () =>
      HttpResponse.json({ agentUserId: null, agentName: null, hasActiveToken: false, model: null, thinkingDepth: null }),
    ),
    http.get(CREDENTIAL, () =>
      state.current
        ? HttpResponse.json(state.current)
        : HttpResponse.json({ message: '등록된 API 키가 없습니다' }, { status: 404 }),
    ),
    http.post(CREDENTIAL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      state.posts.push(body)
      if (postStatus === 400) return HttpResponse.json({ message: 'invalid token' }, { status: 400 })
      if (postStatus === 'needWorkspace') return HttpResponse.json(NEED_WORKSPACE_BODY, { status: 400 })
      const provider = body.provider as CredentialMeta['provider']
      const config = body.providerConfig as { options?: { baseURL?: string } } | undefined
      state.current = {
        id: (state.current?.id ?? 0) + 1,
        provider,
        baseUrl: provider === 'opencode' ? (config?.options?.baseURL ?? null) : null,
        label: null,
        createdAt: '2026-05-26T12:00:00Z',
        lastUsedAt: null,
      }
      return HttpResponse.json(state.current)
    }),
    http.delete(CREDENTIAL, () => {
      state.deletes += 1
      state.current = null
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { state, handlers }
}

/** 모델 프로브 — 200 이면 models, 아니면 status 와 body(기본: 한국어 502 문구)로 실패. 요청 본문을 모은다. */
function probeApi(opts: { status: number; models?: Array<{ id: string; label: string }>; body?: object }) {
  const bodies: unknown[] = []
  const handler = http.post(PROBE, async ({ request }) => {
    bodies.push(await request.json())
    return opts.status !== 200
      ? HttpResponse.json(opts.body ?? { message: '프로바이더 연결에 실패했습니다' }, { status: opts.status })
      : HttpResponse.json({ models: opts.models ?? [] })
  })
  return { bodies, handler }
}

const MODELS = [
  { id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' },
  { id: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
]

/** 섹션을 띄우고 첫 상태(미등록 안내 또는 재발급 버튼)가 보일 때까지 기다린다. */
async function renderSection(
  initial: CredentialMeta | null,
  opts: { postStatus?: PostStatus } = {},
  more: ReturnType<typeof http.post>[] = [],
) {
  const api = credentialApi(initial, opts)
  const view = renderScreen(<AgentConnectionSection agentUserId={AGENT_ID} canConfigure />, {
    path: `/settings/agents?agent=${AGENT_ID}`,
    handlers: [...more, ...api.handlers],
  })
  await screen.findByTestId(initial ? 'oauth-token-reissue' : 'oauth-token-register')
  return { ...view, state: api.state }
}

/** 등록 대화상자를 열고 OpenAI 호환(opencode)으로 바꾼다. */
async function openOpencode(user: ReturnType<typeof renderScreen>['user']) {
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByTestId('credential-provider-opencode'))
}

/** 등록 대화상자를 opencode 로 열고 OpenAI 주소·키를 넣어 「모델 불러오기」를 누른다. */
async function probeOpenAi(user: ReturnType<typeof renderScreen>['user']) {
  await openOpencode(user)
  await user.clear(screen.getByTestId('credential-base-url'))
  await user.paste('https://api.openai.com/v1')
  await user.click(screen.getByTestId('credential-api-key'))
  await user.paste('sk-openai-test')
  await user.click(screen.getByTestId('credential-probe-models'))
}

/** 프로브 실패 시 보이는 한국어 안내(WP-1884). */
const PROBE_FALLBACK = '모델 목록을 불러오지 못했습니다. 모델 id를 직접 입력하세요.'

test('미등록 → anthropic 토큰 등록 → payload 는 provider·token 뿐이고 등록 상태(뱃지·재발급·회수)로 바뀐다', async () => {
  const { user, state } = await renderSection(null)
  expect(screen.getByText('아직 연결하지 않았어요.')).toBeInTheDocument()

  await user.click(screen.getByTestId('oauth-token-register'))
  expect(await screen.findByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
  expect(screen.getByTestId('credential-provider-anthropic')).toBeChecked()
  await user.click(screen.getByRole('textbox', { name: '토큰' }))
  await user.paste(VALID_TOKEN_64)
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  // 레이블 입력란 제거로 label 은 보내지 않는다.
  expect(state.posts).toEqual([{ provider: 'anthropic', token: VALID_TOKEN_64 }])
  expect(await screen.findByTestId('credential-provider-badge')).toHaveTextContent('Claude 구독')
  expect(screen.getByTestId('oauth-token-reissue')).toBeInTheDocument()
  expect(screen.getByTestId('oauth-token-revoke')).toBeInTheDocument()
  expect(screen.queryByTestId('oauth-token-register')).not.toBeInTheDocument()
})

test('opencode 등록 — 기본 프리셋 URL·프로브 payload·고른 모델이 등록 payload 에 실리고 뱃지는 프리셋 이름', async () => {
  const probe = probeApi({ status: 200, models: MODELS })
  const { user, state } = await renderSection(null, {}, [probe.handler])
  await openOpencode(user)

  // 기본 프리셋(AWS Bedrock)의 baseURL 이 채워진다.
  expect(screen.getByTestId('credential-base-url')).toHaveValue(BEDROCK_URL)
  await user.click(screen.getByTestId('credential-api-key'))
  await user.paste('sk-bedrock-test-key')
  await user.click(screen.getByTestId('credential-probe-models'))

  await waitFor(() => expect(probe.bodies).toHaveLength(1))
  expect(probe.bodies[0]).toEqual({
    providerConfig: { providerId: 'amazon-bedrock-openai', options: { baseURL: BEDROCK_URL, apiKey: 'sk-bedrock-test-key' } },
  })

  await user.click(await screen.findByTestId('credential-model-select'))
  await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Claude 3.5 Sonnet' }))
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toEqual([
    {
      provider: 'opencode',
      providerConfig: { providerId: 'amazon-bedrock-openai', options: { baseURL: BEDROCK_URL, apiKey: 'sk-bedrock-test-key' } },
      model: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet',
    },
  ])
  // 등록 뒤 뱃지는 baseUrl 을 프리셋으로 역매핑한 이름, baseUrl 도 보인다.
  expect(await screen.findByTestId('credential-provider-badge')).toHaveTextContent('AWS Bedrock')
  expect(screen.getByText(BEDROCK_URL, { exact: false })).toBeInTheDocument()
})

// 프로브 실패 안내 — 5xx 내부 영문·메시지 없음은 한국어 fallback, 400 검증 실패는 영문 「Validation failed」 대신 필드 문구(WP-1884).
test.each([
  [500, { message: 'An unexpected error occurred' }, PROBE_FALLBACK],
  [400, { message: 'Validation failed', errors: { 'providerConfig.baseUrl': 'Base URL 을 입력하세요' } }, 'Base URL 을 입력하세요'],
  [500, {}, PROBE_FALLBACK],
])('opencode 프로브 %i %j → 「%s」 안내 (WP-1884)', async (status, body, shown) => {
  const probe = probeApi({ status, body })
  const { user } = await renderSection(null, {}, [probe.handler])
  await probeOpenAi(user)

  expect(await screen.findByRole('alert')).toHaveTextContent(shown)
  expect(screen.getByTestId('credential-model-manual')).toBeInTheDocument()
})

test('opencode 프로브 실패 → 모델 목록 대신 직접 입력이 나오고, 접두 없는 id 에 프리셋 접두를 붙여 보낸다', async () => {
  const probe = probeApi({ status: 502 })
  const { user, state } = await renderSection(null, {}, [probe.handler])
  await probeOpenAi(user)

  const manual = await screen.findByTestId('credential-model-manual')
  expect(screen.queryByTestId('credential-model-select')).not.toBeInTheDocument()
  // 접두 누락 시 실행 시점 splitOpencodeModel 이 실패했다 — 제출 때 자동으로 붙인다.
  await user.click(manual)
  await user.paste('gpt-4o-mini')
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toHaveLength(1)
  expect((state.posts[0] as { model: string }).model).toBe('amazon-bedrock-openai/gpt-4o-mini')
})

// 프로브가 성공했지만 목록이 비면 빈 Select 대신 안내와 직접 입력을 보인다(WP-1895).
test('opencode 프로브가 빈 목록이면 안내와 직접 입력이 나오고, 접두를 붙여 연결한다 (WP-1895)', async () => {
  const probe = probeApi({ status: 200, models: [] })
  const { user, state } = await renderSection(null, {}, [probe.handler])
  await probeOpenAi(user)

  expect(await screen.findByRole('alert')).toHaveTextContent(PROBE_MODELS_EMPTY)
  expect(screen.queryByTestId('credential-model-select')).not.toBeInTheDocument()
  expect(screen.getByTestId('credential-vision')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
  await user.click(screen.getByTestId('credential-model-manual'))
  await user.paste('gpt-4o-mini')
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toHaveLength(1)
  expect((state.posts[0] as { model: string }).model).toBe('amazon-bedrock-openai/gpt-4o-mini')
})

test('opencode 모델을 정하지 않으면 연결하기가 비활성이고 요청이 없다', async () => {
  const { user, state } = await renderSection(null)
  await openOpencode(user)
  const baseUrl = screen.getByTestId('credential-base-url')
  await user.clear(baseUrl)
  await user.paste('https://api.openai.com/v1')
  await user.click(screen.getByTestId('credential-api-key'))
  await user.paste('sk-openai-test')
  // 모델 이미지 입력 선택은 모델이 정해질 수 있는 상태(목록·직접 입력)에서만 보인다.
  expect(screen.queryByTestId('credential-vision')).not.toBeInTheDocument()

  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
  expect(state.posts).toEqual([])
  expect(screen.getByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
})

test('등록된 opencode 의 baseUrl 이 프리셋에 없으면 뱃지는 「OpenAI 호환」이고 baseUrl 이 보인다', async () => {
  await renderSection({ ...ANTHROPIC_META, id: 9, provider: 'opencode', baseUrl: 'https://llm.internal.example.com/v1' })
  expect(screen.getByTestId('credential-provider-badge')).toHaveTextContent('OpenAI 호환')
  expect(screen.getByText('https://llm.internal.example.com/v1', { exact: false })).toBeInTheDocument()
})

test('이미 등록돼 있으면 재발급·회수만 보이고, 재발급하면 새 토큰을 보내고 변경 토스트를 띄운다', async () => {
  const { user, state } = await renderSection(ANTHROPIC_META)
  expect(screen.getByTestId('oauth-token-revoke')).toBeInTheDocument()
  expect(screen.queryByTestId('oauth-token-register')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('oauth-token-reissue'))
  expect(await screen.findByRole('heading', { name: '연결 정보 변경' })).toBeInTheDocument()
  await user.click(screen.getByRole('textbox', { name: '토큰' }))
  await user.paste(VALID_TOKEN_64)
  await user.click(screen.getByRole('button', { name: '변경' }))

  expect(await screen.findByText('연결 정보를 변경했습니다.')).toBeInTheDocument()
  expect(state.posts).toEqual([{ provider: 'anthropic', token: VALID_TOKEN_64 }])
})

test('회수 확인창에서 취소하면 DELETE 가 없고, 확인하면 DELETE 1회 뒤 미등록 상태로 돌아간다', async () => {
  const { user, state } = await renderSection(ANTHROPIC_META)

  await user.click(screen.getByTestId('oauth-token-revoke'))
  await user.click(within(await screen.findByTestId('oauth-revoke-dialog')).getByTestId('oauth-revoke-cancel'))
  await waitFor(() => expect(screen.queryByTestId('oauth-revoke-dialog')).not.toBeInTheDocument())
  expect(state.deletes).toBe(0)
  expect(screen.getByTestId('oauth-token-revoke')).toBeInTheDocument()

  await user.click(screen.getByTestId('oauth-token-revoke'))
  await user.click(await screen.findByTestId('oauth-revoke-confirm'))
  expect(await screen.findByText('AI 계정 연결을 끊었습니다.')).toBeInTheDocument()
  expect(state.deletes).toBe(1)
  expect(await screen.findByText('아직 연결하지 않았어요.')).toBeInTheDocument()
  expect(screen.getByTestId('oauth-token-register')).toBeInTheDocument()
})

test('32자 미만 토큰은 오류 토스트만 띄우고 보내지 않는다(대화상자 유지)', async () => {
  const { user, state } = await renderSection(null)
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  await user.paste(SHORT_TOKEN_16)
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('토큰이 너무 짧습니다 (최소 32자)')).toBeInTheDocument()
  expect(state.posts).toEqual([])
  expect(screen.getByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
})

test('2048자를 넘는 토큰은 오류 토스트만 띄우고 보내지 않는다(서버 상한과 같다)', async () => {
  const { user, state } = await renderSection(null)
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  await user.paste('x'.repeat(2049))
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('토큰이 너무 깁니다 (최대 2048자)')).toBeInTheDocument()
  expect(state.posts).toEqual([])
  expect(screen.getByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
})

test('서버 400 이면 서버 메시지를 토스트로 띄우고 대화상자를 유지한다', async () => {
  const { user, state } = await renderSection(null, { postStatus: 400 })
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  await user.paste(VALID_TOKEN_64)
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('invalid token')).toBeInTheDocument()
  expect(state.posts).toHaveLength(1)
  expect(screen.getByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
})

// WP-1163: 구성원의 개인 비서는 관리자가 연결을 등록·재발급하거나 공통 비서로 지정할 수 없다(서버 403) — 버튼·스위치 대신 안내를 보이고, 회수만 남긴다.
test('개인 비서(canConfigure=false)는 재발급·연결하기·공통 비서 스위치 대신 안내를 보이고 회수만 할 수 있다', async () => {
  const api = credentialApi(ANTHROPIC_META)
  const { user } = renderScreen(<AgentConnectionSection agentUserId={AGENT_ID} canConfigure={false} />, {
    path: `/settings/agents?agent=${AGENT_ID}`,
    handlers: api.handlers,
  })
  expect(await screen.findByTestId('credential-provider-badge')).toHaveTextContent('Claude 구독')
  expect(screen.getByTestId('connection-personal-hint')).toHaveTextContent(
    '이 AI 의 AI 계정은 주인이 관리해요.',
  )
  expect(screen.queryByTestId('oauth-token-reissue')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-connection-assistant-toggle')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('oauth-token-revoke'))
  await user.click(await screen.findByTestId('oauth-revoke-confirm'))
  expect(await screen.findByText('AI 계정 연결을 끊었습니다.')).toBeInTheDocument()
  expect(api.state.deletes).toBe(1)
  // 회수 뒤에도 관리자가 새로 연결할 수 없다.
  expect(await screen.findByText('아직 연결하지 않았어요.')).toBeInTheDocument()
  expect(screen.queryByTestId('oauth-token-register')).not.toBeInTheDocument()
  expect(api.state.posts).toEqual([])
})

// WP-1496: 워크스페이스 ID(선택) — Claude 토큰 칸 아래 늘 보이고, 비우면 싣지 않고, 넣으면 다듬어 싣는다.
test('Claude 토큰 칸 아래 워크스페이스 ID 칸이 늘 보이고, 비우면 workspaceId 를 싣지 않는다', async () => {
  const { user, state } = await renderSection(null)
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  await user.paste(VALID_TOKEN_64)
  expect(screen.getByRole('textbox', { name: 'Anthropic 워크스페이스 ID(선택)' })).toHaveValue('')
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toEqual([{ provider: 'anthropic', token: VALID_TOKEN_64 }])
})

test('워크스페이스 ID 를 넣으면 앞뒤 공백을 다듬어 workspaceId 로 싣는다', async () => {
  const { user, state } = await renderSection(null)
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  await user.paste(VALID_TOKEN_64)
  await user.click(screen.getByTestId('anthropic-workspace-id-input'))
  await user.paste('  wrkspc_01AbC  ')
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toEqual([{ provider: 'anthropic', token: VALID_TOKEN_64, workspaceId: 'wrkspc_01AbC' }])
})

test('워크스페이스 ID 에 공백이 섞이면 칸 아래 오류만 보이고 보내지 않는다', async () => {
  const { user, state } = await renderSection(null)
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  await user.paste(VALID_TOKEN_64)
  await user.click(screen.getByTestId('anthropic-workspace-id-input'))
  await user.paste('wrkspc 01')
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByTestId('anthropic-workspace-id-error')).toHaveTextContent('공백')
  expect(screen.getByTestId('anthropic-workspace-id-input')).toHaveAttribute('aria-invalid', 'true')
  expect(state.posts).toEqual([])
})

test('서버가 워크스페이스 ID 가 필요하다고 거절하면 칸 아래 안내를 보이고 칸으로 초점을 옮긴다(대화상자·토큰 유지)', async () => {
  const { user, state } = await renderSection(null, { postStatus: 'needWorkspace' })
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  await user.paste(VALID_TOKEN_64)
  await user.click(screen.getByRole('button', { name: '연결하기' }))

  expect(await screen.findByTestId('anthropic-workspace-id-error')).toHaveTextContent(NEED_WORKSPACE_MESSAGE)
  expect(screen.getByTestId('anthropic-workspace-id-input')).toHaveFocus()
  expect(screen.getByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '토큰' })).toHaveValue(VALID_TOKEN_64)
  expect(state.posts).toHaveLength(1)
})

// ── 한 줄 칸 Enter 로 제출(WP-1622) ─────────────────────────────────────────────
// 워크스페이스 ID·Base URL·API Key·모델 id 같은 한 줄 칸에서 Enter 를 누르면 [연결하기]와 같은 조건으로 제출한다.
// 토큰(여러 줄) 칸의 Enter 는 줄바꿈이고, 한글 조합 Enter·빈 필수 칸·같은 틱 연타는 요청을 보내지 않는다.

/** 「요청이 없다」 를 네트워크 계층에서 확인하기 전 잠시 기다린다 — 요청이 나갔다면 이 사이 핸들러에 닿는다. */
const letStrayRequestArrive = () => new Promise((r) => setTimeout(r, 50))

/** 등록 창을 열고 토큰을 붙여 넣은 뒤 워크스페이스 ID 칸을 돌려준다. */
async function openWithToken(user: ReturnType<typeof renderScreen>['user'], token = VALID_TOKEN_64) {
  await user.click(screen.getByTestId('oauth-token-register'))
  await user.click(await screen.findByRole('textbox', { name: '토큰' }))
  if (token) await user.paste(token)
  return screen.getByTestId('anthropic-workspace-id-input')
}

test('Enter — 워크스페이스 ID 칸에서 Enter 를 누르면 [연결하기]와 같은 본문으로 한 번 보내고 창을 닫는다', async () => {
  const { user, state } = await renderSection(null)
  const workspaceId = await openWithToken(user)
  await user.click(workspaceId)
  await user.paste('wrkspc_01')
  await user.keyboard('{Enter}')
  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toEqual([{ provider: 'anthropic', token: VALID_TOKEN_64, workspaceId: 'wrkspc_01' }])
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'AI 연결하기' })).not.toBeInTheDocument())
})

test('Enter — 토큰이 비면 워크스페이스 ID 칸 Enter 로도 보내지 않는다', async () => {
  const { user, state } = await renderSection(null)
  const workspaceId = await openWithToken(user, '')
  await user.click(workspaceId)
  await user.keyboard('{Enter}')
  await letStrayRequestArrive()
  expect(state.posts).toEqual([])
  expect(screen.getByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
})

test.each([
  ['조합 중(isComposing)', { isComposing: true }],
  ['keyCode 229(Safari 조합 확정)', { keyCode: 229 }],
])('Enter — %s Enter 는 보내지 않는다', async (_label, init) => {
  const { user, state } = await renderSection(null)
  const workspaceId = await openWithToken(user)
  fireEvent.keyDown(workspaceId, { key: 'Enter', ...init })
  await letStrayRequestArrive()
  expect(state.posts).toEqual([])
  expect(screen.getByRole('heading', { name: 'AI 연결하기' })).toBeInTheDocument()
})

test('Enter — 토큰(여러 줄) 칸의 Enter 는 줄바꿈이고 보내지 않는다', async () => {
  const { user, state } = await renderSection(null)
  await openWithToken(user)
  await user.keyboard('{Enter}')
  await letStrayRequestArrive()
  expect(screen.getByRole('textbox', { name: '토큰' })).toHaveValue(`${VALID_TOKEN_64}\n`)
  expect(state.posts).toEqual([])
})

test('Enter — 같은 틱에 Enter 를 두 번 눌러도(다시 그리기 전) 요청은 한 번이다', async () => {
  const { user, state } = await renderSection(null)
  const workspaceId = await openWithToken(user)
  // isPending 은 다시 그린 뒤에야 바뀐다 — 한 act 안에서 연달아 보내 렌더 전 경합을 만든다.
  act(() => {
    workspaceId.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    workspaceId.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  await letStrayRequestArrive()
  expect(state.posts).toHaveLength(1)
})

test('Enter — opencode 모델을 정하지 않으면 API Key 칸 Enter 로도 보내지 않고, 직접 입력한 모델 id 칸 Enter 로는 보낸다', async () => {
  const probe = probeApi({ status: 502 })
  const { user, state } = await renderSection(null, {}, [probe.handler])
  await openOpencode(user)
  await user.click(screen.getByTestId('credential-api-key'))
  await user.paste('sk-openai-test')
  // 모델 미정 — [연결하기]가 비활성이니 Enter 도 막히고, 「모델 불러오기」도 부르지 않는다
  await user.keyboard('{Enter}')
  await letStrayRequestArrive()
  expect(state.posts).toEqual([])
  expect(probe.bodies).toEqual([])

  await user.click(screen.getByTestId('credential-probe-models'))
  const manual = await screen.findByTestId('credential-model-manual')
  await user.click(manual)
  await user.paste('gpt-4o-mini')
  await user.keyboard('{Enter}')
  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toHaveLength(1)
  expect((state.posts[0] as { model: string }).model).toBe('amazon-bedrock-openai/gpt-4o-mini')
})

/** 「모델 불러오기」 응답을 차례대로 돌려준다 — 'fail' 은 502, 'hold' 는 release 를 부를 때까지 붙잡았다가 목록을 준다. */
function probeSequence(steps: Array<'ok' | 'fail' | 'hold' | 'empty'>) {
  let calls = 0
  let release: () => void = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  const handler = http.post(PROBE, async () => {
    const step = steps[Math.min(calls, steps.length - 1)]
    calls += 1
    if (step === 'fail') return HttpResponse.json({ message: '프로바이더 연결에 실패했습니다' }, { status: 502 })
    if (step === 'empty') return HttpResponse.json({ models: [] })
    if (step === 'hold') await held
    return HttpResponse.json({ models: MODELS })
  })
  return { handler, release: () => release() }
}

/** OpenAI 호환으로 바꾸고 키를 넣은 뒤 API Key 칸을 돌려준다(주소는 기본 프리셋 값). */
async function openOpencodeWithKey(user: ReturnType<typeof renderScreen>['user']) {
  await openOpencode(user)
  const apiKey = screen.getByTestId('credential-api-key')
  await user.click(apiKey)
  await user.paste('sk-openai-test')
  return apiKey
}

test('Enter — 모델을 불러와 고른 뒤 Base URL 을 고치면 모델이 지워져, Enter 로 옛 모델을 보내지 않는다', async () => {
  const probe = probeApi({ status: 200, models: MODELS })
  const { user, state } = await renderSection(null, {}, [probe.handler])
  await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await user.click(await screen.findByTestId('credential-model-select'))
  await user.click(await screen.findByRole('option', { name: 'GPT-OSS 120B' }))
  expect(screen.getByRole('button', { name: '연결하기' })).toBeEnabled()

  const baseUrl = screen.getByTestId('credential-base-url')
  await user.click(baseUrl)
  await user.keyboard('x{Enter}')
  await letStrayRequestArrive()
  expect(state.posts).toEqual([])
  expect(screen.queryByTestId('credential-model-select')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
})

// 재시도가 빈 목록이면 Select 로 대체되지 않으므로 직접 입력한 id 를 지우지 않는다(WP-1895).
test('프로브 실패 → 직접 입력 → 다시 불러와 빈 목록이면 입력값이 남고 빈 목록 안내가 나온다 (WP-1895)', async () => {
  const probe = probeSequence(['fail', 'empty'])
  const { user } = await renderSection(null, {}, [probe.handler])
  await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await user.click(await screen.findByTestId('credential-model-manual'))
  await user.paste('my-model')
  await user.click(screen.getByTestId('credential-probe-models'))
  expect(await screen.findByRole('alert')).toHaveTextContent(PROBE_MODELS_EMPTY)
  expect(screen.getByTestId('credential-model-manual')).toHaveValue('my-model')
})

test('Enter — 불러오기 실패 뒤 직접 입력한 모델은, 다시 불러오기가 성공하면 지워져 모델을 고르기 전엔 보내지 않는다', async () => {
  const probe = probeSequence(['fail', 'ok'])
  const { user, state } = await renderSection(null, {}, [probe.handler])
  const apiKey = await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await user.click(await screen.findByTestId('credential-model-manual'))
  await user.paste('gpt-4o-mini')
  await user.click(screen.getByTestId('credential-probe-models'))
  await screen.findByTestId('credential-model-select')
  expect(screen.queryByTestId('credential-model-manual')).not.toBeInTheDocument()

  await user.click(apiKey)
  await user.keyboard('{End}{Enter}')
  await letStrayRequestArrive()
  expect(state.posts).toEqual([])
  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
})

test('Enter — 「모델 불러오기」 중에는 Enter 로도 [연결하기]로도 보내지 않는다', async () => {
  const probe = probeSequence(['fail', 'hold'])
  const { user, state } = await renderSection(null, {}, [probe.handler])
  const apiKey = await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await user.click(await screen.findByTestId('credential-model-manual'))
  await user.paste('gpt-4o-mini')
  // 다시 불러오기 — 응답을 붙잡아 둔 동안 직접 입력한 모델은 아직 남아 있다
  await user.click(screen.getByTestId('credential-probe-models'))
  await screen.findByRole('button', { name: '불러오는 중…' })
  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
  await user.click(apiKey)
  await user.keyboard('{End}{Enter}')
  await letStrayRequestArrive()
  expect(state.posts).toEqual([])
  probe.release()
  await screen.findByTestId('credential-model-select')
})

// WP-1900: 연결을 바꾸면 앞 요청을 끊으므로, 앞 요청이 끝나기를 기다리지 않고 곧바로 다시 불러오거나 연결할 수 있다.
test('모델 불러오기 도중 주소를 바꾸면 곧바로 다시 불러올 수 있다 (WP-1900)', async () => {
  const probe = probeSequence(['hold', 'ok'])
  const { user } = await renderSection(null, {}, [probe.handler])
  await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await screen.findByRole('button', { name: '불러오는 중…' })
  await user.click(screen.getByTestId('credential-base-url'))
  await user.keyboard('{End}x')
  const probeButton = screen.getByTestId('credential-probe-models')
  expect(probeButton).toHaveTextContent('모델 불러오기')
  expect(probeButton).toBeEnabled()
  await user.click(probeButton)
  expect(await screen.findByTestId('credential-model-select')).toBeInTheDocument()
  probe.release()
})

test('모델 불러오기 도중 키를 바꾸면 앞 요청이 도는 동안에도 직접 입력 모델로 연결할 수 있다 (WP-1900)', async () => {
  const probe = probeSequence(['hold', 'fail'])
  const { user, state } = await renderSection(null, {}, [probe.handler])
  const apiKey = await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await screen.findByRole('button', { name: '불러오는 중…' })
  await user.click(apiKey)
  await user.keyboard('{End}x')
  await user.click(screen.getByTestId('credential-probe-models'))
  await user.click(await screen.findByTestId('credential-model-manual'))
  await user.paste('gpt-4o-mini')
  await user.click(screen.getByRole('button', { name: '연결하기' }))
  expect(await screen.findByText('AI에 연결했습니다.')).toBeInTheDocument()
  expect(state.posts).toHaveLength(1)
  const posted = state.posts[0] as { model: string; providerConfig: { options: { apiKey: string } } }
  expect(posted.model).toBe('amazon-bedrock-openai/gpt-4o-mini')
  // 바꾼 키(끝에 x)가 실려야 「지금 연결」로 등록한 것이다 — 앞 요청의 옛 키가 아니다.
  expect(posted.providerConfig.options.apiKey).toBe('sk-openai-testx')
  probe.release()
})

// WP-1900: 대화상자는 닫혀도 컴포넌트는 남아 있으므로, [취소]가 reset 을 건너뛰면 불러오는 중에 닫은 뒤 다시 열었을 때
// 진행 표시·목록·오류·입력한 값이 그대로 남는다 — [취소]도 Radix 닫힘과 같은 reset 경로를 거쳐야 한다.
test('모델 불러오기 도중 취소하면 다시 열었을 때 진행 표시·목록·값이 남지 않는다 (WP-1900)', async () => {
  const probe = probeSequence(['hold', 'ok'])
  const { user } = await renderSection(null, {}, [probe.handler])
  await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await screen.findByRole('button', { name: '불러오는 중…' })

  await user.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'AI 연결하기' })).not.toBeInTheDocument())

  // 다시 열어 OpenAI 호환으로 돌아온다 — 남은 진행 표시·목록·오류 없이 입력 칸도 처음 상태여야 한다.
  await user.click(await screen.findByTestId('oauth-token-register'))
  await user.click(await screen.findByTestId('credential-provider-opencode'))
  const probeButton = screen.getByTestId('credential-probe-models')
  expect(probeButton).toHaveTextContent('모델 불러오기')
  expect(screen.queryByTestId('credential-model-select')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByTestId('credential-api-key')).toHaveValue('')
  probe.release()
})

// WP-1900 리뷰 반려 ②: 개인 비서와 같은 뜻 — 연결 종류를 바꾸면 고른 모델까지 비워야, 화면에 없는 모델로 연결되지 않는다.
test('모델을 고른 뒤 연결 종류를 바꿨다 돌아오면 [연결하기]가 막힌다 (WP-1900)', async () => {
  const probe = probeApi({ status: 200, models: MODELS })
  const { user, state } = await renderSection(null, {}, [probe.handler])
  await openOpencodeWithKey(user)
  await user.click(screen.getByTestId('credential-probe-models'))
  await user.click(await screen.findByTestId('credential-model-select'))
  await user.click(await screen.findByRole('option', { name: 'GPT-OSS 120B' }))
  expect(screen.getByRole('button', { name: '연결하기' })).toBeEnabled()

  await user.click(await screen.findByTestId('credential-provider-anthropic'))
  await user.click(await screen.findByTestId('credential-provider-opencode'))
  expect(screen.queryByTestId('credential-model-select')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '연결하기' })).toBeDisabled()
  expect(state.posts).toEqual([])
})

test('Enter — 짧은 토큰으로 같은 틱에 Enter 를 두 번 눌러도 「짧다」 알림은 한 번이다', async () => {
  const { user, state } = await renderSection(null)
  const workspaceId = await openWithToken(user, SHORT_TOKEN_16)
  act(() => {
    workspaceId.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    workspaceId.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })
  expect(await screen.findByText('토큰이 너무 짧습니다 (최소 32자)')).toBeInTheDocument()
  await letStrayRequestArrive()
  expect(screen.getAllByText('토큰이 너무 짧습니다 (최소 32자)')).toHaveLength(1)
  expect(state.posts).toEqual([])
})
