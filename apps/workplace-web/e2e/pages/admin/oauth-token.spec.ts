// /admin/agents — ProviderCredentialDialog + 자격증명 섹션 E2E.
// 시나리오: AGENT 선택 → anthropic 토큰 등록/재발급/회수(회귀) + opencode 등록(프로브→모델선택→제출)
// + 프로브 실패 폴백 + 모델 미선택 제출 차단 + provider 뱃지 표시.
// 평문 토큰/apiKey는 입력 시에만 다루며 응답에는 절대 포함되지 않는다.

import type { Route } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';

// 등록된 AGENT 1명만 있는 목록 — 페이지 진입 후 자동 선택은 없으므로 행 클릭으로 선택.
const AGENT_ID = 100;
const AGENTS_FIXTURE = [
  {
    id: AGENT_ID,
    username: 'claude_bot',
    name: 'Claude 봇',
    email: 'claude@bot.local',
    kind: 'AGENT' as const,
    isActive: true,
    createdAt: '2026-05-20T09:00:00Z',
  },
];

// 공통 — agents 목록 + agents/{id}/keys 빈 목록 + workspace-assistant 미지정 모킹.
// 자격증명 라우트는 각 테스트가 setupCredential() 로 추가 주입한다.
async function setupBase(page: import('@playwright/test').Page) {
  // includePersonal 기본값이 true 로 바뀌어 목록 조회가 항상 쿼리스트링을 동반하므로
  // 경로만 매칭(쿼리 유무 무관)하도록 정규식을 완화한다.
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AGENTS_FIXTURE),
      });
    }
    return route.fallback();
  });
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }
    return route.fallback();
  });
  // 공통 비서 — 미지정 상태(빈 상태 배너 + WorkspaceAssistantSection용).
  await page.route('**/api/v1/admin/workspace-assistant', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agentUserId: null,
          agentName: null,
          hasActiveToken: false,
          model: null,
          thinkingDepth: null,
        }),
      });
    }
    return route.fallback();
  });
}

interface CredentialMeta {
  id: number;
  provider: 'anthropic' | 'opencode';
  baseUrl: string | null;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface CredentialRouteCfg {
  // 초기 GET 상태. 'absent' → 404, 'present' → meta 200.
  initial: 'absent' | 'present';
  initialMeta?: CredentialMeta;
  // POST 응답을 강제로 400 으로 만든다 (서버 에러 시나리오).
  postStatus?: 200 | 400;
}

interface CredentialRouteState {
  postRequests: Array<Record<string, unknown>>;
  deleteCount: number;
  current: CredentialMeta | null;
}

// 자격증명 메타 라우트 — 단일 path 에서 GET/POST/DELETE 분기 + 상태 누적.
async function setupCredential(
  page: import('@playwright/test').Page,
  cfg: CredentialRouteCfg,
): Promise<CredentialRouteState> {
  const state: CredentialRouteState = {
    postRequests: [],
    deleteCount: 0,
    current:
      cfg.initial === 'present'
        ? (cfg.initialMeta ?? {
            id: 1,
            provider: 'anthropic',
            baseUrl: null,
            label: 'prod',
            createdAt: '2026-05-26T11:23:00Z',
            lastUsedAt: '2026-05-26T11:34:00Z',
          })
        : null,
  };

  await page.route(
    /\/api\/v1\/admin\/agents\/\d+\/provider-credential$/,
    (route: Route) => {
      const method = route.request().method();
      if (method === 'GET') {
        if (state.current == null) {
          return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ message: '등록된 자격증명이 없습니다' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state.current),
        });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        state.postRequests.push(body);
        if (cfg.postStatus === 400) {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'invalid token' }),
          });
        }
        const provider = body.provider as 'anthropic' | 'opencode';
        const providerConfig = body.providerConfig as
          | { options?: { baseURL?: string } }
          | undefined;
        const next: CredentialMeta = {
          id: (state.current?.id ?? 0) + 1,
          provider,
          baseUrl: provider === 'opencode' ? (providerConfig?.options?.baseURL ?? null) : null,
          label: (body.label as string | undefined) ?? null,
          createdAt: '2026-05-26T12:00:00Z',
          lastUsedAt: null,
        };
        state.current = next;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(next),
        });
      }
      if (method === 'DELETE') {
        state.deleteCount += 1;
        state.current = null;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    },
  );

  return state;
}

// 프로브 라우트 — 요청 payload 를 기록하고 성공/실패 응답을 반환.
function setupProbe(
  page: import('@playwright/test').Page,
  opts: { status: 200 | 502; models?: Array<{ id: string; label: string }> },
) {
  const requests: Array<Record<string, unknown>> = [];
  page.route('**/api/v1/admin/agents/models/probe', (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (opts.status === 502) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: '프로바이더 연결에 실패했습니다' }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: opts.models ?? [] }),
    });
  });
  return requests;
}

