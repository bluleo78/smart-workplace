// /settings/agents/:id — 에이전트 실행 방식(기본·외부) E2E (WP-371, 상세 페이지 WP-1281).
// 남는 것: 외부로 바꾼 뒤 설정 가이드의 「아이디 복사」가 실제 클립보드에 들어간다(@platform, UI 리뷰용 데스크톱 스크린샷 포함),
// 375px 모바일에서 상세 페이지가 가로로 넘치지 않는다(@layout).
// 실행 배지·키 사용 시각, 외부 연결 카드 명령 문구, 409 사유, 공통 비서 잠금은 src/pages/admin/agentManagement.test.tsx 가 지킨다(WP-966).
// 스크린샷은 test-results/exploratory/wp-371-agent-runtime/<timestamp>/screenshots/ 에 저장한다.

import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import type { AgentResponse } from '../../../src/types/agent';
import { mockAgentDetail, mockAgentRuntimeNone } from '../../fixtures/agent-runtime-mock';

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const SHOT_DIR = path.resolve(
  // Playwright 는 앱 디렉터리(apps/workplace-web)에서 실행되므로 리포 루트는 ../..
  process.cwd(),
  '../../test-results/exploratory/wp-371-agent-runtime',
  STAMP,
  'screenshots',
);

const base = {
  email: null,
  isActive: true,
  createdAt: '2026-05-20T09:00:00Z',
  ownerName: null,
  lastKeyUsedAt: null,
  description: null,
  instructions: null,
} as const;

// 실행 방식 — 서버 응답이 runtime 과 실행 설정 유무에서 정하는 값(여기선 실행 설정이 없으니 INTERNAL→SERVER, EXTERNAL→EXTERNAL).
const modeOf = (runtime: AgentResponse['runtime']): AgentResponse['runMode'] => (runtime === 'INTERNAL' ? 'SERVER' : 'EXTERNAL');

function makeAgents(): AgentResponse[] {
  return [
    { ...base, id: 100, username: 'ai-dev', name: '내부봇', type: 'REGULAR', runtime: 'INTERNAL', runMode: 'SERVER' },
    {
      ...base,
      id: 101,
      username: 'ext_bot',
      name: '외부봇',
      type: 'REGULAR',
      runtime: 'EXTERNAL',
      runMode: 'EXTERNAL',
      lastKeyUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    { ...base, id: 102, username: 'ext_new', name: '외부신규', type: 'REGULAR', runtime: 'EXTERNAL', runMode: 'EXTERNAL' },
    { ...base, id: 103, username: 'ws_bot', name: '공통봇', type: 'WORKSPACE', runtime: 'INTERNAL', runMode: 'SERVER' },
  ];
}

// 모킹: 목록(상태 보존) + runtime PUT + 키 목록 + 부수 API.
async function setup(page: Page) {
  await mockAgentRuntimeNone(page);
  let agents = makeAgents();
  await mockAgentDetail(page, () => agents);
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agents) })
      : route.fallback(),
  );
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/runtime$/, (route) => {
    const id = Number(route.request().url().match(/agents\/(\d+)\/runtime/)![1]);
    const { runtime } = route.request().postDataJSON() as { runtime: AgentResponse['runtime'] };
    agents = agents.map((a) => (a.id === id ? { ...a, runtime, runMode: modeOf(runtime) } : a));
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/keys$/, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 9, keyPrefix: 'ak_new', plaintextKey: 'ak_new_SECRET', label: null }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/provider-credential$/, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: '없음' }) }),
  );
  await page.route('**/api/v1/admin/workspace-assistant', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        agentUserId: 103,
        agentName: '공통봇',
        hasActiveToken: true,
        model: null,
        thinkingDepth: null,
      }),
    }),
  );
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

test.describe('/settings/agents/:id 실행 방식', () => {
  test('외부로 바꾸면 설정 가이드의 아이디 복사가 클립보드에 들어간다', { tag: '@platform' }, async ({ adminPage: page }) => {
    await setup(page);
    await page.goto('/settings/agents');
    await page.getByTestId('agent-row-100').click();
    await expect(page).toHaveURL(/\/settings\/agents\/100$/);
    await expect(page.getByTestId('agent-run-section')).toBeVisible();
    await shot(page, 'detail-server-desktop');

    // 방식 카드 → 바꾸기 → 확인 창 → 저장(PUT runtime) → 외부 방식의 접속 키 묶음이 나온다.
    await page.getByTestId('agent-run-mode-EXTERNAL').click();
    await page.getByTestId('agent-run-mode-apply').click();
    await page.getByTestId('agent-run-mode-confirm-apply').click();
    await expect(page.getByTestId('external-connect-card')).toBeVisible();

    // 연결 방법은 설정 가이드에 있다 — 키를 한 번도 안 쓴 AI 는 「가이드 열기」 한 줄이 나온다.
    await page.getByTestId('external-connect-guide-open').click();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('agent-username-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ai-dev');

    // UI 리뷰용 스크린샷 — 아이디 복사 토스트가 사라진 뒤 찍는다.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
    await shot(page, 'detail-external-desktop');
    await page.getByTestId('external-connect-card').screenshot({ path: path.join(SHOT_DIR, 'external-connect-card-desktop.png') });
  });

  test.describe('모바일 375px', { tag: '@layout' }, () => {
    test.use({ viewport: { width: 375, height: 800 } });

    test('상세 페이지가 가로로 넘치지 않는다', async ({ adminPage: page }) => {
      await setup(page);
      for (const [id, name] of [
        [100, 'server'],
        [101, 'external'],
        [103, 'workspace-assistant'],
      ] as const) {
        await page.goto(`/settings/agents/${id}`);
        const detail = page.getByTestId('agent-detail-page');
        await expect(detail.getByTestId('agent-run-section')).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const detailOverflow = await detail.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(detailOverflow).toBeLessThanOrEqual(0);
        await shot(page, `detail-${name}-mobile`);
        if (name === 'external') {
          await detail
            .getByTestId('external-connect-card')
            .screenshot({ path: path.join(SHOT_DIR, 'external-connect-card-mobile.png') });
        }
      }
    });
  });
});
