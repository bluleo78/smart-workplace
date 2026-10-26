// 이슈 상세 채움 버튼(저장·삭제 확인) 글자 대비 E2E(WP-322) — 브라우저가 실제로 칠한 색으로 재야 해서 E2E 에 남는다(@layout).
// 삭제 확인창 문구(태스크·하위·에픽)·취소·DELETE 는 src/pages/projects/issueDetailEdit.test.tsx 페이지 테스트가 지킨다(WP-971).

import { expect, test } from '../../fixtures/auth.fixture';
import { expectTheme, textContrast, withTheme } from '../../fixtures/contrast';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { makeEpicType } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 2;

// IssueDetailPage 공통 스텁 — 삭제 다이얼로그 테스트에 필요한 최소 엔드포인트 모킹.
async function setupDeleteStubs(
  page: import('@playwright/test').Page,
  childCount = 0,
  type?: ReturnType<typeof makeEpicType>,
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: '삭제 대상 태스크', childCount, ...(type ? { type } : {}) }),
            body: '본문',
            comments: [],
            history: [],
          }),
        ),
      });
    },
  );
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
}

// 채움 버튼 글자 대비(WP-322) — 다크 기본 버튼(밝은 primary 위 흰 글자 3.25:1)·라이트 삭제 버튼(밝은 빨강 위 흰 글자 3.6:1)이 AA 미달이던 회귀 방지.
// 브라우저가 실제로 칠한 색(반투명 다크 삭제 버튼 bg-destructive/60 포함)으로 잰다.
for (const theme of ['light', 'dark'] as const) {
  test(`기본·삭제 버튼 글자가 4.5:1 대비를 지킨다 (${theme}) (WP-322)`, { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await withTheme(page, theme);
    await setupDeleteStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expectTheme(page, theme);

    // 기본(primary) 버튼 — 본문 편집의 「저장」.
    await page.getByRole('button', { name: '본문 편집' }).click();
    const save = page.getByTestId('issue-body-save');
    await expect(save).toBeVisible();
    expect(await textContrast(save)).toBeGreaterThanOrEqual(4.5);
    await page.getByTestId('issue-body-cancel').click();

    // 삭제(destructive) 버튼 — 삭제 확인 다이얼로그의 「삭제」.
    await page.getByTestId('issue-delete').click();
    const confirm = page.getByRole('alertdialog').getByRole('button', { name: '삭제' });
    await expect(confirm).toBeVisible();
    expect(await textContrast(confirm)).toBeGreaterThanOrEqual(4.5);
  });
}
