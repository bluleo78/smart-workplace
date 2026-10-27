// IssueCommentList — 코멘트 수정·삭제 E2E 회귀 테스트 (#154).
// page.route 로 5 endpoint 모킹. 4 케이스: 수정 / 삭제 / 타인 코멘트 읽기전용 / AGENT 코멘트 읽기전용.
// #785: 작성/수정 입력이 RichInput(@ 멘션)으로 교체됨에 따라 textarea 셀렉터를 data-testid 기반으로 갱신.

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';
import { createAgentComment, createComment, createIssueDetail } from '../../factories/issue.factory';
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

test.describe('IssueCommentList 코멘트 작성 폼 스타일 (#310, #785)', () => {
  test('코멘트 작성 입력 — RichInput(이슈 채팅과 동일 컴포넌트)으로 렌더', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // #785: shadcn Textarea 대신 RichInput(TipTap contenteditable) — 이슈 채팅과 동일 컴포넌트로
    // 시각 일관성(#310)과 @ 멘션 자동완성을 함께 확보.
    const input = page.getByTestId('issue-comment-input');
    await expect(input).toBeVisible();
    await expect(page.locator('textarea[placeholder="코멘트를 작성하세요"]')).toHaveCount(0);
    // 스크린리더 이름은 코멘트 작성칸 — 공용 RichInput 의 채팅 이름(「채팅 메시지 작성」)이 아니다(WP-831).
    await expect(input).toHaveAccessibleName('코멘트 작성');
  });

  test('코멘트 작성 — 입력 → POST API 호출 → 목록 갱신', async ({ authenticatedPage: page }) => {
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

// WP-885: 코멘트 상한(5만자) 초과 — 붙여넣기를 조용히 자르지 않고, 입력창 아래에 현재 글자 수를 안내하며 전송·저장(버튼·Enter)을 막는다.
test.describe('IssueCommentList 코멘트 길이 상한 (WP-885)', () => {
  test('작성창 — 5만 1자는 잘리지 않고 안내 + 전송 막힘(POST 없음), 5만자로 줄이면 전송된다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);
    const posts = trackRequests(page, 'POST', COMMENTS_PATH);
    await page.route(
      (url) => COMMENTS_PATH.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(createComment({ id: 21, issueId: ISSUE_ID, authorId: ME_ID, body: 'x' })),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const input = page.getByTestId('issue-comment-input');
    await input.fill('가'.repeat(50001));

    // 잘리지 않았다 — 안내가 실제 글자 수(50001)를 말한다.
    await expect(page.getByTestId('issue-comment-input-limit-error')).toHaveText('코멘트는 50000자 이하여야 합니다 (현재 50001자)');
    await expect(page.getByTestId('issue-comment-submit')).toBeDisabled();
    // 키보드 전송(Enter)도 막힌다 — 입력은 그대로 남는다.
    await input.press('Enter');
    await expectStays(page, () => posts.count(), 0);
    await expect(page.getByTestId('issue-comment-input-limit-error')).toBeVisible();

    await input.fill('가'.repeat(50000));
    await expect(page.getByTestId('issue-comment-input-limit-error')).toHaveCount(0);
    await expect(page.getByTestId('issue-comment-submit')).toBeEnabled();
    await page.getByTestId('issue-comment-submit').click();
    await expect.poll(posts.count).toBe(1);
    expect(posts.bodies<{ body: string }>()[0].body).toHaveLength(50000);
  });

  test('수정 폼 — 5만 1자는 안내 + 저장 막힘(PATCH 없음)', async ({ authenticatedPage: page }) => {
    const myComment: IssueCommentResponse = createComment({ id: 10, issueId: ISSUE_ID, authorId: ME_ID, body: '원본 코멘트' });
    const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
    await setupIssueStubs(page, detailRef);
    const patches = trackRequests(page, 'PATCH', COMMENT_PATH);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();
    await commentItem.locator('button[aria-label="코멘트 수정"]').click();

    const editInput = page.getByTestId('issue-comment-edit-input');
    // fill 은 DOM 에서 전체를 고른 뒤 따로 글자를 넣는다. 부하에서는 그 사이 편집기가 자기 커서(끝)를 DOM 에 다시 써
    // 원본 「원본 코멘트」 뒤에 덧붙곤 했다(50007자). 편집기 단축키로 먼저 비우고 빈 것을 확인한 뒤 채우면 커서가 어디든 결과가 같다.
    await expect(editInput).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await expect(editInput).toHaveText('');
    await editInput.fill('나'.repeat(50001));

    await expect(page.getByTestId('issue-comment-edit-input-limit-error')).toHaveText('코멘트는 50000자 이하여야 합니다 (현재 50001자)');
    await expect(page.getByTestId('issue-comment-edit-save')).toBeDisabled();
    await editInput.press('Enter');
    await expectStays(page, () => patches.count(), 0);
    // 편집창도 그대로 열려 있다(입력 유실 없음).
    await expect(editInput).toBeVisible();
  });
});

test.describe('IssueCommentList @멘션 자동완성 (#785)', () => {
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

test.describe('IssueCommentList 코멘트 본문 디자인 시스템 body-secondary (#344)', () => {
  test(
    '코멘트 본문 div — text-sm·leading-6·text-foreground 클래스 적용',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const myComment: IssueCommentResponse = createComment({
        id: 40,
        issueId: ISSUE_ID,
        authorId: ME_ID,
        body: '디자인 시스템 body-secondary 테스트',
      });
      const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
      await setupIssueStubs(page, detailRef);

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await expect(page.locator('text=디자인 시스템 body-secondary 테스트').first()).toBeVisible();

      // 코멘트 본문 div — body-secondary 규격(text-sm·leading-6·text-foreground) 준수 여부
      const commentBody = page.locator('section[aria-label="코멘트"] ul li').first().getByTestId('markdown-content');
      await expect(commentBody).toHaveClass(/text-sm/);
      await expect(commentBody).toHaveClass(/leading-6/);
      await expect(commentBody).toHaveClass(/text-foreground/);
    },
  );
});

test.describe('IssueCommentList 날짜 포맷 (#320)', () => {
  test(
    '코멘트 날짜가 초 없이 분 단위(YYYY-MM-DD HH:mm)로 표시된다',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // UTC 타임스탬프(Z 포함) → parseUtcDate 경유 → formatDateTimeMinute → "YYYY-MM-DD HH:mm"
      const fixedDate = '2026-06-08T03:06:36Z';
      const myComment: IssueCommentResponse = createComment({
        id: 30,
        issueId: ISSUE_ID,
        authorId: ME_ID,
        body: '날짜 포맷 테스트 코멘트',
        createdAt: fixedDate,
      });
      const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
      await setupIssueStubs(page, detailRef);

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await expect(page.locator('text=날짜 포맷 테스트 코멘트').first()).toBeVisible();

      const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();

      // 초 단위 포함 패턴(HH:MM:SS)이 없어야 함 — toLocaleString('ko-KR') 잔재 방지
      await expect(commentItem).not.toContainText(/\d{1,2}:\d{2}:\d{2}/);
      // YYYY-MM-DD HH:mm 형식이어야 함
      await expect(commentItem).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    },
  );
});

test.describe('IssueCommentList 수정·삭제 (#154)', () => {
  test('자신의 코멘트 — 수정 버튼 클릭 → 인라인 편집 → PATCH API 호출 및 본문 갱신', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const myComment: IssueCommentResponse = createComment({ id: 10, issueId: ISSUE_ID, authorId: ME_ID, body: '원본 코멘트' });
    const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
    await setupIssueStubs(page, detailRef);

    const patches = trackRequests(page, 'PATCH', COMMENT_PATH);
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        const updated: IssueCommentResponse = { ...myComment, body: payload.body };
        // 수정 성공 후 invalidateQueries 로 이슈 재조회 — 갱신된 코멘트 목록 반환.
        detailRef.current = createIssueDetail({ comments: [updated] });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(updated),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.locator('text=원본 코멘트').first()).toBeVisible();

    // 코멘트 섹션의 첫 번째 li — 편집 모드에서 텍스트가 RichInput 으로 이동하므로 안정적 인덱스 사용.
    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();
    const editBtn = commentItem.locator('button[aria-label="코멘트 수정"]');
    await expect(editBtn).toBeVisible();

    // 수정 버튼 클릭 → 인라인 RichInput (#785)
    await editBtn.click();
    const editInput = page.getByTestId('issue-comment-edit-input');
    await expect(editInput).toBeVisible();
    await expect(editInput).toContainText('원본 코멘트');
    // 수정칸은 「코멘트 수정」으로 읽힌다(WP-831).
    await expect(editInput).toHaveAccessibleName('코멘트 수정');

    // 내용 수정 후 저장 — 기존 텍스트 전체 선택 후 교체.
    await editInput.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('수정된 코멘트');
    await page.getByTestId('issue-comment-edit-save').click();

    // PATCH payload 검증
    await expect.poll(patches.count).toBe(1);
    expect(patches.bodies<{ body: string }>()[0].body).toBe('수정된 코멘트');

    // UI에 갱신된 본문 반영 확인
    await expect(page.locator('text=수정된 코멘트')).toBeVisible();
  });

  test('자신의 코멘트 — 삭제 버튼 클릭 → AlertDialog 확인 → DELETE API 호출 및 목록에서 제거', async ({ authenticatedPage: page }) => {
    const myComment: IssueCommentResponse = createComment({ id: 11, issueId: ISSUE_ID, authorId: ME_ID, body: '삭제할 코멘트' });
    const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
    await setupIssueStubs(page, detailRef);

    const deletes = trackRequests(page, 'DELETE', COMMENT_PATH);
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        // 삭제 성공 후 이슈 재조회 — 코멘트 없는 목록 반환.
        detailRef.current = createIssueDetail({ comments: [] });
        return route.fulfill({ status: 204 });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.locator('text=삭제할 코멘트').first()).toBeVisible();

    // 코멘트 섹션의 첫 번째 li — 안정적 인덱스 사용.
    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();
    const deleteBtn = commentItem.locator('button[aria-label="코멘트 삭제"]');
    await expect(deleteBtn).toBeVisible();

    // 삭제 버튼 → AlertDialog 열림
    await deleteBtn.click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();

    // 취소 버튼은 삭제 진행 안 함 — destructive 확인 버튼 클릭
    await dialog.getByRole('button', { name: '삭제' }).click();

    // 다이얼로그 닫힘 대기
    await expect(dialog).not.toBeVisible();

    // DELETE API 호출 검증
    await expect.poll(deletes.count).toBe(1);
    expect(deletes.urls()[0].pathname.split('/').pop()).toBe('11');

    // 목록에서 제거 확인 — 유일한 코멘트가 삭제되면 빈 안내 문구가 표시됨.
    await expect(page.getByText('코멘트가 없습니다')).toBeVisible();
  });

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

  test('타인의 코멘트 — 수정·삭제 버튼이 hover 시에도 보이지 않는다', async ({ authenticatedPage: page }) => {
    const otherComment: IssueCommentResponse = createComment({
      id: 12,
      issueId: ISSUE_ID,
      authorId: ME_ID + 999, // 다른 사용자
      authorName: '다른 사용자',
      body: '타인의 코멘트',
    });
    const detailRef = { current: createIssueDetail({ comments: [otherComment] }) };
    await setupIssueStubs(page, detailRef);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.locator('text=타인의 코멘트').first()).toBeVisible();

    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();

    // 수정·삭제 버튼이 존재하지 않아야 함
    await expect(commentItem.locator('button[aria-label="코멘트 수정"]')).not.toBeVisible();
    await expect(commentItem.locator('button[aria-label="코멘트 삭제"]')).not.toBeVisible();
  });

  test('AGENT 코멘트 — 수정·삭제 버튼이 hover 시에도 보이지 않는다', async ({ authenticatedPage: page }) => {
    const agentComment = createAgentComment({ id: 13, issueId: ISSUE_ID });
    const detailRef = { current: createIssueDetail({ comments: [agentComment] }) };
    await setupIssueStubs(page, detailRef);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.locator('text=확인 후 처리하겠습니다').first()).toBeVisible();

    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();

    await expect(commentItem.locator('button[aria-label="코멘트 수정"]')).not.toBeVisible();
    await expect(commentItem.locator('button[aria-label="코멘트 삭제"]')).not.toBeVisible();
  });
});

