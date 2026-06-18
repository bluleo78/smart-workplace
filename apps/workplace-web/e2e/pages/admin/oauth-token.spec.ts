// /admin/agents — OAuthTokenSection E2E.
// 시나리오: AGENT 선택 → 토큰 등록/재발급/회수, 짧은 토큰 검증, 서버 400 처리.
// 평문 토큰은 입력 시에만 다루며 응답에는 절대 포함되지 않는다.

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

// 공통 — agents 목록 + agents/{id}/keys 빈 목록 모킹.
// 토큰 라우트는 각 테스트가 setupOAuth() 로 추가 주입한다.
async function setupBase(page: import('@playwright/test').Page) {
  await page.route(/\/api\/v1\/admin\/agents$/, (route) => {
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
}

interface OAuthRouteCfg {
  // 초기 GET 상태. 'absent' → 404, 'present' → meta 200.
  initial: 'absent' | 'present';
  initialMeta?: {
    id: number;
    label: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  };
  // POST 응답을 강제로 400 으로 만든다 (서버 에러 시나리오).
  postStatus?: 200 | 400;
}

interface OAuthRouteState {
  postRequests: Array<{ token: string; label?: string }>;
  deleteCount: number;
  current:
    | null
    | { id: number; label: string | null; createdAt: string; lastUsedAt: string | null };
}

// 토큰 메타 라우트 — 단일 path 에서 GET/POST/DELETE 분기 + 상태 누적.
async function setupOAuth(
  page: import('@playwright/test').Page,
  cfg: OAuthRouteCfg,
): Promise<OAuthRouteState> {
  const state: OAuthRouteState = {
    postRequests: [],
    deleteCount: 0,
    current:
      cfg.initial === 'present'
        ? (cfg.initialMeta ?? {
            id: 1,
            label: 'prod',
            createdAt: '2026-05-26T11:23:00Z',
            lastUsedAt: '2026-05-26T11:34:00Z',
          })
        : null,
  };

  await page.route(
    /\/api\/v1\/admin\/agents\/\d+\/oauth-token$/,
    (route: Route) => {
      const method = route.request().method();
      if (method === 'GET') {
        if (state.current == null) {
          return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ message: '등록된 OAuth 토큰이 없습니다' }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(state.current),
        });
      }
      if (method === 'POST') {
        const body = route.request().postDataJSON() as {
          token: string;
          label?: string;
        };
        state.postRequests.push(body);
        if (cfg.postStatus === 400) {
          return route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'invalid token' }),
          });
        }
        const next = {
          id: (state.current?.id ?? 0) + 1,
          label: body.label ?? null,
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

// 페이지 진입 + AGENT 행 클릭 — OAuthTokenSection 가 렌더되는 시점까지.
async function enterAndSelect(page: import('@playwright/test').Page) {
  await page.goto('/settings/agents');
  await expect(
    page.getByRole('heading', { name: '에이전트 관리' }),
  ).toBeVisible();
  await page.getByTestId(`agent-row-${AGENT_ID}`).click();
  await expect(
    page.getByRole('heading', { name: 'Claude CLI OAuth 토큰' }),
  ).toBeVisible();
}

// 32자 이상 토큰 더미.
const VALID_TOKEN_64 =
  'sk-ant-oat-' + 'a'.repeat(53); // 64자
const SHORT_TOKEN_16 = 'sk-ant-oat-short'; // 16자

test.describe('/admin/agents — OAuthTokenSection', () => {
  test(
    '미등록 AGENT → 토큰 등록 → 메타 노출 (happy path)',
    { tag: '@smoke' },
    async ({ adminPage: page }) => {
      await setupBase(page);
      const state = await setupOAuth(page, { initial: 'absent' });

      await enterAndSelect(page);

      // 미등록 안내 + 등록 버튼 노출.
      await expect(
        page.getByText('등록된 토큰 없음. 에이전트는 LLM 호출 불가.'),
      ).toBeVisible();
      const registerBtn = page.getByTestId('oauth-token-register');
      await expect(registerBtn).toBeVisible();

      // Dialog 열기 → 64자 토큰 + label "main" → 등록.
      await registerBtn.click();
      await expect(
        page.getByRole('heading', { name: 'OAuth 토큰 등록' }),
      ).toBeVisible();
      await page.getByRole('textbox', { name: '토큰' }).fill(VALID_TOKEN_64);
      await page.getByRole('textbox', { name: '레이블 (선택)' }).fill('main');
      await page.getByRole('button', { name: '등록' }).click();

      // success toast.
      await expect(
        page.getByText('OAuth 토큰을 등록했습니다.'),
      ).toBeVisible();

      // POST payload 검증.
      expect(state.postRequests).toHaveLength(1);
      expect(state.postRequests[0]).toEqual({
        token: VALID_TOKEN_64,
        label: 'main',
      });

      // 등록된 영역 노출 — 재발급/회수 버튼 + label.
      await expect(page.getByTestId('oauth-token-reissue')).toBeVisible();
      await expect(page.getByTestId('oauth-token-revoke')).toBeVisible();
      await expect(page.getByText('main')).toBeVisible();
      await expect(page.getByTestId('oauth-token-register')).toHaveCount(0);
    },
  );

  test(
    '이미 등록된 AGENT 진입 → 재발급/회수 버튼만 노출',
    async ({ adminPage: page }) => {
      await setupBase(page);
      await setupOAuth(page, {
        initial: 'present',
        initialMeta: {
          id: 7,
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
    const state = await setupOAuth(page, {
      initial: 'present',
      initialMeta: {
        id: 7,
        label: 'prod',
        createdAt: '2026-05-26T11:23:00Z',
        lastUsedAt: null,
      },
    });

    await enterAndSelect(page);
    await page.getByTestId('oauth-token-reissue').click();
    await expect(
      page.getByRole('heading', { name: 'OAuth 토큰 재발급' }),
    ).toBeVisible();

    await page.getByRole('textbox', { name: '토큰' }).fill(VALID_TOKEN_64);
    await page.getByRole('textbox', { name: '레이블 (선택)' }).fill('rotated');
    await page.getByRole('button', { name: '재발급' }).click();

    await expect(
      page.getByText('OAuth 토큰을 재발급했습니다.'),
    ).toBeVisible();

    expect(state.postRequests).toHaveLength(1);
    expect(state.postRequests[0].label).toBe('rotated');

    // invalidate 이후 새 label 이 노출.
    await expect(page.getByText('rotated')).toBeVisible();
  });

  test('회수 → 미등록 상태로 전환', async ({ adminPage: page }) => {
    // #136: window.confirm → AlertDialog 교체 검증.
    await setupBase(page);
    const state = await setupOAuth(page, {
      initial: 'present',
      initialMeta: {
        id: 7,
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
    const state = await setupOAuth(page, {
      initial: 'present',
      initialMeta: {
        id: 7,
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
    const state = await setupOAuth(page, { initial: 'absent' });

    await enterAndSelect(page);
    await page.getByTestId('oauth-token-register').click();
    await page.getByRole('textbox', { name: '토큰' }).fill(SHORT_TOKEN_16);
    await page.getByRole('button', { name: '등록' }).click();

    await expect(
      page.getByText('토큰이 너무 짧습니다 (최소 32자)'),
    ).toBeVisible();

    expect(state.postRequests).toHaveLength(0);
    // Dialog 유지.
    await expect(
      page.getByRole('heading', { name: 'OAuth 토큰 등록' }),
    ).toBeVisible();
  });

  test('서버 400 응답 → 에러 토스트 + Dialog 유지', async ({ adminPage: page }) => {
    await setupBase(page);
    const state = await setupOAuth(page, {
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
    await expect(
      page.getByRole('heading', { name: 'OAuth 토큰 등록' }),
    ).toBeVisible();
  });
});
