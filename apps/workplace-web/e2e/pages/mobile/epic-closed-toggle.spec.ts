// 모바일 에픽 시트와 「완료 모두 보기」(WP-390) — 데스크톱 패널과 같은 규칙.
// 진행 중 에픽은 토글을 건드리지 않고, 「종료된 에픽」 구역에서 고르면 켜지며, 칩 ✕ 로 벗어나면 꺼진다.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, stubChat, test } from '../../fixtures/mobile.fixture';
import { trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const EPIC_TYPE_ID = String(makeEpicType().id);
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const OPEN_EPICS = [createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 리뉴얼', type: makeEpicType() })];
const CLOSED_EPICS = [createIssue({ id: 52, number: 52, projectKey: KEY, title: '팀 채팅 1차', type: makeEpicType(), status: 'DONE' })];

async function mock(page: Page) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM' }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/members`, `/labels`, `/cycles`, `/saved-views`]) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const sp = new URL(r.request().url()).searchParams;
    if (sp.get('type') !== EPIC_TYPE_ID) return r.fulfill(json(createIssueSearchResponse([], null)));
    return r.fulfill(json(createIssueSearchResponse((sp.get('status') ?? '').includes('DONE') ? CLOSED_EPICS : OPEN_EPICS, null)));
  });
  // 본문 이슈 검색(에픽 목록 조회 제외) — 숨김 파라미터 확인용.
  return trackRequests(page, 'GET', (u) => u.pathname === ISSUES && u.searchParams.get('type') !== EPIC_TYPE_ID);
}

test.describe('모바일 에픽 시트와 「완료 모두 보기」 (WP-390)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('진행 중 에픽은 숨김을 유지하고, 종료된 에픽을 고르면 켜지며, 칩 ✕ 로 벗어나면 꺼진다', async ({ authenticatedPage: page }) => {
    const searches = await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    const sheet = page.getByTestId('mobile-epic-sheet');

    // 진행 중 에픽 — 숨김 유지, URL 에 closed 없음.
    await page.getByTestId('mobile-chip-epic').click();
    await sheet.getByRole('option', { name: /결제 리뉴얼/ }).click();
    await expect(page).toHaveURL(/parent=10/);
    await expect(page).not.toHaveURL(/closed=all/);
    await expect.poll(() => searches.lastUrl()?.searchParams.get('parent')).toBe('10');
    expect(searches.lastUrl()?.searchParams.get('hideInactiveClosed')).toBe('true');

    // 종료된 에픽 — 토글이 켜지고 숨김 파라미터가 빠진다. 뷰 시트의 토글도 켜진 채 누를 수 있다.
    await page.getByTestId('mobile-chip-epic').click();
    await sheet.getByTestId('mobile-epic-closed-toggle').click();
    await sheet.getByTestId('mobile-epic-closed-52').click();
    await expect(page).toHaveURL(/parent=52/);
    await expect(page).toHaveURL(/closed=all/);
    await expect.poll(() => searches.lastUrl()?.searchParams.get('parent')).toBe('52');
    expect(searches.lastUrl()?.searchParams.get('hideInactiveClosed')).toBeNull();
    await page.getByTestId('mobile-chip-view').click();
    const closedToggle = page.getByTestId('mobile-view-closed-toggle');
    await expect(closedToggle).toHaveAttribute('aria-checked', 'true');
    await expect(closedToggle).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('mobile-view-sheet')).toBeHidden();

    // 칩 ✕ — 종료된 에픽에서 벗어나면 토글도 꺼진다.
    await page.getByTestId('mobile-chip-epic-clear').click();
    await expect(page).not.toHaveURL(/parent=/);
    await expect(page).not.toHaveURL(/closed=all/);
  });
});
