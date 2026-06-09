// /admin/agents 공용 비서 카드 E2E.
// 공용 비서가 지정되어 있으나 활성 OAuth 토큰이 없는 상태에서 경고가 노출되는지 검증.
// 백엔드 없이 GET /admin/workspace-assistant + GET /admin/agents 를 page.route 로 모킹.

import { expect, test } from '../fixtures/auth.fixture';

test.describe('admin 공용 비서', () => {
  test('지정 + 토큰 없음 경고', async ({ adminPage: page }) => {
    // 공용 비서: agentUserId=5 지정, 활성 토큰 없음.
    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            agentUserId: 5,
            agentName: 'AI',
            hasActiveToken: false,
            model: 'claude-sonnet-4-6',
            thinkingDepth: 'NORMAL',
          }),
        });
      }
      return route.fallback();
    });

    // AGENT 목록 — UserResponse[] 형태 (id/name/username).
    await page.route(/\/api\/v1\/admin\/agents$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 5,
              username: 'ai',
              name: 'AI',
              email: 'ai@example.com',
              kind: 'AGENT',
              isActive: true,
              createdAt: '2026-05-31T00:00:00Z',
            },
          ]),
        });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');

    // 지정된 AGENT 가 select 에 반영되고, 활성 토큰 없음 경고가 노출되어야 한다.
    await expect(page.getByTestId('workspace-assistant-agent')).toHaveValue('5');
    await expect(page.getByTestId('workspace-assistant-warn')).toBeVisible();
  });

  // #198 — 모델 변경 PUT /settings 실패 시 오류 토스트가 표시되어야 한다(silent failure 방지).
  test('모델 변경 API 실패 시 오류 토스트 표시', async ({ adminPage: page }) => {
    // PUT /admin/workspace-assistant/settings — 500 에러 반환(설정 변경 경로).
    // GET /admin/workspace-assistant 보다 먼저 등록해 settings 경로를 우선 가로챈다.
    await page.route('**/api/v1/admin/workspace-assistant/settings', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '서버 오류가 발생했습니다.' }),
      }),
    );

    // 공용 비서: agentUserId=5 지정, 활성 토큰 있음.
    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            agentUserId: 5,
            agentName: 'AI',
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
          body: JSON.stringify([
            {
              id: 5,
              username: 'ai',
              name: 'AI',
              email: 'ai@example.com',
              kind: 'AGENT',
              isActive: true,
              createdAt: '2026-05-31T00:00:00Z',
            },
          ]),
        });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');
    // 모델 드롭다운 변경 → onChange 가 PUT settings 호출(500).
    await page.getByTestId('workspace-assistant-model').selectOption('claude-opus-4-8');

    // 오류 토스트가 표시되어야 한다.
    await expect(page.getByText('서버 오류가 발생했습니다.')).toBeVisible();
    // 성공 토스트는 표시되면 안 된다.
    await expect(page.getByText('공용 비서 설정을 변경했어요.')).not.toBeVisible();
  });
});
