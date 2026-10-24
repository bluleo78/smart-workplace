// 이슈 목록 마감일 포맷 회귀 테스트 (refs #162, WP-919)
// IssueListView의 dueDate 셀이 ISO 문자열 그대로가 아닌 목록 공용 표기(formatListDueDate)로 표시되는지 검증.
// 올해/다른 해 판정이 실제 시계에 기대지 않도록 먼 미래(다른 해 → 「YYYY. M. D」)로 고정한다. 올해 「M월 D일」은 단위 테스트가 맡는다.

import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createProject } from '../../factories/project.factory';
import {
  createIssue,
  createIssueSearchResponse,
} from '../../factories/issue.factory';

test(
  '이슈 목록 마감일이 목록 공용 표기(다른 해 YYYY. M. D)로, 마감 없음은 —로 표시된다',
  async ({ authenticatedPage: page }) => {
    // 마감 있는 이슈 + 마감 없는 이슈 모킹
    const issueWithDueDate = createIssue({
      id: 1,
      number: 1,
      title: '마감일 테스트 이슈',
      dueDate: '2099-06-30',
    });
    const issueWithoutDueDate = createIssue({ id: 2, number: 2, title: '마감 없는 이슈', dueDate: null });

    await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
    await mockApi(
      page,
      'GET',
      '/api/v1/projects/WP/issues',
      createIssueSearchResponse([issueWithDueDate, issueWithoutDueDate]),
    );

    await page.goto('/projects/WP');

    // 마감일 셀에 ISO 형식이 그대로 노출되지 않아야 함
    await expect(page.getByRole('cell', { name: '2099-06-30' })).not.toBeVisible();

    // 다른 해는 점 표기, 마감 없음은 빈 값 기호(—, U+2014)
    await expect(page.getByTestId('issue-row-1-due')).toHaveText('2099. 6. 30');
    await expect(page.getByTestId('issue-row-2-due')).toHaveText('—');
  },
);
