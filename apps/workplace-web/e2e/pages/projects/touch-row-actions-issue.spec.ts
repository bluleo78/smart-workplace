// WP-237: hover 로만 드러나던 이슈 상세·뷰 칩 행 액션을 ≥1024px 터치 태블릿(pointer: coarse)에서도 쓸 수 있는지.
// - 의존성 행: hover X 대신 ⋯(44px) → DropdownMenu 「의존성 제거」 → DELETE dependencies
// - 드라이브 링크: 링크 제거 X 상시 노출(44px) → 확인창 → DELETE drive-links/{id}
// - 뷰 칩 ⋯: 상시 노출(44px) → 삭제 → 확인창 → DELETE saved-views/{id}
// - 코멘트: hover 아이콘 대신 ⋯(44px) → DropdownMenu(휴대폰 시트 대신 — 다른 태블릿 행 메뉴와 일관) → 삭제 확인 → DELETE comments/{id}
// 마우스 데스크톱 hover 동작은 기존 spec(dependencies / saved-views / issue-comments / drive-cross-link)이 회귀를 지킨다.
import type { Locator, Page } from '@playwright/test';

import type { DriveLink } from '../../../src/types/drive';
import type { IssueCommentResponse, IssueLinkSummary } from '../../../src/types/issue';
import type { SavedViewResponse } from '../../../src/types/savedView';
import { createComment, createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { json } from '../../fixtures/mobile-chat';
import { trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const ISSUE_ID = 7;
const BASE = `/api/v1/projects/${KEY}/issues/7`;
const ME_ID = 1; // auth fixture 의 기본 사용자

const LINK: IssueLinkSummary = { number: 42, title: '후행 작업', status: 'TODO', type: makeTaskType(), dueDate: null };
const DRIVE_LINK: DriveLink = {
  driveFileId: 501, fileId: 501, name: 'spec.md', mimeType: 'text/plain', sizeBytes: 1024, hasThumbnail: false,
  spaceId: 1, spaceName: '팀 공간', availability: 'ACTIVE', createdById: ME_ID, createdAt: new Date().toISOString(),
};

/** 이슈 7 상세 스텁(의존성 1건·드라이브 링크 1건·내 코멘트 1건). 보낸 DELETE 의 경로+쿼리 목록을 읽는 함수를 돌려준다. */
async function setupIssue(page: Page, comments: IssueCommentResponse[] = []) {
  const deleteRequests = trackRequests(
    page,
    'DELETE',
    (u) =>
      u.pathname === `${BASE}/dependencies` ||
      u.pathname.startsWith(`${BASE}/drive-links/`) ||
      /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(u.pathname),
  );
  const issue = createIssue({
    id: ISSUE_ID, number: 7, projectKey: KEY, type: makeTaskType(), title: '터치 행 액션 이슈',
    blockedBy: [], blocks: [LINK], blocked: false, attachmentCount: 0,
  });
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
  await page.route((u) => u.pathname === BASE, (r) => r.fulfill(json(createIssueDetail({ summary: issue, body: '본문', comments }))));
  await page.route((u) => ['watchers', 'labels', 'attachments'].some((s) => u.pathname === `${BASE}/${s}`), (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([{ id: 1, type: 'PERSONAL', name: '내 드라이브' }])));
  await page.route((u) => u.pathname === `${BASE}/dependencies`, (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    return r.fulfill({ status: 204 });
  });
  await page.route((u) => u.pathname === `${BASE}/drive-links`, (r) => r.fulfill(json([DRIVE_LINK])));
  await page.route((u) => u.pathname.startsWith(`${BASE}/drive-links/`), (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    return r.fulfill({ status: 204 });
  });
  await page.route((u) => u.pathname === `/api/v1/issues/${ISSUE_ID}/comments`, (r) => r.fulfill(json(comments)));
  await page.route((u) => /\/api\/v1\/issues\/\d+\/comments\/\d+$/.test(u.pathname), (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    return r.fulfill({ status: 204 });
  });
  await page.goto(`/projects/${KEY}/issues/7`);
  await expect(page.getByTestId('issue-title-heading')).toBeVisible();
  return () => deleteRequests.urls().map((u) => u.pathname + u.search);
}

/** 실제 터치 영역(boundingBox)이 44px 이상인지. */
async function expectTouchTarget(loc: Locator) {
  const box = (await loc.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
}

test.describe('터치 태블릿(≥1024px) — 이슈 상세·뷰 칩 행 액션', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });

  test('의존성 행 — hover X 대신 ⋯ → 메뉴 「의존성 제거」 → DELETE', async ({ authenticatedPage: page }) => {
    const deletes = await setupIssue(page);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    // 의존성 그룹은 기본 접힘 — 펼쳐야 섹션이 마운트된다(#343).
    await page.getByRole('button', { name: /의존성/ }).click();
    const row = page.getByTestId('issue-link-row-42');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('issue-link-remove-42')).toHaveCount(0);
    const more = page.getByTestId('issue-link-more-42');
    await expect(more).toBeVisible();
    await expectTouchTarget(more);
    await more.tap();
    await page.getByTestId('issue-link-menu-remove-42').tap();
    await expect.poll(deletes).toEqual([`${BASE}/dependencies?otherNumber=42&direction=blocks`]);
  });

  test('드라이브 링크 — 링크 제거 X 가 상시 보이고(44px) → 확인 → DELETE', async ({ authenticatedPage: page }) => {
    const deletes = await setupIssue(page);
    await expect(page.getByTestId('issue-drive-link-501')).toBeVisible();
    const remove = page.getByTestId('issue-drive-link-remove-501');
    await expect(remove).toBeVisible();
    await expectTouchTarget(remove);
    await remove.tap();
    await page.getByTestId('drive-link-remove-confirm').tap();
    await expect.poll(deletes).toEqual([`${BASE}/drive-links/501`]);
  });

  test('내 코멘트 — hover 아이콘 대신 ⋯ → 드롭다운 → 삭제 확인 → DELETE', async ({ authenticatedPage: page }) => {
    const deletes = await setupIssue(page, [
      createComment({ id: 10, issueId: ISSUE_ID, authorId: ME_ID, body: '내 코멘트 원본' }),
    ]);
    await expect(page.getByText('내 코멘트 원본')).toBeVisible();
    // 데스크톱 hover 아이콘 묶음은 렌더하지 않는다(보이지 않는 버튼 오터치 방지).
    await expect(page.getByRole('button', { name: '코멘트 수정' })).toHaveCount(0);
    const more = page.getByTestId('issue-comment-more-10');
    await expect(more).toBeVisible();
    await expectTouchTarget(more);
    await more.tap();
    // 태블릿은 화면 폭 하단 시트가 아니라 트리거에 붙은 드롭다운으로 연다.
    await expect(page.getByTestId('issue-comment-sheet')).toHaveCount(0);
    await expect(page.getByTestId('issue-comment-action-edit')).toBeVisible();
    await page.getByTestId('issue-comment-action-delete').click();
    await expect(page.getByRole('menu')).toBeHidden();
    // 드롭다운이 닫혀도 확인창은 열린 채 유지되어야 한다(포커스 복귀로 바로 닫히지 않음).
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).tap();
    await expect.poll(deletes).toEqual(['/api/v1/issues/7/comments/10']);
  });

  test('내 코멘트 — ⋯ → 수정을 고르면 메뉴가 언마운트돼도 잠금 없이 편집기로 전환', async ({ authenticatedPage: page }) => {
    await setupIssue(page, [
      createComment({ id: 10, issueId: ISSUE_ID, authorId: ME_ID, body: '내 코멘트 원본' }),
    ]);
    await page.getByTestId('issue-comment-more-10').tap();
    await page.getByTestId('issue-comment-action-edit').click();
    // 편집 모드로 ⋯ 메뉴가 통째로 사라진다 — 드롭다운의 body pointer-events 잠금이 남으면 편집기를 못 누른다.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveCSS('pointer-events', 'none');
    const input = page.getByTestId('issue-comment-edit-input');
    await expect(input).toContainText('내 코멘트 원본');
    await page.getByTestId('issue-comment-edit-cancel').click();
    await expect(page.getByTestId('issue-comment-more-10')).toBeVisible();
  });

  test('뷰 칩 ⋯ — 상시 보이고(44px) → 삭제 → 확인 → DELETE', async ({ authenticatedPage: page }) => {
    const view: SavedViewResponse = {
      id: 1, name: '내 HIGH', query: 'priority=HIGH', visibility: 'PRIVATE',
      ownerId: ME_ID, mine: true, pinned: false, createdAt: '', updatedAt: '',
    };
    const viewDeletes = trackRequests(page, 'DELETE', `/api/v1/projects/${KEY}/saved-views/1`);
    await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject())));
    await page.route(`**/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])));
    await page.route(`**/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json([])));
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
    await page.route(`**/api/v1/projects/${KEY}/saved-views`, (r) => r.fulfill(json([view])));
    await page.route(`**/api/v1/projects/${KEY}/saved-views/1`, (r) => {
      if (r.request().method() !== 'DELETE') return r.fallback();
      return r.fulfill({ status: 204 });
    });
    await page.goto(`/projects/${KEY}`);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const menu = page.getByTestId('view-chip-menu-1');
    await expect(menu).toHaveCSS('opacity', '1');
    await expectTouchTarget(menu);
    await menu.tap();
    await page.getByTestId('view-delete-1').tap();
    await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).tap();
    await expect.poll(() => viewDeletes.urls().map((u) => u.pathname)).toEqual([`/api/v1/projects/${KEY}/saved-views/1`]);
  });
});
