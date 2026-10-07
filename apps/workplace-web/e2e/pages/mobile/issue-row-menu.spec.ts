// 모바일 이슈 행·카드 「⋯」 메뉴(WP-273 시안 M1) — 행마다 보이는 ⋯ 로 액션 시트를 열고(길게 누르기도 유지),
// 시트 줄마다 현재 값을 보여 주며 담당자·우선순위·AI 위임·삭제까지 상세 진입 없이 처리한다.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createAgentMember, createMember, createProject } from '../../factories/project.factory';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { bodyOf, trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const ME = createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'MEMBER' });
const KIM = createMember({ userId: 2, name: '김개발', username: 'kim', role: 'MEMBER' });
const BOT = createAgentMember({ userId: 99, name: '트리스타나' });
const LONG = createIssue({
  id: 21, number: 21, projectKey: KEY, type: makeTaskType(), status: 'TODO', priority: 'HIGH', reporterId: 1,
  title: '결제 모듈 환불 처리 간헐적 실패 원인 분석 — PG 콜백 타임아웃 시 PENDING 잔류',
  assignees: [{ id: 2, username: 'kim', name: '김개발', kind: 'HUMAN' }],
});
const OTHER = createIssue({ id: 22, number: 22, projectKey: KEY, title: '환불 콜백 재시도 로직 추가', type: makeTaskType(), status: 'TODO', reporterId: 5 });

async function mock(page: Page) {
  const writes = trackRequests(page, 'ANY', (u, req) => req.method() !== 'GET' && u.pathname.startsWith(`${ISSUES}/`));
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json([ME, KIM, BOT])));
  for (const p of ['labels', 'cycles', 'views', 'milestones']) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const status = new URL(r.request().url()).searchParams.get('status');
    const all = [LONG, OTHER];
    return r.fulfill(json(createIssueSearchResponse(status ? all.filter((i) => status.split(',').includes(i.status)) : all, null)));
  });
  await page.route((u) => u.pathname.startsWith(`${ISSUES}/`), (r) =>
    r.request().method() === 'GET' ? r.fallback() : r.fulfill(r.request().method() === 'DELETE' ? { status: 204 } : json([])),
  );
  return () => writes.requests().map((req) => ({ method: req.method(), path: new URL(req.url()).pathname, body: bodyOf(req) }));
}

test.describe('모바일 이슈 행 ⋯ 메뉴', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('행마다 ⋯ 가 보이고, 누르면 현재 값이 적힌 액션 시트가 뜬다(이동 없음, 가로 넘침 없음)', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-22-menu')).toBeVisible();
    await page.getByTestId('issue-row-21-menu').click();
    const sheet = page.getByTestId('mobile-action-sheet');
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?group=none$`));
    await expect(page.getByTestId('mobile-action-status')).toContainText('할 일');
    await expect(page.getByTestId('mobile-action-assignee')).toContainText('김개발');
    await expect(page.getByTestId('mobile-action-priority')).toContainText('높음');
    await expect(page.getByTestId('mobile-action-ai')).toBeVisible();
    await expect(page.getByTestId('mobile-action-copy-link')).toBeVisible();
    await expect(page.getByTestId('mobile-action-select')).toBeVisible();
    await expect(page.getByTestId('mobile-action-delete')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: 'test-results/tc/issue-row-menu/mobile-row-sheet.png' });
  });

  test('우선순위 → 낮음 → PATCH issue { priority: LOW }', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('issue-row-21-menu').click();
    await page.getByTestId('mobile-action-priority').click();
    await expect(page.getByTestId('issue-priority-picker')).toBeVisible();
    await page.getByTestId('picker-option-LOW').click();
    await expect.poll(calls).toEqual([{ method: 'PATCH', path: `${ISSUES}/21`, body: { priority: 'LOW' } }]);
  });

  test('담당자 → 멤버를 누르면 기존 담당자에 더해 PUT', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('issue-row-21-menu').click();
    await page.getByTestId('mobile-action-assignee').click();
    await expect(page.getByTestId('issue-assignee-picker')).toBeVisible();
    await page.getByTestId('picker-option-1').click();
    await expect.poll(calls).toEqual([{ method: 'PUT', path: `${ISSUES}/21/assignees`, body: { userIds: [2, 1] } }]);
  });

  test('AI에게 맡기기(AI 멤버 1명) → 바로 PUT', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('issue-row-21-menu').click();
    await page.getByTestId('mobile-action-ai').click();
    await expect.poll(calls).toEqual([{ method: 'PUT', path: `${ISSUES}/21/assignees`, body: { userIds: [2, 99] } }]);
  });

  test('삭제 → 확인 → DELETE, 보고자가 아닌 이슈엔 삭제가 없다', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('issue-row-22-menu').click();
    await expect(page.getByTestId('mobile-action-status')).toBeVisible();
    await expect(page.getByTestId('mobile-action-delete')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mobile-action-sheet')).toHaveCount(0);

    await page.getByTestId('issue-row-21-menu').click();
    await page.getByTestId('mobile-action-delete').click();
    await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click();
    await expect.poll(calls).toEqual([{ method: 'DELETE', path: `${ISSUES}/21`, body: null }]);
  });

  test('선택 모드에선 ⋯ 를 숨긴다(탭 = 선택 토글)', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('issue-row-21-menu').click();
    await page.getByTestId('mobile-action-select').click();
    await expect(page.getByTestId('issue-bulk-toolbar')).toBeVisible();
    await expect(page.getByTestId('issue-row-22-menu')).toHaveCount(0);
  });

  test('보드 카드에도 ⋯ 가 있고 누르면 액션 시트가 뜬다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?view=board`);
    await page.getByTestId('issue-card-21-menu').click();
    await expect(page.getByTestId('mobile-action-sheet')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?view=board`));
    await page.keyboard.press('Escape');
    await page.screenshot({ path: 'test-results/tc/issue-row-menu/mobile-board.png' });
  });
});
