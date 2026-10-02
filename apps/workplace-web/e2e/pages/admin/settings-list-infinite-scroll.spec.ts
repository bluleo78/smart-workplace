// WP-182: 설정 › 구성원·감사 로그 — 페이지 번호 대신 무한 스크롤.
// - 끝에 닿으면 다음 페이지(page=1)를 자동으로 이어 붙인다(페이지 번호 버튼 없음).
// - 다음 페이지 요청이 실패하면 자동 로드를 멈추고 "다시 시도"를 보이며, 누르면 이어서 붙는다.
// - 구성원 목록은 아이디·이메일 중복 열 대신 이름 아래 보조 줄로 합쳤다(이메일은 아이디와 다를 때만).

import type { Page, Route } from '@playwright/test';

import { setupAdminAuth } from '../../fixtures/admin.fixture';
import { createPageResponse } from '../../fixtures/api-mock';
import { createAuditLog } from '../../factories/admin.factory';
import { createMember } from '../../factories/auth.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const PAGE_SIZE = 50;

/**
 * page 쿼리 파라미터별로 다른 응답을 돌려주는 offset 페이징 스텁.
 * failSecondPage 면 page=1 요청을 처음 2회(최초 + QueryClient 기본 retry 1회) 500 → 이후 정상.
 */
async function stubPaged<T>(
  page: Page,
  path: string,
  pages: T[][],
  { failSecondPage = false } = {},
) {
  const totalElements = pages.reduce((n, p) => n + p.length, 0);
  let failures = 0;
  await page.route(
    (url) => url.pathname === path,
    (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const n = Number(new URL(route.request().url()).searchParams.get('page') ?? 0);
      if (n === 1 && failSecondPage && failures < 2) {
        failures += 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
      const body = createPageResponse(pages[n] ?? [], {
        page: n,
        size: PAGE_SIZE,
        totalElements,
        totalPages: pages.length,
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );
}

function members(from: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    createMember({
      userId: from + i,
      name: `구성원 ${from + i}`,
      username: `user${from + i}@example.com`,
      email: `user${from + i}@example.com`,
    }),
  );
}

test.describe('설정 › 구성원 무한 스크롤 (WP-182)', () => {
  test('끝까지 스크롤하면 다음 페이지를 이어 붙이고 페이지 번호 버튼은 없다', async ({ adminPage: page }) => {
    await stubPaged(page, '/api/v1/members', [members(1, PAGE_SIZE), members(1001, 3)]);
    await page.goto('/settings/users');

    await expect(page.getByRole('button', { name: '사용자 구성원 1 상세 보기' })).toBeVisible();
    await expect(page.getByTestId('user-list-total')).toHaveText('총 53명');
    // 페이지 번호 버튼(1·2…) 대신 무한 스크롤
    await expect(page.getByRole('button', { name: '2', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: `사용자 구성원 ${PAGE_SIZE} 상세 보기` }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: '사용자 구성원 1003 상세 보기' })).toBeVisible();
    await expect(page.getByTestId('user-list-load-more')).toHaveCount(0);
  });

  test('다음 페이지 실패 시 다시 시도 버튼이 나오고, 누르면 이어 붙는다', async ({ adminPage: page }) => {
    await stubPaged(page, '/api/v1/members', [members(1, PAGE_SIZE), members(1001, 2)], {
      failSecondPage: true,
    });
    await page.goto('/settings/users');

    await page.getByRole('button', { name: `사용자 구성원 ${PAGE_SIZE} 상세 보기` }).scrollIntoViewIfNeeded();
    const retry = page.getByRole('button', { name: '불러오지 못했습니다 — 다시 시도' });
    await expect(retry).toBeVisible();
    // 다음 페이지 실패가 이미 받은 행을 오류 화면으로 덮지 않는다(첫 페이지 실패만 오류 행)
    await expect(page.getByRole('button', { name: '사용자 구성원 1 상세 보기' })).toBeAttached();
    await expect(page.getByText('데이터를 불러오는데 실패했습니다.')).toHaveCount(0);

    await retry.click();
    await expect(page.getByRole('button', { name: '사용자 구성원 1002 상세 보기' })).toBeVisible();
    await expect(retry).toHaveCount(0);
  });

  test('아이디는 이름 아래 보조 줄에 보이고, 이메일은 아이디와 다를 때만 덧붙는다', async ({ adminPage: page }) => {
    await stubPaged(page, '/api/v1/members', [
      [
        createMember({ userId: 1, name: '같은값', username: 'same@example.com', email: 'same@example.com' }),
        createMember({ userId: 2, name: '다른값', username: 'diff', email: 'diff@example.com' }),
      ],
    ]);
    await page.goto('/settings/users');

    // 아이디·이메일 별도 열은 없다
    await expect(page.getByRole('columnheader', { name: '아이디' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: '이메일' })).toHaveCount(0);

    const same = page.getByRole('button', { name: '사용자 같은값 상세 보기' });
    await expect(same.getByTestId('user-list-username')).toHaveText('same@example.com');
    const diff = page.getByRole('button', { name: '사용자 다른값 상세 보기' });
    await expect(diff.getByTestId('user-list-username')).toHaveText('diff · diff@example.com');
  });
});

test.describe('설정 › 감사 로그 무한 스크롤 (WP-182)', () => {
  test('끝까지 스크롤하면 다음 페이지를 이어 붙이고, 경계에서 겹친 행은 한 번만 보인다', async ({ adminPage: page }) => {
    await setupAdminAuth(page);
    await stubPaged(page, '/api/v1/members', [[]]);
    const logs = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        createAuditLog({ id: from + i, description: `감사 로그 ${from + i}` }),
      );
    // 두 번째 페이지 첫 행(id 50)은 첫 페이지 마지막 행과 같다 — 사이에 새 로그가 끼어 offset 이 밀린 상황.
    await stubPaged(page, '/api/v1/admin/audit-logs', [logs(1, PAGE_SIZE), logs(PAGE_SIZE, 3)]);
    await page.goto('/settings/audit-logs');

    await expect(page.getByText('감사 로그 1', { exact: true })).toBeVisible();
    await page.getByText(`감사 로그 ${PAGE_SIZE}`, { exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByText(`감사 로그 ${PAGE_SIZE + 2}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`감사 로그 ${PAGE_SIZE}`, { exact: true })).toHaveCount(1);
    // 페이지 크기 선택기 없음
    await expect(page.getByText('페이지당')).toHaveCount(0);
  });
});
