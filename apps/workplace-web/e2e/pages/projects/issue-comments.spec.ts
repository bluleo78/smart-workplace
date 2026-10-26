// IssueCommentList — 코멘트 E2E (#154·#785·WP-832).
// 브라우저가 있어야 판정되는 것만 남긴다 — 작성 → POST → 목록 갱신 배선(@wiring), TipTap 실제 타이핑의 @ 자동완성·
// 자동 포커스 위치·후보 mousedown 포커스 유지, 키보드 삭제 뒤 포커스 이동(@input).
// 작성칸 렌더·길이 상한(WP-885)·수정/삭제 payload·작성자별 버튼·날짜 포맷(#320)·본문 클래스(#344)·
// 새로고침 경고(#620)·AGENT 마크다운(WP-254)은 페이지 테스트 src/pages/projects/issueComments.test.tsx 가 지킨다(WP-980).

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createComment, createIssueDetail } from '../../factories/issue.factory';
import { createAgentMember, createMember, createProject } from '../../factories/project.factory';
import type { IssueCommentResponse, IssueDetailResponse } from '../../../src/types/issue';
import type { MemberResponse } from '../../../src/types/project';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const COMMENTS_PATH = /\/api\/v1\/issues\/\d+\/comments$/;
const COMMENT_PATH = /\/api\/v1\/issues\/\d+\/comments\/\d+$/;
const ISSUE_ID = 100;
// createUser()의 기본 id — auth fixture의 ME
const ME_ID = 1;

// 이슈 상세 페이지 공통 스텁 설정.
async function setupIssueStubs(
  page: import('@playwright/test').Page,
  detailRef: { current: IssueDetailResponse },
  members: MemberResponse[] = [],
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detailRef.current),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

test.describe('IssueCommentList 코멘트 작성 (#785)', () => {
  test('코멘트 작성 — 입력 → POST API 호출 → 목록 갱신', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);

    const posts = trackRequests(page, 'POST', COMMENTS_PATH);
    const newComment = createComment({ id: 20, issueId: ISSUE_ID, authorId: ME_ID, body: '새 코멘트' });
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        // 작성 성공 후 invalidateQueries 로 이슈 재조회 — 새 코멘트 포함 목록 반환
        detailRef.current = createIssueDetail({ comments: [newComment] });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newComment),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByText('코멘트가 없습니다')).toBeVisible();

    const input = page.getByTestId('issue-comment-input');
    await input.click();
    await page.keyboard.type('새 코멘트');
    await page.getByTestId('issue-comment-submit').click();

    // POST payload 검증
    await expect.poll(posts.count).toBe(1);
    expect(posts.bodies<{ body: string }>()[0].body).toBe('새 코멘트');

    // UI에 새 코멘트 반영 확인
    await expect(page.getByText('새 코멘트')).toBeVisible();
  });
});

