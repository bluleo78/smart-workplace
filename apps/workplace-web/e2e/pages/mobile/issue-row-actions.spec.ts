// 모바일 이슈 행·카드 길게 누르기(WP-193) — 체크박스·드래그 대신 액션 시트로 선택·에픽 지정·상태 변경.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { longPressWithMouse } from '../../fixtures/mobile-chat';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { bodyOf, trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const EPIC = createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 3, childDoneCount: 1 });
// 실데이터 수준의 긴 제목 — 2줄 이상으로 넘친다.
const LONG = createIssue({ id: 21, number: 21, projectKey: KEY, title: '결제 모듈 환불 처리 간헐적 실패 원인 분석 — PG 콜백 타임아웃 시 PENDING 잔류', type: makeTaskType(), status: 'TODO' });
const OTHER = createIssue({ id: 22, number: 22, projectKey: KEY, title: '환불 콜백 재시도 로직 추가', type: makeTaskType(), status: 'TODO' });

/** 목록·에픽·메타 스텁. 돌려주는 calls() 는 status/parent 변경 요청 기록. group=none 으로 진입해 사이클 기본 그룹을 피한다. */
async function mock(page: Page, { member = true, issues = [LONG, OTHER] } = {}) {
  const changes = trackRequests(page, 'ANY', /\/issues\/\d+\/(status|parent)$/);
  const calls = () => changes.requests().map((req) => ({ path: new URL(req.url()).pathname, body: bodyOf(req) }));
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: member }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`, `/api/v1/projects/${KEY}/cycles`, `/api/v1/projects/${KEY}/views`]) {
    await page.route((u) => u.pathname === p, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const isEpicList = new URL(r.request().url()).searchParams.get('type') === String(makeEpicType().id);
    // 보드는 컬럼별 쿼리(status 파라미터) — 지정되면 그 상태만 돌려준다.
    const status = new URL(r.request().url()).searchParams.get('status');
    const list = isEpicList ? [EPIC] : status ? issues.filter((i) => status.split(',').includes(i.status)) : issues;
    return r.fulfill(json(createIssueSearchResponse(list, null)));
  });
  await page.route((u) => /\/issues\/\d+\/(status|parent)$/.test(u.pathname), (r) => r.fulfill(json({})));
  return calls;
}

test.describe('이슈 행 길게 누르기', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('길게 누르면 액션 시트가 뜨고 상세로 이동하지 않는다, 체크박스는 없다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('select-issue-21')).toHaveCount(0);
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
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
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
    await page.getByTestId('mobile-action-status').click();
    await expect(page.getByTestId('issue-status-picker')).toBeVisible();
    await page.getByTestId('picker-option-IN_PROGRESS').click();
    await expect.poll(() => calls().find((c) => c.path.endsWith('/issues/21/status'))?.body).toEqual({ status: 'IN_PROGRESS' });
  });

  test('에픽 지정 → 에픽 선택 → PATCH parent', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
    await page.getByTestId('mobile-action-epic').click();
    await expect(page.getByTestId('issue-epic-picker')).toBeVisible();
    await page.getByTestId('picker-option-10').click();
    await expect.poll(() => calls().find((c) => c.path.endsWith('/issues/21/parent'))?.body).toEqual({ parentNumber: 10 });
  });

  test('비멤버는 상태·에픽 행이 없다', async ({ authenticatedPage: page }) => {
    await mock(page, { member: false });
    await page.goto(`/projects/${KEY}?group=none`);
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
    await expect(page.getByTestId('mobile-action-status')).toHaveCount(0);
    await expect(page.getByTestId('mobile-action-epic')).toHaveCount(0);
  });

  test('에픽 이슈에는 에픽 지정이 없다', async ({ authenticatedPage: page }) => {
    await mock(page, { issues: [EPIC, LONG] });
    await page.goto(`/projects/${KEY}?group=none`);
    await longPressWithMouse(page, page.getByTestId('issue-row-10'));
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
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
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

    // 모바일은 데스크톱 드롭다운 대신 피커 시트(44px 항목)로 고른다.
    await page.getByTestId('bulk-status-trigger').click();
    await expect(page.getByTestId('bulk-status-picker')).toBeVisible();
    await page.getByTestId('picker-option-DONE').click();
    await expect.poll(() => calls().filter((c) => c.path.endsWith('/status')).length).toBe(2);
    await expect(bar).toHaveCount(0);
  });

  test('✕ 버튼(선택 해제)으로 선택 모드를 끝내면 탭이 다시 상세로 이동한다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
    await page.getByTestId('mobile-action-select').click();
    // 상태 「완료」와 혼동되지 않게 텍스트 대신 ✕ 아이콘 + aria-label.
    await expect(page.getByTestId('bulk-clear')).toHaveAttribute('aria-label', '선택 해제');
    await page.getByTestId('bulk-clear').click();
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
    await page.getByTestId('issue-row-22').getByText('환불 콜백 재시도 로직 추가').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/22$`));
  });
});

