import type { Route } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockMyAssistantModels, mockMyAssistantStatus } from '../fixtures/my-assistant-mock'
import { trackRequests } from '../fixtures/requests'

// 프로필 개인 비서 섹션 E2E — Task 13: 등록 폼이 admin ProviderCredentialDialog(Task 12)와 동일한
// 2모드(anthropic 토큰 / opencode 프리셋+프로브+모델선택) UX 를 따르도록 개편.
// 백엔드 없이 GET 상태/POST 자격증명/모델 API 를 page.route 로 모킹. 등록 후 GET 응답을 configured=true 로
// 바꿔 캐시 무효화 → 재조회 → UI 반영을 검증한다.
// 신규 route: PUT /users/me/assistant/token → POST /users/me/assistant/credential 로 교체(Task 11/12 대응).

interface AssistantStatusFixture {
  configured: boolean
  tokenLabel: string | null
  tokenLastUsedAt: string | null
  model: string | null
  thinkingDepth: string | null
  name?: string | null
  provider?: string | null
  baseUrl?: string | null
  vision?: boolean | null
}

function unconfiguredStatus(): AssistantStatusFixture {
  return {
    configured: false,
    tokenLabel: null,
    tokenLastUsedAt: null,
    model: null,
    thinkingDepth: null,
    name: null,
    provider: null,
    baseUrl: null,
  }
}

function configuredStatus(overrides: Partial<AssistantStatusFixture> = {}): AssistantStatusFixture {
  return {
    configured: true,
    tokenLabel: null,
    tokenLastUsedAt: null,
    model: 'claude-sonnet-4-6',
    thinkingDepth: 'NORMAL',
    name: null,
    provider: 'anthropic',
    baseUrl: null,
    ...overrides,
  }
}

// GET 상태 — 공용 목(my-assistant-mock)에 이 spec 의 상태 타입을 붙인다.
const mockStatus = (page: import('@playwright/test').Page, get: () => AssistantStatusFixture) => mockMyAssistantStatus(page, get)

// PUT /users/me/assistant/credential — 성공 응답. 등록 요청 tracker 를 돌려준다.
function mockCredentialRegister(
  page: import('@playwright/test').Page,
  onSuccess?: () => void,
) {
  const requests = trackRequests(page, 'PUT', '/api/v1/users/me/assistant/credential')
  page.route('**/api/v1/users/me/assistant/credential', (route: Route) => {
    if (route.request().method() === 'PUT') {
      onSuccess?.()
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fallback()
  })
  return requests
}

// GET /users/me/assistant/models — 설정된 비서의 서버 모델 목록(공용 목).
const mockModels = mockMyAssistantModels

// POST /users/me/assistant/models/probe — 성공/실패 응답. 프로브 요청 tracker 를 돌려준다.
function mockProbe(
  page: import('@playwright/test').Page,
  opts: { status: 200 | 502; models?: Array<{ id: string; label: string }> },
) {
  const requests = trackRequests(page, 'ANY', '/api/v1/users/me/assistant/models/probe')
  page.route('**/api/v1/users/me/assistant/models/probe', (route) => {
    if (opts.status === 502) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: '프로바이더 연결에 실패했습니다' }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: opts.models ?? [] }),
    })
  })
  return requests
}

