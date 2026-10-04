// 모바일 프로젝트 목록(WP-197) — 64px 한 줄 행: 배지 32 · 이름(말줄임) / 키 · 진행 바 · % · 개수, 오른쪽 별 44px.
import type { Page } from '@playwright/test';

import { createProject } from '../../factories/project.factory';
import { createPageResponse } from '../../fixtures/api-mock';
import { json } from '../../fixtures/mobile-chat';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

const LONG_NAME = '2026 하반기 차세대 고객 포털 리뉴얼 및 결제 모듈 전면 재구축 프로젝트';
const PROJECTS = [
  createProject({ id: 1, key: 'WEB', name: LONG_NAME, type: 'TEAM', issueTotal: 12, issueDone: 5 }),
  createProject({ id: 2, key: 'OPN', name: '고객 요청 접수', type: 'OPEN', issueTotal: 0, issueDone: 0 }),
  createProject({ id: 3, key: 'EMP', name: '빈 팀 프로젝트', type: 'TEAM', issueTotal: 0, issueDone: 0 }),
  createProject({ id: 4, key: 'PME', name: '개인 작업', type: 'PERSONAL', isDefault: true, issueTotal: 3, issueDone: 1 }),
];

async function setup(page: Page) {
  await stubChat(page);
  await page.route((u) => u.pathname === '/api/v1/projects', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(createPageResponse(PROJECTS, { size: 20 }))) : r.fallback());
  await page.goto('/projects');
  await expect(page.getByTestId('project-row-WEB')).toBeVisible();
}

test('행 높이 ≈ 64px, 긴 이름 말줄임, 보조줄 = 키 · % · 개수, 가로 넘침 없음', async ({ authenticatedPage: page }) => {
  await setup(page);
  const row = page.getByTestId('project-row-WEB');
  const box = (await row.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(62);
  expect(box.height).toBeLessThanOrEqual(66);
  await expect(page.getByTestId('project-row-meta-WEB')).toHaveText(/WEB\s*·\s*42%\s*·\s*12개/);
  const clipped = await row.getByText(LONG_NAME).evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
  const badge = (await page.getByTestId('project-badge-WEB').boundingBox())!;
  expect(badge.width).toBe(32);
  await expectNoHorizontalOverflow(page);
});

test('OPEN 은 「접수함」(이슈 0건이어도), 이슈 0건 팀은 「이슈 없음」, 개인은 별 없음', async ({ authenticatedPage: page }) => {
  await setup(page);
  await expect(page.getByTestId('project-row-meta-OPN')).toHaveText(/OPN\s*·\s*접수함/);
  await expect(page.getByTestId('project-row-meta-EMP')).toHaveText(/EMP\s*·\s*이슈 없음/);
  await expect(page.getByTestId('fav-toggle-PME')).toHaveCount(0);
});

test('별 버튼 44px — 탭하면 즐겨찾기 그룹으로 이동하고 행 이동은 일어나지 않는다', async ({ authenticatedPage: page }) => {
  await setup(page);
  const star = page.getByTestId('fav-toggle-WEB');
  const sb = (await star.boundingBox())!;
  expect(sb.width).toBeGreaterThanOrEqual(44);
  expect(sb.height).toBeGreaterThanOrEqual(44);
  await star.tap();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('fav-group')).toBeVisible();
  await expect(page).toHaveURL(/\/projects$/);
});

test('행(이름 영역) 탭 → 프로젝트 상세로 이동', async ({ authenticatedPage: page }) => {
  await setup(page);
  await page.getByTestId('project-row-EMP').getByRole('link').tap();
  await expect(page).toHaveURL(/\/projects\/EMP$/);
});
