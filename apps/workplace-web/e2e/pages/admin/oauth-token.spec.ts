// /admin/agents — ProviderCredentialDialog 이미지 입력 선택 E2E.
// 남는 것: 이미지 입력 선택의 TC 스크린샷 2건(@layout) — 선택 결과가 payload 의 vision 에 모델 id 키로 실리는지도 함께 본다.
// anthropic 등록·재발급·회수, opencode 프로브 → 모델 선택·프로브 실패 폴백·모델 미선택 차단, 짧은 토큰·서버 400, provider 뱃지는
// src/pages/admin/agentConnection.test.tsx 가 지킨다(WP-966).
// 평문 토큰/apiKey는 입력 시에만 다루며 응답에는 절대 포함되지 않는다.

import type { Route } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { type RequestTracker, trackRequests } from '../../fixtures/requests';

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
  posts: RequestTracker;
  deletes: RequestTracker;
  current: CredentialMeta | null;
}

const CREDENTIAL_PATH = /^\/api\/v1\/admin\/agents\/\d+\/provider-credential$/;

// 자격증명 메타 라우트 — 단일 path 에서 GET/POST/DELETE 분기 + 상태 누적.
async function setupCredential(
  page: import('@playwright/test').Page,
  cfg: CredentialRouteCfg,
): Promise<CredentialRouteState> {
  const state: CredentialRouteState = {
    posts: trackRequests(page, 'POST', CREDENTIAL_PATH),
    deletes: trackRequests(page, 'DELETE', CREDENTIAL_PATH),
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
            body: JSON.stringify({ message: '등록된 API 키가 없습니다' }),
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
        state.current = null;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    },
  );

  return state;
}

// 프로브 라우트 — 성공/실패 응답을 반환하고 요청 tracker 를 돌려준다.
function setupProbe(
  page: import('@playwright/test').Page,
  opts: { status: 200 | 502; models?: Array<{ id: string; label: string }> },
) {
  const requests = trackRequests(page, 'POST', '/api/v1/admin/agents/models/probe');
  page.route('**/api/v1/admin/agents/models/probe', (route) => {
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
  await expect(page.getByRole('heading', { name: 'AI 연결 및 모델' })).toBeVisible();
}

test.describe('/admin/agents — AI 연결 및 모델', () => {
  test(
    'opencode 이미지 입력 — 기본 자동 감지 → 볼 수 있음 선택 시 모델 id 키의 vision 이 전송된다',
    { tag: '@layout' },
    async ({ adminPage: page }) => {
      await setupBase(page);
      const state = await setupCredential(page, { initial: 'absent' });
      setupProbe(page, {
        status: 200,
        models: [
          { id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' },
          { id: 'amazon-bedrock-openai/anthropic.claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
        ],
      });

      await enterAndSelect(page);
      await page.getByTestId('oauth-token-register').click();
      await page.getByTestId('credential-provider-opencode').click();

      // 모델 목록이 나오기 전에는 "이미지 입력" 이 보이지 않는다.
      await expect(page.getByTestId('credential-vision')).toHaveCount(0);

      await page.getByTestId('credential-api-key').fill('sk-bedrock-test-key');
      await page.getByTestId('credential-probe-models').click();
      await page.getByTestId('credential-model-select').click();
      await page.getByRole('option', { name: 'GPT-OSS 120B' }).click();

      // 기본값은 "자동 감지" + 도움말.
      const vision = page.getByTestId('credential-vision');
      await expect(page.getByText('이미지 입력', { exact: true })).toBeVisible();
      await expect(vision).toHaveText('자동 감지');
      await expect(
        page.getByText(
          '이미지를 볼 수 있는 모델이면 AI가 첨부 사진과 PDF 페이지를 직접 봅니다. 자동 감지가 안 되는 모델은 직접 지정하세요.',
        ),
      ).toBeVisible();
      await page.screenshot({
        path: '../../test-results/tc/admin-provider-credential-vision/vision-select.png',
      });

      await vision.click();
      await page.getByRole('option', { name: '볼 수 있음' }).click();
      await expect(vision).toHaveText('볼 수 있음');

      await page.getByRole('button', { name: '연결하기' }).click();
      await expect(page.getByText('AI에 연결했습니다.')).toBeVisible();

      expect(state.posts.count()).toBe(1);
      const body = state.posts.bodies()[0] as { providerConfig: { vision?: unknown } };
      expect(body.providerConfig.vision).toEqual({
        'amazon-bedrock-openai/openai.gpt-oss-120b-1:0': true,
      });
    },
  );

  test('opencode 프로브 실패 → 수동 입력 모델에도 이미지 입력이 보이고 접두가 붙은 id 로 키가 잡힌다', { tag: '@layout' }, async ({
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

    await page.getByTestId('credential-model-manual').fill('gpt-4o-mini');
    const vision = page.getByTestId('credential-vision');
    await expect(vision).toHaveText('자동 감지');
    await vision.click();
    await page.getByRole('option', { name: '볼 수 없음' }).click();
    await page.screenshot({
      path: '../../test-results/tc/admin-provider-credential-vision/vision-select-manual.png',
    });

    await page.getByRole('button', { name: '연결하기' }).click();
    await expect(page.getByText('AI에 연결했습니다.')).toBeVisible();

    expect(state.posts.count()).toBe(1);
    const body = state.posts.bodies()[0] as { providerConfig: { vision?: unknown } };
    expect(body.providerConfig.vision).toEqual({ 'amazon-bedrock-openai/gpt-4o-mini': false });
  });
});
