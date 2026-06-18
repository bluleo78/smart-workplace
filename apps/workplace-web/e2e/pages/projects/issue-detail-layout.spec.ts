// 이슈 상세 레이아웃 — 속성 레일 3그룹 접기/펼침 + 첨부 본문 이동 E2E 테스트 (#343).
// 무엇을: property-group-classification 기본 접힘·배지 + 첨부가 본문 스트립으로 이동 검증.

import { expect, test } from '../../fixtures/auth.fixture';
import { createAttachment } from '../../factories/attachment.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueAttachment } from '../../../src/types/attachment';
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

// 첨부 목록 API 스텁 — mockIssueDetail 이후 호출해 attachments 응답을 override.
// 무엇을: mockIssueDetail 이 attachments→[] 로 스텁하는 것을 실제 목록으로 교체.
// 왜: Playwright 은 마지막 등록 route 가 우선하므로 mockIssueDetail 후 이걸 등록하면 덮어씀.
async function mockAttachmentList(
  page: import('@playwright/test').Page,
  items: IssueAttachment[],
) {
  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/attachments`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(items),
      }),
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

  test('첨부는 본문 설명 아래 스트립으로 표시되고 사이드바엔 없다', async ({
    authenticatedPage: page,
  }) => {
    await mockIssueDetail(page, { attachmentCount: 2 });
    await mockAttachmentList(page, [
      createAttachment({ fileId: 1, originalName: 'spec.pdf', mimeType: 'application/pdf', sizeBytes: 1234, attachedById: 9 }),
      createAttachment({ fileId: 2, originalName: 'shot.png', mimeType: 'image/png', sizeBytes: 5678, attachedById: 9 }),
    ]);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const strip = page.getByTestId('issue-attachment-strip');
    await expect(strip).toBeVisible();
    await expect(strip.getByText('spec.pdf')).toBeVisible();
    // 사이드바(속성 레일)에 첨부 섹션이 없다
    await expect(page.getByTestId('property-rail').getByText('첨부')).toHaveCount(0);
  });

  test('첨부가 0개인 스트립에서는 "첨부가 없습니다" 텍스트가 숨겨지고 드롭존만 표시된다', async ({
    authenticatedPage: page,
  }) => {
    // 무엇을: attachmentCount=0, 빈 목록 → "첨부가 없습니다" 텍스트는 strip 모드에서 숨김 (drop-zone만 표시).
    // 왜: strip 레이아웃에서 빈 상태 텍스트는 불필요 — drop-zone 이 목적을 대신.
    await mockIssueDetail(page, { attachmentCount: 0 });
    await mockAttachmentList(page, []);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const strip = page.getByTestId('issue-attachment-strip');
    await expect(strip).toBeVisible();

    // strip 내에서 "첨부가 없습니다" 텍스트는 보이지 않아야 함
    await expect(strip.getByText('첨부가 없습니다')).toHaveCount(0);

    // drop-zone 은 여전히 보여야 함
    const dropzone = strip.getByTestId('attachment-dropzone');
    await expect(dropzone).toBeVisible();
    await expect(dropzone).toContainText('파일을 드롭하거나 클릭해 첨부');
  });
});
