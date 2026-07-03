import type { Route } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'

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

function mockStatus(page: import('@playwright/test').Page, get: () => AssistantStatusFixture) {
  return page.route('**/api/v1/users/me/assistant', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(get()),
      })
    }
    return route.fallback()
  })
}

// POST /users/me/assistant/credential — payload 캡처 후 성공 응답.
function mockCredentialRegister(
  page: import('@playwright/test').Page,
  onSuccess?: () => void,
) {
  const requests: Array<Record<string, unknown>> = []
  page.route('**/api/v1/users/me/assistant/credential', (route: Route) => {
    if (route.request().method() === 'PUT') {
      requests.push(route.request().postDataJSON() as Record<string, unknown>)
      onSuccess?.()
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fallback()
  })
  return requests
}

// GET /users/me/assistant/models — 설정된 비서의 서버 모델 목록.
function mockModels(
  page: import('@playwright/test').Page,
  models: Array<{ id: string; label: string }>,
  provider = 'anthropic',
) {
  return page.route('**/api/v1/users/me/assistant/models', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ provider, models }),
      })
    }
    return route.fallback()
  })
}

// POST /users/me/assistant/models/probe — 요청 payload 기록 + 성공/실패 응답.
function mockProbe(
  page: import('@playwright/test').Page,
  opts: { status: 200 | 502; models?: Array<{ id: string; label: string }> },
) {
  const requests: Array<Record<string, unknown>> = []
  page.route('**/api/v1/users/me/assistant/models/probe', (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>)
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

    expect(requests).toHaveLength(1)
    expect(requests[0]).toEqual({ provider: 'anthropic', token: 'x'.repeat(40) })
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

      await expect.poll(() => probeRequests.length).toBe(1)
      expect(probeRequests[0]).toEqual({
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

      await page.getByLabel('레이블 (선택)').fill('bedrock-main')
      await page.getByRole('button', { name: '등록' }).click()

      await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()

      expect(requests).toHaveLength(1)
      expect(requests[0]).toEqual({
        provider: 'opencode',
        providerConfig: {
          providerId: 'amazon-bedrock-openai',
          options: {
            baseURL: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
            apiKey: 'sk-bedrock-test-key',
          },
        },
        model: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet',
        label: 'bedrock-main',
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

    await manualModel.fill('gpt-4o-mini')
    await page.getByRole('button', { name: '등록' }).click()

    await expect(page.getByText('개인 비서를 등록했습니다.')).toBeVisible()
    expect(requests).toHaveLength(1)
    expect((requests[0] as { model: string }).model).toBe('gpt-4o-mini')
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

    expect(requests).toHaveLength(0)
  })

  test('비서 설정 페이지 제목', async ({ authenticatedPage: page }) => {
    await mockStatus(page, unconfiguredStatus)
    await page.goto('/settings/assistant')
    await expect(page.getByRole('heading', { name: '비서 설정' })).toBeVisible()
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

    await expect(page.getByRole('combobox', { name: '모델' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: '생각의 깊이' })).toBeVisible()
  })

  // 모델 Select 옵션이 GET /users/me/assistant/models 서버 응답을 그대로 반영하는지 검증.
  test('모델 선택기 옵션이 서버 모델 목록 응답을 그대로 반영', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ model: 'claude-sonnet-5' }))
    let modelsRequested = false
    await page.route('**/api/v1/users/me/assistant/models', (route) => {
      if (route.request().method() === 'GET') {
        modelsRequested = true
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
    await expect.poll(() => modelsRequested).toBe(true)

    await expect(page.getByRole('combobox', { name: '모델' })).toContainText('Claude Sonnet 5')

    await page.getByRole('combobox', { name: '모델' }).click()
    await expect(page.getByRole('option', { name: 'Claude Sonnet 5' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Claude Opus 4.8' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Claude Haiku 4.5' })).toBeVisible()
    // 내부 ID 형식('claude-sonnet-5')은 옵션 레이블로 노출되면 안 된다.
    await expect(page.getByRole('option', { name: 'claude-sonnet-5' })).not.toBeVisible()
  })

  // 모델 목록이 비어 있으면 Select 비활성 + 안내 문구 노출.
  test('모델 목록 없음 → Select 비활성 + 안내 문구', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [])

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await expect(page.getByTestId('assistant-model')).toBeDisabled()
    await expect(page.getByTestId('assistant-model-empty')).toBeVisible()
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
    expect(requests).toHaveLength(0)
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
    await page.getByRole('button', { name: '해제' }).click()

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
    await page.getByRole('combobox', { name: '모델' }).click()
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
    let putBody: { model?: string } | null = null
    await page.route('**/api/v1/users/me/assistant/settings', (route) => {
      putBody = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('combobox', { name: '모델' }).click()
    await page.getByRole('option', { name: 'Claude Opus 4.8' }).click()

    await expect(page.getByText('비서 설정을 변경했습니다.')).toBeVisible()
    expect(putBody).toEqual({ model: 'claude-opus-4-8' })
  })

  // 개인 비서 이름 변경 — 명시적 저장 후 PUT /name payload 검증 + 성공 토스트.
  test('개인 비서 이름 변경 → PUT /name payload + 성공 토스트', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ name: '개인 비서' }))
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    let putBody: { name?: string } | null = null
    await page.route('**/api/v1/users/me/assistant/name', (route) => {
      putBody = route.request().postDataJSON()
      return route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()

    await expect(page.getByTestId('assistant-name-input')).toHaveValue('개인 비서')
    await page.getByTestId('assistant-name-input').fill('나만의 비서')
    await page.getByTestId('assistant-name-save').click()

    await expect(page.getByText('개인 비서 이름을 변경했습니다.')).toBeVisible()
    expect(putBody).toEqual({ name: '나만의 비서' })
  })

  // #607 — 이름 입력값이 비어있거나 공백뿐이면 저장 버튼이 비활성화되어야 한다(불필요한 API 호출 방지).
  test('이름을 비우거나 공백만 입력하면 저장 버튼이 비활성화된다', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ name: '개인 비서' }))
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    let putCalled = false
    await page.route('**/api/v1/users/me/assistant/name', (route) => {
      putCalled = true
      return route.fulfill({ status: 204, body: '' })
    })

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

    expect(putCalled).toBe(false)
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
    await expect(configured).toContainText('설정됨')
  })

  // #264 — tokenLabel 이 있으면 ' · <label>' 형태로 표시되어야 한다.
  test('tokenLabel 있을 때 라벨이 포함된 문구가 표시된다', async ({
    authenticatedPage: page,
  }) => {
    await mockStatus(page, () => configuredStatus({ tokenLabel: '내 토큰' }))
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])

    await page.goto('/settings/assistant')
    const configured = page.getByTestId('assistant-configured')
    await expect(configured).toBeVisible()

    await expect(configured).toContainText('설정됨 · 내 토큰')
  })

  // #198 — 생각의 깊이 변경 성공(204) 시 성공 토스트가 표시되어야 한다(피드백 일관성).
  test('생각의 깊이 변경 성공 시 성공 토스트 표시', async ({ authenticatedPage: page }) => {
    await mockStatus(page, () => configuredStatus())
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])
    let putBody: unknown = null
    await page.route('**/api/v1/users/me/assistant/settings', (route) => {
      putBody = route.request().postDataJSON()
      return route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/settings/assistant')
    await expect(page.getByTestId('assistant-configured')).toBeVisible()
    await page.getByRole('combobox', { name: '생각의 깊이' }).click()
    await page.getByRole('option', { name: '깊게' }).click()

    await expect(page.getByText('비서 설정을 변경했습니다.')).toBeVisible()
    expect(putBody).toEqual({ thinkingDepth: 'DEEP' })
  })
})
