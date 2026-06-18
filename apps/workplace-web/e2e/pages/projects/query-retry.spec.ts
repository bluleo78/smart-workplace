import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';

// 전역 QueryClient retry 정책 회귀 테스트 (main.tsx).
// 4xx 클라이언트 오류는 재시도해도 결과가 같으므로 즉시 실패해야 하고(불필요한 ~1초 지연 제거),
// 5xx 서버 오류·네트워크 오류는 1회 재시도해야 한다.
// 입력→처리→출력 파이프라인: 특정 상태 코드 응답 → useProject 쿼리의 재시도 횟수 → 발생한 HTTP 요청 수.

test.describe('QueryClient 전역 retry 정책', () => {
  // 404(클라이언트 오류)는 재시도하지 않고 단 1회 요청 후 즉시 오류 표시.
  test('404 응답은 재시도하지 않는다 (요청 1회)', async ({ authenticatedPage: page }) => {
    const capture = await mockApi(
      page,
      'GET',
      '/api/v1/projects/NONEXISTENT999',
      { message: '프로젝트를 찾을 수 없습니다' },
      { status: 404, capture: true },
    );

    await page.goto('/projects/NONEXISTENT999');

    // 첫 404 즉시 오류 화면 표시 (retry backoff 지연 없음)
    await expect(page.getByText('프로젝트를 불러올 수 없습니다')).toBeVisible();

    // 기존 retry:1 동작이었다면 ~1초 후 2번째 요청이 발생한다. 그 backoff 창을 넘겨 확인.
    await page.waitForTimeout(1500);
    expect(capture.requests).toHaveLength(1);
  });

  // 500(서버 오류)은 1회 재시도하여 총 2회 요청.
  test('500 응답은 1회 재시도한다 (요청 2회)', async ({ authenticatedPage: page }) => {
    const capture = await mockApi(
      page,
      'GET',
      '/api/v1/projects/SERVERERR999',
      { message: '서버 오류' },
      { status: 500, capture: true },
    );

    await page.goto('/projects/SERVERERR999');

    // backoff(~1초) 후 재시도가 발생해 요청이 2회가 되어야 한다.
    await expect.poll(() => capture.requests.length, { timeout: 5000 }).toBe(2);
    await expect(page.getByText('프로젝트를 불러올 수 없습니다')).toBeVisible();
  });
});
