// 모바일 보드(WP-195) — 상태 탭 + 한 컬럼, 카드 2줄 레이아웃, 탭·스와이프 전환, boardTab URL 유지.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const EPIC = createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 안정화 및 PG 연동 재정비', type: makeEpicType() });
const epicRef = { number: EPIC.number, title: EPIC.title, type: EPIC.type! };
// 실데이터 수준의 긴 제목 — 카드 폭에서 2줄을 넘친다.
const LONG = createIssue({ id: 21, number: 21, projectKey: KEY, title: '결제 모듈 환불 처리 간헐적 실패 원인 분석 — PG 콜백 타임아웃 시 PENDING 잔류 및 재시도 정책 정리', type: makeTaskType(), status: 'TODO', parent: epicRef });
const TODO2 = createIssue({ id: 22, number: 22, projectKey: KEY, title: '환불 콜백 재시도 로직 추가', type: makeTaskType(), status: 'TODO' });
const PROG = createIssue({ id: 1047, number: 1047, projectKey: KEY, title: '정산 배치 지연 알림', type: makeTaskType(), status: 'IN_PROGRESS' });
const DONE1 = createIssue({ id: 31, number: 31, projectKey: KEY, title: '영수증 PDF 폰트 깨짐', type: makeTaskType(), status: 'DONE' });

/** 프로젝트·메타·이슈 스텁. 보드는 컬럼별 쿼리(status) — 지정 상태만 돌려준다. moreStatus 는 첫 페이지에 nextCursor 를 단다. */
async function mock(page: Page, { issues = [LONG, TODO2, PROG, DONE1], moreStatus }: { issues?: typeof LONG[]; moreStatus?: string } = {}) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`, `/api/v1/projects/${KEY}/cycles`, `/api/v1/projects/${KEY}/saved-views`]) {
    await page.route((u) => u.pathname === p, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const url = new URL(r.request().url());
    if (url.searchParams.get('type') === String(makeEpicType().id)) return r.fulfill(json(createIssueSearchResponse([EPIC], null)));
    const status = url.searchParams.get('status');
    const list = status ? issues.filter((i) => status.split(',').includes(i.status)) : issues;
    const more = status != null && status === moreStatus && !url.searchParams.get('cursor');
    return r.fulfill(json(createIssueSearchResponse(list, more ? 'next' : null)));
  });
}

test.describe('모바일 보드 카드', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('긴 제목은 최대 2줄, ID 는 한 줄로 메타 줄에 — 카드는 화면 폭을 거의 다 쓴다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?view=board&boardTab=TODO&group=none`);
    const card = page.getByTestId('issue-card-21');
    await expect(card).toBeVisible();
    expect((await card.boundingBox())!.width).toBeGreaterThan(320);
    const title = page.getByTestId('issue-card-21-title');
    const titleBox = (await title.boundingBox())!;
    // 2줄 clamp — 한 줄(약 20px)보다 크고 3줄(약 60px)보다 작다.
    expect(titleBox.height).toBeGreaterThan(30);
    expect(titleBox.height).toBeLessThan(50);
    const meta = page.getByTestId('issue-card-21-meta');
    await expect(meta).toContainText('WP-21');
    expect((await meta.boundingBox())!.height).toBeLessThan(24);
    await expect(page.getByTestId('issue-card-21-epic')).toContainText('결제 안정화');
    await expectNoHorizontalOverflow(page);
  });
});

/** 목록 영역에서 좌우로 끌기 — pointer 이벤트(마우스)로 dx 만큼. */
async function swipe(page: Page, dx: number) {
  const box = (await page.getByTestId('board-scroll').boundingBox())!;
  const y = box.y + 80;
  const x0 = box.x + box.width / 2 - dx / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + dx / 2, y, { steps: 4 });
  await page.mouse.move(x0 + dx, y, { steps: 4 });
  await page.mouse.up();
}

