// 모바일 이슈 상세 ‹ — 데스크톱 ← 와 같은 "출발 화면 복귀" 규칙(#885)을 병합 상세 헤더에서도 따른다.
import { createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const DETAIL_URL = (n: number) => new RegExp(`/projects/${KEY}/issues/${n}$`);

// 목록(이슈 7·8) + 두 이슈의 상세 스텁. 8 은 7 의 하위 이슈라 상세 브레드크럼에 상위 크럼이 생긴다.
async function mock(page: import('@playwright/test').Page) {
  const parent = createIssue({ id: 1, number: 7, projectKey: KEY, title: '로그인 개편' });
  const child = createIssue({
    id: 2,
    number: 8,
    projectKey: KEY,
    title: '비밀번호 재설정 메일',
    parent: { number: 7, title: '로그인 개편', type: makeTaskType() },
  });
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route(`**/api/v1/projects/${KEY}`, (route) => route.fulfill(json(createProject({ key: KEY }))));
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill(json(createIssueSearchResponse([parent, child], null)));
    },
  );
  for (const issue of [parent, child]) {
    const base = `/api/v1/projects/${KEY}/issues/${issue.number}`;
    await page.route((url) => url.pathname === base, (route) => route.fulfill(json(createIssueDetail({ summary: issue }))));
    await page.route(
      (url) => ['watchers', 'labels', 'attachments', 'drive-links'].some((sub) => url.pathname === `${base}/${sub}`),
      (route) => route.fulfill(json([])),
    );
    await page.route(
      (url) => url.pathname === `${base}/chat/thread`,
      (route) => route.fulfill(json(createChatThread({ threadId: 999, recentMessages: [] }))),
    );
  }
  for (const path of [`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`, '/api/v1/drive/spaces']) {
    await page.route((url) => url.pathname === path, (route) => route.fulfill(json([])));
  }
}


test('필터 목록 → 이슈 상세 → ‹ 는 필터가 유지된 목록으로 되감는다', async ({ authenticatedPage: page }) => {
  await stubChat(page);
  await mock(page);
  await page.goto(`/projects/${KEY}?priority=HIGH`);
  await page.getByTestId('issue-row-8').getByText('비밀번호 재설정 메일').click();
  await expect(page).toHaveURL(DETAIL_URL(8));
  // 모바일은 데스크톱 브레드크럼 대신 병합 헤더 한 줄 — ← 버튼(issue-back)은 없고 ‹ 하나만.
  await expect(page.getByTestId('issue-back')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('mobile-back').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?priority=HIGH$`));
  await page.goForward();
  await expect(page).toHaveURL(DETAIL_URL(8));
});

test('딥링크로 연 이슈 상세의 ‹ 는 프로젝트 화면으로 간다', async ({ authenticatedPage: page }) => {
  await stubChat(page);
  await mock(page);
  await page.goto(`/projects/${KEY}/issues/8`);
  await expect(page.getByTestId('mobile-back')).toBeVisible();
  const lengthBefore = await page.evaluate(() => history.length);
  await page.getByTestId('mobile-back').click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
  // replace 이동 — 시스템 뒤로가기가 방금 떠난 상세로 되돌아가는 왕복 고리가 없다.
  expect(await page.evaluate(() => history.length)).toBe(lengthBefore);
});
