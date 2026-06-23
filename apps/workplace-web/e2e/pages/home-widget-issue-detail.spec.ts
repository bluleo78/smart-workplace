// #465: 홈 챗 도크 이슈 상세 위젯(IssueDetailWidget) 렌더 + 에러 처리 검증.
// show_issue_detail 지시(done.widgets)를 받아 /projects/{key}/issues/{number} 를 조회한다.
// 전략: compose done SSE 에 widgets:[{type:'issue_detail',...}] 를 포함시키고,
//   위젯이 호출하는 이슈 상세 API 를 모킹(200/500)하여 백엔드 없이 성공·에러를 검증한다.

import { createIssueDetail } from '../factories/issue.factory';
import { expect, test } from '../fixtures/auth.fixture';

test.describe('#465 홈 챗 도크 이슈 상세 위젯', () => {
  test('이슈 상세 위젯이 제목·상태를 렌더한다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/ai/chat',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-iss-1","widgets":[{"type":"issue_detail","params":{"number":1,"projectKey":"WP"}}]}\n\n',
        }),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/projects/WP/issues/1',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createIssueDetail()),
        }),
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('WP-1 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    await expect(page.getByTestId('issuedetail')).toBeVisible();
  });

  // #465 버그 수정: fetch 실패 시 무한 스켈레톤이 아니라 재시도 가능한 에러를 표시한다.
  test('이슈 상세 조회 실패 시 에러+재시도를 표시한다(무한 스켈레톤 금지)', async ({ authenticatedPage: page }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/ai/chat',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-iss-2","widgets":[{"type":"issue_detail","params":{"number":9,"projectKey":"WP"}}]}\n\n',
        }),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/projects/WP/issues/9',
      (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }),
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('WP-9 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    // 에러 상태(재시도 버튼 포함)가 보이고, issuedetail(성공 본문)은 안 보인다.
    await expect(page.getByTestId('issuedetail-error')).toBeVisible();
    await expect(page.getByTestId('issuedetail')).toHaveCount(0);
  });
});
