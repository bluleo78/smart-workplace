// 이슈 상세 "이전 화면으로 돌아가기" E2E — 헤더 ← 버튼과 ESC 로 상세 진입 직전 화면에 복귀(#885).
// 무엇을: 필터가 걸린 목록 URL 그대로 복귀, 이슈 간 이동을 건너뛴 복귀, 출발 화면이 없을 때의 기본 목적지,
//        ESC 가 편집 취소·오버레이 닫기와 충돌하지 않는지 검증.
import { expect, test } from '../../fixtures/auth.fixture';
import { createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';

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

// 필터가 걸린 목록에서 이슈 8 상세로 들어간다.
async function openDetailFromFilteredList(page: import('@playwright/test').Page) {
  await page.goto(`/projects/${KEY}?priority=HIGH`);
  await page.getByTestId('issue-row-8').getByText('비밀번호 재설정 메일').click();
  await expect(page).toHaveURL(DETAIL_URL(8));
  await expect(page.getByTestId('issue-back')).toBeVisible();
}

const FILTERED_LIST_URL = new RegExp(`/projects/${KEY}\\?priority=HIGH$`);

test.describe('이슈 상세 — 이전 화면으로 돌아가기', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await mock(page);
  });

  test('← 버튼 → 필터가 유지된 목록으로 복귀하고 히스토리를 쌓지 않는다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);

    await page.getByRole('button', { name: '이전 화면으로 돌아가기' }).click();
    await expect(page).toHaveURL(FILTERED_LIST_URL);

    // 되감기이므로 앞으로가기로 다시 상세에 갈 수 있다(새 항목을 push 했다면 앞으로가기가 없다).
    await page.goForward();
    await expect(page).toHaveURL(DETAIL_URL(8));
  });

  test('상세에서 상위 이슈로 건너간 뒤에도 ← 한 번에 출발한 목록으로 복귀한다', async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);
    await page.getByTestId('breadcrumb-parent-7').click();
    await expect(page).toHaveURL(DETAIL_URL(7));

    await page.getByTestId('issue-back').click();
    await expect(page).toHaveURL(FILTERED_LIST_URL);
  });

  test('브라우저 뒤로·앞으로 이동 후에도 ← 는 출발한 목록으로 복귀한다', async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);
    await page.goBack();
    await expect(page).toHaveURL(FILTERED_LIST_URL);
    await page.goForward();
    await expect(page).toHaveURL(DETAIL_URL(8));

    await page.getByTestId('issue-back').click();
    await expect(page).toHaveURL(FILTERED_LIST_URL);
  });

  test('직접 진입(출발 화면 없음) → ← 는 프로젝트 화면으로 이동한다', async ({ authenticatedPage: page }) => {
    await page.goto(`/projects/${KEY}/issues/8`);

    await page.getByTestId('issue-back').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
  });

  test('ESC → 목록으로 복귀한다', async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(FILTERED_LIST_URL);
  });

  test('제목 편집 중 ESC 는 편집만 취소하고 상세에 머문다', async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);
    await page.getByTestId('issue-title-edit').click();
    await page.getByTestId('issue-title-input').fill('바꾸다 만 제목');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-title-input')).toHaveCount(0);
    await expect(page).toHaveURL(DETAIL_URL(8));
  });

  test('쓰다 만 코멘트가 있으면 포커스가 밖에 있어도 ESC 로 이탈하지 않는다', async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);
    await page.getByTestId('issue-comment-input').fill('작성 중인 코멘트');
    await page.getByTestId('breadcrumb-current').click(); // 작성창 밖으로 포커스 이동

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-comment-input')).toHaveText('작성 중인 코멘트');
    await expect(page).toHaveURL(DETAIL_URL(8));
  });

  test('AI 패널이 열려 있으면 ESC 는 패널만 닫고, 다음 ESC 가 목록으로 복귀시킨다', async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByTestId('ai-side-panel')).toBeVisible();
    await page.getByTestId('breadcrumb-current').click(); // AI 입력창 밖으로 포커스 이동

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ai-side-panel')).toHaveCount(0);
    await expect(page).toHaveURL(DETAIL_URL(8));

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(FILTERED_LIST_URL);
  });

  test('채팅 드로워가 열려 있으면 ESC 는 드로워만 닫고, 다음 ESC 가 목록으로 복귀시킨다', async ({ authenticatedPage: page }) => {
    await openDetailFromFilteredList(page);
    await page.getByTestId('issue-chat-open').click();
    await expect(page.getByTestId('issue-chat-drawer')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('issue-chat-drawer')).toHaveCount(0);
    await expect(page).toHaveURL(DETAIL_URL(8));

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(FILTERED_LIST_URL);
  });
});
