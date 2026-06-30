// 이슈 상세 제목·본문 인라인 수정 UI 회귀 테스트 (refs #117)
// 제목/본문을 인라인으로 편집 → PATCH payload 검증 + 재조회된 GET 반영(렌더) 검증.
// 핵심: useUpdateIssue 는 onSuccess 에서 detail 캐시를 invalidate(재조회)하므로,
// GET 스텁이 currentTitle/currentBody 를 추적해야 변경 후 새 값이 렌더된다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;
const ISSUE_DETAIL_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}`;

// 가변 상태 + PATCH payload 추적용 컨테이너.
interface Stub {
  title: string;
  body: string;
  patches: Record<string, unknown>[];
}

// 상세 페이지 진입에 필요한 스텁 일괄 설정.
async function setupStubs(page: import('@playwright/test').Page): Promise<Stub> {
  const stub: Stub = { title: '원본 제목', body: '원본 본문', patches: [] };

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 이슈 상세 GET — 가변 title/body 를 읽어 응답(재조회 시 새 값 반영).
  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: stub.title }),
            body: stub.body,
          }),
        ),
      });
    },
  );

  // 상세 보조 엔드포인트.
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `${ISSUE_DETAIL_PATH}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }

  // 이슈 상세 PATCH — payload 기록 + 가변 상태 갱신.
  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      stub.patches.push(payload);
      if (typeof payload.title === 'string') stub.title = payload.title;
      if (typeof payload.body === 'string') stub.body = payload.body;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: stub.title })),
      });
    },
  );

  return stub;
}

test.describe('이슈 상세 제목·본문 인라인 수정 (#117)', () => {
  test('제목 편집 → Enter → PATCH {title} 호출 + 새 제목 렌더', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('page-header').getByText('원본 제목')).toBeVisible();

    // 편집 트리거(연필 버튼) → input 노출.
    await page.getByRole('button', { name: '제목 편집' }).click();
    const input = page.getByTestId('issue-title-input');
    await expect(input).toBeVisible();
    await input.fill('수정된 제목');
    await input.press('Enter');

    await expect.poll(() => stub.patches.length).toBeGreaterThanOrEqual(1);
    expect(stub.patches[stub.patches.length - 1]).toEqual({ title: '수정된 제목' });
    await expect(page.getByTestId('page-header').getByText('수정된 제목')).toBeVisible();
  });

  test('제목을 공백으로 비우면 저장 차단(PATCH 없음) + 원본 복귀', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('page-header').getByText('원본 제목')).toBeVisible();

    await page.getByRole('button', { name: '제목 편집' }).click();
    const input = page.getByTestId('issue-title-input');
    await input.fill('   ');
    await input.press('Enter');

    // 빈 제목은 PATCH 가 발생하지 않아야 하고, 표시는 원본으로 복귀.
    await page.waitForTimeout(300);
    expect(stub.patches.filter((p) => 'title' in p)).toHaveLength(0);
    await expect(page.getByTestId('page-header').getByText('원본 제목')).toBeVisible();
  });

  test('제목 편집 중 Escape → 취소(PATCH 없음)', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('page-header').getByText('원본 제목')).toBeVisible();

    await page.getByRole('button', { name: '제목 편집' }).click();
    const input = page.getByTestId('issue-title-input');
    await input.fill('버려질 제목');
    await input.press('Escape');

    await page.waitForTimeout(300);
    expect(stub.patches).toHaveLength(0);
    await expect(page.getByTestId('page-header').getByText('원본 제목')).toBeVisible();
  });

  test('본문 편집 → Ctrl+Enter → PATCH {body} 호출 + 새 본문 렌더', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByText('원본 본문')).toBeVisible();

    await page.getByRole('button', { name: '본문 편집' }).click();
    const textarea = page.getByTestId('issue-body-textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('수정된 본문');
    await textarea.press('ControlOrMeta+Enter');

    await expect.poll(() => stub.patches.length).toBeGreaterThanOrEqual(1);
    expect(stub.patches[stub.patches.length - 1]).toEqual({ body: '수정된 본문' });
    await expect(page.getByText('수정된 본문')).toBeVisible();
  });

  test('본문 편집 중 Escape → 취소(PATCH 없음)', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByText('원본 본문')).toBeVisible();

    await page.getByRole('button', { name: '본문 편집' }).click();
    const textarea = page.getByTestId('issue-body-textarea');
    await textarea.fill('버려질 본문');
    await textarea.press('Escape');

    await page.waitForTimeout(300);
    expect(stub.patches).toHaveLength(0);
    await expect(page.getByText('원본 본문')).toBeVisible();
  });

  // 회귀: 본문 편집 버튼이 hover 없이 기본 표시되어야 함 (refs #266)
  // opacity-0 클래스가 제거되어 마우스 hover 없이도 편집 버튼이 보여야 한다.
  test('본문 편집 버튼이 hover 없이 기본 표시됨 (opacity-0 없음) (#266)', async ({ authenticatedPage: page }) => {
    await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByText('원본 본문')).toBeVisible();

    // hover 없이 본문 편집 버튼의 computed opacity 가 1이어야 함
    const bodyEditBtn = page.getByRole('button', { name: '본문 편집' });
    await expect(bodyEditBtn).toHaveCSS('opacity', '1');
  });

  // Jira 식 — 본문 영역 전체 클릭 → 편집, 호버 배경 변화, 하단 좌측 저장/취소 버튼.
  test('본문 영역 클릭 → 편집 모드 + 저장/취소 버튼 노출', async ({
    authenticatedPage: page,
  }) => {
    await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 본문 영역(클릭 가능)에 호버 배경 클래스가 있어 편집 가능 신호를 준다.
    const bodyArea = page.getByRole('button', { name: '본문 편집' });
    await expect(bodyArea).toHaveClass(/hover:bg-muted/);

    // 클릭 → 편집 모드 진입 + 저장/취소 버튼 노출.
    await bodyArea.click();
    await expect(page.getByTestId('issue-body-textarea')).toBeVisible();
    await expect(page.getByTestId('issue-body-save')).toBeVisible();
    await expect(page.getByTestId('issue-body-cancel')).toBeVisible();
  });

  test('본문 편집 → 저장 버튼 → PATCH {body} 호출 + 새 본문 렌더', async ({
    authenticatedPage: page,
  }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await page.getByRole('button', { name: '본문 편집' }).click();
    await page.getByTestId('issue-body-textarea').fill('버튼으로 저장한 본문');
    await page.getByTestId('issue-body-save').click();

    await expect.poll(() => stub.patches.length).toBeGreaterThanOrEqual(1);
    expect(stub.patches[stub.patches.length - 1]).toEqual({ body: '버튼으로 저장한 본문' });
    await expect(page.getByText('버튼으로 저장한 본문')).toBeVisible();
  });

  test('본문 편집 → 취소 버튼 → PATCH 없음 + 원본 복귀', async ({
    authenticatedPage: page,
  }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await page.getByRole('button', { name: '본문 편집' }).click();
    await page.getByTestId('issue-body-textarea').fill('버려질 본문');
    await page.getByTestId('issue-body-cancel').click();

    await page.waitForTimeout(300);
    expect(stub.patches).toHaveLength(0);
    await expect(page.getByText('원본 본문')).toBeVisible();
  });
});
