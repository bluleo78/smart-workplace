// #431: 홈 챗 도크 인라인 위젯 렌더 — show_* 도구가 지시한 위젯을 done 이벤트로 받아 렌더한다.
// 배경: #234/#348 재설계로 위젯 렌더 표면이 제거돼, compose done 의 widgets[] 가 클라이언트에서
//   버려지고 있었다(이슈/메일 목록 조회 시 빈 버블). 본 스펙은 렌더 표면 복원 + 메일 위젯을 검증한다.
//
// 전략: /api/v1/ai/compose 를 done-only SSE(빈 텍스트 + widgets[])로 모킹하고,
//   위젯이 자체 훅으로 호출하는 데이터 API(/me/issues, /mail/accounts/{id}/messages)를 모킹한다.
//   LLM 이 표를 생성하지 않고 위젯이 구조화 데이터를 렌더하는 것이 이 기능의 핵심이다.

import { createIssue, createIssueSearchResponse } from '../factories/issue.factory';
import { mailAccount, summary } from '../factories/mail.factory';
import { expect, test } from '../fixtures/auth.fixture';

test.describe('#431 홈 챗 도크 인라인 위젯 렌더', () => {
  test('mail_list 위젯 — show_mail_list done 이벤트를 받아 메일 목록을 렌더', async ({
    authenticatedPage: page,
  }) => {
    // 1) compose 는 텍스트 없이 mail_list 위젯만 지시(show_mail_list 단독 응답 모사).
    await page.route(
      (url) => url.pathname === '/api/v1/ai/compose',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body:
            'event: done\ndata: {"sessionId":"s-mail-1","widgets":[{"type":"mail_list","params":{"folder":"INBOX"}}]}\n\n',
        }),
    );
    // 2) 위젯이 기본 계정을 해석하기 위해 호출하는 계정 목록.
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([mailAccount({ id: 1 })]),
        }),
    );
    // 3) 계정 1의 받은편지함 목록 — folder=INBOX 쿼리로 호출돼야 한다.
    let listFolder: string | null = null;
    await page.route(
      (url) => url.pathname === '/api/v1/mail/accounts/1/messages',
      (route) => {
        listFolder = new URL(route.request().url()).searchParams.get('folder');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            summary({ id: 10, subject: '프로젝트 회의 안내', fromName: '앨리스', seen: false }),
            summary({ id: 11, subject: '분기 보고서', fromName: '밥', seen: true, hasAttachment: false }),
          ]),
        });
      },
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('메일 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    // 출력: 위젯 컨테이너 + 메일 목록 행이 렌더되고, 셀 단위 데이터가 보인다.
    await expect(page.getByTestId('chat-widgets')).toBeVisible();
    const items = page.getByTestId('maillist-items');
    await expect(items).toBeVisible();
    await expect(items).toContainText('프로젝트 회의 안내');
    await expect(items).toContainText('앨리스');
    await expect(items).toContainText('분기 보고서');

    // 처리: 데이터 API 가 folder=INBOX 로 호출됐는지(위젯 params → 쿼리 전파) 검증.
    expect(listFolder).toBe('INBOX');

    // LLM 이 표를 토큰으로 생성하지 않으므로 마크다운 파이프 표는 화면에 없다(위젯이 대신 렌더).
    await expect(page.getByTestId('chat-panel')).not.toContainText('| # |');
  });

  test('issue_list 위젯 — 빈 버블 회귀 방지(show_issue_list done 을 렌더)', async ({
    authenticatedPage: page,
  }) => {
    // compose 는 텍스트 없이 issue_list 위젯만 지시 — 과거엔 widgets 가 버려져 빈 버블이 됐다.
    await page.route(
      (url) => url.pathname === '/api/v1/ai/compose',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body:
            'event: done\ndata: {"sessionId":"s-issue-1","widgets":[{"type":"issue_list","params":{"assignee":"me"}}]}\n\n',
        }),
    );
    // 위젯이 호출하는 내 이슈 목록.
    let issueAssignee: string | null = null;
    await page.route(
      (url) => url.pathname === '/api/v1/me/issues',
      (route) => {
        issueAssignee = new URL(route.request().url()).searchParams.get('assignee');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            createIssueSearchResponse([
              createIssue({ projectKey: 'WP', number: 7, title: '위젯 렌더 이슈' }),
            ]),
          ),
        });
      },
    );

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();
    await page.getByTestId('chat-input').fill('내 이슈 목록 보여줘');
    await page.getByRole('button', { name: '보내기' }).click();

    // 출력: 위젯 컨테이너 + 이슈 목록 행(빈 버블이 아니라 실제 위젯).
    await expect(page.getByTestId('chat-widgets')).toBeVisible();
    const items = page.getByTestId('issuelist-items');
    await expect(items).toBeVisible();
    await expect(items).toContainText('위젯 렌더 이슈');
    await expect(items).toContainText('WP-7');

    // 처리: assignee=me 로 호출됐는지(위젯 params 전파) 검증.
    expect(issueAssignee).toBe('me');
  });
});
