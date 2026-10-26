// ADMIN — /settings/agents 「AI 연결 및 모델」 공통 비서 지정 E2E — 화면 배선(@wiring) 1건만 남긴다(WP-966).
// 목록 진입 → 행 선택 → 상세 → 지정 토글 → 프로브 → 강제 확인 → PUT 이 실제로 이어지는지 본다.
// 프로브 실패·해제 경고 확인/취소·토큰 게이트·활성 토큰 없음 경고·진입 안내 배너·개인 비서 표시 토글, 그리고
// 옛 workspace-assistant.spec.ts 의 모델 목록·빈 목록·변경 실패 토스트·이미지 입력 저장 규칙은
// 화면 테스트 src/pages/admin/agentWorkspaceAssistant.test.tsx 가 지킨다.

import type { WorkspaceAssistant } from '../../src/types/assistant';
import type { ProviderCredentialMeta } from '../../src/types/providerCredential';
import { expect, test } from '../fixtures/auth.fixture';
import { trackRequests } from '../fixtures/requests';

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
  type: 'REGULAR' as const,
  ownerName: null,
};

// 자격증명 메타 픽스처 — anthropic 등록 상태.
const OAUTH_META_FIXTURE: ProviderCredentialMeta = {
  id: 1,
  provider: 'anthropic',
  baseUrl: null,
  label: 'ai-token',
  createdAt: '2026-05-31T00:00:00Z',
  lastUsedAt: null,
};

/**
 * 공통 모킹 — 에이전트 목록 + API 키(빈 배열) + 모델 목록(빈 배열, isCurrent 케이스 대비).
 * 개별 테스트는 workspace-assistant + provider-credential 경로를 별도 등록한다.
 */
async function setupBase(page: import('@playwright/test').Page) {
  // includePersonal 기본값이 true 로 바뀌어 목록 조회가 항상 쿼리스트링을 동반하므로
  // 경로만 매칭(쿼리 유무 무관)하도록 정규식을 완화한다.
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) => {
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
  // 모델 목록 — 공통 비서(isCurrent)일 때만 조회되지만, 안전하게 기본 빈 목록을 모킹.
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
}

test.describe('에이전트 관리 공통 비서 섹션', () => {
  // 시나리오 1: 토큰 있는 에이전트 선택 → "공통 비서로 지정" → 모델 프로브(0개) →
  // 강제 지정 확인 다이얼로그 → 확인 → PUT payload 검증 (#643 — 프로브 없이 즉시 저장되던 결함 수정).
  test(
    '토큰 있는 에이전트 선택 → 공통 비서로 지정 → 프로브 0개 → 강제 확인 → PUT agentUserId 검증',
    { tag: ['@wiring', '@smoke'] },
    async ({ adminPage: page }) => {
      // 공통 비서 미지정 상태.
      const wsState: WorkspaceAssistant = {
        agentUserId: null,
        agentName: null,
        hasActiveToken: false,
        model: null,
        thinkingDepth: null,
      };

      const puts = trackRequests(page, 'PUT', '/api/v1/admin/workspace-assistant');

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
          wsState.agentUserId = AGENT_ID;
          wsState.agentName = AGENT_FIXTURE.name;
          wsState.hasActiveToken = true;
          return route.fulfill({ status: 204, body: '' });
        }
        return route.fallback();
      });

      // 자격증명 등록 상태(200) — 지정 버튼 활성.
      await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (route) => {
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

      // 공통 비서 지정 토글이 활성화되어 있어야 한다(OFF 상태).
      const toggle = page.getByTestId('agent-connection-assistant-toggle');
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeEnabled();
      await expect(toggle).not.toBeChecked();

      // 토글 클릭 → 모델 프로브(setupBase 모킹: 200 + models 0개) → 강제 지정 확인 다이얼로그.
      await toggle.click();
      const forceDialog = page.getByTestId('workspace-assistant-force-set-dialog');
      await expect(forceDialog).toBeVisible();

      // 프로브 미확정 상태이므로 PUT 은 아직 호출되지 않아야 한다.
      expect(puts.count()).toBe(0);

      // "그래도 지정" 확인 → 그제서야 PUT 호출.
      await page.getByTestId('workspace-assistant-force-set-confirm').click();

      // PUT payload = { agentUserId: AGENT_ID } 확인.
      await puts.waitFor();
      expect(puts.lastBody()).toEqual({ agentUserId: AGENT_ID });
    },
  );
});
