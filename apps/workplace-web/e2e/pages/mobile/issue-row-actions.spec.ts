// 모바일 이슈 행·카드 길게 누르기(WP-193) — 체크박스·드래그 대신 액션 시트로 선택·에픽 지정·상태 변경.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const EPIC = createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 3, childDoneCount: 1 });
// 실데이터 수준의 긴 제목 — 2줄 이상으로 넘친다.
const LONG = createIssue({ id: 21, number: 21, projectKey: KEY, title: '결제 모듈 환불 처리 간헐적 실패 원인 분석 — PG 콜백 타임아웃 시 PENDING 잔류', type: makeTaskType(), status: 'TODO' });
const OTHER = createIssue({ id: 22, number: 22, projectKey: KEY, title: '환불 콜백 재시도 로직 추가', type: makeTaskType(), status: 'TODO' });

/** 목록·에픽·메타 스텁. PATCH 호출을 calls 에 모은다. group=none 으로 진입해 사이클 기본 그룹을 피한다. */
async function mock(page: Page, { member = true, issues = [LONG, OTHER] } = {}) {
  const calls: { path: string; body: unknown }[] = [];
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: member }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`, `/api/v1/projects/${KEY}/cycles`, `/api/v1/projects/${KEY}/views`]) {
    await page.route((u) => u.pathname === p, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const isEpicList = new URL(r.request().url()).searchParams.get('type') === String(makeEpicType().id);
    return r.fulfill(json(createIssueSearchResponse(isEpicList ? [EPIC] : issues, null)));
  });
  await page.route((u) => /\/issues\/\d+\/(status|parent)$/.test(u.pathname), async (r) => {
    calls.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    return r.fulfill(json({}));
  });
  return calls;
}

/** 길게 누르기 — 터치 프로젝트라도 pointer 이벤트로 600ms 유지. */
async function longPress(page: Page, testId: string) {
  const box = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test.describe('이슈 행 길게 누르기', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('길게 누르면 액션 시트가 뜨고 상세로 이동하지 않는다, 체크박스는 없다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('select-issue-21')).toHaveCount(0);
    await longPress(page, 'issue-row-21');
    await expect(page.getByTestId('mobile-action-sheet')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?group=none$`));
    await expect(page.getByTestId('mobile-action-select')).toBeVisible();
    await expect(page.getByTestId('mobile-action-epic')).toBeVisible();
    await expect(page.getByTestId('mobile-action-status')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('상태 변경 → 시트에서 진행 중 선택 → PATCH status', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await longPress(page, 'issue-row-21');
    await page.getByTestId('mobile-action-status').click();
    await expect(page.getByTestId('issue-status-picker')).toBeVisible();
    await page.getByTestId('picker-option-IN_PROGRESS').click();
    await expect.poll(() => calls.find((c) => c.path.endsWith('/issues/21/status'))?.body).toEqual({ status: 'IN_PROGRESS' });
  });

  test('에픽 지정 → 에픽 선택 → PATCH parent', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await longPress(page, 'issue-row-21');
    await page.getByTestId('mobile-action-epic').click();
    await expect(page.getByTestId('issue-epic-picker')).toBeVisible();
    await page.getByTestId('picker-option-10').click();
    await expect.poll(() => calls.find((c) => c.path.endsWith('/issues/21/parent'))?.body).toEqual({ parentNumber: 10 });
  });

  test('비멤버는 상태·에픽 행이 없다', async ({ authenticatedPage: page }) => {
    await mock(page, { member: false });
    await page.goto(`/projects/${KEY}?group=none`);
    await longPress(page, 'issue-row-21');
    await expect(page.getByTestId('mobile-action-status')).toHaveCount(0);
    await expect(page.getByTestId('mobile-action-epic')).toHaveCount(0);
  });

  test('에픽 이슈에는 에픽 지정이 없다', async ({ authenticatedPage: page }) => {
    await mock(page, { issues: [EPIC, LONG] });
    await page.goto(`/projects/${KEY}?group=none`);
    await longPress(page, 'issue-row-10');
    await expect(page.getByTestId('mobile-action-status')).toBeVisible();
    await expect(page.getByTestId('mobile-action-epic')).toHaveCount(0);
  });
});

test.describe('모바일 선택 모드', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('선택 → 탭으로 추가 선택(이동 없음) → 하단 바 → 일괄 상태 변경 → 종료', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await longPress(page, 'issue-row-21');
    await page.getByTestId('mobile-action-select').click();

    const bar = page.getByTestId('issue-bulk-toolbar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-mobile', 'true');
    await expect(bar).toContainText('1개 선택');

    // 제목 텍스트(링크)를 정확히 탭해도 이동하지 않고 선택이 늘어난다.
    await page.getByTestId('issue-row-22').getByText('환불 콜백 재시도 로직 추가').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?group=none$`));
    await expect(bar).toContainText('2개 선택');

    // 바가 마지막 행을 가리지 않는다.
    const barBox = (await bar.boundingBox())!;
    const lastBox = (await page.getByTestId('issue-row-22').boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(barBox.y + 1);

    await page.getByTestId('bulk-status-trigger').click();
    await page.getByTestId('bulk-status-option-DONE').click();
    await expect.poll(() => calls.filter((c) => c.path.endsWith('/status')).length).toBe(2);
    await expect(bar).toHaveCount(0);
  });

  test('완료 버튼으로 선택 모드를 끝내면 탭이 다시 상세로 이동한다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await longPress(page, 'issue-row-21');
    await page.getByTestId('mobile-action-select').click();
    await page.getByTestId('bulk-clear').click();
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
    await page.getByTestId('issue-row-22').getByText('환불 콜백 재시도 로직 추가').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/22$`));
  });
});