test.describe('IssueCommentList 새로고침 유실 경고 (#620)', () => {
  // 실제 beforeunload 확인창은 headless 브라우저가 표시하지 않으므로, window 에 이벤트를
  // 직접 dispatch 해 리스너가 등록돼 preventDefault() 를 호출하는지로 검증한다.
  async function dispatchBeforeUnload(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
  }

  test('코멘트 입력창이 비어있으면 beforeunload 경고가 없다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByText('코멘트가 없습니다')).toBeVisible();

    expect(await dispatchBeforeUnload(page)).toBe(false);
  });

  test('코멘트 작성 중 새로고침 시도 → beforeunload 경고가 뜬다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const input = page.getByTestId('issue-comment-input');
    await input.click();
    await page.keyboard.type('작성 중인 코멘트');

    expect(await dispatchBeforeUnload(page)).toBe(true);
  });

  test('작성 후 제출하면 beforeunload 경고가 해제된다', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);
    const newComment = createComment({ id: 21, issueId: ISSUE_ID, authorId: ME_ID, body: '제출된 코멘트' });
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        detailRef.current = createIssueDetail({ comments: [newComment] });
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newComment) });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const input = page.getByTestId('issue-comment-input');
    await input.click();
    await page.keyboard.type('제출된 코멘트');
    expect(await dispatchBeforeUnload(page)).toBe(true);

    await page.getByTestId('issue-comment-submit').click();
    // 무효화 refetch 가 mutateAsync resolve 보다 먼저 코멘트를 렌더할 수 있어 "코멘트 표시"는 제출 완료 신호가
    // 아니다. 실제 완료 신호인 입력창 clear(= suppress 처리된 onChange 로 hasDraft 해제)를 기다린다.
    await expect(input).not.toContainText('제출된 코멘트');
    await expect(
      page.getByRole('region', { name: '코멘트' }).getByRole('list').getByText('제출된 코멘트'),
    ).toBeVisible();

    // beforeunload 리스너 해제는 setHasDraft(false) 이후 effect 에서 일어나므로 1회 확인 대신 폴링한다.
    await expect.poll(() => dispatchBeforeUnload(page)).toBe(false);
  });
});

