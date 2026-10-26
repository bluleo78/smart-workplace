// WP-183: 감사 로그 — 재진입 시 첫 페이지부터.
// - 깊이 스크롤한 뒤 다른 화면에 갔다 오면 받아 둔 페이지를 전부 다시 받지 않고 첫 페이지만 받는다 — 스크롤 + 화면 이동(@flow).
// 검색형 사용자 필터(검색어 → 서버 조회 → userId)는 src/pages/admin/auditLog.test.tsx 가 지킨다(WP-966).

import type { Page } from '@playwright/test';

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { createPageResponse } from '../../fixtures/api-mock';
import { createAuditLog } from '../../factories/admin.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';

const PAGE_SIZE = 50;

/** 감사 로그 offset 페이징 스텁 — 요청 tracker 를 돌려준다. */
async function stubAuditLogs(page: Page, totalPages: number) {
  const requests = trackRequests(page, 'GET', '/api/v1/admin/audit-logs');
  await page.route(
    (url) => url.pathname === '/api/v1/admin/audit-logs',
    (route) => {
      const url = new URL(route.request().url());
      const n = Number(url.searchParams.get('page') ?? 0);
      const logs = Array.from({ length: PAGE_SIZE }, (_, i) =>
        createAuditLog({ id: n * PAGE_SIZE + i + 1, description: `감사 로그 ${n * PAGE_SIZE + i + 1}` }),
      );
      const body = createPageResponse(logs, {
        page: n,
        size: PAGE_SIZE,
        totalElements: PAGE_SIZE * totalPages,
        totalPages,
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );
  return requests;
}

test.describe('감사 로그 사용자 필터 (WP-183)', () => {
  test('깊이 스크롤한 뒤 다른 화면에 갔다 오면 첫 페이지만 다시 받는다', { tag: '@flow' }, async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    const auditRequests = await stubAuditLogs(page, 4);

    await page.goto('/settings/audit-logs');
    // 3페이지까지 스크롤로 받는다
    for (const last of [PAGE_SIZE, PAGE_SIZE * 2]) {
      await page.getByText(`감사 로그 ${last}`, { exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByText(`감사 로그 ${last + 1}`, { exact: true })).toBeVisible();
    }

    // 다른 설정 화면에 갔다가 돌아온다
    await page.getByRole('link', { name: '구성원' }).click();
    await expect(page.getByRole('heading', { name: '구성원' })).toBeVisible();
    const before = auditRequests.count();
    await page.getByRole('link', { name: '감사 로그' }).click();
    await expect(page.getByText('감사 로그 1', { exact: true })).toBeVisible();

    // 돌아온 뒤 요청은 page=0 하나뿐 — 받아 둔 1·2 페이지를 순서대로 다시 받지 않는다
    const after = auditRequests.urls().slice(before).map((u) => u.searchParams.get('page'));
    expect(after).toEqual(['0']);
  });
});
