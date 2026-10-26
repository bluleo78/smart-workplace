// 설정 > AI 비서 「개인 비서」 섹션 — 화면 컴포넌트 테스트(WP-971, WP-966).
// 등록 폼 payload(anthropic 토큰·opencode 프로브/모델/이미지 입력), 프로브 실패 폴백, 짧은 토큰·모델 미선택 차단,
// 등록 뒤 모델 목록·로딩·빈 목록 폴백, 이름·모델·생각의 깊이 변경 payload, API 실패 토스트, 토큰 라벨 표시는
// 브라우저 없이 판정되므로 e2e/pages/personal-assistant.spec.ts 에서 옮겼다. 화면 배선(@wiring)·직접 입력 중 포커스(@input)·
// 문서 스크린샷(@layout)은 E2E 에 남는다. 섹션 하나만 renderScreen 으로 띄운다(App 부팅·앱 셸 없이).
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, test, vi } from 'vitest'

import { PersonalAssistantSection } from '@/pages/profile/PersonalAssistantSection'
import { renderScreen } from '@/test/renderScreen'

type Status = {
  configured: boolean
  tokenLabel: string | null
  tokenLastUsedAt: string | null
  model: string | null
  thinkingDepth: string | null
  name: string | null
  provider: string | null
  baseUrl: string | null
  vision?: boolean | null
}

const unconfigured = (): Status => ({
  configured: false, tokenLabel: null, tokenLastUsedAt: null, model: null, thinkingDepth: null, name: null, provider: null, baseUrl: null,
})
const configured = (o: Partial<Status> = {}): Status => ({
  configured: true, tokenLabel: null, tokenLastUsedAt: null, model: 'claude-sonnet-4-6', thinkingDepth: 'NORMAL', name: null, provider: 'anthropic', baseUrl: null, ...o,
})

