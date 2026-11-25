// 이슈 제목 동시 편집 충돌(WP-2095 2차 리뷰 지적 2) — 실제 브라우저 포커스 동작만 지킨다(@input).
// 충돌 안내가 떠 있는 동안 입력칸이 blur 에서 포커스를 되찾으면 덮어쓰기 확인 창(포털·포커스 가둠)·다른 컨트롤과 포커스가 서로 당겼다.
// PATCH 가 409 를 돌려주고(그 사이 남이 제목을 바꿈) 최신 상세가 다른 제목이면 충돌 안내가 열린다.

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';

const PROJECT_KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;
const ISSUE_DETAIL_PATH = `${ISSUES_PATH}/1`;
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page: import('@playwright/test').Page) {
  // 서버의 제목 — PATCH 가 409 를 낼 때 남이 먼저 바꾼 값으로 옮긴다.
  let serverTitle = '원본 제목';
  // 서로 겹치지 않는 경로라 등록 순서와 무관하다 — 한꺼번에 등록한다.
  await Promise.all([
  page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) => route.fulfill(json(createProject()))),
  page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => route.fulfill(json([]))),
  page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => (route.request().method() === 'GET' ? route.fulfill(json(createIssueSearchResponse([]))) : route.fallback()),
  ),
  ...['watchers', 'labels', 'attachments', 'children'].map((sub) =>
    page.route((url) => url.pathname === `${ISSUE_DETAIL_PATH}/${sub}`, (route) => route.fulfill(json([]))),
  ),
  page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill(json(createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: serverTitle, version: serverTitle === '원본 제목' ? 1 : 2 }), body: '본문' })));
      }
      if (method === 'PATCH') {
        serverTitle = '남이 바꾼 제목';
        return route.fulfill(json({ status: 409, message: '다른 사람이 먼저 수정했습니다' }, 409));
      }
      return route.fallback();
    },
  ),
  ]);
}

test.describe('이슈 제목 충돌 안내와 포커스(WP-2095)', () => {
  test('덮어쓰기 확인 창이 열리면 포커스가 창 안에 머물고, 닫은 뒤 다른 컨트롤을 눌러도 제목 입력칸이 포커스를 끌어오지 않는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByTestId('issue-title-edit').click();
    const input = page.getByTestId('issue-title-input');
    await input.fill('내가 바꾼 제목');
    await input.press('Enter');
    await expect(page.getByTestId('issue-edit-conflict-title')).toBeVisible();

    // (1) 마우스로 [내 글로 덮어쓰기…] — 확인 창 단추가 포커스를 받고, Tab 을 눌러도 창 안에 머문다.
    await page.getByTestId('issue-edit-conflict-title-overwrite').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'))).toBe(true);

    // (2) 창을 「돌아가기」로 닫은 뒤 다른 컨트롤을 누르면 그 컨트롤이 포커스를 갖고, 제목 입력칸은 포커스를 되찾지 않는다.
    await dialog.getByRole('button', { name: '돌아가기' }).click();
    await expect(dialog).toBeHidden();
    const other = page.getByTestId('assignee-picker-trigger');
    await other.click();
    // 담당자 선택은 눌러 열리는 팝오버라 포커스는 그 안으로 간다 — 제목 입력칸이 끌어오지 못하고 팝오버가 열려 있어야 한다.
    await expect(page.getByRole('dialog', { name: '담당자 선택' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await expect(input).not.toBeFocused();
  });
});
