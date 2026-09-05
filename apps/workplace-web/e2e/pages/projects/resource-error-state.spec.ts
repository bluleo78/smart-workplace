import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';

// 존재하지 않는 프로젝트/이슈 접근 시 404 패턴(아이콘+제목+설명+액션 버튼) 회귀 테스트 (#787).
// 이전에는 <p> 한 줄("프로젝트를 불러올 수 없습니다")만 렌더해 액션이 전혀 없었다.
// 입력→처리→출력: 404 응답 → ResourceErrorState 렌더 → "프로젝트 목록으로" 버튼 클릭 → /projects 이동.

test.describe('리소스 로드 실패 화면 (#787)', () => {
  test('존재하지 않는 프로젝트 접근 시 아이콘·제목·설명·액션 버튼이 모두 렌더되고, 버튼 클릭 시 목록으로 이동한다', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(
      page,
      'GET',
      '/api/v1/projects/NOPROJECT999',
      { message: '프로젝트를 찾을 수 없습니다' },
      { status: 404 },
    );
    // 프로젝트 목록 페이지로 이동했을 때 렌더될 최소 응답 — 이동 성공 확인용.
    await mockApi(page, 'GET', '/api/v1/projects', { content: [], totalElements: 0 }, { status: 200 });

    await page.goto('/projects/NOPROJECT999');

    // 제목 — 기존 텍스트 유지 (query-retry.spec.ts 등 기존 회귀와 호환)
    await expect(page.getByText('프로젝트를 불러올 수 없습니다')).toBeVisible();
    // 설명 — 신규
    await expect(
      page.getByText('요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다.'),
    ).toBeVisible();
    // 아이콘 — lucide svg (FolderX)가 실제로 렌더되는지
    await expect(page.locator('svg.lucide-folder-x')).toBeVisible();

    // 액션 버튼 클릭 → 프로젝트 목록(/projects)으로 이동
    const listButton = page.getByRole('button', { name: '프로젝트 목록으로' });
    await expect(listButton).toBeVisible();
    await listButton.click();

    await expect(page).toHaveURL(/\/projects$/);
  });

  test('존재하지 않는 이슈(프로젝트 자체 접근 불가) 접근 시 동일한 404 패턴이 렌더되고, 버튼 클릭 시 목록으로 이동한다', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(
      page,
      'GET',
      '/api/v1/projects/NOPROJECT999',
      { message: '프로젝트를 찾을 수 없습니다' },
      { status: 404 },
    );
    await mockApi(page, 'GET', '/api/v1/projects', { content: [], totalElements: 0 }, { status: 200 });

    await page.goto('/projects/NOPROJECT999/issues/1');

    await expect(page.getByText('프로젝트를 불러올 수 없습니다')).toBeVisible();
    await expect(
      page.getByText('요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다.'),
    ).toBeVisible();
    await expect(page.locator('svg.lucide-file-question-mark')).toBeVisible();

    const listButton = page.getByRole('button', { name: '프로젝트 목록으로' });
    await expect(listButton).toBeVisible();
    await listButton.click();

    await expect(page).toHaveURL(/\/projects$/);
  });
});
