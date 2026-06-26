// /settings/agents 공통 비서 E2E — 기존 WorkspaceAssistantCard 제거(Task 7) 후 갱신.
// 상단 카드 기준 케이스는 모두 agent-workspace-assistant.spec.ts 로 이관.
// 이 파일은 모델 변경 에러 토스트(#198) 회귀 테스트를 에이전트 상세 섹션 기준으로 유지한다.
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

    // 공통 비서 = AGENT_ID, 활성 토큰 있음 → 모델 드롭다운 노출 조건(isCurrent=true).
    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
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

    // OAuth 토큰 있음(200) — WorkspaceAssistantSection 토큰게이트 비활성.
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/oauth-token$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1,
            label: 'ai-token',
            createdAt: '2026-05-31T00:00:00Z',
            lastUsedAt: null,
          }),
        });
      }
      return route.fallback();
    });

    // API 키 목록 — 빈 배열.
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
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

    // Radix Select 옵션 선택 — Claude Opus 4.8.
    await page.getByRole('option', { name: 'Claude Opus 4.8' }).click();

    // 오류 토스트가 표시되어야 한다.
    await expect(page.getByText('서버 오류가 발생했습니다.')).toBeVisible();
    // 성공 토스트는 표시되면 안 된다.
    await expect(page.getByText('설정을 변경했습니다.')).not.toBeVisible();
  });
});
