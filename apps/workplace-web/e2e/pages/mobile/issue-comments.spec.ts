// 모바일 이슈 코멘트 수정·삭제(WP-223) — hover 아이콘 대신 항상 보이는 ⋯(44px) → 액션 시트 → 인라인 수정 / 삭제 확인창.
import type { Page } from '@playwright/test';

import type { IssueCommentResponse } from '../../../src/types/issue';
import { createChatThread } from '../../factories/chat.factory';
import { createAgentComment, createComment, createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { json } from '../../fixtures/mobile-chat';
import { expect, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}/issues/7`;
const ISSUE_ID = 7;
const ME_ID = 1; // auth fixture 의 기본 사용자

/** 이슈 7 상세 + 코멘트 API 스텁. 코멘트 상태는 서버처럼 PATCH/DELETE 로 갱신하고 호출을 기록한다. */
async function setup(page: Page, initial: IssueCommentResponse[]) {
  let comments = [...initial];
  const patches: { id: number; body: string }[] = [];
  const deletes: number[] = [];
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
  await page.route((u) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(u.pathname), (r) => {
    const id = Number(new URL(r.request().url()).pathname.split('/').pop());
    if (r.request().method() === 'PATCH') {
      const { body } = r.request().postDataJSON() as { body: string };
      patches.push({ id, body });
      comments = comments.map((c) => (c.id === id ? { ...c, body } : c));
      return r.fulfill(json(comments.find((c) => c.id === id)));
    }
    if (r.request().method() === 'DELETE') {
      deletes.push(id);
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
  const input = page.getByTestId('issue-comment-edit-input');
  await expect(input).toContainText('내 코멘트 원본');
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('수정한 코멘트');
  await page.getByTestId('issue-comment-edit-save').click();
  await expect.poll(() => patches).toEqual([{ id: 10, body: '수정한 코멘트' }]);
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
  expect(deletes).toHaveLength(0);
  await expect(page.getByText('내 코멘트 원본')).toBeVisible();

  await page.getByTestId('issue-comment-more-10').click();
  await sheet.getByTestId('mobile-action-delete').click();
  await expect(sheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '삭제' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => deletes).toEqual([10]);
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
