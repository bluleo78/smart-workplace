// 프로젝트 접근 불가 화면 E2E(WP-480) — 비멤버가 URL 로 설정·사이클·타임라인을 직접 열면 API 가 403 인데도 빈 관리 화면
// (「프로젝트 삭제」「+ 멤버 추가」, 틀린 「아직 사이클이 없습니다」)을 그리던 회귀를 막는다. 프로젝트 화면과 같은 안내를 보여야 한다.
import { expect, test } from '../../fixtures/auth.fixture';

const KEY = 'SEC';

for (const path of ['settings', 'cycles', 'timeline'] as const) {
  test(`비멤버가 /projects/${KEY}/${path} 를 열면 접근 불가 안내를 보인다`, async ({ authenticatedPage: page }) => {
    // 프로젝트와 그 하위 API 는 모두 403(비멤버).
    await page.route(
      (url) => url.pathname.startsWith(`/api/v1/projects/${KEY}`),
      (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: '프로젝트 멤버가 아닙니다' }),
        }),
    );

    await page.goto(`/projects/${KEY}/${path}`);

    await expect(page.getByText('프로젝트를 불러올 수 없습니다')).toBeVisible();
    await expect(page.getByRole('button', { name: '프로젝트 목록으로' })).toBeVisible();
    await expect(page.getByTestId('project-delete')).toHaveCount(0);
    await expect(page.getByTestId('member-add-trigger')).toHaveCount(0);
    await expect(page.getByText('아직 사이클이 없습니다')).toHaveCount(0);
  });
}
