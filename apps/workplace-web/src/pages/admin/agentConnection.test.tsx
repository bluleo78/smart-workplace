// 에이전트 상세 「AI 연결 및 모델」 섹션 — 화면 컴포넌트 테스트(WP-971, WP-995).
// 자격증명 등록(anthropic 토큰·opencode 프로브 → 모델 선택)·재발급·회수·짧은 토큰·서버 400·provider 뱃지는
// 폼 → payload, 응답 → 화면이라 브라우저 없이 판정되므로 e2e/pages/admin/oauth-token.spec.ts 에서 옮겼다.
// 이미지 입력 선택의 TC 스크린샷 2건(@layout)은 E2E 에 남고, /settings/agents 화면 배선은 agents.spec.ts 의 @wiring 이 지킨다.
// 섹션을 가진 가장 작은 컴포넌트(AgentConnectionSection)만 renderScreen 으로 띄운다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

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

/**
 * 자격증명 GET/POST/DELETE 를 한 상태로 다룬다 — POST 는 메타를 바꾸고 DELETE 는 지운다(재조회에 반영).
 * posts·deletes 에 요청 본문·횟수를 모은다. 공통 비서는 미지정(모델 목록 조회 없음).
 */
function credentialApi(initial: CredentialMeta | null, { postStatus = 200 }: { postStatus?: 200 | 400 } = {}) {
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

/** 모델 프로브 — 성공이면 models, 실패면 502. 요청 본문을 모은다. */
function probeApi(opts: { status: 200 | 502; models?: Array<{ id: string; label: string }> }) {
  const bodies: unknown[] = []
  const handler = http.post(PROBE, async ({ request }) => {
    bodies.push(await request.json())
    return opts.status === 502
      ? HttpResponse.json({ message: '프로바이더 연결에 실패했습니다' }, { status: 502 })
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
  opts: { postStatus?: 200 | 400 } = {},
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

test('미등록 → anthropic 토큰 등록 → payload 는 provider·token 뿐이고 등록 상태(뱃지·재발급·회수)로 바뀐다', async () => {
  const { user, state } = await renderSection(null)
  expect(screen.getByText('아직 연결되지 않았습니다. 연결하면 에이전트가 LLM을 호출할 수 있어요.')).toBeInTheDocument()

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
  expect(screen.getByText(BEDROCK_URL)).toBeInTheDocument()
})

test('opencode 프로브 실패 → 모델 목록 대신 직접 입력이 나오고, 접두 없는 id 에 프리셋 접두를 붙여 보낸다', async () => {
  const probe = probeApi({ status: 502 })
  const { user, state } = await renderSection(null, {}, [probe.handler])
  await openOpencode(user)

  const baseUrl = screen.getByTestId('credential-base-url')
  await user.clear(baseUrl)
  await user.paste('https://api.openai.com/v1')
  await user.click(screen.getByTestId('credential-api-key'))
  await user.paste('sk-openai-test')
  await user.click(screen.getByTestId('credential-probe-models'))

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
  expect(screen.getByText('https://llm.internal.example.com/v1')).toBeInTheDocument()
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
  expect(await screen.findByText('API 키를 회수했습니다.')).toBeInTheDocument()
  expect(state.deletes).toBe(1)
  expect(await screen.findByText('아직 연결되지 않았습니다. 연결하면 에이전트가 LLM을 호출할 수 있어요.')).toBeInTheDocument()
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
    '개인 비서의 AI 연결은 주인이 설정에서 정하고, 공통 비서로는 지정할 수 없어요.',
  )
  expect(screen.queryByTestId('oauth-token-reissue')).not.toBeInTheDocument()
  expect(screen.queryByTestId('agent-connection-assistant-toggle')).not.toBeInTheDocument()

  await user.click(screen.getByTestId('oauth-token-revoke'))
  await user.click(await screen.findByTestId('oauth-revoke-confirm'))
  expect(await screen.findByText('API 키를 회수했습니다.')).toBeInTheDocument()
  expect(api.state.deletes).toBe(1)
  // 회수 뒤에도 관리자가 새로 연결할 수 없다.
  expect(await screen.findByText('아직 연결되지 않았습니다. 연결하면 에이전트가 LLM을 호출할 수 있어요.')).toBeInTheDocument()
  expect(screen.queryByTestId('oauth-token-register')).not.toBeInTheDocument()
  expect(api.state.posts).toEqual([])
})