test.describe('프로필 개인 비서', () => {
  test('미설정 → anthropic 토큰 등록 → 설정됨', { tag: '@smoke' }, async ({
    authenticatedPage: page,
  }) => {
    let configured = false
    await mockStatus(page, () => (configured ? configuredStatus() : unconfiguredStatus()))
    const requests = mockCredentialRegister(page, () => {
      configured = true
    })
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])

    await page.goto('/settings/assistant')

    // 기본 선택 — anthropic.
    await expect(page.getByTestId('credential-provider-anthropic')).toBeChecked()

    await page.getByTestId('assistant-token-input').fill('x'.repeat(40))
    await page.getByRole('button', { name: '등록' }).click()

    await expect(page.getByText('개인 비서 토큰을 저장했습니다.')).toBeVisible()
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await expect(page.getByTestId('assistant-connection-badge')).toHaveText('Claude 구독')

    expect(requests.count()).toBe(1)
    expect(requests.bodies()[0]).toEqual({ provider: 'anthropic', token: 'x'.repeat(40) })
  })

  test(
    '미설정 → opencode 등록 — 프리셋 선택 → 프로브 payload 검증 → 모델 선택 → 제출 payload 검증',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      let configured = false
      await mockStatus(page, () => (configured ? configuredStatus({ provider: 'opencode' }) : unconfiguredStatus()))
      const requests = mockCredentialRegister(page, () => {
        configured = true
      })
      const probeRequests = mockProbe(page, {
        status: 200,
        models: [
          { id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' },
          { id: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
        ],
      })

      await page.goto('/settings/assistant')

      await page.getByTestId('credential-provider-opencode').click()
      await expect(page.getByTestId('credential-base-url')).toHaveValue(
        'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
      )

      await page.getByTestId('credential-api-key').fill('sk-bedrock-test-key')
      await page.getByTestId('credential-probe-models').click()

      await expect.poll(probeRequests.count).toBe(1)
      expect(probeRequests.bodies()[0]).toEqual({
        providerConfig: {
          providerId: 'amazon-bedrock-openai',
          options: {
            baseURL: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
            apiKey: 'sk-bedrock-test-key',
          },
        },
      })

      const modelSelect = page.getByTestId('credential-model-select')
      await expect(modelSelect).toBeVisible()
      await modelSelect.click()
      await page.getByRole('option', { name: 'Claude 3.5 Sonnet' }).click()

      await page.getByRole('button', { name: '등록' }).click()

      await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()
      await expect(page.getByTestId('assistant-connection-badge')).toHaveText('OpenAI 호환')

      expect(requests.count()).toBe(1)
      expect(requests.bodies()[0]).toEqual({
        provider: 'opencode',
        providerConfig: {
          providerId: 'amazon-bedrock-openai',
          options: {
            baseURL: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
            apiKey: 'sk-bedrock-test-key',
          },
        },
        model: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet',
      })
    },
  )

  test('opencode 프로브 실패 → 수동 모델 입력 폴백 노출 + 제출 가능', async ({
    authenticatedPage: page,
  }) => {
    let configured = false
    await mockStatus(page, () => (configured ? configuredStatus({ provider: 'opencode' }) : unconfiguredStatus()))
    const requests = mockCredentialRegister(page, () => {
      configured = true
    })
    mockProbe(page, { status: 502 })

    await page.goto('/settings/assistant')
    await page.getByTestId('credential-provider-opencode').click()

    await page.getByTestId('credential-base-url').fill('https://api.openai.com/v1')
    await page.getByTestId('credential-api-key').fill('sk-openai-test')
    await page.getByTestId('credential-probe-models').click()

    await expect(page.getByTestId('credential-model-select')).toHaveCount(0)
    const manualModel = page.getByTestId('credential-model-manual')
    await expect(manualModel).toBeVisible()

    // providerId/ 접두 없이 실제 모델 id 만 입력해도 제출 시 자동으로 접두된다(실측 회귀 방지 —
    // 접두 누락 시 실행 시점 splitOpencodeModel 실패).
    await manualModel.fill('gpt-4o-mini')
    await page.getByRole('button', { name: '등록' }).click()

    await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()
    expect(requests.count()).toBe(1)
    expect(requests.bodies<{ model: string }>()[0].model).toBe('amazon-bedrock-openai/gpt-4o-mini')
  })

  test('opencode 수동 입력에 이미 providerId/ 접두가 있으면 중복 접두하지 않는다', async ({
    authenticatedPage: page,
  }) => {
    let configured = false
    await mockStatus(page, () => (configured ? configuredStatus({ provider: 'opencode' }) : unconfiguredStatus()))
    const requests = mockCredentialRegister(page, () => {
      configured = true
    })
    mockProbe(page, { status: 502 })

    await page.goto('/settings/assistant')
    await page.getByTestId('credential-provider-opencode').click()

    await page.getByTestId('credential-base-url').fill('https://api.openai.com/v1')
    await page.getByTestId('credential-api-key').fill('sk-openai-test')
    await page.getByTestId('credential-probe-models').click()

    const manualModel = page.getByTestId('credential-model-manual')
    await expect(manualModel).toBeVisible()
    await manualModel.fill('amazon-bedrock-openai/gpt-4o-mini')
    await page.getByRole('button', { name: '등록' }).click()

    await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()
    expect(requests.count()).toBe(1)
    expect(requests.bodies<{ model: string }>()[0].model).toBe('amazon-bedrock-openai/gpt-4o-mini')
  })

  test('opencode 이미지 입력 — 기본 자동 감지 → 볼 수 있음 선택 시 모델 id 키의 vision 이 전송된다', async ({
    authenticatedPage: page,
  }) => {
    let configured = false
    await mockStatus(page, () => (configured ? configuredStatus({ provider: 'opencode' }) : unconfiguredStatus()))
    const requests = mockCredentialRegister(page, () => {
      configured = true
    })
    mockProbe(page, {
      status: 200,
      models: [
        { id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' },
        { id: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
      ],
    })

    await page.goto('/settings/assistant')
    await page.getByTestId('credential-provider-opencode').click()
    await expect(page.getByTestId('credential-vision')).toHaveCount(0)

    await page.getByTestId('credential-api-key').fill('sk-bedrock-test-key')
    await page.getByTestId('credential-probe-models').click()
    await page.getByTestId('credential-model-select').click()
    await page.getByRole('option', { name: 'GPT-OSS 120B' }).click()

    const vision = page.getByTestId('credential-vision')
    await expect(vision).toHaveText('자동 감지')
    // 인라인 폼이 길어 뷰포트 아래로 밀리므로 스크린샷 전에 선택 상자를 화면 안으로 가져온다.
    await vision.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: '../../test-results/tc/personal-assistant-vision/vision-select.png',
    })
    await vision.click()
    await page.getByRole('option', { name: '볼 수 있음' }).click()
    await expect(vision).toHaveText('볼 수 있음')

    await page.getByRole('button', { name: '등록' }).click()
    await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()

    expect(requests.count()).toBe(1)
    expect(
      requests.bodies<{ providerConfig: { vision?: unknown } }>()[0].providerConfig.vision,
    ).toEqual({ 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0': true })
  })

  test('opencode 이미지 입력 — 모델을 바꾸면 자동 감지로 되돌아가고 vision 키가 전송되지 않는다', async ({
    authenticatedPage: page,
  }) => {
    let configured = false
    await mockStatus(page, () => (configured ? configuredStatus({ provider: 'opencode' }) : unconfiguredStatus()))
    const requests = mockCredentialRegister(page, () => {
      configured = true
    })
    mockProbe(page, {
      status: 200,
      models: [
        { id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' },
        { id: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
      ],
    })

    await page.goto('/settings/assistant')
    await page.getByTestId('credential-provider-opencode').click()
    await page.getByTestId('credential-api-key').fill('sk-bedrock-test-key')
    await page.getByTestId('credential-probe-models').click()

    await page.getByTestId('credential-model-select').click()
    await page.getByRole('option', { name: 'GPT-OSS 120B' }).click()
    const vision = page.getByTestId('credential-vision')
    await vision.click()
    await page.getByRole('option', { name: '볼 수 없음' }).click()
    await expect(vision).toHaveText('볼 수 없음')

    await page.getByTestId('credential-model-select').click()
    await page.getByRole('option', { name: 'Claude 3.5 Sonnet' }).click()
    await expect(vision).toHaveText('자동 감지')

    await page.getByRole('button', { name: '등록' }).click()
    await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()

    expect(requests.count()).toBe(1)
    expect(requests.bodies<{ providerConfig: Record<string, unknown> }>()[0].providerConfig).not.toHaveProperty(
      'vision',
    )
  })

  // WP-250 최종 리뷰: 직접 입력 중 키를 칠 때마다 선택이 지워지지 않는다 — 선택은 그때의 모델 id 에만 적용되고,
  // 같은 id 로 정리되는 입력(끝 공백)에는 유지, 다른 id 가 되면 자동 감지로 보인다.
  test('opencode 수동 입력 — 이미지 입력 선택은 그 모델 id 에만 적용되고 같은 id 로 정리되는 입력에는 유지된다', async ({
    authenticatedPage: page,
  }) => {
    let configured = false
    await mockStatus(page, () => (configured ? configuredStatus({ provider: 'opencode' }) : unconfiguredStatus()))
    const requests = mockCredentialRegister(page, () => {
      configured = true
    })
    mockProbe(page, { status: 502 })

    await page.goto('/settings/assistant')
    await page.getByTestId('credential-provider-opencode').click()
    await page.getByTestId('credential-base-url').fill('https://api.openai.com/v1')
    await page.getByTestId('credential-api-key').fill('sk-openai-test')
    await page.getByTestId('credential-probe-models').click()

    const manual = page.getByTestId('credential-model-manual')
    await manual.fill('gpt-4o')
    const vision = page.getByTestId('credential-vision')
    await vision.click()
    await page.getByRole('option', { name: '볼 수 있음' }).click()
    await expect(vision).toHaveText('볼 수 있음')

    // 끝 공백은 제출 id 가 같아(앞뒤 공백 정리) 선택이 그대로다 — 지울 때도 마찬가지.
    await manual.press('End')
    await manual.pressSequentially(' ')
    await expect(vision).toHaveText('볼 수 있음')
    await manual.press('Backspace')
    await expect(vision).toHaveText('볼 수 있음')

    // 다른 모델 id 가 되면 자동 감지로 보인다(이전 모델의 지정이 따라가지 않는다).
    await manual.pressSequentially('-mini')
    await expect(vision).toHaveText('자동 감지')
    await vision.click()
    await page.getByRole('option', { name: '볼 수 없음' }).click()

    await page.getByRole('button', { name: '등록' }).click()
    await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()

    expect(requests.count()).toBe(1)
    const body = requests.bodies<{ model: string; providerConfig: { vision?: unknown } }>()[0]
    expect(body.model).toBe('amazon-bedrock-openai/gpt-4o-mini')
    expect(body.providerConfig.vision).toEqual({ 'amazon-bedrock-openai/gpt-4o-mini': false })
  })

  test('opencode 모델 미선택 → 제출 버튼 비활성(POST 호출 없음)', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, unconfiguredStatus)
    const requests = mockCredentialRegister(page)

    await page.goto('/settings/assistant')
    await page.getByTestId('credential-provider-opencode').click()

    await page.getByTestId('credential-base-url').fill('https://api.openai.com/v1')
    await page.getByTestId('credential-api-key').fill('sk-openai-test')

    // 프로브를 호출하지 않아 모델 미선택 상태 — 제출 버튼이 비활성화되어 클릭 자체가 불가하다.
    const submitBtn = page.getByRole('button', { name: '등록' })
    await expect(submitBtn).toBeDisabled()

    expect(requests.count()).toBe(0)
  })

  test('AI 비서 페이지 제목', async ({ authenticatedPage: page }) => {
    await mockStatus(page, unconfiguredStatus)
    await page.goto('/settings/assistant')
    // 페이지 제목 = 사이드바 메뉴 라벨(#651)
    await expect(page.getByRole('heading', { name: 'AI 비서' })).toBeVisible()
  })

  // #261 — 모델/생각의 깊이 선택기가 shadcn Select 로 렌더링되어야 한다 (native <select> 금지).
  test('모델·생각의 깊이 선택기가 shadcn Select로 렌더링된다', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    // native <select> 요소가 없어야 한다 — shadcn SelectTrigger(role="combobox")로 대체됨.
    await expect(page.locator('select')).toHaveCount(0)

    await expect(page.getByRole('combobox', { name: '모델', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '생각의 깊이' })).toBeVisible()
  })

  // 모델 Select 옵션이 GET /users/me/assistant/models 서버 응답을 그대로 반영하는지 검증.
  test('모델 선택기 옵션이 서버 모델 목록 응답을 그대로 반영', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ model: 'claude-sonnet-5' }))
    const modelGets = trackRequests(page, 'GET', '/api/v1/users/me/assistant/models')
    await page.route('**/api/v1/users/me/assistant/models', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            provider: 'anthropic',
            models: [
              { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
              { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
              { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
            ],
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await modelGets.waitFor()

    await expect(page.getByRole('combobox', { name: '모델', exact: true })).toContainText('Claude Sonnet 5')

    await page.getByRole('combobox', { name: '모델', exact: true }).click()
    await expect(page.getByRole('option', { name: 'Claude Sonnet 5' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Claude Opus 4.8' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Claude Haiku 4.5' })).toBeVisible()
    // 내부 ID 형식('claude-sonnet-5')은 옵션 레이블로 노출되면 안 된다.
    await expect(page.getByRole('option', { name: 'claude-sonnet-5' })).not.toBeVisible()
  })

  // #642 — 모델 목록 조회(GET /users/me/assistant/models) 응답 지연 중에는 "모델" 필드가
  // 완전히 빈 상태가 아니라 스켈레톤을 보여줘야 한다. 응답 도착 후 스켈레톤은 사라지고 Select 로 교체된다.
  test('모델 목록 로딩 중 스켈레톤 표시 → 응답 도착 후 Select로 교체', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ model: 'claude-sonnet-5' }))

    let resolveModels: (() => void) | undefined
    const modelsResponseGate = new Promise<void>((resolve) => {
      resolveModels = resolve
    })
    await page.route('**/api/v1/users/me/assistant/models', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await modelsResponseGate
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          provider: 'anthropic',
          models: [{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5' }],
        }),
      })
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    // 응답이 오기 전: 로딩 스켈레톤이 보이고, Select/폴백 텍스트는 아직 없어야 한다.
    await expect(page.getByTestId('assistant-model-loading')).toBeVisible()
    await expect(page.getByRole('combobox', { name: '모델', exact: true })).not.toBeVisible()

    // 응답 도착 후: 스켈레톤은 사라지고 Select 가 나타난다.
    resolveModels?.()
    await expect(page.getByTestId('assistant-model-loading')).not.toBeVisible()
    await expect(page.getByRole('combobox', { name: '모델', exact: true })).toBeVisible()
  })

  // 모델 목록이 비어 있으면(프로바이더가 목록 조회 미지원) Select 대신 현재값 표시 + 직접 입력 폴백 노출.
  test('모델 목록 없음 → 현재값 표시 + 직접 입력 폴백', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [])

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await expect(page.getByTestId('assistant-model-empty')).toBeVisible()
    await expect(page.getByTestId('assistant-model-current')).toBeVisible()
    await expect(page.getByTestId('assistant-model-manual-input')).toBeVisible()
    await expect(page.getByTestId('assistant-model-manual-apply')).toBeVisible()
  })

  // 직접 입력 폴백으로 모델을 변경하면 접두 없는 입력에 현재 providerId 가 자동 부여된다.
  test('모델 직접 입력 변경 → providerId 자동 접두', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus({ model: 'amazon-bedrock-openai/google.gemma-4-31b' }))
    await mockModels(page, [])

    const settingsPuts = trackRequests(page, 'PUT', '/api/v1/users/me/assistant/settings')
    await page.route('**/api/v1/users/me/assistant/settings', (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-model-manual-input')).toBeVisible()
    await page.getByTestId('assistant-model-manual-input').fill('claude-4-6')
    await page.getByTestId('assistant-model-manual-apply').click()

    await expect.poll(() => settingsPuts.lastBody()).toEqual({ model: 'amazon-bedrock-openai/claude-4-6' })
  })

  // #192 — 자격증명 등록 API 실패 시 오류 토스트가 표시되어야 한다.
  test('토큰 등록 API 실패 시 오류 토스트 표시', async ({ authenticatedPage: page }) => {
    await mockStatus(page, unconfiguredStatus)
    await page.route('**/api/v1/users/me/assistant/credential', (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: '서버 오류가 발생했습니다.' }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    await page.getByTestId('assistant-token-input').fill('x'.repeat(40))
    await page.getByRole('button', { name: '등록' }).click()

    await expect(page.getByText('서버 오류가 발생했습니다.')).toBeVisible()
    await expect(page.getByText('개인 비서 토큰을 저장했습니다.')).not.toBeVisible()
  })

  // 짧은 토큰 → 형식 에러 토스트 + POST 호출 없음 (회귀 — 최소 32자 검증 byte-identical 유지).
  test('짧은 토큰 → 에러 토스트 + POST 호출 없음', async ({ authenticatedPage: page }) => {
    await mockStatus(page, unconfiguredStatus)
    const requests = mockCredentialRegister(page)

    await page.goto('/settings/assistant')
    await page.getByTestId('assistant-token-input').fill('x'.repeat(16))
    await page.getByRole('button', { name: '등록' }).click()

    await expect(page.getByText('토큰 형식이 올바르지 않습니다.')).toBeVisible()
    expect(requests.count()).toBe(0)
  })

  // #192 — 해제 API 실패 시 오류 토스트가 표시되어야 한다.
  test('개인 비서 해제 API 실패 시 오류 토스트 표시', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    await page.route('**/api/v1/users/me/assistant', (route) => {
      if (route.request().method() === 'DELETE') {
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: '권한이 없습니다.' }),
        })
      }
      return route.fallback()
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('button', { name: '연결 해제' }).click()

    await expect(page.getByText('권한이 없습니다.')).toBeVisible()
    await expect(page.getByText('개인 비서를 해제했습니다.')).not.toBeVisible()
  })

  // #198 — 모델 변경 PUT /settings 실패 시 오류 토스트가 표시되어야 한다(silent failure 방지).
  test('모델 변경 API 실패 시 오류 토스트 표시', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    ])
    await page.route('**/api/v1/users/me/assistant/settings', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '서버 오류가 발생했습니다.' }),
      }),
    )

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('combobox', { name: '모델', exact: true }).click()
    await page.getByRole('option', { name: 'Claude Opus 4.8' }).click()

    await expect(page.getByText('서버 오류가 발생했습니다.')).toBeVisible()
    await expect(page.getByText('비서 설정을 변경했습니다.')).not.toBeVisible()
  })

  // 모델로 Claude Opus 4.8 을 선택하면 내부 ID('claude-opus-4-8')가 PUT payload 로 전송된다.
  test('모델 선택 시 올바른 모델 ID 가 PUT 으로 전송된다', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    ])
    const puts = trackRequests(page, 'ANY', '/api/v1/users/me/assistant/settings')
    await page.route('**/api/v1/users/me/assistant/settings', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }))

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('combobox', { name: '모델', exact: true }).click()
    await page.getByRole('option', { name: 'Claude Opus 4.8' }).click()

    await expect(page.getByText('비서 설정을 변경했습니다.')).toBeVisible()
    expect(puts.lastBody()).toEqual({ model: 'claude-opus-4-8' })
  })

  // 개인 비서 이름 변경 — 명시적 저장 후 PUT /name payload 검증 + 성공 토스트.
  test('개인 비서 이름 변경 → PUT /name payload + 성공 토스트', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ name: '개인 비서' }))
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    const puts = trackRequests(page, 'ANY', '/api/v1/users/me/assistant/name')
    await page.route('**/api/v1/users/me/assistant/name', (route) => route.fulfill({ status: 204, body: '' }))

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    await expect(page.getByTestId('assistant-name-input')).toHaveValue('개인 비서')
    await page.getByTestId('assistant-name-input').fill('나만의 비서')
    await page.getByTestId('assistant-name-save').click()

    await expect(page.getByText('개인 비서 이름을 변경했습니다.')).toBeVisible()
    expect(puts.lastBody()).toEqual({ name: '나만의 비서' })
  })

  // #607 — 이름 입력값이 비어있거나 공백뿐이면 저장 버튼이 비활성화되어야 한다(불필요한 API 호출 방지).
  test('이름을 비우거나 공백만 입력하면 저장 버튼이 비활성화된다', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ name: '개인 비서' }))
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    const puts = trackRequests(page, 'ANY', '/api/v1/users/me/assistant/name')
    await page.route('**/api/v1/users/me/assistant/name', (route) => route.fulfill({ status: 204, body: '' }))

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    const nameInput = page.getByTestId('assistant-name-input')
    const saveButton = page.getByTestId('assistant-name-save')

    await expect(saveButton).toBeDisabled()

    await nameInput.fill('')
    await expect(saveButton).toBeDisabled()

    await nameInput.fill('   ')
    await expect(saveButton).toBeDisabled()

    await nameInput.fill('나만의 비서')
    await expect(saveButton).toBeEnabled()

    expect(puts.count()).toBe(0)
  })

  // #264 — tokenLabel 이 null 일 때 '(라벨 없음)' 개발자 용어가 노출되면 안 된다.
  test('tokenLabel null 시 라벨 없음 문구가 표시되지 않는다', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])

    await page.goto('/settings/assistant')
    const configured = page.getByTestId('assistant-configured')
    await expect(configured).toBeVisible()

    await expect(configured).not.toContainText('라벨 없음')
    await expect(page.getByTestId('assistant-connection-badge')).toBeVisible()
  })

  // #264 — tokenLabel 이 있으면 그대로 표시되어야 한다.
  test('tokenLabel 있을 때 라벨이 포함된 문구가 표시된다', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ tokenLabel: '내 토큰' }))
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])

    await page.goto('/settings/assistant')
    const configured = page.getByTestId('assistant-configured')
    await expect(configured).toBeVisible()

    await expect(configured).toContainText('내 토큰')
  })

  // #198 — 생각의 깊이 변경 성공(204) 시 성공 토스트가 표시되어야 한다(피드백 일관성).
  test('생각의 깊이 변경 성공 시 성공 토스트 표시', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    const puts = trackRequests(page, 'ANY', '/api/v1/users/me/assistant/settings')
    await page.route('**/api/v1/users/me/assistant/settings', (route) => route.fulfill({ status: 204, body: '' }))

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('combobox', { name: '생각의 깊이' }).click()
    await page.getByRole('option', { name: '깊게' }).click()

    await expect(page.getByText('비서 설정을 변경했습니다.')).toBeVisible()
    expect(puts.lastBody()).toEqual({ thinkingDepth: 'DEEP' })
  })

  // WP-250 코드 리뷰: 등록 후 모델을 바꿔도 이미지 입력을 지정할 수 있다 — 설정 PUT 을 서버처럼 상태에 반영하는 목으로
  // "이미지 입력만 바꾸기 → 지금 모델에", "모델 바꾸기 → vision:null(자동 감지에서 시작)" 를 요청 본문으로 확인한다.
  function mockOpencodeSettingsServer(page: import('@playwright/test').Page, initial: Partial<AssistantStatusFixture>) {
    let st = configuredStatus({ provider: 'opencode', model: 'openai/gpt-4.1', vision: null, ...initial })
    const puts = trackRequests(page, 'PUT', '/api/v1/users/me/assistant/settings')
    void mockStatus(page, () => st)
    void page.route('**/api/v1/users/me/assistant/settings', (route) => {
      const body = route.request().postDataJSON() as { model?: string; vision?: boolean | null }
      st = { ...st, ...(body.model !== undefined && { model: body.model, vision: null }), ...('vision' in body && { vision: body.vision }) }
      return route.fulfill({ status: 204, body: '' })
    })
    return puts
  }

  test('등록 후 opencode — 이미지 입력만 바꾸면 지금 모델에, 모델을 바꾸면 vision:null 로 자동 감지에서 시작한다', async ({
    authenticatedPage: page,
  }) => {
    const puts = mockOpencodeSettingsServer(page, {})
    await mockModels(page, [
      { id: 'openai/gpt-4.1', label: 'GPT-4.1' },
      { id: 'openai/my-vl', label: 'My VL' },
    ], 'opencode')

    await page.goto('/settings/assistant')
    const vision = page.getByTestId('assistant-vision')
    await expect(vision).toHaveText('자동 감지')

    await vision.click()
    await page.getByRole('option', { name: '볼 수 있음' }).click()
    await expect.poll(() => puts.lastBody()).toEqual({ vision: true })
    await expect(vision).toHaveText('볼 수 있음')

    await vision.scrollIntoViewIfNeeded()
    await page.screenshot({ path: '../../test-results/tc/personal-assistant-vision/configured-vision.png' })

    await page.getByRole('combobox', { name: '모델', exact: true }).click()
    await page.getByRole('option', { name: 'My VL' }).click()
    await expect.poll(() => puts.lastBody()).toEqual({ model: 'openai/my-vl', vision: null })
    // 다른 모델은 자동 감지에서 시작 — 이전 모델의 '볼 수 있음' 이 옮겨지지 않는다.
    await expect(vision).toHaveText('자동 감지')
  })

  test('등록 후 opencode(모델 목록 없음) — 직접 입력으로 모델을 바꿔도 vision:null 로 자동 감지에서 시작한다', async ({
    authenticatedPage: page,
  }) => {
    const puts = mockOpencodeSettingsServer(page, { vision: false })
    await mockModels(page, [], 'opencode')

    await page.goto('/settings/assistant')
    const vision = page.getByTestId('assistant-vision')
    // 지금 모델에 저장된 지정이 초깃값으로 보인다.
    await expect(vision).toHaveText('볼 수 없음')

    await page.getByTestId('assistant-model-manual-input').fill('my-custom-vl')
    await page.getByTestId('assistant-model-manual-apply').click()
    await expect.poll(() => puts.lastBody()).toEqual({ model: 'openai/my-custom-vl', vision: null })
    await expect(vision).toHaveText('자동 감지')

    // 새 모델에 직접 지정하면 그 모델에만 저장된다.
    await vision.click()
    await page.getByRole('option', { name: '볼 수 없음' }).click()
    await expect.poll(() => puts.lastBody()).toEqual({ vision: false })
  })

  test('Claude 연결은 이미지 입력 선택을 보이지 않고 모델 변경에 vision 을 싣지 않는다', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    ])
    const puts = trackRequests(page, 'PUT', '/api/v1/users/me/assistant/settings')
    await page.route('**/api/v1/users/me/assistant/settings', (route) => route.fulfill({ status: 204, body: '' }))

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await expect(page.getByTestId('assistant-vision')).toHaveCount(0)
    await page.getByRole('combobox', { name: '모델', exact: true }).click()
    await page.getByRole('option', { name: 'Claude Opus 4.8' }).click()
    await expect.poll(() => puts.lastBody()).toEqual({ model: 'claude-opus-4-8' })
  })
})
