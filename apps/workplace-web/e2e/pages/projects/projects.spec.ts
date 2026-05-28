import { createPageResponse, mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createMember, createProject } from '../../factories/project.factory';
import {
  createComment,
  createIssue,
  createIssueDetail,
  createIssueSearchResponse,
} from '../../factories/issue.factory';

// @smoke — 핵심 happy path 전체 파이프라인:
// 프로젝트 생성 → 이슈 생성 → 상태 변경 → 코멘트 작성.
test(
  '프로젝트 생성 → 이슈 생성 → 상태 변경 → 코멘트',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    // 0. 빈 목록 (Playwright page.route 는 LIFO — 나중에 등록한 라우트가 먼저 매칭)
    await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject()]));
    const createProjectCapture = await mockApi(
      page, 'POST', '/api/v1/projects', createProject(), { capture: true },
    );

    await page.goto('/projects');

    // 새 프로젝트 모달
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click();
    await page.getByLabel('key (예: WP)').fill('WP');
    await page.getByLabel('이름').fill('Workplace');
    await page.getByRole('button', { name: '생성' }).click();

    const created = await createProjectCapture.waitForRequest();
    expect(created.payload).toMatchObject({ key: 'WP', name: 'Workplace' });

    // 1. 프로젝트 상세 → 이슈 생성
    await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
    await mockApi(
      page, 'GET', '/api/v1/projects/WP/issues',
      createIssueSearchResponse([createIssue({ title: '첫 이슈' })]),
    );
    const createIssueCapture = await mockApi(
      page, 'POST', '/api/v1/projects/WP/issues', createIssue(), { capture: true },
    );

    await page.getByRole('main').getByRole('link', { name: /Workplace/ }).first().click();
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    await page.getByLabel('제목').fill('첫 이슈');
    await page.getByRole('button', { name: '생성' }).click();

    const issueCreated = await createIssueCapture.waitForRequest();
    expect(issueCreated.payload).toMatchObject({ title: '첫 이슈' });

    // 2. 이슈 상세 → 상태 IN_PROGRESS
    await mockApi(page, 'GET', '/api/v1/projects/WP/issues/1', createIssueDetail());
    const patchCapture = await mockApi(
      page, 'PATCH', '/api/v1/projects/WP/issues/1',
      createIssueDetail({ summary: createIssue({ status: 'IN_PROGRESS' }) }),
      { capture: true },
    );

    await page.getByRole('link', { name: '첫 이슈' }).click();
    await page.getByRole('combobox', { name: '상태' }).click();
    await page.getByRole('option', { name: '진행 중' }).click();

    const patched = await patchCapture.waitForRequest();
    expect(patched.payload).toMatchObject({ status: 'IN_PROGRESS' });

    // 3. 코멘트 작성
    const commentCapture = await mockApi(
      page, 'POST', '/api/v1/issues/100/comments', createComment(), { capture: true },
    );
    // 갱신용 detail (코멘트 포함)
    await mockApi(
      page, 'GET', '/api/v1/projects/WP/issues/1',
      createIssueDetail({ comments: [createComment()] }),
    );

    await page.getByPlaceholder('코멘트를 작성하세요').fill('확인했습니다');
    await page.getByRole('button', { name: '작성' }).click();

    const comment = await commentCapture.waitForRequest();
    expect(comment.payload).toMatchObject({ body: '확인했습니다' });

    // UI 반영
    await expect(page.getByText('확인했습니다')).toBeVisible();
  },
);

// non-smoke: 비멤버 프로젝트 접근 시 403 → 에러 메시지 노출
test('비멤버 프로젝트 접근 시 권한 거부 메시지 노출', async ({ authenticatedPage: page }) => {
  await mockApi(
    page, 'GET', '/api/v1/projects/SECRET',
    { status: 403, error: 'Forbidden', message: '프로젝트 멤버가 아닙니다',
      errors: null, timestamp: new Date().toISOString(), path: '/api/v1/projects/SECRET' },
    { status: 403 },
  );

  await page.goto('/projects/SECRET');
  await expect(page.getByText('프로젝트를 불러올 수 없습니다')).toBeVisible();
});

// non-smoke: PATCH 후 활동 타임라인에 변경 항목 한국어 라벨로 노출
test('상태 변경 시 활동 타임라인에 한국어 라벨로 노출', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());

  const after = createIssueDetail({
    summary: createIssue({ status: 'IN_PROGRESS' }),
    history: [{
      id: 1, actorId: 1, actorName: 'Tester', actorKind: 'HUMAN', eventType: 'STATUS_CHANGED',
      fromValue: 'TODO', toValue: 'IN_PROGRESS', createdAt: new Date().toISOString(),
    }],
  });
  let fetchCount = 0;
  await page.route('**/api/v1/projects/WP/issues/1', (route) => {
    if (route.request().method() === 'GET') {
      const body = fetchCount++ === 0 ? createIssueDetail() : after;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(after) });
  });

  await page.goto('/projects/WP/issues/1');
  await page.getByRole('combobox', { name: '상태' }).click();
  await page.getByRole('option', { name: '진행 중' }).click();
  await expect(page.getByText('상태 변경')).toBeVisible();
  await expect(page.getByText(/TODO\s*→\s*IN_PROGRESS/)).toBeVisible();
});

// non-smoke: 프로젝트 삭제 후 목록에서 사라짐
test('프로젝트 삭제 후 목록에서 사라진다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject());
  await mockApi(page, 'GET', '/api/v1/projects/WP/members', [createMember()]);

  let deleted = false;
  await page.route(
    (url) => url.pathname === '/api/v1/projects',
    (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPageResponse(deleted ? [] : [createProject()])),
        });
      }
      return route.fallback();
    },
  );
  await page.route(
    (url) => url.pathname === '/api/v1/projects/WP',
    (route) => {
      if (route.request().method() === 'DELETE') {
        deleted = true;
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    },
  );

  page.on('dialog', (d) => d.accept());

  await page.goto('/projects/WP/settings');
  await page.getByRole('button', { name: '프로젝트 삭제' }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText('아직 프로젝트가 없습니다')).toBeVisible();
});
