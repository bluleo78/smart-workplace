// WP-183: 감사 로그 — 검색형 사용자 필터 · 재진입 시 첫 페이지부터.
// - 사용자 필터는 구성원 100명 상한 없이 검색어로 서버 조회하고, 고른 사람의 user_id 가 감사 로그 요청에 실린다.
// - 깊이 스크롤한 뒤 다른 화면에 갔다 오면 받아 둔 페이지를 전부 다시 받지 않고 첫 페이지만 받는다.

import type { Page } from '@playwright/test';

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { createPageResponse } from '../../fixtures/api-mock';
import { createAuditLog } from '../../factories/admin.factory';
import { createMember } from '../../factories/auth.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const PAGE_SIZE = 50;

/** 감사 로그 offset 페이징 스텁 — 요청 URL 을 모두 기록한다. */
async function stubAuditLogs(page: Page, totalPages: number) {
  const requests: URL[] = [];
  await page.route(
    (url) => url.pathname === '/api/v1/admin/audit-logs',
    (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
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

/** 구성원 디렉터리 스텁 — search 파라미터로 거른 결과를 돌려주고 요청을 기록한다. */
async function stubMembers(page: Page, members: ReturnType<typeof createMember>[]) {
  const requests: URL[] = [];
  await page.route(
    (url) => url.pathname === '/api/v1/members',
    (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const q = url.searchParams.get('search')?.toLowerCase();
      const hit = q ? members.filter((m) => m.name.toLowerCase().includes(q) || m.username.includes(q)) : members;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createPageResponse(hit.slice(0, 20), { size: 20, totalElements: hit.length })),
      });
    },
  );
  return requests;
}

test.describe('감사 로그 사용자 필터 (WP-183)', () => {
  test('검색어로 사람을 찾아 고르면 user_id 가 요청에 실리고, 전체 사용자로 되돌릴 수 있다', async ({
    adminPage: page,
  }) => {
    await setupAdminAuth(page);
    const auditRequests = await stubAuditLogs(page, 1);
    // 150명 — 예전 Select(100명 상한)라면 150번째는 고를 수 없었다.
    const members = Array.from({ length: 150 }, (_, i) =>
      createMember({ userId: i + 1, name: `구성원${i + 1}`, username: `user${i + 1}` }),
    );
    const memberRequests = await stubMembers(page, members);

    await page.goto('/settings/audit-logs');
    await expect(page.getByText('감사 로그 1', { exact: true })).toBeVisible();
    // 팝오버를 열기 전에는 구성원 목록을 받지 않는다
    expect(memberRequests).toHaveLength(0);

    await page.getByRole('combobox', { name: '사용자 필터' }).click();
    await page.getByRole('combobox', { name: '사용자 검색' }).fill('구성원150');
    await expect.poll(() => memberRequests.at(-1)?.searchParams.get('search')).toBe('구성원150');
    await expect.poll(() => memberRequests.at(-1)?.searchParams.get('includeInactive')).toBe('true');
    await page.getByTestId('audit-user-option-150').click();

    await expect(page.getByRole('combobox', { name: '사용자 필터' })).toHaveText(/구성원150/);
    await expect.poll(() => auditRequests.at(-1)?.searchParams.get('userId')).toBe('150');

    // 전체 사용자 → userId 파라미터 제거
    await page.getByRole('combobox', { name: '사용자 필터' }).click();
    await page.getByRole('option', { name: '전체 사용자' }).click();
    await expect(page.getByRole('combobox', { name: '사용자 필터' })).toHaveText(/전체 사용자/);
    await expect.poll(() => auditRequests.at(-1)?.searchParams.has('userId')).toBe(false);
  });

  test('깊이 스크롤한 뒤 다른 화면에 갔다 오면 첫 페이지만 다시 받는다', async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    const auditRequests = await stubAuditLogs(page, 4);
    await stubMembers(page, []);

    await page.goto('/settings/audit-logs');
    // 3페이지까지 스크롤로 받는다
    for (const last of [PAGE_SIZE, PAGE_SIZE * 2]) {
      await page.getByText(`감사 로그 ${last}`, { exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByText(`감사 로그 ${last + 1}`, { exact: true })).toBeVisible();
    }

    // 다른 설정 화면에 갔다가 돌아온다
    await page.getByRole('link', { name: '구성원' }).click();
    await expect(page.getByRole('heading', { name: '구성원' })).toBeVisible();
    const before = auditRequests.length;
    await page.getByRole('link', { name: '감사 로그' }).click();
    await expect(page.getByText('감사 로그 1', { exact: true })).toBeVisible();

    // 돌아온 뒤 요청은 page=0 하나뿐 — 받아 둔 1·2 페이지를 순서대로 다시 받지 않는다
    const after = auditRequests.slice(before).map((u) => u.searchParams.get('page'));
    expect(after).toEqual(['0']);
  });
});