type Model = { id: string; label: string }
const SONNET: Model = { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }
const OPUS: Model = { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }
const BEDROCK_MODELS: Model[] = [
  { id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' },
  { id: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
]
const BEDROCK_URL = 'https://bedrock-mantle.us-east-1.api.aws/openai/v1'
const API = '/api/v1/users/me/assistant'

/**
 * 섹션을 띄운다. status 는 요청마다 불러 등록 뒤 재조회(캐시 무효화)처럼 응답을 바꿀 수 있다.
 * 쓰기 요청(PUT credential·settings·name, POST probe, DELETE)은 bodies 에 모으고, 응답 상태는 replies 로 정한다.
 */
function open(opts: {
  status: () => Status
  models?: Model[] | (() => Promise<Model[]>)
  provider?: string
  replies?: { credential?: number; settings?: number; name?: number; disable?: number; probe?: number }
  probeModels?: Model[]
  onCredential?: () => void
}) {
  const bodies = { credential: [] as unknown[], settings: [] as unknown[], name: [] as unknown[], probe: [] as unknown[], disable: 0 }
  const r = opts.replies ?? {}
  const fail = (status: number, message: string) => HttpResponse.json({ message }, { status })
  const handlers = [
    http.get(API, () => HttpResponse.json(opts.status())),
    http.get(`${API}/models`, async () => {
      const models = typeof opts.models === 'function' ? await opts.models() : (opts.models ?? [])
      return HttpResponse.json({ provider: opts.provider ?? 'anthropic', models })
    }),
    http.put(`${API}/credential`, async ({ request }) => {
      bodies.credential.push(await request.json())
      if (r.credential && r.credential >= 400) return fail(r.credential, '서버 오류가 발생했습니다.')
      opts.onCredential?.()
      return new HttpResponse(null, { status: 204 })
    }),
    http.post(`${API}/models/probe`, async ({ request }) => {
      bodies.probe.push(await request.json())
      if (r.probe && r.probe >= 400) return fail(r.probe, '프로바이더 연결에 실패했습니다')
      return HttpResponse.json({ models: opts.probeModels ?? [] })
    }),
    http.put(`${API}/settings`, async ({ request }) => {
      bodies.settings.push(await request.json())
      if (r.settings && r.settings >= 400) return fail(r.settings, '서버 오류가 발생했습니다.')
      return new HttpResponse(null, { status: 204 })
    }),
    http.put(`${API}/name`, async ({ request }) => {
      bodies.name.push(await request.json())
      return new HttpResponse(null, { status: 204 })
    }),
    http.delete(API, () => {
      bodies.disable++
      if (r.disable && r.disable >= 400) return fail(r.disable, '권한이 없습니다.')
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  const view = renderScreen(<PersonalAssistantSection />, { path: '/settings/assistant', handlers, auth: { refreshUser: vi.fn(async () => {}) } })
  return { ...view, bodies }
}

/** Radix Select 를 키보드로 열고 이름이 name 인 옵션을 고른다 — jsdom 은 포인터로 연 목록이 레이아웃 없이 바로 닫힌다. */
async function pick(user: UserEvent, trigger: HTMLElement, name: string) {
  trigger.focus()
  await user.keyboard('{Enter}')
  const option = await screen.findByRole('option', { name })
  option.focus()
  await user.keyboard('{Enter}')
}

const modelCombo = () => screen.getByRole('combobox', { name: '모델' })

describe('개인 비서 — 미설정 등록 폼', () => {
  // opencode 등록의 전 과정 — 프리셋 기본 baseURL → 프로브 payload → 고른 모델로 제출 payload → 등록 뒤 재조회로 배지 반영.
  test('opencode 등록 — 프리셋 baseURL·프로브 payload·모델 선택·제출 payload·연결 배지', async () => {
    let done = false
    const { user, bodies } = open({
      status: () => (done ? configured({ provider: 'opencode' }) : unconfigured()),
      probeModels: BEDROCK_MODELS,
      onCredential: () => (done = true),
    })
    await user.click(await screen.findByTestId('credential-provider-opencode'))
    expect(screen.getByTestId('credential-base-url')).toHaveValue(BEDROCK_URL)
    await user.click(screen.getByTestId('credential-api-key'))
    await user.paste('sk-bedrock-test-key')
    await user.click(screen.getByTestId('credential-probe-models'))
    const providerConfig = { providerId: 'amazon-bedrock-openai', options: { baseURL: BEDROCK_URL, apiKey: 'sk-bedrock-test-key' } }
    await waitFor(() => expect(bodies.probe).toEqual([{ providerConfig }]))
    await pick(user, await screen.findByTestId('credential-model-select'), 'Claude 3.5 Sonnet')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('개인 비서를 등록했습니다.')).toBeInTheDocument()
    expect(await screen.findByTestId('assistant-connection-badge')).toHaveTextContent('OpenAI 호환')
    expect(bodies.credential).toEqual([{ provider: 'opencode', providerConfig, model: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet' }])
  })

  // 프로브가 실패하면 모델 선택 대신 직접 입력이 보이고, 접두 없이 넣은 id 에 providerId/ 가 붙어 제출된다(실행 시점 splitOpencodeModel 실패 회귀).
  test('프로브 실패 → 직접 입력 폴백, 접두 없는 모델 id 에 providerId 접두가 붙어 제출된다', async () => {
    const { user, bodies } = open({ status: unconfigured, replies: { probe: 502 } })
    await user.click(await screen.findByTestId('credential-provider-opencode'))
    await user.clear(screen.getByTestId('credential-base-url'))
    await user.paste('https://api.openai.com/v1')
    await user.click(screen.getByTestId('credential-api-key'))
    await user.paste('sk-openai-test')
    await user.click(screen.getByTestId('credential-probe-models'))
    const manual = await screen.findByTestId('credential-model-manual')
    expect(screen.queryByTestId('credential-model-select')).not.toBeInTheDocument()
    await user.click(manual)
    await user.paste('gpt-4o-mini')
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('개인 비서를 등록했습니다.')).toBeInTheDocument()
    expect(bodies.credential).toHaveLength(1)
    expect((bodies.credential[0] as { model: string }).model).toBe('amazon-bedrock-openai/gpt-4o-mini')
  })

  // 모델을 고르기 전에는 등록할 수 없다 — 버튼 비활성, 요청 없음.
  test('opencode 모델 미선택이면 등록 버튼이 비활성이고 요청이 나가지 않는다', async () => {
    const { user, bodies } = open({ status: unconfigured })
    await user.click(await screen.findByTestId('credential-provider-opencode'))
    await user.click(screen.getByTestId('credential-api-key'))
    await user.paste('sk-openai-test')
    expect(screen.getByRole('button', { name: '등록' })).toBeDisabled()
    expect(bodies.credential).toHaveLength(0)
  })

  // #192 — 등록 API 가 실패하면 서버 메시지 토스트, 성공 토스트는 없다.
  test('토큰 등록 API 실패 시 오류 토스트를 보인다', async () => {
    const { user } = open({ status: unconfigured, replies: { credential: 500 } })
    await user.click(await screen.findByTestId('assistant-token-input'))
    await user.paste('x'.repeat(40))
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('서버 오류가 발생했습니다.')).toBeInTheDocument()
    expect(screen.queryByText('개인 비서 토큰을 저장했습니다.')).not.toBeInTheDocument()
  })

  // 최소 32자 검증 — 짧으면 형식 오류 토스트만 보이고 요청은 나가지 않는다.
  test('짧은 토큰이면 형식 오류 토스트를 보이고 요청하지 않는다', async () => {
    const { user, bodies } = open({ status: unconfigured })
    await user.click(await screen.findByTestId('assistant-token-input'))
    await user.paste('x'.repeat(16))
    await user.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('토큰 형식이 올바르지 않습니다.')).toBeInTheDocument()
    expect(bodies.credential).toHaveLength(0)
  })
})

describe('개인 비서 — 등록 뒤 설정', () => {
  // #261 — 모델·생각의 깊이는 shadcn Select(combobox)이고 native <select> 가 없다.
  test('모델·생각의 깊이 선택기는 shadcn Select 로 그려진다', async () => {
    const { container } = open({ status: () => configured(), models: [SONNET] })
    expect(await screen.findByRole('combobox', { name: '모델' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '생각의 깊이' })).toBeInTheDocument()
    expect(container.querySelector('select')).toBeNull()
  })

  // 모델 옵션은 GET /models 응답 그대로 — 지금 모델은 라벨로 보이고 내부 id 는 옵션 이름이 아니다.
  test('모델 선택기 옵션이 서버 모델 목록을 그대로 보이고 내부 id 는 보이지 않는다', async () => {
    const { user } = open({
      status: () => configured({ model: 'claude-sonnet-5' }),
      models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }, OPUS, { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }],
    })
    const combo = await screen.findByRole('combobox', { name: '모델' })
    expect(combo).toHaveTextContent('Claude Sonnet 5')
    combo.focus()
    await user.keyboard('{Enter}')
    const list = await screen.findByRole('listbox')
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['Claude Sonnet 5', 'Claude Opus 4.8', 'Claude Haiku 4.5'])
    expect(within(list).queryByRole('option', { name: 'claude-sonnet-5' })).not.toBeInTheDocument()
  })

  // #642 — 모델 목록 응답 전에는 스켈레톤, 도착하면 Select 로 바뀐다.
  test('모델 목록 로딩 중에는 스켈레톤, 응답 뒤에는 Select', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    open({ status: () => configured({ model: 'claude-sonnet-5' }), models: async () => (await gate, [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }]) })
    expect(await screen.findByTestId('assistant-model-loading')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '모델' })).not.toBeInTheDocument()
    release()
    expect(await screen.findByRole('combobox', { name: '모델' })).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-model-loading')).not.toBeInTheDocument()
  })

  // 목록 조회를 지원하지 않는 연결 — Select 대신 현재값·안내·직접 입력.
  test('모델 목록이 비면 현재값과 직접 입력 폴백을 보인다', async () => {
    open({ status: () => configured(), models: [] })
    expect(await screen.findByTestId('assistant-model-empty')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-model-current')).toHaveTextContent('claude-sonnet-4-6')
    expect(screen.getByTestId('assistant-model-manual-input')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-model-manual-apply')).toBeInTheDocument()
  })

  // #192 — 해제 실패는 서버 메시지 토스트, 성공 토스트 없음.
  test('개인 비서 해제 API 실패 시 오류 토스트를 보인다', async () => {
    const { user, bodies } = open({ status: () => configured(), models: [SONNET], replies: { disable: 403 } })
    await user.click(await screen.findByRole('button', { name: '연결 해제' }))
    expect(await screen.findByText('권한이 없습니다.')).toBeInTheDocument()
    expect(bodies.disable).toBe(1)
    expect(screen.queryByText('개인 비서를 해제했습니다.')).not.toBeInTheDocument()
  })

  // #198 — 모델 변경 실패가 조용히 지나가지 않는다.
  test('모델 변경 API 실패 시 오류 토스트를 보인다', async () => {
    const { user } = open({ status: () => configured(), models: [SONNET, OPUS], replies: { settings: 500 } })
    await pick(user, await screen.findByRole('combobox', { name: '모델' }), 'Claude Opus 4.8')
    expect(await screen.findByText('서버 오류가 발생했습니다.')).toBeInTheDocument()
    expect(screen.queryByText('비서 설정을 변경했습니다.')).not.toBeInTheDocument()
  })

  // 라벨로 고른 모델의 내부 id 가 PUT 으로 간다. Claude 연결은 이미지 입력 선택이 없고 vision 도 싣지 않는다.
  test('모델을 고르면 내부 id 만 PUT 하고, Claude 연결은 이미지 입력 선택을 보이지 않는다', async () => {
    const { user, bodies } = open({ status: () => configured(), models: [SONNET, OPUS] })
    await screen.findByRole('combobox', { name: '모델' })
    expect(screen.queryByTestId('assistant-vision')).not.toBeInTheDocument()
    await pick(user, modelCombo(), 'Claude Opus 4.8')
    expect(await screen.findByText('비서 설정을 변경했습니다.')).toBeInTheDocument()
    expect(bodies.settings).toEqual([{ model: 'claude-opus-4-8' }])
  })

  // #198 — 생각의 깊이 변경은 성공 토스트와 thinkingDepth payload.
  test('생각의 깊이를 바꾸면 thinkingDepth 를 PUT 하고 성공 토스트를 보인다', async () => {
    const { user, bodies } = open({ status: () => configured(), models: [SONNET] })
    await pick(user, await screen.findByRole('combobox', { name: '생각의 깊이' }), '깊게')
    expect(await screen.findByText('비서 설정을 변경했습니다.')).toBeInTheDocument()
    expect(bodies.settings).toEqual([{ thinkingDepth: 'DEEP' }])
  })

  // 이름은 명시적 저장 — 서버값이 초깃값, 저장하면 PUT /name payload 와 성공 토스트.
  test('이름을 바꿔 저장하면 PUT /name 에 새 이름을 보내고 성공 토스트를 보인다', async () => {
    const { user, bodies } = open({ status: () => configured({ name: '개인 비서' }), models: [SONNET] })
    const input = await screen.findByTestId('assistant-name-input')
    expect(input).toHaveValue('개인 비서')
    await user.clear(input)
    await user.paste('나만의 비서')
    await user.click(screen.getByTestId('assistant-name-save'))
    expect(await screen.findByText('개인 비서 이름을 변경했습니다.')).toBeInTheDocument()
    expect(bodies.name).toEqual([{ name: '나만의 비서' }])
  })

  // #607 — 그대로·비움·공백뿐이면 저장 비활성, 새 이름이면 활성. 요청은 나가지 않는다.
  test('이름이 그대로이거나 비었거나 공백뿐이면 저장 버튼이 비활성이다', async () => {
    const { user, bodies } = open({ status: () => configured({ name: '개인 비서' }), models: [SONNET] })
    const input = await screen.findByTestId('assistant-name-input')
    const save = screen.getByTestId('assistant-name-save')
    expect(save).toBeDisabled()
    await user.clear(input)
    expect(save).toBeDisabled()
    await user.paste('   ')
    expect(save).toBeDisabled()
    await user.clear(input)
    await user.paste('나만의 비서')
    expect(save).toBeEnabled()
    expect(bodies.name).toHaveLength(0)
  })

  // #264 — tokenLabel 이 없으면 「라벨 없음」 같은 개발자 문구 없이 배지만, 있으면 라벨을 그대로 보인다.
  test('토큰 라벨이 없으면 라벨 없음 문구가 없고, 있으면 라벨을 보인다', async () => {
    const first = open({ status: () => configured(), models: [SONNET] })
    const box = await screen.findByTestId('assistant-configured')
    expect(box).not.toHaveTextContent('라벨 없음')
    expect(within(box).getByTestId('assistant-connection-badge')).toHaveTextContent('Claude 구독')
    first.unmount()
    open({ status: () => configured({ tokenLabel: '내 토큰' }), models: [SONNET] })
    expect(await screen.findByTestId('assistant-configured')).toHaveTextContent('내 토큰')
  })
})
