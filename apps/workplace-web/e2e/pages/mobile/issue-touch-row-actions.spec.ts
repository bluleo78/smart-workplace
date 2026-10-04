// WP-237: 휴대폰(390px, pointer: coarse)에서 hover 로만 드러나던 이슈 상세 행 액션에 닿을 수 있는지.
// - 의존성 행(＋ 속성 시트 안): ⋯(44px) → 액션 시트 「의존성 제거」 → DELETE dependencies
// - 드라이브 링크: 링크 제거 X 상시 노출(44px) → 확인창 → DELETE drive-links/{id}
// (코멘트 ⋮ → 시트는 issue-comments.spec.ts(WP-223)가 검증한다.)
import type { DriveLink } from '../../../src/types/drive';
import type { IssueLinkSummary } from '../../../src/types/issue';
import { createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { json } from '../../fixtures/mobile-chat';
import { expect, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const ISSUE_ID = 7;
const BASE = `/api/v1/projects/${KEY}/issues/7`;

const LINK: IssueLinkSummary = { number: 42, title: '후행 작업', status: 'TODO', type: makeTaskType(), dueDate: null };
const DRIVE_LINK: DriveLink = {
  driveFileId: 501, fileId: 501, name: 'spec.md', mimeType: 'text/plain', sizeBytes: 1024, hasThumbnail: false,
  spaceId: 1, spaceName: '팀 공간', availability: 'ACTIVE', createdById: 1, createdAt: new Date().toISOString(),
};

/** 이슈 7 상세 스텁(의존성 1건·드라이브 링크 1건). DELETE 호출은 경로+쿼리로 기록한다. */
async function setup(page: import('@playwright/test').Page) {
  const deletes: string[] = [];
  const onDelete = (r: import('@playwright/test').Route) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    const u = new URL(r.request().url());
    deletes.push(u.pathname + u.search);
    return r.fulfill({ status: 204 });
  };
  const issue = createIssue({
    id: ISSUE_ID, number: 7, projectKey: KEY, type: makeTaskType(), title: '터치 행 액션 이슈',
    blockedBy: [], blocks: [LINK], blocked: false,
  });
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
  await page.route((u) => u.pathname === BASE, (r) => r.fulfill(json(createIssueDetail({ summary: issue, body: '본문' }))));
  await page.route((u) => ['watchers', 'labels', 'attachments'].some((s) => u.pathname === `${BASE}/${s}`), (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `${BASE}/chat/thread`, (r) => r.fulfill(json(createChatThread({ threadId: 999, recentMessages: [] }))));
  await page.route((u) => u.pathname === `/api/v1/issues/${ISSUE_ID}/comments`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([{ id: 1, type: 'PERSONAL', name: '내 드라이브' }])));
  await page.route((u) => u.pathname === `${BASE}/dependencies`, onDelete);
  await page.route((u) => u.pathname === `${BASE}/drive-links`, (r) => r.fulfill(json([DRIVE_LINK])));
  await page.route((u) => u.pathname.startsWith(`${BASE}/drive-links/`), onDelete);
  await page.goto(`/projects/${KEY}/issues/7`);
  await expect(page.getByTestId('issue-title-heading')).toBeVisible();
  return deletes;
}

test('의존성 행 — ⋯(44px) → 액션 시트 「의존성 제거」 → DELETE', async ({ authenticatedPage: page }) => {
  const deletes = await setup(page);
  await page.getByTestId('mobile-prop-more').click();
  const props = page.getByTestId('issue-more-props-sheet');
  await props.getByRole('button', { name: /의존성/ }).click();
  await expect(props.getByTestId('issue-link-row-42')).toBeVisible();
  await expect(props.getByTestId('issue-link-remove-42')).toHaveCount(0);
  const more = props.getByTestId('issue-link-more-42');
  const box = (await more.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await more.tap();
  const sheet = page.getByTestId('issue-link-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('mobile-action-remove').tap();
  await expect.poll(() => deletes).toEqual([`${BASE}/dependencies?otherNumber=42&direction=blocks`]);
});

test('드라이브 링크 — 링크 제거 X 가 상시 보이고(44px) → 확인 → DELETE', async ({ authenticatedPage: page }) => {
  const deletes = await setup(page);
  const remove = page.getByTestId('issue-drive-link-remove-501');
  await expect(remove).toBeVisible();
  const box = (await remove.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await remove.tap();
  await page.getByTestId('drive-link-remove-confirm').tap();
  await expect.poll(() => deletes).toEqual([`${BASE}/drive-links/501`]);
});
