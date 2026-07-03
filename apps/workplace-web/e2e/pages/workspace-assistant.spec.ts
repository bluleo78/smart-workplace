// /settings/agents 공통 비서 E2E — 기존 WorkspaceAssistantCard 제거(Task 7) 후 갱신.
// 상단 카드 기준 케이스는 모두 agent-workspace-assistant.spec.ts 로 이관.
// 이 파일은 모델 변경 에러 토스트(#198) 회귀 테스트 + Task12 모델 목록 서버화(GET .../models)
// 렌더 검증을 에이전트 상세 섹션 기준으로 유지한다.
//
// WorkspaceAssistantSection 의 Radix Select 는 네이티브 <select> 가 아니므로
// .selectOption() 이 아닌 .click() + getByRole('option') 패턴을 사용한다.

import { expect, test } from '../fixtures/auth.fixture';

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

// 공통 비서 = AGENT_ID, 활성 자격증명 있음 → 모델 드롭다운 노출 조건(isCurrent=true).
function mockCurrentWorkspaceAssistant(page: import('@playwright/test').Page) {
  return page.route('**/api/v1/admin/workspace-assistant', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agentUserId: AGENT_ID,
          agentName: AGENT_FIXTURE.name,
          hasActiveToken: true,
          model: 'claude-sonnet-4-6',
          thinkingDepth: 'NORMAL',
        }),
      });
    }
    return route.fallback();
  });
}

function mockAgentsAndKeys(page: import('@playwright/test').Page) {
  return Promise.all([
    page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([AGENT_FIXTURE]),
        });
      }
      return route.fallback();
    }),
    page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fallback();
    }),
    // 자격증명 있음(200) — WorkspaceAssistantSection 토큰게이트 비활성.
    page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            provider: 'anthropic',
            baseUrl: null,
            label: 'ai-token',
            createdAt: '2026-05-31T00:00:00Z',
            lastUsedAt: null,
          }),
        });
      }
      return route.fallback();
    }),
  ]);
}

test.describe('admin 공통 비서', () => {
  // #198 회귀 — 모델 변경 PUT /settings 실패 시 오류 토스트.
  // WorkspaceAssistantSection(에이전트 상세)에서 isCurrent=true일 때 모델 드롭다운이 노출된다.
  test('모델 변경 API 실패 시 오류 토스트 표시', async ({ adminPage: page }) => {
    // PUT /admin/workspace-assistant/settings — 500 에러(설정 변경 경로).
    await page.route('**/api/v1/admin/workspace-assistant/settings', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '서버 오류가 발생했습니다.' }),
      }),
    );

    await mockCurrentWorkspaceAssistant(page);
    await mockAgentsAndKeys(page);

    // 모델 목록 — GET /admin/agents/{id}/models (Task12: 서버화된 모델 목록).
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/models$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            provider: 'anthropic',
            models: [
              { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
              { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
            ],
          }),
        });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');

    // 에이전트 행 선택 → 상세 패널(WorkspaceAssistantSection 표시).
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    // isCurrent=true → 모델 Select 트리거 클릭.
    const modelTrigger = page.getByTestId('workspace-assistant-model');
    await expect(modelTrigger).toBeVisible();
    await modelTrigger.click();

    // Radix Select 옵션 선택 — 서버가 반환한 모델 목록 중 Claude Opus 4.8.
    await page.getByRole('option', { name: 'Claude Opus 4.8' }).click();

    // 오류 토스트가 표시되어야 한다.
    await expect(page.getByText('서버 오류가 발생했습니다.')).toBeVisible();
    // 성공 토스트는 표시되면 안 된다.
    await expect(page.getByText('설정을 변경했습니다.')).not.toBeVisible();
  });

  // Task12 — 모델 목록이 GET /admin/agents/{id}/models 로부터 렌더되는지 검증.
  test('모델 Select 옵션이 서버 모델 목록 응답을 그대로 반영', async ({ adminPage: page }) => {
    await mockCurrentWorkspaceAssistant(page);
    await mockAgentsAndKeys(page);

    let modelsRequested = false;
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/models$/, (route) => {
      if (route.request().method() === 'GET') {
        modelsRequested = true;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            provider: 'opencode',
            models: [{ id: 'amazon-bedrock-openai/openai.gpt-oss-120b-1:0', label: 'GPT-OSS 120B' }],
          }),
        });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    const modelTrigger = page.getByTestId('workspace-assistant-model');
    await expect(modelTrigger).toBeVisible();
    expect(modelsRequested).toBe(true);

    await modelTrigger.click();
    await expect(page.getByRole('option', { name: 'GPT-OSS 120B' })).toBeVisible();
  });

  // Task12 — 모델 목록이 비어 있으면 Select 비활성 + 안내 문구 노출.
  test('모델 목록 없음 → Select 비활성 + 안내 문구', async ({ adminPage: page }) => {
    await mockCurrentWorkspaceAssistant(page);
    await mockAgentsAndKeys(page);

    await page.route(/\/api\/v1\/admin\/agents\/\d+\/models$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ provider: 'anthropic', models: [] }),
        });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    await expect(page.getByTestId('workspace-assistant-model')).toBeDisabled();
    await expect(page.getByTestId('workspace-assistant-model-empty')).toBeVisible();
  });
});
