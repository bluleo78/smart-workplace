// IssueCommentList — 코멘트 수정·삭제 E2E 회귀 테스트 (#154).
// page.route 로 5 endpoint 모킹. 4 케이스: 수정 / 삭제 / 타인 코멘트 읽기전용 / AGENT 코멘트 읽기전용.

import { expect, test } from '../../fixtures/auth.fixture';
import { createAgentComment, createComment, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueCommentResponse, IssueDetailResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const ISSUE_ID = 100;
// createUser()의 기본 id — auth fixture의 ME
const ME_ID = 1;

// 이슈 상세 페이지 공통 스텁 설정.
async function setupIssueStubs(
  page: import('@playwright/test').Page,
  detailRef: { current: IssueDetailResponse },
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
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

test.describe('IssueCommentList 코멘트 작성 폼 스타일 (#310)', () => {
  test('코멘트 textarea — resize-none 적용으로 RichInput과 시각 일관성', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 코멘트 작성 폼의 textarea 확인
    const textarea = page.locator('section[aria-label="코멘트"] textarea[placeholder="코멘트를 작성하세요"]');
    await expect(textarea).toBeVisible();

    // resize-none 클래스가 적용되어 있어야 함 — RichInput(이슈 채팅)과 시각 일관성
    await expect(textarea).toHaveClass(/resize-none/);
  });

  test('코멘트 작성 — 폼 입력 → POST API 호출 → 목록 갱신', async ({ authenticatedPage: page }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    await setupIssueStubs(page, detailRef);

    const postPayloads: { body: string }[] = [];
    const newComment = createComment({ id: 20, issueId: ISSUE_ID, authorId: ME_ID, body: '새 코멘트' });
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        postPayloads.push(payload);
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

    const textarea = page.locator('section[aria-label="코멘트"] textarea[placeholder="코멘트를 작성하세요"]');
    await textarea.fill('새 코멘트');
    await page.locator('section[aria-label="코멘트"] button[type="submit"]').click();

    // POST payload 검증
    await expect.poll(() => postPayloads.length).toBe(1);
    expect(postPayloads[0].body).toBe('새 코멘트');

    // UI에 새 코멘트 반영 확인
    await expect(page.getByText('새 코멘트')).toBeVisible();
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
      await page.waitForSelector('text=디자인 시스템 body-secondary 테스트');

      // 코멘트 본문 div — body-secondary 규격(text-sm·leading-6·text-foreground) 준수 여부
      const commentBody = page.locator('section[aria-label="코멘트"] ul li').first().locator('div.whitespace-pre-wrap');
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
      await page.waitForSelector('text=날짜 포맷 테스트 코멘트');

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

    // PATCH 요청 캡처
    const patchPayloads: { body: string }[] = [];
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        patchPayloads.push(payload);
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
    await page.waitForSelector('text=원본 코멘트');

    // 코멘트 섹션의 첫 번째 li — 편집 모드에서 텍스트가 textarea로 이동하므로 안정적 인덱스 사용.
    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();
    const editBtn = commentItem.locator('button[aria-label="코멘트 수정"]');
    await expect(editBtn).toBeVisible();

    // 수정 버튼 클릭 → 인라인 textarea
    await editBtn.click();
    const textarea = commentItem.locator('textarea[aria-label="코멘트 내용 수정"]');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('원본 코멘트');

    // 내용 수정 후 저장
    await textarea.fill('수정된 코멘트');
    await commentItem.locator('button:has-text("저장")').click();

    // PATCH payload 검증
    await expect.poll(() => patchPayloads.length).toBe(1);
    expect(patchPayloads[0].body).toBe('수정된 코멘트');

    // UI에 갱신된 본문 반영 확인
    await expect(page.locator('text=수정된 코멘트')).toBeVisible();
  });

  test('자신의 코멘트 — 삭제 버튼 클릭 → AlertDialog 확인 → DELETE API 호출 및 목록에서 제거', async ({ authenticatedPage: page }) => {
    const myComment: IssueCommentResponse = createComment({ id: 11, issueId: ISSUE_ID, authorId: ME_ID, body: '삭제할 코멘트' });
    const detailRef = { current: createIssueDetail({ comments: [myComment] }) };
    await setupIssueStubs(page, detailRef);

    const deleteIds: number[] = [];
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        const id = Number(new URL(route.request().url()).pathname.split('/').pop());
        deleteIds.push(id);
        // 삭제 성공 후 이슈 재조회 — 코멘트 없는 목록 반환.
        detailRef.current = createIssueDetail({ comments: [] });
        return route.fulfill({ status: 204 });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await page.waitForSelector('text=삭제할 코멘트');

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
    await expect.poll(() => deleteIds.length).toBe(1);
    expect(deleteIds[0]).toBe(11);

    // 목록에서 제거 확인 — 유일한 코멘트가 삭제되면 빈 안내 문구가 표시됨.
    await expect(page.getByText('코멘트가 없습니다')).toBeVisible();
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
    await page.waitForSelector('text=타인의 코멘트');

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
    await page.waitForSelector('text=확인 후 처리하겠습니다');

    const commentItem = page.locator('section[aria-label="코멘트"] ul li').first();
    await commentItem.hover();

    await expect(commentItem.locator('button[aria-label="코멘트 수정"]')).not.toBeVisible();
    await expect(commentItem.locator('button[aria-label="코멘트 삭제"]')).not.toBeVisible();
  });
});
