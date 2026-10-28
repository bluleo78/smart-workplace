// /settings/agents — 에이전트 실행 방식(내부·외부) E2E (WP-371).
// 남는 것: 외부로 바꾼 뒤 「아이디 복사」가 실제 클립보드에 들어간다(@platform, UI 리뷰용 데스크톱 스크린샷 포함),
// 375px 모바일에서 드로어가 가로로 넘치지 않는다(@layout).
// 실행 배지·키 사용 시각, 외부 연결 카드 명령 문구, 409 사유, 공통 비서 잠금은 src/pages/admin/agentManagement.test.tsx 가 지킨다(WP-966).
// 스크린샷은 test-results/exploratory/wp-371-agent-runtime/<timestamp>/screenshots/ 에 저장한다.

import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import type { AgentResponse } from '../../../src/types/agent';

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

function makeAgents(): AgentResponse[] {
  return [
    { ...base, id: 100, username: 'ai-dev', name: '내부봇', type: 'REGULAR', runtime: 'INTERNAL' },
    {
      ...base,
      id: 101,
      username: 'ext_bot',
      name: '외부봇',
      type: 'REGULAR',
      runtime: 'EXTERNAL',
      lastKeyUsedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
    { ...base, id: 102, username: 'ext_new', name: '외부신규', type: 'REGULAR', runtime: 'EXTERNAL' },
    { ...base, id: 103, username: 'ws_bot', name: '공통봇', type: 'WORKSPACE', runtime: 'INTERNAL' },
  ];
}

// 모킹: 목록(상태 보존) + runtime PUT + 키 목록 + 부수 API.
async function setup(page: Page) {
  let agents = makeAgents();
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agents) })
      : route.fallback(),
  );
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/runtime$/, (route) => {
    const id = Number(route.request().url().match(/agents\/(\d+)\/runtime/)![1]);
    const { runtime } = route.request().postDataJSON() as { runtime: AgentResponse['runtime'] };
    agents = agents.map((a) => (a.id === id ? { ...a, runtime } : a));
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

test.describe('/settings/agents 실행 방식', () => {
  test('외부로 바꾸면 아이디 복사가 클립보드에 들어간다', { tag: '@platform' }, async ({ adminPage: page }) => {
    await setup(page);
    await page.goto('/settings/agents');
    await page.getByTestId('agent-row-100').click();
    await expect(page.getByTestId('agent-connection-section')).toBeVisible();
    await shot(page, 'drawer-internal-desktop');

    await page.getByTestId('agent-runtime-EXTERNAL').click();
    await expect(page.getByTestId('external-connect-card')).toBeVisible();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('agent-username-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ai-dev');

    // UI 리뷰용 스크린샷 — 아이디 복사 토스트가 ⑤ 위를 덮으므로 사라질 때까지 기다린 뒤, 드로어 내부 스크롤로 ⑤ 를 보이게 하고 찍는다.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
    await page.getByTestId('agent-work-loop').scrollIntoViewIfNeeded();
    await page
      .getByTestId('agent-work-loop')
      .screenshot({ path: path.join(SHOT_DIR, 'external-connect-card-work-loop-desktop.png') });
    await page.getByTestId('agent-fallback').click();
    await shot(page, 'drawer-external-desktop');
    // 드로어는 내부 스크롤이라 뷰포트 캡처로는 ②·③ 이 잘린다 — 연결 카드만 따로 저장해 UI 리뷰에 쓴다.
    await page.getByTestId('external-connect-card').screenshot({ path: path.join(SHOT_DIR, 'external-connect-card-desktop.png') });
  });

  test.describe('모바일 375px', { tag: '@layout' }, () => {
    test.use({ viewport: { width: 375, height: 800 } });

    test('드로어가 가로로 넘치지 않는다', async ({ adminPage: page }) => {
      await setup(page);
      await page.goto('/settings/agents');
      for (const [id, name] of [
        [100, 'internal'],
        [101, 'external'],
        [103, 'workspace-disabled'],
      ] as const) {
        await page.getByTestId(`agent-row-${id}`).click();
        const drawer = page.getByTestId('agent-detail-drawer');
        await expect(drawer.getByTestId('agent-runtime-section')).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const drawerOverflow = await drawer.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(drawerOverflow).toBeLessThanOrEqual(0);
        await shot(page, `drawer-${name}-mobile`);
        if (name === 'external') {
          // 연결 카드(②·③ 명령 포함)는 드로어 아래쪽이라 따로 저장한다.
          await drawer
            .getByTestId('external-connect-card')
            .screenshot({ path: path.join(SHOT_DIR, 'external-connect-card-mobile.png') });
        }
        await page.keyboard.press('Escape');
        await expect(drawer).toHaveCount(0);
      }
    });
  });
});
