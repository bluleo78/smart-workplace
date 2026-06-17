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

// non-smoke: 빈 상태 — 아이콘+제목+설명+CTA 4요소 노출 (refs #296)
test('프로젝트 없을 때 빈 상태 UI 4요소가 모두 표시된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([]));

  await page.goto('/projects');

  // 빈 상태 컨테이너
  const emptyState = page.getByTestId('projects-empty');
  await expect(emptyState).toBeVisible();

  // 제목 + 설명 텍스트
  await expect(emptyState.getByText('아직 프로젝트가 없어요')).toBeVisible();
  await expect(emptyState.getByText('팀원과 함께 작업할 프로젝트를 만들어 보세요.')).toBeVisible();

  // CTA 버튼 클릭 시 생성 모달 열림 (입력→처리→출력 파이프라인)
  await emptyState.getByRole('button', { name: '새 프로젝트 만들기' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

// non-smoke: 프로젝트 목록 API 실패 시 오류 메시지·재시도 버튼 노출 (refs #189)
test('프로젝트 목록 API 실패 시 오류 메시지와 재시도 버튼이 표시된다', async ({ authenticatedPage: page }) => {
  // QueryClient 전역 retry: 1 → 자동 재시도 1회 포함, 첫 2번은 500으로 isError 유도,
  // 3번째(수동 "다시 시도" 클릭)는 200으로 복구 확인
  let attempt = 0;
  await page.route(
    (url) => url.pathname === '/api/v1/projects',
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      attempt++;
      if (attempt <= 2) {
        return route.fulfill({ status: 500, contentType: 'application/json',
          body: JSON.stringify({ message: 'Internal Server Error' }) });
      }
      // 수동 재시도 요청: 정상 응답
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(createPageResponse([createProject()])) });
    },
  );

  await page.goto('/projects');

  // 오류 메시지와 재시도 버튼 표시 확인 (retry: 1 자동 재시도 소진 후 isError 노출)
  await expect(page.getByText('프로젝트 목록을 불러오지 못했습니다.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();

  // 재시도 클릭 → 정상 목록 표시
  await page.getByRole('button', { name: '다시 시도' }).click();
  await expect(page.getByText('프로젝트 목록을 불러오지 못했습니다.')).not.toBeVisible();
  await expect(page.getByRole('list').getByRole('link', { name: /Workplace/ })).toBeVisible();
});

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
  await expect(page.getByText(/할 일\s*→\s*진행 중/)).toBeVisible();
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

  await page.goto('/projects/WP/settings');
  await page.getByTestId('project-delete').click();
  // shadcn AlertDialog가 열리면 확인 버튼을 클릭 (#139 window.confirm 대체).
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: '삭제' }).last().click();
  await expect(page).toHaveURL(/\/projects$/);
  // 빈 상태 empty state: 아이콘+제목+설명+CTA 4요소 확인
  await expect(page.getByTestId('projects-empty')).toBeVisible();
  await expect(page.getByText('아직 프로젝트가 없어요')).toBeVisible();
});