test.describe('AGENT 코멘트 마크다운 렌더 (WP-254)', () => {
  // AI 가 남기는 진행 보고형 코멘트 — 제목·체크리스트·굵게·멘션 토큰·원시 HTML 을 함께 담는다.
  const AGENT_BODY = [
    '## 조사 결과',
    '',
    '**원인**: 정산 배치가 재시도 시 멱등 키 없이 다시 적재했습니다. 담당 <@1> 확인 부탁드립니다.',
    '',
    '- [x] 로그 수집',
    '- [ ] 재현 테스트 작성',
    '- [ ] 수정 배포',
    '',
    '<b>raw</b>',
  ].join('\n');

  test('AGENT 코멘트는 마크다운으로 — 체크리스트는 불릿 없는 읽기 전용 체크박스, 원시 HTML 은 해석하지 않는다', async ({ authenticatedPage: page }) => {
    const members = [createMember({ userId: 1, name: 'Tester' }), createAgentMember()];
    const agentComment = createAgentComment({ id: 30, issueId: ISSUE_ID, body: AGENT_BODY });
    const detailRef = { current: createIssueDetail({ comments: [agentComment] }) };
    await setupIssueStubs(page, detailRef, members);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const item = page.locator('section[aria-label="코멘트"] li[data-agent="true"]');
    const md = item.getByTestId('markdown-content');
    await expect(md).toBeVisible();

    // 제목·굵게가 마크다운 요소로 변환되고 원시 기호(##, **)는 남지 않는다.
    await expect(md.getByRole('heading', { name: '조사 결과' })).toBeVisible();
    await expect(md.locator('strong')).toHaveText('원인');
    await expect(md).not.toContainText('##');
    await expect(md).not.toContainText('**');

    // GFM 체크리스트 — 체크 상태가 원문대로, 읽기 전용, 불릿 없음.
    const boxes = md.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(3);
    await expect(boxes.nth(0)).toBeChecked();
    await expect(boxes.nth(1)).not.toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    for (let i = 0; i < 3; i++) await expect(boxes.nth(i)).toBeDisabled();
    await expect(md.locator('ul').first()).toHaveCSS('list-style-type', 'none');

    // <@id> 토큰은 원문 대신 '@이름' 으로.
    await expect(md).toContainText('담당 @Tester 확인');
    await expect(md).not.toContainText('<@1>');

    // 원시 HTML 비허용 — 태그가 해석되지 않고 b 요소가 생기지 않는다.
    await expect(md.locator('b')).toHaveCount(0);
  });

  test('사람 코멘트도 마크다운으로 — 굵게·체크리스트가 서식대로 보인다 (WP-1015)', async ({ authenticatedPage: page }) => {
    const human = createComment({ id: 31, issueId: ISSUE_ID, authorId: 2, authorName: '김개발', body: '**굵게**\n\n- [ ] 체크' });
    const detailRef = { current: createIssueDetail({ comments: [human] }) };
    await setupIssueStubs(page, detailRef);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    const item = page.locator('section[aria-label="코멘트"] ul li').first();
    await expect(item.getByTestId('markdown-content').locator('strong')).toHaveText('굵게');
    await expect(item).not.toContainText('**');
    await expect(item.locator('input[type="checkbox"]')).toHaveCount(1);
  });
});
