import type { Route } from '@playwright/test'

import { expect, test } from '../fixtures/auth.fixture'
import { mockMyAssistantModels, mockMyAssistantStatus } from '../fixtures/my-assistant-mock'
import { trackRequests } from '../fixtures/requests'

// 설정 > AI 비서 「개인 비서」 섹션 E2E — 브라우저가 있어야 판정되는 것만 남긴다(WP-966).
// - @wiring: /settings/assistant 진입 → 상태 조회 → anthropic 토큰 등록 → 재조회로 설정됨(화면당 1건, 페이지 제목 포함)
// - @input: 직접 입력 중 이미지 입력 선택을 닫은 뒤의 포커스·커서(실제 키 입력)
// - @layout: 이미지 입력 선택 문서 스크린샷 2건(등록 폼·등록 뒤)
// 등록 폼 payload(opencode 프로브·모델·접두), 모델 미선택·짧은 토큰 차단, 모델 목록·로딩·빈 목록 폴백, 이름·모델·생각의 깊이
// 변경 payload, API 실패 토스트, 토큰 라벨 표시는 화면 테스트 src/pages/profile/personalAssistantSection.test.tsx 가 지킨다.

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
  test('미설정 → anthropic 토큰 등록 → 설정됨', { tag: ['@wiring', '@smoke'] }, async ({
    authenticatedPage: page,
  }) => {
    let configured = false
    await mockStatus(page, () => (configured ? configuredStatus() : unconfiguredStatus()))
    const requests = mockCredentialRegister(page, () => {
      configured = true
    })
    await mockModels(page, [{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }])

    await page.goto('/settings/assistant')
    // 페이지 제목 = 사이드바 메뉴 라벨(#651)
    await expect(page.getByRole('heading', { name: 'AI 비서' })).toBeVisible()

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

  // 문서 스크린샷(vision-select.png)을 남기는 시나리오라 @layout.
  test('opencode 이미지 입력 — 기본 자동 감지 → 볼 수 있음 선택 시 모델 id 키의 vision 이 전송된다', { tag: '@layout' }, async ({
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

  // WP-250 최종 리뷰: 직접 입력 중 키를 칠 때마다 선택이 지워지지 않는다 — 선택은 그때의 모델 id 에만 적용되고,
  // 같은 id 로 정리되는 입력(끝 공백)에는 유지, 다른 id 가 되면 자동 감지로 보인다.
  test('opencode 수동 입력 — 이미지 입력 선택은 그 모델 id 에만 적용되고 같은 id 로 정리되는 입력에는 유지된다', { tag: '@input' }, async ({
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
    // 드롭다운이 닫히며 포커스를 트리거로 되돌리기 전에 입력칸을 누르면, 되돌림이 포커스를 빼앗아
    // 다음 키에서 커서가 맨 앞으로 간다(빌드본에서 간헐 실패). 닫힘이 끝난 뒤 입력한다.
    await expect(vision).toBeFocused()

    // 끝 공백은 제출 id 가 같아(앞뒤 공백 정리) 선택이 그대로다 — 지울 때도 마찬가지.
    // macOS 에서는 End 키가 입력칸 커서를 옮기지 않으므로 커서를 끝에 직접 둔다.
    await manual.focus()
    await manual.evaluate((el: HTMLInputElement) => el.setSelectionRange(el.value.length, el.value.length))
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

  // 선택 상자 값 ↔ 서버 지정값(visionChoiceOf·visionSettingOf)·접두 부여(withProviderPrefix)는 visionConfig.test.ts·suggestionModel.test.ts 가 담당 —
  // 등록 후 화면의 연결(모델 변경 시 vision:null, 직접 입력 접두, 지정 저장)은 이 테스트가 대표한다.
  // 문서 스크린샷(configured-vision.png)을 남기는 시나리오라 @layout.
  test('등록 후 opencode(모델 목록 없음) — 직접 입력으로 모델을 바꿔도 vision:null 로 자동 감지에서 시작한다', { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    const puts = mockOpencodeSettingsServer(page, { vision: false })
    await mockModels(page, [], 'opencode')

    await page.goto('/settings/assistant')
    const vision = page.getByTestId('assistant-vision')
    // 지금 모델에 저장된 지정이 초깃값으로 보인다.
    await expect(vision).toHaveText('볼 수 없음')
    await vision.scrollIntoViewIfNeeded()
    await page.screenshot({ path: '../../test-results/tc/personal-assistant-vision/configured-vision.png' })

    await page.getByTestId('assistant-model-manual-input').fill('my-custom-vl')
    await page.getByTestId('assistant-model-manual-apply').click()
    await expect.poll(() => puts.lastBody()).toEqual({ model: 'openai/my-custom-vl', vision: null })
    await expect(vision).toHaveText('자동 감지')

    // 새 모델에 직접 지정하면 그 모델에만 저장된다.
    await vision.click()
    await page.getByRole('option', { name: '볼 수 없음' }).click()
    await expect.poll(() => puts.lastBody()).toEqual({ vision: false })
  })
})
