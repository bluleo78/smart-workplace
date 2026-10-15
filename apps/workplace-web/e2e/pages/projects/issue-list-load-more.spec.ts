// WP-183: 이슈 목록·내 작업 목록 끝 — 다음 페이지 실패 시 조용히 멈추지 않고 "다시 시도"를 보인다.
// 다음 페이지가 실패해도 이미 받은 행은 그대로 두고, 다시 시도를 누르면 이어 붙는다.

import type { Page, Route } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueResponse } from '../../../src/types/issue';

const KEY = 'WP';

/**
 * cursor 가 붙은 요청(다음 페이지)을 돌려준 allowNextPage() 가 불릴 때까지 매번 500 으로 실패시키는 cursor 페이징 스텁.
 * 횟수 고정 대신 테스트가 직접 여는 이유는 settings-list-infinite-scroll.spec.ts 의 stubPaged 와 같다.
 * nextPageRequests 는 브라우저가 보낸 다음 페이지 요청 수 — 자동 로드가 실패 뒤 멈췄는지 본다.
 */
async function stubCursorPagesFailingUntilAllowed(page: Page, path: string, first: IssueResponse[], second: IssueResponse[]) {
  let nextPageAllowed = false;
  const nextPageRequests = trackRequests(page, 'GET', (url) => url.pathname === path && url.searchParams.has('cursor'));
  await page.route(
    (url) => url.pathname === path,
    (route: Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      if (cursor && !nextPageAllowed) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      }
      const body = cursor
        ? createIssueSearchResponse(second, null)
        : createIssueSearchResponse(first, 'NEXT');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    },
  );
  return {
    nextPageRequests,
    /** 이후 다음 페이지 요청을 정상 응답한다 — 「다시 시도」를 누르기 직전에 부른다. */
    allowNextPage: () => {
      nextPageAllowed = true;
    },
  };
}

const firstPage = Array.from({ length: 3 }, (_, i) =>
  createIssue({ id: 10 + i, number: 10 + i, title: `첫 묶음 ${i}` }),
);
const secondPage = [createIssue({ id: 99, number: 99, title: '두 번째 묶음' })];

test('프로젝트 이슈 목록: 다음 페이지 실패 시 받은 행은 두고 다시 시도로 이어 붙인다', async ({
  authenticatedPage: page,
}) => {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  const stub = await stubCursorPagesFailingUntilAllowed(page, `/api/v1/projects/${KEY}/issues`, firstPage, secondPage);

  await page.goto(`/projects/${KEY}`);
  const retry = page.getByTestId('issue-list-more').getByRole('button', { name: /다시 시도/ });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('issue-row-10')).toBeVisible();

  // 실패 뒤 자동 로드는 멈춘다 — 최초 + QueryClient retry 1회 = 2회에서 늘지 않는다
  await expectStays(page, stub.nextPageRequests.count, 2);

  stub.allowNextPage();
  await retry.click();
  await expect(page.getByTestId('issue-row-99')).toBeVisible();
  await expect(page.getByTestId('issue-list-more')).toHaveCount(0);
});

test('내 작업(할당) 목록: 다음 페이지 실패 시 받은 행은 두고 다시 시도로 이어 붙인다', async ({
  authenticatedPage: page,
}) => {
  const stub = await stubCursorPagesFailingUntilAllowed(page, '/api/v1/me/issues', firstPage, secondPage);

  await page.goto('/me/tasks/assigned');
  const retry = page.getByTestId('assigned-row-more').getByRole('button', { name: /다시 시도/ });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId('assigned-row-10')).toBeVisible();

  // 실패 뒤 자동 로드는 멈춘다 — 최초 + QueryClient retry 1회 = 2회에서 늘지 않는다
  await expectStays(page, stub.nextPageRequests.count, 2);

  stub.allowNextPage();
  await retry.click();
  await expect(page.getByTestId('assigned-row-99')).toBeVisible();
  await expect(page.getByTestId('assigned-row-more')).toHaveCount(0);
});
