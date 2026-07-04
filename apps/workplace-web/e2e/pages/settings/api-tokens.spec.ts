// /settings/tokens — 사용자 개인 API 토큰(PAT) 관리 페이지 E2E (@smoke).
// 시나리오: 진입 → 발급 모달 열기 → 이름/유효기간 입력 → 발급 → 평문(swp_) + 연결 명령 노출
//          → 닫기 → 목록 반영(만료일 포함) → 폐기.

import { expect, test } from '../../fixtures/auth.fixture';

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
      await expect(dialog.getByRole('button', { name: '복사', exact: true })).toBeVisible();
      await expect(page.getByTestId('token-issue-expiry')).toContainText('까지');

      // ③ 연결 명령(claude mcp add ...) 코드 블록
      const command = page.getByTestId('token-connect-command');
      await expect(command).toContainText('claude mcp add');
      await expect(command).toContainText('swp_PLAINTEXT_');

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
});