test.describe('IssueCommentList @멘션 자동완성 (#785)', { tag: '@input' }, () => {
  test('작성 입력창 — @ 입력 시 자동완성 팝업 노출 + 선택 → <@id> 전송 + 칩 렌더', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    const members = [createMember({ userId: 1, name: 'Tester' }), createAgentMember()];
    await setupIssueStubs(page, detailRef, members);

    const posts = trackRequests(page, 'POST', COMMENTS_PATH);
    const newComment = createComment({
      id: 21,
      issueId: ISSUE_ID,
      authorId: ME_ID,
      body: 'hi <@99>',
    });
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        detailRef.current = createIssueDetail({ comments: [newComment] });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(newComment),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const input = page.getByTestId('issue-comment-input');
    await input.click();
    await page.keyboard.type('hi @ai');

    // @ 입력 시 자동완성 드롭다운 노출 — 수정 전에는 뜨지 않던 부분(#785 재현 지점).
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    await page.getByTestId('chat-mention-option-99').click();

    // 선택 후 입력창에 이름 칩이 삽입된다.
    await expect(input).toContainText('@AI Agent');

    await page.getByTestId('issue-comment-submit').click();

    // 전송 payload 는 <@id> 토큰으로 직렬화된다.
    await expect.poll(() => posts.bodies<{ body: string }>().map((p) => p.body.trim())).toEqual(['hi <@99>']);

    // 읽기 모드 렌더 — 멘션 칩(이름 + AGENT 스타일)으로 표시된다.
    const chip = page.getByTestId('comment-mention-chip-99');
    await expect(chip).toHaveText('@AI Agent');
    await expect(chip).toHaveClass(/bg-ai-accent-subtle/);
    await expect(chip).toHaveClass(/text-ai-accent/);
  });

  test('수정 입력창 — 기존 멘션 칩 복원 + @ 자동완성 동작', async ({ authenticatedPage: page }) => {
    const members = [createMember({ userId: 1, name: 'Tester' }), createAgentMember()];
    const myComment: IssueCommentResponse = createComment({
      id: 22,
      issueId: ISSUE_ID,
      authorId: ME_ID,
      body: '검토 요청 <@99>',
    });
    const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
    await setupIssueStubs(page, detailRef, members);

    const patches = trackRequests(page, 'PATCH', COMMENT_PATH);
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        const updated: IssueCommentResponse = { ...myComment, body: payload.body };
        detailRef.current = createIssueDetail({ comments: [updated] });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 읽기 모드에서 기존 멘션이 칩으로 렌더되는지 먼저 확인.
    await expect(page.getByTestId('comment-mention-chip-99')).toHaveText('@AI Agent');

    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();
    await commentItem.locator('button[aria-label="코멘트 수정"]').click();

    const editInput = page.getByTestId('issue-comment-edit-input');
    // 수정 진입 시 기존 멘션이 칩으로 복원된다.
    await expect(editInput).toContainText('@AI Agent');

    // 추가로 @ 입력 시 자동완성이 뜬다.
    await editInput.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @tester');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    // 후보를 누르는 순간에도 입력창이 포커스를 잃지 않는다(WP-302) — mousedown 기본 동작은 동기라 즉시 확인한다.
    await page.getByTestId('chat-mention-option-1').hover();
    await page.mouse.down();
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('[data-testid="issue-comment-edit-input"]')),
    ).toBe(true);
    await page.mouse.up();

    await page.getByTestId('issue-comment-edit-save').click();

    await expect.poll(patches.count).toBe(1);
    expect(patches.bodies<{ body: string }>()[0].body).toBe('검토 요청 <@99> <@1>');
  });

  // WP-85 — 수정 진입 시 자동 포커스가 본문 끝에 놓여, 클릭·End 없이 바로 이어 쓸 수 있다.
  // (autofocus=start 는 마운트 직후 비동기로 커서를 맨 앞으로 옮겨 입력이 앞에 붙는 flaky 를 냈다)
  test('수정 입력창 — 자동 포커스가 본문 끝이라 바로 이어 쓴다', async ({ authenticatedPage: page }) => {
    const members = [createMember({ userId: 1, name: 'Tester' }), createAgentMember()];
    const myComment: IssueCommentResponse = createComment({
      id: 23,
      issueId: ISSUE_ID,
      authorId: ME_ID,
      body: '검토 요청 <@99>',
    });
    const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
    await setupIssueStubs(page, detailRef, members);

    const patches = trackRequests(page, 'PATCH', COMMENT_PATH);
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        const updated: IssueCommentResponse = { ...myComment, body: payload.body };
        detailRef.current = createIssueDetail({ comments: [updated] });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();
    await commentItem.locator('button[aria-label="코멘트 수정"]').click();

    const editInput = page.getByTestId('issue-comment-edit-input');
    await expect(editInput).toContainText('@AI Agent');
    // 클릭·End 없이 자동 포커스 위치에서 바로 입력 — 포커스가 편집기 안에 잡힌 뒤 타이핑한다.
    await expect(editInput).toBeFocused();
    await page.keyboard.type(' 추가');
    await page.getByTestId('issue-comment-edit-save').click();

    await expect.poll(patches.count).toBe(1);
    expect(patches.bodies<{ body: string }>()[0].body).toBe('검토 요청 <@99> 추가');
  });
});

test.describe('IssueCommentList 키보드 삭제 포커스 (WP-832)', { tag: '@input' }, () => {
  // WP-832: 키보드로 지우면 행이 빠지며 포커스가 body 로 빠졌다 — 같은 자리에 온 코멘트로, 다 지웠으면 작성칸으로 잇는다.
  test('키보드로 코멘트를 지우면 포커스가 다음 코멘트로, 마지막 코멘트까지 지우면 작성칸으로 간다', async ({ authenticatedPage: page }) => {
    const first = createComment({ id: 21, issueId: ISSUE_ID, authorId: ME_ID, body: '첫 코멘트' });
    const second = createComment({ id: 22, issueId: ISSUE_ID, authorId: ME_ID, body: '둘째 코멘트' });
    const detailRef = { current: createIssueDetail({ comments: [first, second] }) };
    await setupIssueStubs(page, detailRef);
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        // 지운 코멘트를 뺀 목록으로 재조회되게 한다.
        const id = Number(new URL(route.request().url()).pathname.split('/').pop());
        const left = detailRef.current.comments.filter((c) => c.id !== id);
        detailRef.current = createIssueDetail({ comments: left });
        return route.fulfill({ status: 204 });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const items = page.locator('section[aria-label="코멘트"] ul li');
    await expect(items.filter({ hasText: '둘째 코멘트' })).toBeVisible();

    // 키보드로: 「코멘트 삭제」 → Enter → 확인창 「삭제」 → Enter.
    const deleteWithKeyboard = async (body: string) => {
      await items.filter({ hasText: body }).locator('button[aria-label="코멘트 삭제"]').focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('alertdialog');
      await dialog.getByRole('button', { name: '삭제' }).focus();
      await page.keyboard.press('Enter');
      await expect(items.filter({ hasText: body })).toHaveCount(0);
    };

    await deleteWithKeyboard('첫 코멘트');
    // 지운 자리에 온 「둘째 코멘트」 행이 포커스를 받는다(body 가 아니다).
    await expect(items.filter({ hasText: '둘째 코멘트' })).toBeFocused();
    // 이어서 Tab 하면 화면 처음이 아니라 그 코멘트 안의 컨트롤로 간다.
    await page.keyboard.press('Tab');
    await expect(items.filter({ hasText: '둘째 코멘트' }).locator(':focus')).toHaveCount(1);

    await deleteWithKeyboard('둘째 코멘트');
    // 남은 코멘트가 없으면 작성칸으로.
    await expect(page.getByTestId('issue-comment-input')).toBeFocused();
  });
});