test.describe('모바일 보드 상태 탭', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('탭 4개와 개수, 기본은 진행 중 — 선택 탭 카드만 보인다', async ({ authenticatedPage: page }) => {
    await mock(page, { moreStatus: 'TODO' });
    await page.goto(`/projects/${KEY}?view=board&group=none`);
    for (const s of ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']) await expect(page.getByTestId(`board-tab-${s}`)).toBeVisible();
    await expect(page.getByTestId('board-tab-count-TODO')).toHaveText('2+');
    await expect(page.getByTestId('board-tab-count-IN_PROGRESS')).toHaveText('1');
    await expect(page.getByTestId('board-tab-IN_PROGRESS')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('issue-card-1047')).toBeVisible();
    await expect(page.getByTestId('issue-card-21')).toHaveCount(0);
    // 탭 높이 = 터치 타깃 44px 이상
    expect((await page.getByTestId('board-tab-TODO').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // 탭 줄이 44px 탭을 다 담는다 — 줄이 낮으면 탭이 줄 안에서 세로 스크롤되고 활성 밑줄이 잘린다.
    expect(await page.getByTestId('board-tabs').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test('탭을 누르면 전환되고 URL boardTab 으로 유지(새로고침 복귀)', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?view=board&group=none`);
    await page.getByTestId('board-tab-DONE').click();
    await expect(page).toHaveURL(/boardTab=DONE/);
    await expect(page.getByTestId('issue-card-31')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('board-tab-DONE')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('issue-card-31')).toBeVisible();
  });

  test('진행 중이 비면 기본 탭은 할 일, 빈 탭은 빈 상태', async ({ authenticatedPage: page }) => {
    await mock(page, { issues: [LONG, TODO2, DONE1] });
    await page.goto(`/projects/${KEY}?view=board&group=none`);
    await expect(page.getByTestId('board-tab-TODO')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('board-tab-CANCELED').click();
    await expect(page.getByTestId('board-col-empty-CANCELED')).toBeVisible();
  });

  test('좌우 스와이프로 이웃 탭 전환, 끝에서는 그대로, 스와이프 후 상세로 이동하지 않는다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=TODO`);
    await expect(page.getByTestId('issue-card-21')).toBeVisible();
    await swipe(page, -150);
    await expect(page.getByTestId('board-tab-IN_PROGRESS')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/boardTab=IN_PROGRESS/);
    await expect(page).not.toHaveURL(/\/issues\/\d+/);
    await swipe(page, 150);
    await swipe(page, 150);
    await expect(page.getByTestId('board-tab-TODO')).toHaveAttribute('aria-selected', 'true');
    // 짧은 이동(임계 이하)은 무시
    await swipe(page, -40);
    await expect(page.getByTestId('board-tab-TODO')).toHaveAttribute('aria-selected', 'true');
  });

  test('상태 필터로 제외된 탭은 숨기고, 필터를 바꿔도 선택 탭은 유지된다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?view=board&group=none&status=TODO,DONE&boardTab=DONE`);
    await expect(page.getByTestId('board-tab-IN_PROGRESS')).toHaveCount(0);
    await expect(page.getByTestId('board-tab-DONE')).toHaveAttribute('aria-selected', 'true');
    // 검색어 입력 = writeFilters 경로
    await page.getByTestId('mobile-search-open').click();
    await page.getByTestId('mobile-search-input').fill('영수증');
    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/boardTab=DONE/);
  });

  test('탭을 바꾸면 목록 스크롤이 맨 위로', async ({ authenticatedPage: page }) => {
    const many = Array.from({ length: 30 }, (_, i) => createIssue({ id: 500 + i, number: 500 + i, projectKey: KEY, title: `대량 할 일 ${i}`, type: makeTaskType(), status: 'TODO' }));
    await mock(page, { issues: [...many, PROG] });
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=TODO`);
    await page.getByTestId('board-scroll').evaluate((el) => el.scrollTo(0, 2000));
    await page.getByTestId('board-tab-IN_PROGRESS').click();
    await expect.poll(() => page.getByTestId('board-scroll').evaluate((el) => el.scrollTop)).toBe(0);
  });
});
