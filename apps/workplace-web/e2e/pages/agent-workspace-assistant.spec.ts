// ADMIN — /settings/agents 내 "AI 연결 및 모델" 카드의 공통 비서 지정 토글 E2E.
// 에이전트 상세 패널 내 AgentConnectionSection 지정·해제·토큰 게이트·빈 상태 배너 검증.
// 백엔드 없이 page.route 로 API 모킹. 모킹 데이터는 src/types/ 타입 적용.

import type { WorkspaceAssistant } from '../../src/types/assistant';
import type { ProviderCredentialMeta } from '../../src/types/providerCredential';
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
      expect(putPayload).toBeNull();

      // "그래도 지정" 확인 → 그제서야 PUT 호출.
      await page.getByTestId('workspace-assistant-force-set-confirm').click();

      // PUT payload = { agentUserId: AGENT_ID } 확인.
      await expect.poll(() => putPayload).toEqual({ agentUserId: AGENT_ID });
    },
  );

  // 시나리오 1b: 모델 프로브 자체가 실패(502)해도 동일하게 강제 확인 다이얼로그로 유도된다 (#643).
  test('공통 비서 지정 → 모델 프로브 502 실패 → 강제 확인 다이얼로그 → PUT 호출', async ({
    adminPage: page,
  }) => {
    const wsState = {
      agentUserId: null as number | null,
      agentName: null as string | null,
      hasActiveToken: false,
      model: null as string | null,
      thinkingDepth: null as string | null,
    };
    let putPayload: unknown = null;

    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wsState) });
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

    // 에이전트/키 목록은 setupBase 로, 모델 목록만 502 로 덮어써 프로브 실패를 재현.
    await setupBase(page);
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/models$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ message: '모델 목록 조회에 실패했습니다.' }),
        });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    const toggle = page.getByTestId('agent-connection-assistant-toggle');
    await toggle.click();

    const forceDialog = page.getByTestId('workspace-assistant-force-set-dialog');
    await expect(forceDialog).toBeVisible();
    expect(putPayload).toBeNull();

    // 취소하면 지정되지 않아야 한다.
    await page.getByTestId('workspace-assistant-force-set-cancel').click();
    await expect(forceDialog).toBeHidden();
    expect(putPayload).toBeNull();
    await expect(toggle).not.toBeChecked();
  });

  // 시나리오 2: 현재 공통 비서 → "지정 해제" → 영향 경고 확인 다이얼로그 → 확인 → DELETE 호출 (#643).
  test('현재 공통 비서 → 지정 해제 → 경고 확인 → DELETE 호출', async ({ adminPage: page }) => {
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

    // 자격증명 있음.
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

    // 에이전트 행 선택.
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    // 현재 공통 비서 배지가 표시되어야 한다.
    await expect(page.getByTestId('workspace-assistant-current')).toBeVisible();

    // 토글이 ON 상태 — 클릭하면 경고 확인 다이얼로그가 먼저 뜬다(즉시 DELETE 아님).
    const toggle = page.getByTestId('agent-connection-assistant-toggle');
    await expect(toggle).toBeChecked();
    await toggle.click();

    const clearDialog = page.getByTestId('workspace-assistant-clear-confirm-dialog');
    await expect(clearDialog).toBeVisible();
    expect(deleteCallCount).toBe(0);

    // "해제" 확인 → 그제서야 DELETE 호출.
    await page.getByTestId('workspace-assistant-clear-confirm-confirm').click();

    // DELETE 가 1회 호출되어야 한다.
    await expect.poll(() => deleteCallCount).toBe(1);
  });

  // 시나리오 2b: 해제 경고 다이얼로그에서 취소하면 DELETE 가 호출되지 않아야 한다 (#643).
  test('공통 비서 해제 경고 다이얼로그 취소 → DELETE 미호출', async ({ adminPage: page }) => {
    let deleteCallCount = 0;
    const wsData = {
      agentUserId: AGENT_ID as number | null,
      agentName: AGENT_FIXTURE.name as string | null,
      hasActiveToken: true,
      model: 'claude-sonnet-4-6',
      thinkingDepth: 'NORMAL',
    };

    await page.route('**/api/v1/admin/workspace-assistant', (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wsData) });
      }
      if (method === 'DELETE') {
        deleteCallCount += 1;
        wsData.agentUserId = null;
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fallback();
    });

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
    await page.getByTestId(`agent-row-${AGENT_ID}`).click();

    const toggle = page.getByTestId('agent-connection-assistant-toggle');
    await expect(toggle).toBeChecked();
    await toggle.click();

    const clearDialog = page.getByTestId('workspace-assistant-clear-confirm-dialog');
    await expect(clearDialog).toBeVisible();
    await page.getByTestId('workspace-assistant-clear-confirm-cancel').click();
    await expect(clearDialog).toBeHidden();

    // 취소했으므로 DELETE 미호출 + 토글은 여전히 ON 이어야 한다.
    expect(deleteCallCount).toBe(0);
    await expect(toggle).toBeChecked();
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

    // 자격증명 없음(404) — 미등록 상태로 간주, null 반환.
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (route) => {
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

    // 공통 비서 지정 토글은 disabled 이어야 한다(연결 안 됨).
    const toggle = page.getByTestId('agent-connection-assistant-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();

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

    // 자격증명 없음(404) — 이미 회수된 상태.
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (route) => {
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

  // 시나리오 4: 에이전트는 있으나 공통 비서 미지정 → 지정 안내 배너 노출.
  test('에이전트 있음 + 공통 비서 미지정 → 지정 안내 배너', async ({ adminPage: page }) => {
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

    // 에이전트는 존재(setupBase 가 [AGENT_FIXTURE] 반환).
    await setupBase(page);
    await page.goto('/settings/agents');

    // 공통 비서 지정 안내 배너가 보이고, 에이전트 없음 배너는 안 보여야 한다.
    await expect(page.getByTestId('workspace-assistant-empty')).toBeVisible();
    await expect(page.getByTestId('agent-roster-empty')).toHaveCount(0);
  });

  // 시나리오 6: 에이전트가 하나도 없음 → 에이전트 추가 안내 배너(공통 비서 지정 안내 아님).
  test('에이전트 0개 → 에이전트 추가 안내 배너', async ({ adminPage: page }) => {
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

    // 에이전트 목록 빈 배열 (includePersonal 쿼리 유무 무관하게 매칭).
    await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.fallback();
    });

    await page.goto('/settings/agents');

    // 에이전트 추가 안내 배너가 보이고, 공통 비서 지정 안내 배너는 안 보여야 한다.
    await expect(page.getByTestId('agent-roster-empty')).toBeVisible();
    await expect(page.getByTestId('workspace-assistant-empty')).toHaveCount(0);
  });

  // 시나리오 7: 개인 비서 표시 토글 — 기본 표시, 끄면 includePersonal=false 로 재조회해 숨김.
  test('개인 비서 표시 토글 — 기본 표시, 끄면 숨김 + 아이디에 @ 프리픽스 없음', async ({
    adminPage: page,
  }) => {
    const wsAgent = {
      id: 5,
      username: 'ws_bot',
      name: 'WS 봇',
      email: 'ws@bot.local',
      kind: 'AGENT' as const,
      isActive: true,
      createdAt: '2026-05-31T00:00:00Z',
      type: 'REGULAR' as const,
      ownerName: null,
    };
    const personalAgent = {
      id: 9,
      username: '__assistant_u1',
      name: '개인 비서',
      email: 'assistant.u1@workplace.local',
      kind: 'AGENT' as const,
      isActive: true,
      createdAt: '2026-05-31T00:00:00Z',
      type: 'PERSONAL' as const,
      ownerName: '양동희',
    };

    // includePersonal 쿼리에 따라 목록을 분기 — 백엔드 필터 동작을 모킹.
    await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const include =
        new URL(route.request().url()).searchParams.get('includePersonal') === 'true';
      const body = include ? [personalAgent, wsAgent] : [wsAgent];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
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
    await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/settings/agents');

    // 기본: 워크스페이스 에이전트 + 개인 비서 모두 표시.
    await expect(page.getByTestId('agent-row-5')).toBeVisible();
    await expect(page.getByTestId('agent-row-9')).toBeVisible();
    // 아이디 컬럼에 @ 프리픽스가 없어야 한다.
    await expect(page.getByTestId('agent-row-5')).toContainText('ws_bot');
    await expect(page.getByTestId('agent-row-5')).not.toContainText('@ws_bot');
    // 유형 컬럼: 워크스페이스 에이전트는 '일반', 개인 비서는 '개인' + 소유자 이름.
    await expect(page.getByTestId('agent-type-5')).toContainText('일반');
    await expect(page.getByTestId('agent-type-9')).toContainText('개인');
    await expect(page.getByTestId('agent-type-9')).toContainText('양동희');

    // 토글 OFF → 개인 비서 제외.
    await page.getByTestId('include-personal-toggle').click();
    await expect(page.getByTestId('agent-row-9')).toHaveCount(0);
    await expect(page.getByTestId('agent-row-5')).toBeVisible();
  });
});
