// 모바일 이슈 코멘트 수정·삭제(WP-223) — hover 아이콘 대신 항상 보이는 ⋯(44px) → 액션 시트 → 인라인 수정 / 삭제 확인창.
import type { Page } from '@playwright/test';

import type { IssueCommentResponse } from '../../../src/types/issue';
import { createChatThread } from '../../factories/chat.factory';
import { createAgentComment, createComment, createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { json } from '../../fixtures/mobile-chat';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { bodyOf, trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}/issues/7`;
const ISSUE_ID = 7;
const ME_ID = 1; // auth fixture 의 기본 사용자

/** 이슈 7 상세 + 코멘트 API 스텁. 코멘트 상태는 서버처럼 PATCH/DELETE 로 갱신하고 호출을 기록한다. */
async function setup(page: Page, initial: IssueCommentResponse[]) {
  let comments = [...initial];
  const COMMENT = /^\/api\/v1\/issues\/\d+\/comments\/\d+$/;
  const commentIdOf = (url: URL) => Number(url.pathname.split('/').pop());
  const patchReqs = trackRequests(page, 'PATCH', COMMENT);
  const deleteReqs = trackRequests(page, 'DELETE', COMMENT);
  const patches = () => patchReqs.requests().map((req) => ({
    id: commentIdOf(new URL(req.url())),
    body: (bodyOf(req) as { body: string }).body,
  }));
  const deletes = () => deleteReqs.urls().map(commentIdOf);
  const issue = createIssue({ id: ISSUE_ID, number: 7, projectKey: KEY, type: makeTaskType(), title: '코멘트 액션 이슈' });
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
  await page.route((u) => u.pathname === BASE, (r) => r.fulfill(json(createIssueDetail({ summary: issue, body: '본문', comments }))));
  await page.route((u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${BASE}/${s}`), (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `${BASE}/chat/thread`, (r) => r.fulfill(json(createChatThread({ threadId: 999, recentMessages: [] }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([{ id: 1, type: 'PERSONAL', name: '내 드라이브' }])));
  await page.route((u) => u.pathname === `/api/v1/issues/${ISSUE_ID}/comments`, (r) => r.fulfill(json(comments)));
  await page.route((u) => COMMENT.test(u.pathname), (r) => {
    const id = commentIdOf(new URL(r.request().url()));
    if (r.request().method() === 'PATCH') {
      const { body } = r.request().postDataJSON() as { body: string };
      comments = comments.map((c) => (c.id === id ? { ...c, body } : c));
      return r.fulfill(json(comments.find((c) => c.id === id)));
    }
    if (r.request().method() === 'DELETE') {
      comments = comments.filter((c) => c.id !== id);
      return r.fulfill({ status: 204 });
    }
    return r.fallback();
  });
  await page.goto(`/projects/${KEY}/issues/7`);
  await expect(page.getByTestId('issue-title-heading')).toBeVisible();
  return { patches, deletes };
}

const mine = (over: Partial<IssueCommentResponse> = {}) =>
  createComment({ id: 10, issueId: ISSUE_ID, authorId: ME_ID, body: '내 코멘트 원본', ...over });

test('내 코멘트 — ⋯ 는 44px 이상 · 수정 → 저장 → PATCH 와 본문 갱신', async ({ authenticatedPage: page }) => {
  const { patches } = await setup(page, [mine()]);
  const more = page.getByTestId('issue-comment-more-10');
  await expect(more).toBeVisible();
  const box = await more.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await more.click();
  await page.getByTestId('issue-comment-sheet').getByTestId('mobile-action-edit').click();
  await expect(page.getByTestId('issue-comment-sheet')).toBeHidden();
  // WP-237: 「수정」을 고르면 ⋯ 메뉴(시트 포함)가 편집 모드로 언마운트된다 — 오버레이·body pointer-events 잠금이 남지 않아야 한다.
  await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
  const input = page.getByTestId('issue-comment-edit-input');
  await expect(input).toContainText('내 코멘트 원본');
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('수정한 코멘트');
  await page.getByTestId('issue-comment-edit-save').click();
  await expect.poll(patches).toEqual([{ id: 10, body: '수정한 코멘트' }]);
  await expect(page.getByText('수정한 코멘트')).toBeVisible();
  await expect(page.getByTestId('issue-comment-edit-input')).toBeHidden();
});

test('내 코멘트 — 삭제는 확인창에서 취소하면 유지, 확인하면 DELETE 후 사라진다', async ({ authenticatedPage: page }) => {
  const { deletes } = await setup(page, [mine()]);
  const sheet = page.getByTestId('issue-comment-sheet');
  const dialog = page.getByRole('alertdialog');

  await page.getByTestId('issue-comment-more-10').click();
  await sheet.getByTestId('mobile-action-delete').click();
  await expect(sheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toBeHidden();
  expect(deletes()).toHaveLength(0);
  await expect(page.getByText('내 코멘트 원본')).toBeVisible();

  await page.getByTestId('issue-comment-more-10').click();
  await sheet.getByTestId('mobile-action-delete').click();
  await expect(sheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '삭제' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(deletes).toEqual([10]);
  await expect(page.getByText('내 코멘트 원본')).toBeHidden();
});

test('타인·AGENT 코멘트에는 ⋯ 가 없다', async ({ authenticatedPage: page }) => {
  await setup(page, [
    createComment({ id: 11, issueId: ISSUE_ID, authorId: ME_ID + 999, authorName: '다른 사용자', body: '타인의 코멘트' }),
    createAgentComment({ id: 12, issueId: ISSUE_ID }),
  ]);
  await expect(page.getByText('타인의 코멘트')).toBeVisible();
  await expect(page.getByTestId('issue-comment-more-11')).toHaveCount(0);
  await expect(page.getByTestId('issue-comment-more-12')).toHaveCount(0);
});

// WP-228 — 공백 없는 긴 URL 은 카드 폭에서 줄바꿈되고, 긴 작성자명은 말줄임되어 날짜가 한 줄로 남는다.
test('긴 URL·긴 작성자명 코멘트도 카드 폭 안에 머문다', async ({ authenticatedPage: page }) => {
  const LONG_URL = `https://drive.example.com/share/${'a1b2c3d4e5'.repeat(12)}?ref=${'x'.repeat(40)}`;
  const LONG_NAME = '외부협력사 프로젝트 매니저 홍길동(주식회사아주긴회사이름테크놀로지솔루션즈)';
  await setup(page, [
    createComment({ id: 21, issueId: ISSUE_ID, authorId: ME_ID + 999, authorName: LONG_NAME, body: `참고 링크 ${LONG_URL}` }),
  ]);
  const card = page.getByRole('listitem').filter({ hasText: '참고 링크' });
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const vw = page.viewportSize()!.width;
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(vw);

  // 날짜는 한 줄(text-sm 줄 높이 20px — 꺾이면 40px) + 카드 오른쪽 안.
  const date = card.locator('span', { hasText: /^· / });
  const dateBox = (await date.boundingBox())!;
  expect(dateBox.height).toBeLessThan(28);
  expect(dateBox.x + dateBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);

  // 작성자명은 말줄임 — 실제 글자 폭(scrollWidth)이 보이는 폭(clientWidth)보다 크다.
  const clipped = await card.getByText(LONG_NAME).evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
});

// WP-254 — AI 코멘트 마크다운(제목·체크리스트·표·긴 URL)도 휴대폰 카드 폭 안에 머문다.
test('AGENT 마크다운 코멘트 — 체크리스트·표·긴 URL 이 카드 폭을 넘지 않는다', async ({ authenticatedPage: page }) => {
  const LONG_URL = `https://ci.example.com/runs/${'9f8e7d6c5b'.repeat(10)}`;
  const body = [
    '## 배포 전 점검 결과 보고',
    '',
    '- [x] 마이그레이션 드라이런 — 운영 스냅샷 기준 12분 소요, 잠금 대기 없음',
    '- [ ] 정산 배치 재시도 멱등성 확인(재현 스크립트 작성 중)',
    '',
    '| 항목 | 결과 | 비고 |',
    '| --- | --- | --- |',
    '| 단위 테스트 | 통과 | 1,284건 |',
    '| E2E | 실패 1 | 결제 취소 플로우 타임아웃 |',
    '',
    `로그: ${LONG_URL}`,
  ].join('\n');
  await setup(page, [createAgentComment({ id: 40, issueId: ISSUE_ID, body })]);
  const card = page.locator('li[data-agent="true"]');
  await expect(card.getByTestId('markdown-content').locator('input[type="checkbox"]')).toHaveCount(2);
  await expectNoHorizontalOverflow(page);
  const vw = page.viewportSize()!.width;
  const cardBox = (await card.boundingBox())!;
  expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(vw);
});