test.describe('모바일 선택 토글 라벨', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('이미 선택된 행을 길게 누르면 「선택 해제」, 누르면 선택이 풀린다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
    await expect(page.getByTestId('mobile-action-select')).toHaveText('선택');
    await page.getByTestId('mobile-action-select').click();
    await expect(page.getByTestId('issue-bulk-toolbar')).toContainText('1개 선택');
    await longPressWithMouse(page, page.getByTestId('issue-row-21'));
    await expect(page.getByTestId('mobile-action-select')).toHaveText('선택 해제');
    await page.getByTestId('mobile-action-select').click();
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
  });
});

test.describe('모바일 보드 카드', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('카드를 길게 누르면 상태 변경·에픽 지정 시트(선택 없음), 이동·드래그 없음', async ({ authenticatedPage: page }) => {
    const calls = await mock(page);
    await page.goto(`/projects/${KEY}?view=board`);
    const card = page.getByTestId('issue-card-21');
    await expect(card).toBeVisible();
    // 드래그 비활성 — dnd-kit 이 붙이는 roledescription 이 없다.
    await expect(card).not.toHaveAttribute('aria-roledescription', /.+/);
    await longPressWithMouse(page, page.getByTestId('issue-card-21'));
    await expect(page.getByTestId('mobile-action-sheet')).toBeVisible();
    // 상세로 이동하지 않는다 — 기본 탭은 첫 로드 후 boardTab 으로 URL 에 고정되므로 쿼리는 허용.
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?view=board(&boardTab=\\w+)?$`));
    await expect(page.getByTestId('mobile-action-select')).toHaveCount(0);
    await page.getByTestId('mobile-action-status').click();
    await page.getByTestId('picker-option-DONE').click();
    await expect.poll(() => calls().find((c) => c.path.endsWith('/issues/21/status'))?.body).toEqual({ status: 'DONE' });
    await expect(page.getByTestId('issue-card-drag-overlay')).toHaveCount(0);
  });

  test('모바일 목록 행은 드래그 소스가 아니다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-21')).not.toHaveAttribute('aria-roledescription', /.+/);
  });

  test('비멤버 카드는 짧게 탭하면 상세로 이동하고, 길게 눌러도 시트가 뜨지 않는다', async ({ authenticatedPage: page }) => {
    await mock(page, { member: false });
    await page.goto(`/projects/${KEY}?view=board`);
    await expect(page.getByTestId('issue-card-21')).toBeVisible();
    await longPressWithMouse(page, page.getByTestId('issue-card-21'));
    await expect(page.getByTestId('mobile-action-sheet')).toHaveCount(0);
    // 길게 눌렀다 뗀 것은 탭이 아니다 — 보드에 남는다(WP-217). dev 서버는 상세 청크 로딩이 느려 이동이 가려졌었다.
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?view=board`));
    await expect(page.getByTestId('issue-card-21')).toBeVisible();
    await page.getByTestId('issue-card-22').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/22$`));
  });
});
