// WP-182: 설정 › 구성원 — 페이지 번호 대신 무한 스크롤.
// 끝까지 스크롤하면 다음 페이지(page=1)를 자동으로 이어 붙인다 — 실제 스크롤·교차 판정이라 E2E(@layout).
// 다음 페이지 실패 → 「다시 시도」·자동 로드 멈춤, 아이디·이메일 보조 줄은 src/pages/admin/userList.test.tsx 가 지킨다(WP-966).

import type { Page, Route } from '@playwright/test';

import { createPageResponse } from '../../fixtures/api-mock';
import { createMember } from '../../factories/auth.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const PAGE_SIZE = 50;

/** page 쿼리 파라미터별로 다른 응답을 돌려주는 offset 페이징 스텁. */
async function stubPaged<T>(page: Page, path: string, pages: T[][]) {
  const totalElements = pages.reduce((n, p) => n + p.length, 0);
  await page.route(
    (url) => url.pathname === path,
    (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const n = Number(new URL(route.request().url()).searchParams.get('page') ?? 0);
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
  test('끝까지 스크롤하면 다음 페이지를 이어 붙이고 페이지 번호 버튼은 없다', { tag: '@layout' }, async ({ adminPage: page }) => {
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
});

// 감사 로그 무한 스크롤의 경계 중복 제거(flattenUniquePages)·다음 페이지 판정은 offsetPaging.test 가 지키고,
// 스크롤 → 다음 페이지 이어 붙이기(LoadMoreFooter) 배선은 위 구성원 목록 테스트가 지킨다(WP-412).
