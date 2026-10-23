// /settings/tokens — 사용자 개인 API 토큰(PAT) 관리 페이지 E2E (@smoke).
// 시나리오: 진입 → 발급 모달 열기 → 이름/유효기간 입력 → 발급 → 평문(swp_) + 연결 명령 노출
//          → 닫기 → 목록 반영(만료일 포함) → 폐기.

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
    { tag: '@smoke' },
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

  test('유효기간을 무기한으로 발급하면 목록에 무기한으로 표시된다', async ({
    authenticatedPage: page,
  }) => {
    await setupTokensMock(page);
    await page.goto('/settings/tokens');
    await page.getByTestId('token-issue-open').click();

    const formDialog = page.getByTestId('token-issue-form-dialog');
    await formDialog.getByLabel('토큰 이름').fill('no-expiry-token');
    await formDialog.getByTestId('token-expiry-select').click();
    await page.getByRole('option', { name: '무기한' }).click();
    await formDialog.getByTestId('token-issue-submit').click();

    await expect(page.getByTestId('token-issue-dialog')).toBeVisible();
    await expect(page.getByTestId('token-issue-expiry')).toContainText('무기한');
    await page.keyboard.press('Escape');

    const row = page.getByTestId(/^token-row-\d+$/).first();
    await expect(row).toContainText('무기한');
  });

  // WP-835 — 활성 토큰 20개 상한(WP-818)에 걸리면 서버 사유를 발급 창 안에 보이고, 같은 내용을 토스트로 한 번 더 띄우지 않는다.
  test('발급이 상한에 걸리면 서버 사유를 발급 창 안에 보이고 토스트는 띄우지 않는다', async ({
    authenticatedPage: page,
  }) => {
    const reason = '개인 API 토큰은 20개까지 쓸 수 있습니다. 쓰지 않는 토큰을 폐기한 뒤 다시 발급하세요';
    await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: reason }) })
        : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.goto('/settings/tokens');
    await page.getByTestId('token-issue-open').click();

    const formDialog = page.getByTestId('token-issue-form-dialog');
    await formDialog.getByLabel('토큰 이름').fill('one-too-many');
    await formDialog.getByTestId('token-issue-submit').click();

    // 창 안에 사유 그대로(스크린리더가 읽게 role=alert) — 사유 없는 「토큰 발급에 실패했습니다.」가 아니다.
    const error = formDialog.getByTestId('token-issue-error');
    await expect(error).toHaveText(reason);
    await expect(error).toHaveAttribute('role', 'alert');
    // 창은 열린 채 — 이름을 고치거나 목록에서 폐기하러 갈 수 있다. 같은 사유의 토스트는 없다.
    await expect(formDialog).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });

  // WP-702 — 만료일이 지난 토큰은 서버가 거절하므로 「활성」이 아니라 「만료됨」으로 보이고, 폐기 버튼은 남는다.
  test('만료일이 지난 토큰은 「만료됨」으로 표시된다', async ({ authenticatedPage: page }) => {
    const base = { tenantId: 1, createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null, revokedAt: null };
    const tokens: UserApiTokenFixture[] = [
      { ...base, id: 1, name: 'expired-token', tokenPrefix: 'swp_old', expiresAt: '2020-01-01T00:00:00Z' },
      { ...base, id: 2, name: 'live-token', tokenPrefix: 'swp_new', expiresAt: '2999-01-01T00:00:00Z' },
    ];
    await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokens) }),
    );
    await page.goto('/settings/tokens');

    const expired = page.getByTestId('token-row-1');
    await expect(expired.getByText('만료됨', { exact: true })).toBeVisible();
    await expect(expired.getByText('활성', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('token-revoke-1')).toBeVisible();
    await expect(page.getByTestId('token-row-2').getByText('활성', { exact: true })).toBeVisible();
  });

  // WP-875 — 발급 모달을 닫은 뒤에도 API 토큰 화면 표 아래 「도구에 연결하기」에서 같은 연결 안내를 다시 본다.
  // 토큰 값은 다시 보이지 않으므로 2단계는 「발급 때 복사한 토큰」·새로 발급 안내로 바뀐다.
  test('토큰 화면에서 발급 없이도 연결 안내를 늘 볼 수 있다 (WP-875)', async ({ authenticatedPage: page }) => {
    const tokens: UserApiTokenFixture[] = [
      { id: 1, name: 'claude-code', tokenPrefix: 'swp_abc', tenantId: 1, expiresAt: null, createdAt: '2026-09-01T00:00:00Z', lastUsedAt: null, revokedAt: null },
    ];
    await page.route(/\/api\/v1\/users\/me\/api-tokens$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tokens) }),
    );
    await page.goto('/settings/tokens');
    await expect(page.getByTestId('token-row-1')).toBeVisible();

    const guide = page.getByRole('region', { name: '도구에 연결하기' });
    await expect(guide).toBeVisible();
    const origin = new URL(page.url()).origin;
    await expect(guide.getByTestId('connect-guide-plugin-install-command')).toContainText(
      `/plugin marketplace add ${origin}/claude/marketplace.json`,
    );
    const tokenStep = guide.getByTestId('connect-guide-plugin-token-step');
    await expect(tokenStep).toContainText('발급 때 복사한 토큰');
    // 토큰은 다시 볼 수 없다는 것과 잃어버렸을 때 새로 발급하라는 안내는 섹션 설명에 있다.
    await expect(guide).toContainText('잃어버렸으면 새로 발급하세요');
    await expect(tokenStep).not.toContainText('위 토큰');
    // 모달과 같은 서버 주소 — 두 곳이 어긋나지 않는다(WP-387).
    const expectedMcp = expectedMcpEndpoint(origin);
    await expect(guide.getByTestId('connect-guide-server-url')).toHaveText(expectedMcp);
    // 평문 토큰·토큰이 든 명령은 화면 어디에도 없다.
    await expect(guide).not.toContainText('swp_');
    await expect(guide).not.toContainText('--header');

    // 다른 도구 안내는 모달처럼 접혀 있다가 펼치면 연결 주소가 보인다.
    await expect(guide.getByTestId('connect-guide-mcp-endpoint')).toHaveCount(0);
    await guide.getByTestId('connect-guide-other-tools').click();
    await expect(guide.getByTestId('connect-guide-mcp-endpoint')).toHaveText(expectedMcp);

    // 설치 명령 복사 — 클립보드가 모달과 같은 설치 명령 두 줄이다.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await guide.getByTestId('connect-guide-plugin-install-command-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `/plugin marketplace add ${origin}/claude/marketplace.json\n/plugin install genia-works@genia-works`,
    );
  });

  // WP-875 — 휴대폰 폭에서도 안내가 표 아래로 이어지고, 긴 명령 때문에 화면이 옆으로 밀리지 않는다.
  test('휴대폰 폭에서 연결 안내가 표 아래로 이어지고 가로로 넘치지 않는다 (WP-875)', async ({ authenticatedPage: page }) => {
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