// 페이지 진입 + AGENT 행 클릭 — 자격증명 섹션이 렌더되는 시점까지.
async function enterAndSelect(page: import('@playwright/test').Page) {
  await page.goto('/settings/agents');
  await expect(page.getByRole('heading', { name: '에이전트' })).toBeVisible();
  await page.getByTestId(`agent-row-${AGENT_ID}`).click();
  await expect(page.getByRole('heading', { name: '프로바이더 자격증명' })).toBeVisible();
}

// 32자 이상 토큰 더미.
const VALID_TOKEN_64 = 'sk-ant-oat-' + 'a'.repeat(53); // 64자
const SHORT_TOKEN_16 = 'sk-ant-oat-short'; // 16자

test.describe('/admin/agents — 프로바이더 자격증명', () => {
  test(
    '미등록 AGENT → anthropic 토큰 등록 → 메타 노출 (happy path 회귀)',
    { tag: '@smoke' },
    async ({ adminPage: page }) => {
      await setupBase(page);
      const state = await setupCredential(page, { initial: 'absent' });

      await enterAndSelect(page);

      // 미등록 안내 + 등록 버튼 노출.
      await expect(
        page.getByText('등록된 토큰 없음. 에이전트는 LLM 호출 불가.'),
      ).toBeVisible();
      const registerBtn = page.getByTestId('oauth-token-register');
      await expect(registerBtn).toBeVisible();

      // Dialog 열기 → anthropic 라디오(기본 선택) 확인 → 64자 토큰 + label "main" → 등록.
      await registerBtn.click();
      await expect(page.getByRole('heading', { name: '자격증명 등록' })).toBeVisible();
      await expect(page.getByTestId('credential-provider-anthropic')).toBeChecked();
      await page.getByRole('textbox', { name: '토큰' }).fill(VALID_TOKEN_64);
      await page.getByLabel('레이블 (선택)').fill('main');
      await page.getByRole('button', { name: '등록' }).click();

      // success toast.
      await expect(page.getByText('자격증명을 등록했습니다.')).toBeVisible();

      // POST payload 검증.
      expect(state.postRequests).toHaveLength(1);
      expect(state.postRequests[0]).toEqual({
        provider: 'anthropic',
        token: VALID_TOKEN_64,
        label: 'main',
      });

      // 등록된 영역 노출 — 재발급/회수 버튼 + label + provider 뱃지.
      await expect(page.getByTestId('oauth-token-reissue')).toBeVisible();
      await expect(page.getByTestId('oauth-token-revoke')).toBeVisible();
      await expect(page.getByText('main')).toBeVisible();
      await expect(page.getByTestId('credential-provider-badge')).toHaveText('Claude 구독');
      await expect(page.getByTestId('oauth-token-register')).toHaveCount(0);
    },
  );

  test(
    'opencode 등록 — 프리셋 선택 → 프로브 payload 검증 → 모델 선택 → 제출 payload 검증',
    { tag: '@smoke' },
    async ({ adminPage: page }) => {
      await setupBase(page);
      const state = await setupCredential(page, { initial: 'absent' });
      const probeRequests = setupProbe(page, {
        status: 200,
        models: [
          { id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' },
          { id: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
        ],
      });

      await enterAndSelect(page);
      await page.getByTestId('oauth-token-register').click();

      // opencode 모드로 전환 — 기본 프리셋(AWS Bedrock)의 baseURL 템플릿이 자동 채워진다.
      await page.getByTestId('credential-provider-opencode').click();
      await expect(page.getByTestId('credential-base-url')).toHaveValue(
        'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
      );

      await page.getByTestId('credential-api-key').fill('sk-bedrock-test-key');
      await page.getByTestId('credential-probe-models').click();

      // 프로브 요청 payload 검증.
      await expect.poll(() => probeRequests.length).toBe(1);
      expect(probeRequests[0]).toEqual({
        providerConfig: {
          providerId: 'amazon-bedrock-openai',
          options: {
            baseURL: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1',
            apiKey: 'sk-bedrock-test-key',
          },
        },
      });

      // 모델 Select 노출 → 옵션 선택.
      const modelSelect = page.getByTestId('credential-model-select');
      await expect(modelSelect).toBeVisible();
      await modelSelect.click();
      await page.getByRole('option', { name: 'Claude 3.5 Sonnet' }).click();

      await page.getByLabel('레이블 (선택)').fill('bedrock-main');
      await page.getByRole('button', { name: '등록' }).click();

      await expect(page.getByText('자격증명을 등록했습니다.')).toBeVisible();

      // 최종 등록 payload 검증.
      expect(state.postRequests).toHaveLength(1);
      expect(state.postRequests[0]).toEqual({
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
      });

      // 등록 후 provider 뱃지 = 프리셋 역매핑(AWS Bedrock) + baseUrl 노출.
      await expect(page.getByTestId('credential-provider-badge')).toHaveText('AWS Bedrock');
      await expect(
        page.getByText('https://bedrock-mantle.us-east-1.api.aws/openai/v1'),
      ).toBeVisible();
    },
  );

  test('opencode 프로브 실패 → 수동 모델 입력 폴백 노출 + 제출 가능', async ({
    adminPage: page,
  }) => {
    await setupBase(page);
    const state = await setupCredential(page, { initial: 'absent' });
    setupProbe(page, { status: 502 });

    await enterAndSelect(page);
    await page.getByTestId('oauth-token-register').click();
    await page.getByTestId('credential-provider-opencode').click();

    await page.getByTestId('credential-base-url').fill('https://api.openai.com/v1');
    await page.getByTestId('credential-api-key').fill('sk-openai-test');
    await page.getByTestId('credential-probe-models').click();

    // 프로브 실패 → 모델 Select 는 노출되지 않고, 수동 입력 폴백이 노출된다.
    await expect(page.getByTestId('credential-model-select')).toHaveCount(0);
    const manualModel = page.getByTestId('credential-model-manual');
    await expect(manualModel).toBeVisible();

    await manualModel.fill('gpt-4o-mini');
    await page.getByRole('button', { name: '등록' }).click();

    await expect(page.getByText('자격증명을 등록했습니다.')).toBeVisible();
    expect(state.postRequests).toHaveLength(1);
    expect((state.postRequests[0] as { model: string }).model).toBe('gpt-4o-mini');
  });

  test('opencode 모델 미선택 → 제출 버튼 비활성(POST 호출 없음)', async ({ adminPage: page }) => {
    await setupBase(page);
    const state = await setupCredential(page, { initial: 'absent' });

    await enterAndSelect(page);
    await page.getByTestId('oauth-token-register').click();
    await page.getByTestId('credential-provider-opencode').click();

    await page.getByTestId('credential-base-url').fill('https://api.openai.com/v1');
    await page.getByTestId('credential-api-key').fill('sk-openai-test');

    // 프로브를 호출하지 않아 모델 미선택 상태 — 제출 버튼이 비활성화되어 클릭 자체가 불가하다.
    const submitBtn = page.getByRole('button', { name: '등록' });
    await expect(submitBtn).toBeDisabled();

    expect(state.postRequests).toHaveLength(0);
    // Dialog 유지.
    await expect(page.getByRole('heading', { name: '자격증명 등록' })).toBeVisible();
  });

  test('opencode 등록 후 provider 뱃지 — 미매칭 baseUrl 은 "OpenAI 호환" 표시', async ({
    adminPage: page,
  }) => {
    await setupBase(page);
    await setupCredential(page, {
      initial: 'present',
      initialMeta: {
        id: 9,
        provider: 'opencode',
        baseUrl: 'https://llm.internal.example.com/v1',
        label: 'internal',
        createdAt: '2026-05-26T11:23:00Z',
        lastUsedAt: null,
      },
    });

    await enterAndSelect(page);

    await expect(page.getByTestId('credential-provider-badge')).toHaveText('OpenAI 호환');
    await expect(page.getByText('https://llm.internal.example.com/v1')).toBeVisible();
  });

  test(
    '이미 등록된 AGENT 진입 → 재발급/회수 버튼만 노출',
    async ({ adminPage: page }) => {
      await setupBase(page);
      await setupCredential(page, {
        initial: 'present',
        initialMeta: {
          id: 7,
          provider: 'anthropic',
          baseUrl: null,
          label: 'prod',
          createdAt: '2026-05-26T11:23:00Z',
          lastUsedAt: '2026-05-26T11:34:00Z',
        },
      });

      await enterAndSelect(page);

      await expect(page.getByTestId('oauth-token-reissue')).toBeVisible();
      await expect(page.getByTestId('oauth-token-revoke')).toBeVisible();
      await expect(page.getByTestId('oauth-token-register')).toHaveCount(0);
      await expect(page.getByText('prod')).toBeVisible();
    },
  );

  test('재발급 → 새 label 노출', async ({ adminPage: page }) => {
    await setupBase(page);
    const state = await setupCredential(page, {
      initial: 'present',
      initialMeta: {
        id: 7,
        provider: 'anthropic',
        baseUrl: null,
        label: 'prod',
        createdAt: '2026-05-26T11:23:00Z',
        lastUsedAt: null,
      },
    });

    await enterAndSelect(page);
    await page.getByTestId('oauth-token-reissue').click();
    await expect(page.getByRole('heading', { name: '자격증명 재발급' })).toBeVisible();

    await page.getByRole('textbox', { name: '토큰' }).fill(VALID_TOKEN_64);
    await page.getByLabel('레이블 (선택)').fill('rotated');
    await page.getByRole('button', { name: '재발급' }).click();

    await expect(page.getByText('자격증명을 재발급했습니다.')).toBeVisible();

    expect(state.postRequests).toHaveLength(1);
    expect((state.postRequests[0] as { label?: string }).label).toBe('rotated');

    // invalidate 이후 새 label 이 노출.
    await expect(page.getByText('rotated')).toBeVisible();
  });

  test('회수 → 미등록 상태로 전환', async ({ adminPage: page }) => {
    // #136: window.confirm → AlertDialog 교체 검증.
    await setupBase(page);
    const state = await setupCredential(page, {
      initial: 'present',
      initialMeta: {
        id: 7,
        provider: 'anthropic',
        baseUrl: null,
        label: 'prod',
        createdAt: '2026-05-26T11:23:00Z',
        lastUsedAt: null,
      },
    });

    await enterAndSelect(page);

    // AlertDialog 가 표시되고 확인 버튼 클릭 → DELETE 호출.
    await page.getByTestId('oauth-token-revoke').click();
    await expect(page.getByTestId('oauth-revoke-dialog')).toBeVisible();
    await page.getByTestId('oauth-revoke-confirm').click();

    await expect(page.getByText('토큰을 회수했습니다.')).toBeVisible();
    expect(state.deleteCount).toBe(1);
    await expect(
      page.getByText('등록된 토큰 없음. 에이전트는 LLM 호출 불가.'),
    ).toBeVisible();
    await expect(page.getByTestId('oauth-token-register')).toBeVisible();
  });

  test('회수 AlertDialog 취소 → DELETE 호출 없음', async ({ adminPage: page }) => {
    // #136: window.confirm → AlertDialog 교체 검증 — 취소 경로.
    await setupBase(page);
    const state = await setupCredential(page, {
      initial: 'present',
      initialMeta: {
        id: 7,
        provider: 'anthropic',
        baseUrl: null,
        label: 'prod',
        createdAt: '2026-05-26T11:23:00Z',
        lastUsedAt: null,
      },
    });

    await enterAndSelect(page);

    // AlertDialog 가 표시되고 취소 버튼 클릭 → DELETE 호출 없음.
    await page.getByTestId('oauth-token-revoke').click();
    await expect(page.getByTestId('oauth-revoke-dialog')).toBeVisible();
    await page.getByTestId('oauth-revoke-cancel').click();
    await expect(page.getByTestId('oauth-revoke-dialog')).not.toBeVisible();

    expect(state.deleteCount).toBe(0);
    await expect(page.getByTestId('oauth-token-revoke')).toBeVisible();
  });

  test('짧은 토큰 → 에러 토스트 + POST 호출 없음', async ({ adminPage: page }) => {
    await setupBase(page);
    const state = await setupCredential(page, { initial: 'absent' });

    await enterAndSelect(page);
    await page.getByTestId('oauth-token-register').click();
    await page.getByRole('textbox', { name: '토큰' }).fill(SHORT_TOKEN_16);
    await page.getByRole('button', { name: '등록' }).click();

    await expect(page.getByText('토큰이 너무 짧습니다 (최소 32자)')).toBeVisible();

    expect(state.postRequests).toHaveLength(0);
    // Dialog 유지.
    await expect(page.getByRole('heading', { name: '자격증명 등록' })).toBeVisible();
  });

  test('서버 400 응답 → 에러 토스트 + Dialog 유지', async ({ adminPage: page }) => {
    await setupBase(page);
    const state = await setupCredential(page, {
      initial: 'absent',
      postStatus: 400,
    });

    await enterAndSelect(page);
    await page.getByTestId('oauth-token-register').click();
    await page.getByRole('textbox', { name: '토큰' }).fill(VALID_TOKEN_64);
    await page.getByRole('button', { name: '등록' }).click();

    // 400 응답 메시지 → handleApiError 가 토스트 노출.
    await expect(page.getByText('invalid token')).toBeVisible();
    expect(state.postRequests).toHaveLength(1);

    // Dialog 유지.
    await expect(page.getByRole('heading', { name: '자격증명 등록' })).toBeVisible();
  });
});
