// 모바일 사이클(WP-197) — 2줄 요약(날짜 · 진행%), goal 1줄, 연필·휴지통 대신 ⋯ → 액션 시트, 행 탭 = 그 사이클 이슈 목록.
import type { Page } from '@playwright/test';

import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';
import { createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { json } from '../../fixtures/mobile-chat';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

const KEY = 'WP';
const now = new Date().toISOString();
const cycle = (o: Partial<CycleResponse>): CycleResponse => ({
  id: 1, projectId: 1, name: '스프린트', goal: null, startDate: null, endDate: null, status: 'ACTIVE', createdAt: now, updatedAt: now, ...o,
});
const CYCLES = [
  cycle({ id: 1, name: '2026 4분기 결제 모듈 재구축 1차 스프린트 — 이름이 아주 긴 사이클', goal: '결제 승인 실패율을 0.5% 미만으로 낮추고 정산 배치를 신규 파이프라인으로 이관한다', startDate: '2026-09-29', endDate: '2026-10-10', status: 'ACTIVE' }),
  cycle({ id: 2, name: '시작만', startDate: '2026-10-13', status: 'PLANNED' }),
  cycle({ id: 3, name: '끝만', endDate: '2026-10-31', status: 'PLANNED' }),
  cycle({ id: 4, name: '날짜 없음', status: 'COMPLETED' }),
];
const PROGRESS: CycleProgress[] = [{ cycleId: 1, total: 20, done: 9, byStatus: { DONE: 9, TODO: 11 } }];

async function setup(page: Page) {
  const deletes = trackRequests(page, 'DELETE', /\/api\/v1\/projects\/WP\/cycles\/\d+$/);
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/cycles`, (r) => r.fulfill(json(CYCLES)));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/cycles/progress`, (r) => r.fulfill(json(PROGRESS)));
  await page.route((u) => /\/api\/v1\/projects\/WP\/cycles\/\d+$/.test(u.pathname), (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback();
    return r.fulfill({ status: 204 });
  });
  // 행 탭 후 도착하는 프로젝트 상세의 최소 스텁 — 미스텁 요청이 프록시로 새지 않게.
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => [`/api/v1/projects/${KEY}/members`, `/api/v1/projects/${KEY}/labels`, `/api/v1/projects/${KEY}/milestones`, `/api/v1/projects/${KEY}/saved-views`].includes(u.pathname), (r) => r.fulfill(json([])));
  await page.goto(`/projects/${KEY}/cycles`);
  await expect(page.getByTestId('cycle-row-1')).toBeVisible();
  return { deletes };
}

test('2줄째 = 날짜 · 진행 — 시작만/끝만/날짜 없음/이슈 0건 문구, goal 1줄, 진행 막대 숨김, 넘침 없음', async ({ authenticatedPage: page }) => {
  await setup(page);
  await expect(page.getByTestId('cycle-row-meta-1')).toHaveText('9월 29일 ~ 10월 10일 · 45%');
  await expect(page.getByTestId('cycle-row-meta-2')).toHaveText('10월 13일 ~ · 이슈 없음');
  await expect(page.getByTestId('cycle-row-meta-3')).toHaveText('~ 10월 31일 · 이슈 없음');
  await expect(page.getByTestId('cycle-row-meta-4')).toHaveText('— · 이슈 없음');
  await expect(page.getByTestId('cycle-row-1')).toContainText('진행 중'); // 상태는 배지에만
  const goal = page.getByTestId('cycle-row-1').getByText(/결제 승인 실패율/);
  expect(await goal.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true); // 1줄 말줄임
  await expect(page.getByTestId('cycle-row-1').getByText(/완료 \(45%\)/)).toHaveCount(0); // CycleProgressBar 미렌더
  await expectNoHorizontalOverflow(page);
});

test('⋯(44px) → 수정 → 기존 사이클 폼이 값 채워 열린다', async ({ authenticatedPage: page }) => {
  await setup(page);
  const more = page.getByTestId('cycle-more-1');
  const mb = (await more.boundingBox())!;
  expect(mb.width).toBeGreaterThanOrEqual(44);
  expect(mb.height).toBeGreaterThanOrEqual(44);
  await more.tap();
  const sheet = page.getByTestId('cycle-sheet');
  await sheet.getByTestId('mobile-action-edit').tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('cycle-form-dialog')).toBeVisible();
  await expect(page.getByTestId('cycle-name-input')).toHaveValue(CYCLES[0].name);
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/cycles$`)); // ⋯ 는 행 이동을 일으키지 않는다
});

test('⋯ → 삭제 → 취소는 유지, 확인은 DELETE', async ({ authenticatedPage: page }) => {
  const { deletes } = await setup(page);
  const sheet = page.getByTestId('cycle-sheet');
  const dialog = page.getByRole('alertdialog');

  await page.getByTestId('cycle-more-2').tap();
  await sheet.getByTestId('mobile-action-delete').tap();
  await expect(sheet).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '취소' }).tap();
  await expect(dialog).toBeHidden();
  await expectStays(page, deletes.count, 0);

  await page.getByTestId('cycle-more-2').tap();
  await sheet.getByTestId('mobile-action-delete').tap();
  await expect(sheet).toBeHidden();
  await dialog.getByRole('button', { name: '삭제' }).tap();
  await expect(dialog).toBeHidden();
  await expect.poll(() => deletes.urls().map((u) => Number(u.pathname.split('/').pop()))).toEqual([2]);
});

test('행 탭 → 그 사이클로 필터된 이슈 목록', async ({ authenticatedPage: page }) => {
  await setup(page);
  await page.getByTestId('cycle-row-1').getByRole('link').tap();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?`));
  await expect.poll(() => new URL(page.url()).searchParams.get('cycle')).toBe('1');
});
