// 프로젝트 핵심 흐름 E2E — 프로젝트 생성 → 이슈 생성 → 상태 변경 → 코멘트로 여러 화면을 잇는다(@flow).
// 빈 상태·목록 오류·403·삭제 뒤 이동·설정 설명 검증은 src/pages/projects/projectListPage.test.tsx,
// 상태 변경 토스트·이력 라벨은 src/pages/projects/issueDetailFields.test.tsx 페이지 테스트가 지킨다(WP-971).
import { createPageResponse, mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { createProject } from '../../factories/project.factory';
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
  { tag: ['@flow', '@smoke'] },
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
    // 상태 선택은 프로젝트 상태 id 를 보낸다(WP-808) — 시드 「진행 중」 id 2.
    expect(patched.payload).toMatchObject({ statusId: 2 });

    // 3. 코멘트 작성
    const commentCapture = await mockApi(
      page, 'POST', '/api/v1/issues/100/comments', createComment(), { capture: true },
    );
    // 갱신용 detail (코멘트 포함)
    await mockApi(
      page, 'GET', '/api/v1/projects/WP/issues/1',
      createIssueDetail({ comments: [createComment()] }),
    );

    // #785: 코멘트 입력이 RichInput(contenteditable) 으로 교체 — placeholder 는 접근성 트리에 노출되지 않으므로
    // testid 기반으로 클릭 후 타이핑한다.
    await page.getByTestId('issue-comment-input').click();
    await page.keyboard.type('확인했습니다');
    await page.getByRole('button', { name: '작성' }).click();

    const comment = await commentCapture.waitForRequest();
    expect(comment.payload).toMatchObject({ body: '확인했습니다' });

    // UI 반영 — waitForRequest 는 POST 가로채기 시점에 resolve 되므로 아직 mutateAsync 가 끝나지 않았을 수 있다.
    // 코멘트 포함 detail 목이 무효화 refetch 로 먼저 렌더되면 입력창(clear 전)과 목록에 같은 텍스트가 공존해
    // 페이지 전역 getByText 가 strict 위반으로 즉시 실패한다 → 입력창이 비워지길(#123) 먼저 기다리고,
    // 코멘트 확인은 코멘트 목록으로 범위를 좁힌다.
    await expect(page.getByTestId('issue-comment-input')).not.toContainText('확인했습니다');
    await expect(
      page.getByRole('region', { name: '코멘트' }).getByRole('list').getByText('확인했습니다'),
    ).toBeVisible();
  },
);
