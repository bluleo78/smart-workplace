// 팀 리스트 뷰 벌크 작업 E2E (#606) — Drive drive-bulk.spec.ts 와 동일 패턴.
// 체크박스 다중 선택 + 벌크 툴바(상태 일괄 변경/담당자 일괄 지정/일괄 삭제).
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const KEY = 'WP';

async function mock(page: Page, issues: ReturnType<typeof createIssue>[]) {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues, null)),
      });
    },
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([createMember({ userId: 2, name: '김개발', username: 'kim' })]),
    }),
  );
}

test.describe('팀 리스트 뷰 — 벌크 작업 (#606)', () => {
  test('체크박스 선택 시 벌크 툴바에 선택 개수가 표시된다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    // 초기 상태: 벌크 툴바 없음
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);

    await page.getByTestId('select-issue-7').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 1개');

    await page.getByTestId('select-issue-8').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 2개');

    // 체크박스 클릭이 행 네비게이션(상세 이동)을 트리거하지 않아야 한다.
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));

    await page.getByTestId('bulk-clear').click();
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
  });

  test('전체선택 — 체크 시 모든 행이 선택되고, 해제 시 모두 풀린다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('issue-select-all').check();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('선택 2개');
    await expect(page.getByTestId('select-issue-7')).toBeChecked();
    await expect(page.getByTestId('select-issue-8')).toBeChecked();

    await page.getByTestId('issue-select-all').uncheck();
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
  });

  test('벌크 상태 변경 — 선택 항목 각각에 PATCH .../status 요청을 보낸다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A', status: 'TODO' }),
      createIssue({ id: 2, number: 8, title: '이슈B', status: 'TODO' }),
    ]);

    const statusBodies: { number: number; body: unknown }[] = [];
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/status$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const number = Number(route.request().url().match(/issues\/(\d+)\/status/)?.[1]);
        statusBodies.push({ number, body: route.request().postDataJSON() });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssue({ number, status: 'DONE' })),
        });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();
    await page.getByTestId('bulk-status-trigger').click();
    await page.getByTestId('bulk-status-option-DONE').click();

    await expect.poll(() => statusBodies.length).toBe(2);
    expect(statusBodies).toContainEqual({ number: 7, body: { status: 'DONE' } });
    expect(statusBodies).toContainEqual({ number: 8, body: { status: 'DONE' } });

    // 처리 후 선택 해제(벌크 툴바 사라짐)
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
  });

  test('벌크 담당자 지정 — 선택 항목 각각에 PUT .../assignees 요청을 보낸다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    const assigneeBodies: { number: number; body: unknown }[] = [];
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)\/assignees$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        const number = Number(route.request().url().match(/issues\/(\d+)\/assignees/)?.[1]);
        assigneeBodies.push({ number, body: route.request().postDataJSON() });
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();
    await page.getByTestId('bulk-assignee-trigger').click();
    await page.getByTestId('bulk-assignee-option-2').click();

    await expect.poll(() => assigneeBodies.length).toBe(2);
    expect(assigneeBodies).toContainEqual({ number: 7, body: { userIds: [2] } });
    expect(assigneeBodies).toContainEqual({ number: 8, body: { userIds: [2] } });
  });

  test('벌크 삭제 — 확인 다이얼로그 후 선택 항목 각각에 DELETE 요청을 보낸다', async ({ authenticatedPage: page }) => {
    await mock(page, [
      createIssue({ id: 1, number: 7, title: '이슈A' }),
      createIssue({ id: 2, number: 8, title: '이슈B' }),
    ]);

    const deletedNumbers: number[] = [];
    await page.route(
      (url) => /\/api\/v1\/projects\/WP\/issues\/(7|8)$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        const number = Number(route.request().url().match(/issues\/(\d+)$/)?.[1]);
        deletedNumbers.push(number);
        return route.fulfill({ status: 204, body: '' });
      },
    );

    await page.goto(`/projects/${KEY}`);
    await expect(page.getByTestId('issue-row-7')).toBeVisible();

    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();

    await page.getByTestId('bulk-delete').click();
    await expect(page.getByTestId('issue-bulk-delete-dialog')).toBeVisible();
    await page.getByTestId('issue-bulk-delete-confirm').click();

    await expect.poll(() => deletedNumbers.sort()).toEqual([7, 8]);
  });
});
