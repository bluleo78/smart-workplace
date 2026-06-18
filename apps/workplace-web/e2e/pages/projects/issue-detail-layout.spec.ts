// 이슈 상세 레이아웃 — 속성 레일 3그룹 접기/펼침 E2E 테스트 (#343).
// 무엇을: property-group-classification(분류·관계)이 기본 접힘 + 배지 노출, 클릭 시 펼침 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueDetailResponse, IssueResponse } from '../../../src/types/issue';
import type { LabelSummary } from '../../../src/types/label';

const PROJECT_KEY = 'PROJ';
const ISSUE_NUMBER = 1;

// 이슈 상세 페이지 공통 API 스텁 설정.
// 무엇을: project/members/issue-detail/watchers/labels/attachments 엔드포인트 모킹.
// 왜: 백엔드 없이 이슈 상세 레이아웃을 테스트하기 위해 issue-comments.spec.ts 패턴 재사용.
async function mockIssueDetail(
  page: import('@playwright/test').Page,
  summaryOverrides: Partial<IssueResponse> = {},
) {
  const summary = { ...createIssue({ projectKey: PROJECT_KEY }), ...summaryOverrides };
  const detail: IssueDetailResponse = createIssueDetail({ summary });

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ key: PROJECT_KEY })),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname ===
        `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test.describe('이슈 상세 레이아웃 — 속성 레일 3그룹', () => {
  test(
    '분류·관계 그룹은 기본 접힘이고 개수 배지를 보여준다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const labels: LabelSummary[] = [{ id: 1, name: 'bug', colorToken: 'RED' }];
      await mockIssueDetail(page, { labels });
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      // 상태·담당 그룹: 기본 펼침 → 상태 셀렉트 보임
      await expect(page.getByTestId('property-group-status-people')).toBeVisible();
      await expect(page.getByTestId('issue-status-select')).toBeVisible();

      // 분류·관계 그룹: 기본 접힘 → 라벨 영역 숨김 + 배지 표시
      const classGroup = page.getByTestId('property-group-classification');
      await expect(classGroup).toBeVisible();
      await expect(page.getByTestId('issue-labels')).toBeHidden();
      await expect(classGroup.getByTestId('property-group-badge')).toHaveText('1');

      // 헤더 클릭 → 펼침 → 라벨 보임
      await classGroup.getByRole('button', { name: /분류·관계/ }).click();
      await expect(page.getByTestId('issue-labels')).toBeVisible();
    },
  );
});
