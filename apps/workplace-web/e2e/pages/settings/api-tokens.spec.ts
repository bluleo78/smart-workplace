// /settings/tokens — 사용자 개인 API 토큰(PAT) 관리 페이지 E2E (@smoke).
// 시나리오: 진입 → 발급 모달 열기 → 이름/유효기간 입력 → 발급 → 평문(swp_) + 연결 명령 노출
//          → 닫기 → 목록 반영(만료일 포함) → 폐기(@wiring), 휴대폰 폭 연결 안내 가로 넘침(@layout).
// 무기한 표기·발급 상한 사유(WP-835)·만료됨(WP-702)·표 아래 연결 안내(WP-875)는 src/pages/settings/tokenSettings.test.tsx 가 지킨다.

import { expect, test } from '../../fixtures/auth.fixture';
import { expectedMcpEndpoint } from '../../fixtures/mcp';

interface UserApiTokenFixture {
  id: number;
  name: string;
  tokenPrefix: string;
  tenantId: number;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// 상태 저장형 목킹 — 발급/폐기가 목록에 반영되는지 검증하기 위해 인메모리 상태를 둔다.
async function setupTokensMock(page: import('@playwright/test').Page) {
  let tokens: UserApiTokenFixture[] = [];
  let nextId = 1;

  await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tokens),
      });
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON() as { name: string; expiresAt: string | null };
      const id = nextId++;
      const createdAt = new Date().toISOString();
      const tokenPrefix = `swp_test${id}`;
      const t: UserApiTokenFixture = {
        id,
        name: body.name,
        tokenPrefix,
        tenantId: 1,
        expiresAt: body.expiresAt,
        createdAt,
        lastUsedAt: null,
        revokedAt: null,
      };
      tokens = [...tokens, t];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id,
          name: body.name,
          plaintextToken: `swp_PLAINTEXT_${id}_abcdefg`,
          tokenPrefix,
          tenantId: 1,
          expiresAt: body.expiresAt,
          createdAt,
        }),
      });
    }
    return route.fallback();
  });

  await page.route(/\/api\/v1\/users\/me\/api-tokens\/\d+$/, (route) => {
    if (route.request().method() === 'DELETE') {
      const m = route.request().url().match(/api-tokens\/(\d+)$/);
      const id = m ? Number(m[1]) : 0;
      tokens = tokens.map((t) =>
        t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t,
      );
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fallback();
  });
}

test.describe('/settings/tokens', () => {
  test(
    '토큰 발급 → 평문/연결명령 노출 → 목록 반영 → 폐기',
    { tag: ['@wiring', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      await setupTokensMock(page);

      // ① 진입 시 page-header 에 "API 토큰" 표시 + 헤더 액션 버튼으로 발급 모달 오픈
      await page.goto('/settings/tokens');
      await expect(page.getByTestId('page-header')).toContainText('API 토큰');
      await page.getByTestId('token-issue-open').click();

      // 발급 모달 — 이름 입력 + 유효기간 90일 선택 후 발급
      const formDialog = page.getByTestId('token-issue-form-dialog');
      await expect(formDialog).toBeVisible();
      await formDialog.getByLabel('토큰 이름').fill('claude-code-mcp');
      await formDialog.getByTestId('token-expiry-select').click();
      await page.getByRole('option', { name: '90일' }).click();
      await formDialog.getByTestId('token-issue-submit').click();

      // ② 평문(swp_) + 경고 문구 + 복사 버튼 + 유효기간 안내
      const dialog = page.getByTestId('token-issue-dialog');
      await expect(dialog).toBeVisible();
      await expect(formDialog).not.toBeVisible();
      const plaintext = page.getByTestId('token-plaintext');
      await expect(plaintext).toContainText('swp_');
      await expect(dialog).toContainText('다시 표시되지 않습니다');
      await expect(dialog.getByTestId('token-copy')).toBeVisible();
      await expect(page.getByTestId('token-issue-expiry')).toContainText('까지');

      // ③ 플러그인 설치 안내(WP-378) — 토큰이 든 명령은 어디에도 없고, 설치 명령은 접속한 웹 origin 기준이다.
      const origin = new URL(page.url()).origin;
      const install = page.getByTestId('token-plugin-install-command');
      await expect(install).toContainText(`/plugin marketplace add ${origin}/claude/marketplace.json`);
      await expect(install).toContainText('/plugin install genia-works@genia-works');
      await expect(page.getByTestId('token-plugin-token-step')).toContainText('/plugin configure genia-works@genia-works');
      // dev·preview 서버는 운영 기본 주소가 아니므로 서버 주소 바꾸기 안내가 보이고, 바꿀 주소는 이 배포의 MCP 주소다.
      const expectedMcp = expectedMcpEndpoint(origin);
      await expect(page.getByTestId('plugin-server-url-step')).toBeVisible();
      await expect(page.getByTestId('plugin-server-url')).toHaveText(expectedMcp);
      await expect(dialog).not.toContainText('claude mcp add');
      await expect(dialog).not.toContainText('--header');

      // 설치 명령 복사 — 클립보드가 설치 명령 두 줄이다.
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByTestId('token-plugin-install-command-copy').click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        `/plugin marketplace add ${origin}/claude/marketplace.json\n/plugin install genia-works@genia-works`,
      );

      // 다른 도구로 연결(접힘) — 펼치면 연결 주소와 범위 선택 안내(WP-350)가 보인다. dev 는 MCP 6090, preview 는 접속 origin(WP-387).
      await expect(page.getByTestId('token-connect-scope-guide')).toHaveCount(0);
      await page.getByTestId('token-other-tools').click();
      await expect(page.getByTestId('token-mcp-endpoint')).toHaveText(expectedMcp);
      const scopeGuide = page.getByTestId('token-connect-scope-guide');
      await expect(scopeGuide).toContainText('/mcp/x/issue,wiki');
      await expect(scopeGuide).toContainText('이슈·노트 도구만');
      await expect(scopeGuide).toContainText('/mcp/readonly');
      await expect(scopeGuide).toContainText('issue, project, wiki, drive, mail, messaging, calendar, contacts, notify, member');

      // ④ 모달 닫으면 목록에 새 행 추가(prefix만, 평문 없음) — 만료일도 반영
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      const row = page.getByTestId(/^token-row-\d+$/).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('claude-code-mcp');
      await expect(row).toContainText('swp_test');
      await expect(row).not.toContainText('swp_PLAINTEXT_');
      await expect(row).not.toContainText('무기한');

      // ⑤ 폐기 — AlertDialog 확인 후 활성 뱃지/버튼 제거
      const revokeBtn = page.getByTestId(/^token-revoke-\d+$/).first();
      await revokeBtn.click();
      await expect(page.getByTestId('token-confirm-dialog')).toBeVisible();
      await page.getByTestId('token-confirm-confirm').click();
      await expect(revokeBtn).toHaveCount(0);
      await expect(row.getByText('폐기됨', { exact: true })).toBeVisible();
    },
  );

  // WP-875 — 휴대폰 폭에서도 안내가 표 아래로 이어지고, 긴 명령 때문에 화면이 옆으로 밀리지 않는다.
  test('휴대폰 폭에서 연결 안내가 표 아래로 이어지고 가로로 넘치지 않는다 (WP-875)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.goto('/settings/tokens');
    const guide = page.getByRole('region', { name: '도구에 연결하기' });
    await expect(guide.getByTestId('connect-guide-plugin-install-command')).toBeVisible();
    const table = await page.getByRole('table', { name: 'API 토큰 목록' }).boundingBox();
    const box = await guide.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(table!.y + table!.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
