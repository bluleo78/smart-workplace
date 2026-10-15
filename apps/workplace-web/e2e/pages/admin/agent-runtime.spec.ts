// /settings/agents — 에이전트 실행 방식(내부·외부) E2E (WP-371).
// 시나리오: INTERNAL→EXTERNAL 전환 시 외부 연결 카드 노출 + AI 연결 숨김, 409 메시지 노출,
// 공통 비서 비활성+사유, 목록 실행 배지·키 사용 시각, 375px 모바일 가로 넘침 없음.
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

// 모킹: 목록(상태 보존) + runtime PUT(409 옵션) + 키 목록 + 부수 API.
async function setup(page: Page, opts: { runtimeConflict?: string } = {}) {
  let agents = makeAgents();
  await page.route(/\/api\/v1\/admin\/agents(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(agents) })
      : route.fallback(),
  );
  await page.route(/\/api\/v1\/admin\/agents\/\d+\/runtime$/, (route) => {
    if (opts.runtimeConflict) {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ message: opts.runtimeConflict }),
      });
    }
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
  test('목록에 실행 배지와 키 사용 시각을 보인다', async ({ adminPage: page }) => {
    await setup(page);
    await page.goto('/settings/agents');
    await expect(page.getByTestId('agent-runtime-cell-100')).toContainText('내부');
    await expect(page.getByTestId('agent-runtime-cell-101')).toContainText('외부');
    await expect(page.getByTestId('agent-key-status-101')).toHaveText('키 사용 5분 전');
    await expect(page.getByTestId('agent-key-status-102')).toHaveText('키 미사용');
    await expect(page.getByTestId('agent-key-status-100')).toHaveCount(0);
  });

  test('내부 → 외부 전환 시 외부 연결 카드가 보이고 AI 연결이 숨겨진다', async ({ adminPage: page }) => {
    await setup(page);
    await page.goto('/settings/agents');
    await page.getByTestId('agent-row-100').click();
    await expect(page.getByTestId('agent-connection-section')).toBeVisible();
    await expect(page.getByTestId('external-connect-card')).toHaveCount(0);
    await shot(page, 'drawer-internal-desktop');

    await page.getByTestId('agent-runtime-EXTERNAL').click();
    await expect(page.getByTestId('external-connect-card')).toBeVisible();
    await expect(page.getByTestId('agent-connection-section')).toHaveCount(0);
    // ② 플러그인 설치 ③ 이 AI 등록 ④ 이 AI로 일하기(WP-378) — 키·토큰이 든 명령은 없다.
    const origin = new URL(page.url()).origin;
    await expect(page.getByTestId('plugin-install-command')).toHaveText(
      `/plugin marketplace add ${origin}/claude/marketplace.json\n/plugin install genia-works@genia-works`,
    );
    // dev·preview 서버는 운영 기본 주소가 아니므로 ② 에 서버 주소 바꾸기 안내가 보인다(dev 는 MCP 6090, preview 는 접속 origin).
    await expect(page.getByTestId('plugin-server-url-step')).toBeVisible();
    await expect(page.getByTestId('plugin-server-url')).toHaveText(
      process.env.E2E_SERVER === 'preview' ? `${origin}/mcp` : 'http://localhost:6090/mcp',
    );
    await expect(page.getByTestId('agent-login-command')).toHaveText('/genia-works:login');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByTestId('agent-username-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ai-dev');
    await expect(page.getByTestId('agent-switch-command')).toHaveText('/genia-works:as ai-dev');
    await expect(page.getByTestId('agent-launch-as-command')).toHaveText('GENIA_WORKS_AS=ai-dev claude');
    // 다른 방법(접힘) — 펼쳐야 키를 직접 넘기는 명령이 보인다.
    await expect(page.getByTestId('agent-fallback-command')).toHaveCount(0);
    await page.getByTestId('agent-fallback').click();
    await expect(page.getByTestId('agent-fallback-command')).toHaveText('GENIA_WORKS_TOKEN=<발급한 키> claude');
    await expect(page.getByPlaceholder('label (예: 맥북)')).toBeVisible();
    await shot(page, 'drawer-external-desktop');
    // 드로어는 내부 스크롤이라 뷰포트 캡처로는 ②·③ 이 잘린다 — 연결 카드만 따로 저장해 UI 리뷰에 쓴다.
    await page.getByTestId('external-connect-card').screenshot({ path: path.join(SHOT_DIR, 'external-connect-card-desktop.png') });

    // 키 발급 다이얼로그에는 로그인 안내만 있고 평문 키가 든 명령은 없다.
    await page.getByTestId('key-issue-form').getByRole('button', { name: '키 발급' }).click();
    const keyDialog = page.getByTestId('agent-key-issue-dialog');
    await expect(keyDialog.getByTestId('agent-key-login-guide')).toContainText('/genia-works:login');
    await expect(keyDialog.getByTestId('agent-key-login-guide')).toContainText('ai-dev');
    await expect(keyDialog).not.toContainText('GENIA_WORKS_TOKEN=ak_');
    await expect(keyDialog.getByRole('button', { name: '키 복사' })).toBeVisible();
  });

  test('409 사유를 서버 메시지로 보여준다', async ({ adminPage: page }) => {
    await setup(page, { runtimeConflict: '공통 비서로 지정된 AI는 외부로 바꿀 수 없습니다' });
    await page.goto('/settings/agents');
    await page.getByTestId('agent-row-100').click();
    await page.getByTestId('agent-runtime-EXTERNAL').click();
    await expect(page.getByText('공통 비서로 지정된 AI는 외부로 바꿀 수 없습니다')).toBeVisible();
    await expect(page.getByTestId('external-connect-card')).toHaveCount(0);
  });

  test('공통 비서는 실행 방식이 비활성화되고 사유가 보인다', async ({ adminPage: page }) => {
    await setup(page);
    await page.goto('/settings/agents');
    await page.getByTestId('agent-row-103').click();
    await expect(page.getByTestId('agent-runtime-EXTERNAL')).toBeDisabled();
    await expect(page.getByTestId('agent-runtime-INTERNAL')).toBeDisabled();
    await expect(page.getByTestId('agent-runtime-description')).toContainText('비서 지정을 먼저 해제하세요');
    await shot(page, 'drawer-workspace-disabled-desktop');
  });

  test.describe('모바일 375px', () => {
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
