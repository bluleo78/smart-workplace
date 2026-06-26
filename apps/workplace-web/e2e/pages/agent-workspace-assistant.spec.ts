// ADMIN — /settings/agents 내 공통 비서 섹션 E2E.
// 에이전트 상세 패널 내 WorkspaceAssistantSection 지정·해제·토큰 게이트·빈 상태 배너 검증.
// 백엔드 없이 page.route 로 API 모킹. 모킹 데이터는 src/types/ 타입 적용.

import type { WorkspaceAssistant } from '../../src/types/assistant';
import type { OAuthTokenMeta } from '../../src/types/agentOAuthToken';
import { expect, test } from '../fixtures/auth.fixture';

// 테스트용 AGENT 픽스처.
const AGENT_ID = 5;
const AGENT_FIXTURE = {
  id: AGENT_ID,
  username: 'ai_bot',
  name: 'AI 봇',
  email: 'ai@bot.local',
  kind: 'AGENT' as const,
  isActive: true,
  createdAt: '2026-05-31T00:00:00Z',
};

// OAuth 토큰 메타 픽스처 — 등록 상태.
const OAUTH_META_FIXTURE: OAuthTokenMeta = {
  id: 1,
  label: 'ai-token',
  createdAt: '2026-05-31T00:00:00Z',
  lastUsedAt: null,
};

/**
 * 공통 모킹 — 에이전트 목록 + API 키(빈 배열).
 * 개별 테스트는 workspace-assistant + oauth-token 경로를 별도 등록한다.
 */
async function setupBase(page: import('@playwright/test').Page) {
  await page.route(/\/api\/v1\/admin\/agents$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([AGENT_FIXTURE]),
      });
    }
    return route.fallback();
  });
  // API 키 목록 — 빈 배열(공통 비서 테스트에서 불필요).
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.fallback();
  });
}

