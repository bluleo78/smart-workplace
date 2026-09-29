// IssueCommentList — 코멘트 수정·삭제 E2E 회귀 테스트 (#154).
// page.route 로 5 endpoint 모킹. 4 케이스: 수정 / 삭제 / 타인 코멘트 읽기전용 / AGENT 코멘트 읽기전용.
// #785: 작성/수정 입력이 RichInput(@ 멘션)으로 교체됨에 따라 textarea 셀렉터를 data-testid 기반으로 갱신.

import { expect, test } from '../../fixtures/auth.fixture';
import { createAgentComment, createComment, createIssueDetail } from '../../factories/issue.factory';
import { createAgentMember, createMember, createProject } from '../../factories/project.factory';
import type { IssueCommentResponse, IssueDetailResponse } from '../../../src/types/issue';
import type { MemberResponse } from '../../../src/types/project';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
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
  });

  test('코멘트 작성 — 입력 → POST API 호출 → 목록 갱신', async ({ authenticatedPage: page }) => {
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

    const input = page.getByTestId('issue-comment-input');
    await input.click();
    await page.keyboard.type('새 코멘트');
    await page.getByTestId('issue-comment-submit').click();

    // POST payload 검증
    await expect.poll(() => postPayloads.length).toBe(1);
    expect(postPayloads[0].body).toBe('새 코멘트');

    // UI에 새 코멘트 반영 확인
    await expect(page.getByText('새 코멘트')).toBeVisible();
  });
});

test.describe('IssueCommentList @멘션 자동완성 (#785)', () => {
  test('작성 입력창 — @ 입력 시 자동완성 팝업 노출 + 선택 → <@id> 전송 + 칩 렌더', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = { current: createIssueDetail({ comments: [] }) };
    const members = [createMember({ userId: 1, name: 'Tester' }), createAgentMember()];
    await setupIssueStubs(page, detailRef, members);

    const postPayloads: { body: string }[] = [];
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
        const payload = route.request().postDataJSON() as { body: string };
        postPayloads.push(payload);
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
    await expect.poll(() => postPayloads.map((p) => p.body.trim())).toEqual(['hi <@99>']);

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

    const patchPayloads: { body: string }[] = [];
    await page.route(
      (url) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        patchPayloads.push(payload);
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
    await page.getByTestId('chat-mention-option-1').click();

    await page.getByTestId('issue-comment-edit-save').click();

    await expect.poll(() => patchPayloads.length).toBe(1);
    expect(patchPayloads[0].body).toBe('검토 요청 <@99> <@1>');
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

    // 내용 수정 후 저장 — 기존 텍스트 전체 선택 후 교체.
    await editInput.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('수정된 코멘트');
    await page.getByTestId('issue-comment-edit-save').click();

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
