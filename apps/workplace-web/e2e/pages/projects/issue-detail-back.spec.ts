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

  test('직접 진입(출발 화면 없음) → ← 는 상세를 교체해 프로젝트 화면으로 간다(뒤로가기로 상세에 돌아오지 않음)', async ({ authenticatedPage: page }) => {
    await page.goto(`/projects/${KEY}/issues/8`);
    const lengthBefore = await page.evaluate(() => history.length);

    await page.getByTestId('issue-back').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
    // replace 이동이라 히스토리가 늘지 않는다 — push 였다면 뒤로가기가 방금 떠난 상세로 되돌아간다.
    expect(await page.evaluate(() => history.length)).toBe(lengthBefore);
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

// 넓은 화면(2xl container max-width 1536px 초과)에서 헤더가 본문과 같은 좌우 축에 놓이는지 — 헤더가 container 로
// 가운데 정렬되면 ← 버튼이 제목보다 수백 px 안쪽에서 시작하고 우측 액션이 본문 끝보다 앞에서 끝난다(372px 차이).
test.describe('이슈 상세 헤더 — 넓은 화면 정렬', () => {
  test.use({ viewport: { width: 2560, height: 1200 } });

  test('← 버튼은 제목과 같은 x 에서 시작하고 헤더는 본문 전체폭을 쓴다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}/issues/8`);
    const back = page.getByTestId('issue-back');
    const title = page.getByTestId('issue-title-heading');
    await expect(back).toBeVisible();
    await expect(title).toBeVisible();

    const backBox = (await back.boundingBox())!;
    const titleBox = (await title.boundingBox())!;
    // 둘 다 페이지 여백(pageGutterClass, 16px) 축 — ← 버튼 박스의 왼쪽 끝과 제목 왼쪽 끝이 같아야 한다(반올림 오차만 허용).
    expect(Math.abs(backBox.x - titleBox.x)).toBeLessThanOrEqual(1);

    // 헤더 내부 래퍼가 헤더 폭을 그대로 채운다(max-width 로 잘리지 않음).
    const header = page.getByTestId('page-header');
    const [headerW, innerW] = await header.evaluate((el) => [
      el.getBoundingClientRect().width,
      (el.firstElementChild as HTMLElement).getBoundingClientRect().width,
    ]);
    expect(innerW).toBe(headerW);
  });
});
