// 이슈 목록 마감일 포맷 회귀 테스트 (refs #162)
// IssueListView의 dueDate 셀이 ISO 문자열 그대로가 아닌 한국어 형식으로 표시되는지 검증.

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createProject } from '../../factories/project.factory';
import {
  createIssue,
  createIssueSearchResponse,
} from '../../factories/issue.factory';

test(
  '이슈 목록 마감일이 한국어 형식(YYYY년 M월 D일)으로 표시된다',
  async ({ authenticatedPage: page }) => {
    // ISO 날짜 문자열이 있는 이슈 모킹
    const issueWithDueDate = createIssue({
      title: '마감일 테스트 이슈',
      dueDate: '2026-06-30',
    });

    await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
    await mockApi(
      page,
      'GET',
      '/api/v1/projects/WP/issues',
      createIssueSearchResponse([issueWithDueDate]),
    );

    await page.goto('/projects/WP');

    // 마감일 셀에 ISO 형식이 그대로 노출되지 않아야 함
    await expect(page.getByRole('cell', { name: '2026-06-30' })).not.toBeVisible();

    // 한국어 형식으로 변환된 날짜가 표시되어야 함
    await expect(page.getByRole('cell', { name: '2026년 6월 30일' })).toBeVisible();
  },
);

test(
  '이슈 목록 마감일이 없는 경우 하이픈(-) 표시',
  async ({ authenticatedPage: page }) => {
    const issueNoDueDate = createIssue({
      title: '마감일 없는 이슈',
      dueDate: null,
    });

    await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
    await mockApi(
      page,
      'GET',
      '/api/v1/projects/WP/issues',
      createIssueSearchResponse([issueNoDueDate]),
    );

    await page.goto('/projects/WP');

    // 마감일 없을 때 '-' 표시 — 행 전체 클릭 구조 변경 후 data-testid 로 셀 특정.
    const dueDateCell = page.getByTestId('issue-row-1-due');
    await expect(dueDateCell).toHaveText('-');
  },
);