test.describe('에이전트 관리 공통 비서 섹션', () => {
  // 시나리오 1: 토큰 있는 에이전트 선택 → "공통 비서로 지정" → PUT payload 검증.
  test(
    '토큰 있는 에이전트 선택 → 공통 비서로 지정 → PUT agentUserId 검증',
    { tag: '@smoke' },
    async ({ adminPage: page }) => {
      // 공통 비서 미지정 상태.
      const wsState: WorkspaceAssistant = {
        agentUserId: null,
        agentName: null,
        hasActiveToken: false,
        model: null,
        thinkingDepth: null,
      };

      let putPayload: unknown = null;

      await page.route('**/api/v1/admin/workspace-assistant', (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(wsState),
          });
        }
        if (method === 'PUT') {
          putPayload = route.request().postDataJSON();
          wsState.agentUserId = AGENT_ID;
          wsState.agentName = AGENT_FIXTURE.name;
          wsState.hasActiveToken = true;
          return route.fulfill({ status: 204, body: '' });
        }
        return route.fallback();
      });

      // OAuth 토큰 등록 상태(200) — 지정 버튼 활성.
      await page.route(/\/api\/v1\/admin\/agents\/\d+\/oauth-token$/, (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(OAUTH_META_FIXTURE),
          });
        }
        return route.fallback();
      });

      await setupBase(page);
      await page.goto('/settings/agents');

      // 에이전트 행 선택 → 상세 패널 열기.
      await page.getByTestId(`agent-row-${AGENT_ID}`).click();

      // 공통 비서로 지정 버튼이 활성화되어야 한다.
      const assignBtn = page.getByTestId('workspace-assistant-assign');
      await expect(assignBtn).toBeVisible();
      await expect(assignBtn).toBeEnabled();

      // 지정 버튼 클릭 → PUT 호출.
      await assignBtn.click();

      // PUT payload = { agentUserId: AGENT_ID } 확인.
      await expect.poll(() => putPayload).toEqual({ agentUserId: AGENT_ID });
    },
  );

  // 시나리오 2: 현재 공통 비서 → "지정 해제" → DELETE 호출 확인.
  test('현재 공통 비서 → 지정 해제 → DELETE 호출', async ({ adminPage: page }) => {
    let deleteCallCount = 0;

    // 공통 비서 = AGENT_ID 지정 상태.
    const wsData: WorkspaceAssistant = {
      agentUserId: AGENT_ID,
      agentName: AGENT_FIXTURE.name,
      hasActiveToken: true,
      model: 'claude-sonnet-4-6',
      thinkingDepth: 'NORMAL',
    };

    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(wsData),
        });
      }
      if (method === 'DELETE') {
        deleteCallCount += 1;
        wsData.agentUserId = null;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    });

    // OAuth 토큰 있음.
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/oauth-token$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(OAUTH_META_FIXTURE),
        });
      }
      return route.fallback();
    });

    await setupBase(page);
    await page.goto('/settings/agents');

    // 에이전트 행 선택.
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    // 현재 공통 비서 배지가 표시되어야 한다.
    await expect(page.getByTestId('workspace-assistant-current')).toBeVisible();

    // 지정 해제 버튼 → DELETE 호출.
    const clearBtn = page.getByTestId('workspace-assistant-clear');
    await expect(clearBtn).toBeVisible();
    await clearBtn.click();

    // DELETE 가 1회 호출되어야 한다.
    await expect.poll(() => deleteCallCount).toBe(1);
  });

  // 시나리오 3: 토큰 없는 에이전트 → 지정 버튼 disabled + token-gate 안내.
  test('토큰 없는 에이전트 → 지정 버튼 disabled + token-gate 안내', async ({ adminPage: page }) => {
    const wsData: WorkspaceAssistant = {
      agentUserId: null,
      agentName: null,
      hasActiveToken: false,
      model: null,
      thinkingDepth: null,
    };

    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(wsData),
        });
      }
      return route.fallback();
    });

    // OAuth 토큰 없음(404) — 미등록 상태로 간주, null 반환.
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/oauth-token$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: '없음' }),
        });
      }
      return route.fallback();
    });

    await setupBase(page);
    await page.goto('/settings/agents');

    // 에이전트 행 선택 → 상세 패널.
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    // 지정 버튼은 disabled 이어야 한다.
    const assignBtn = page.getByTestId('workspace-assistant-assign');
    await expect(assignBtn).toBeVisible();
    await expect(assignBtn).toBeDisabled();

    // token-gate 안내 문구가 표시되어야 한다.
    await expect(page.getByTestId('workspace-assistant-token-gate')).toBeVisible();
  });

  // 시나리오 5: 현재 공통 비서이나 활성 토큰 없음 → warn 배너 노출.
  test('공통 비서 지정됐으나 활성 토큰 없음 → warn 배너 표시', async ({ adminPage: page }) => {
    // hasActiveToken: false — 이후 토큰이 회수된 상태를 시뮬레이션.
    const wsData: WorkspaceAssistant = {
      agentUserId: AGENT_ID,
      agentName: AGENT_FIXTURE.name,
      hasActiveToken: false,
      model: 'claude-sonnet-4-6',
      thinkingDepth: 'NORMAL',
    };

    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(wsData),
        });
      }
      return route.fallback();
    });

    // OAuth 토큰 없음(404) — 이미 회수된 상태.
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/oauth-token$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: '없음' }),
        });
      }
      return route.fallback();
    });

    await setupBase(page);
    await page.goto('/settings/agents');

    // 에이전트 행 선택 → 상세 패널.
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    // 현재 공통 비서 배지가 표시되어야 한다.
    await expect(page.getByTestId('workspace-assistant-current')).toBeVisible();

    // 활성 토큰 없음 경고 배너가 표시되어야 한다.
    await expect(page.getByTestId('workspace-assistant-warn')).toBeVisible();
  });

  // 시나리오 4: 공통 비서 미지정 → 빈 상태 배너 노출.
  test('공통 비서 미지정 시 상단 배너를 보인다', async ({ adminPage: page }) => {
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
          } satisfies WorkspaceAssistant),
        });
      }
      return route.fallback();
    });

    await page.route(/\/api\/v1\/admin\/agents$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');

    // 빈 상태 배너가 표시되어야 한다.
    await expect(page.getByTestId('workspace-assistant-empty')).toBeVisible();
  });
});
