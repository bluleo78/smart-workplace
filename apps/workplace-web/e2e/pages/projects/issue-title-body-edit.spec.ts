// 이슈 상세 제목·본문 인라인 수정 UI 회귀 테스트 (refs #117)
// 제목/본문을 인라인으로 편집 → PATCH payload 검증 + 재조회된 GET 반영(렌더) 검증.
// 핵심: useUpdateIssue 는 onSuccess 에서 detail 캐시를 invalidate(재조회)하므로,
// GET 스텁이 currentTitle/currentBody 를 추적해야 변경 후 새 값이 렌더된다.

import { expect, test } from '../../fixtures/auth.fixture';
import { expectStays } from '../../fixtures/wait';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
// 본문 초안 localStorage 키 — IssueDetailPage 의 bodyDraftKey 와 같은 형식(#824).
const DRAFT_KEY = `issue-body-draft:${PROJECT_KEY}:${ISSUE_NUMBER}`;
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
  // 보드 페이지(#824 draft 테스트 — 브레드크럼 이탈 왕복) 진입 시 필요한 이슈 검색 GET.
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse([])),
      });
    },
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
  // #791 — h1 accessible name에 편집 버튼의 aria-label("제목 편집")이 섞여 들어가지 않아야 한다.
  test('제목 heading의 accessible name이 편집 버튼 라벨과 섞이지 않는다 (#791)', async ({
    authenticatedPage: page,
  }) => {
    await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // aria-label 명시로 accessible name === 제목 텍스트만이어야 한다 (편집 버튼 라벨 미포함).
    await expect(page.getByRole('heading', { level: 1, name: '원본 제목', exact: true })).toBeVisible();
  });

  test('제목 편집 → Enter → PATCH {title} 호출 + 새 제목 렌더', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();

    // 편집 트리거(연필 버튼) → input 노출.
    await page.getByRole('button', { name: '제목 편집' }).click();
    const input = page.getByTestId('issue-title-input');
    await expect(input).toBeVisible();
    await input.fill('수정된 제목');
    await input.press('Enter');

    await expect.poll(() => stub.patches.length).toBeGreaterThanOrEqual(1);
    expect(stub.patches[stub.patches.length - 1]).toEqual({ title: '수정된 제목' });
    await expect(page.getByTestId('issue-title-heading').getByText('수정된 제목')).toBeVisible();
  });

  test('제목을 공백으로 비우면 저장 차단(PATCH 없음) + 원본 복귀', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();

    await page.getByRole('button', { name: '제목 편집' }).click();
    const input = page.getByTestId('issue-title-input');
    await input.fill('   ');
    await input.press('Enter');

    // 빈 제목은 PATCH 가 발생하지 않아야 하고, 표시는 원본으로 복귀.
    await expectStays(page, () => stub.patches.filter((p) => 'title' in p).length, 0);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();
  });

  test('제목 편집 중 Escape → 취소(PATCH 없음)', async ({ authenticatedPage: page }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();

    await page.getByRole('button', { name: '제목 편집' }).click();
    const input = page.getByTestId('issue-title-input');
    await input.fill('버려질 제목');
    await input.press('Escape');

    await expectStays(page, () => stub.patches.length, 0);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();
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

    await expectStays(page, () => stub.patches.length, 0);
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

    await expectStays(page, () => stub.patches.length, 0);
    await expect(page.getByText('원본 본문')).toBeVisible();
  });

  // #824 — beforeunload 로 못 막는 SPA 내부 네비게이션(브레드크럼 링크 이탈 → 뒤로가기 재진입)에서도
  // localStorage 초안 자동저장으로 작업을 복구할 수 있어야 한다.
  test('본문 편집 중 브레드크럼 링크로 이탈 → 뒤로가기 재진입 시 초안 복구 배너 노출 + 불러오기 (#824)', async ({
    authenticatedPage: page,
  }) => {
    await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await page.getByRole('button', { name: '본문 편집' }).click();
    const textarea = page.getByTestId('issue-body-textarea');
    await textarea.fill('저장 안 하고 이탈할 초안');

    // 디바운스(600ms) 후 localStorage 에 초안이 기록될 때까지 조건 대기(고정 대기 대신).
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY))
      .toBe('저장 안 하고 이탈할 초안');

    // 브레드크럼의 프로젝트명 링크 클릭 → SPA 내부 네비게이션(프로젝트 목록 화면으로 이동, beforeunload 미발생).
    await page.getByRole('navigation', { name: '이슈 경로' }).getByRole('link').first().click();
    await expect(page.getByTestId('empty-no-issues')).toBeVisible();

    // 브라우저 뒤로가기(popstate) → 이슈 상세로 재진입.
    await page.goBack();
    await expect(page.getByText('원본 본문')).toBeVisible();

    // 다시 편집 진입 → 서버 본문과 다른 로컬 초안이 있으므로 복구 배너 노출.
    await page.getByRole('button', { name: '본문 편집' }).click();
    await expect(page.getByTestId('issue-body-draft-banner')).toBeVisible();

    // [불러오기] → textarea 에 초안 내용 복원.
    await page.getByTestId('issue-body-draft-restore').click();
    await expect(page.getByTestId('issue-body-textarea')).toHaveValue('저장 안 하고 이탈할 초안');
    await expect(page.getByTestId('issue-body-draft-banner')).toBeHidden();
  });

  // 초안 저장 성공 후 재진입 시 배너가 뜨지 않아야 한다(초안 정리 확인, #824).
  test('본문 편집 → 저장 성공 후 재진입 시 초안 복구 배너 미노출 (#824)', async ({
    authenticatedPage: page,
  }) => {
    const stub = await setupStubs(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await page.getByRole('button', { name: '본문 편집' }).click();
    await page.getByTestId('issue-body-textarea').fill('정상 저장된 본문');
    // 디바운스 초안 저장이 끝난 뒤 정식 저장 — 저장 성공이 초안을 정리하는지 보려면 초안이 먼저 있어야 한다.
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY))
      .toBe('정상 저장된 본문');
    await page.getByTestId('issue-body-save').click();

    await expect.poll(() => stub.patches.length).toBeGreaterThanOrEqual(1);
    await expect(page.getByText('정상 저장된 본문')).toBeVisible();

    // 재진입 시 초안이 정리되어 있어야 하므로 배너가 뜨지 않는다.
    await page.getByRole('button', { name: '본문 편집' }).click();
    await expect(page.getByTestId('issue-body-draft-banner')).toBeHidden();
  });
});
