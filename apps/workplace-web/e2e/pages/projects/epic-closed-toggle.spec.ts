// 에픽 선택과 「완료 모두 보기」(WP-390) — 에픽을 골라도 종료 이슈 숨김(#876)이 강제로 풀리지 않고,
// 종료된 에픽 구역에서 고를 때만 토글이 실제로 켜지며(끌 수 있음), 그 에픽에서 벗어나면 다시 꺼지는지 검증한다.
// 목 서버는 hideInactiveClosed=true 면 지난 사이클 완료 이슈를 빼고 돌려줘 실제 숨김 결과까지 화면으로 확인한다.
import type { Page } from '@playwright/test';

import type { CycleResponse } from '../../../src/types/cycle';
import type { IssueResponse } from '../../../src/types/issue';
import { mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;
const EPIC_TYPE_ID = String(makeEpicType().id);

function cycle(overrides: Partial<CycleResponse>): CycleResponse {
  return { id: 1, projectId: 1, name: '스프린트', goal: null, startDate: null, endDate: null, status: 'ACTIVE', createdAt: '', updatedAt: '', ...overrides };
}
// 진행 중 사이클 1개 + 지난(완료) 사이클 1개 — 목록 기본 그룹이 사이클(진행 중 → 백로그)이 된다.
const CYCLES = [
  cycle({ id: 1, name: '스프린트 3', status: 'ACTIVE' }),
  cycle({ id: 2, name: '스프린트 2', status: 'COMPLETED' }),
];

const epic = (number: number, title: string, status: IssueResponse['status']) =>
  createIssue({ id: number, number, title, type: makeEpicType(), status, childCount: 2, childDoneCount: 1 });
// 진행 중 에픽 10, 종료된 에픽 30(완료·진행 중 사이클 밖).
const OPEN_EPICS = [epic(10, '결제 리뉴얼', 'IN_PROGRESS')];
const CLOSED_EPICS = [epic(30, '팀 채팅 1차', 'DONE')];

// 에픽별 백로그(진행 중·예정 사이클 밖) 이슈 — DONE 은 지난 사이클에서 끝난 이슈(숨김 대상).
const BACKLOG_BY_PARENT: Record<string, IssueResponse[]> = {
  '': [createIssue({ id: 1, number: 1, title: '백로그 작업' }), createIssue({ id: 2, number: 2, title: '지난 사이클 완료 작업', status: 'DONE' })],
  '10': [createIssue({ id: 11, number: 11, title: '결제 남은 작업' }), createIssue({ id: 12, number: 12, title: '결제 지난 완료 작업', status: 'DONE' })],
  '30': [createIssue({ id: 31, number: 31, title: '채팅 지난 완료 작업', status: 'DONE' })],
};

/** 공통 목 — 본문 이슈 검색(에픽 목록 조회 제외) 요청 기록을 돌려준다. */
async function setup(page: Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject({ key: KEY, type: 'TEAM' }));
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, systemTypes());
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, CYCLES);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles/progress`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/saved-views`, []);
  const bodySearches = trackRequests(page, 'GET', (u) => u.pathname === ISSUES_PATH && u.searchParams.get('type') !== EPIC_TYPE_ID);
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const sp = new URL(route.request().url()).searchParams;
      let items: IssueResponse[];
      if (sp.get('type') === EPIC_TYPE_ID) {
        items = (sp.get('status') ?? '').includes('DONE') ? CLOSED_EPICS : OPEN_EPICS;
      } else if (sp.get('cycle') === '1') {
        items = [];
      } else {
        // 백로그·보드 — 서버의 종료 이슈 숨김(#876)을 흉내 낸다.
        const all = BACKLOG_BY_PARENT[sp.get('parent') ?? ''] ?? [];
        items = sp.get('hideInactiveClosed') === 'true' ? all.filter((i) => i.status !== 'DONE') : all;
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(items, null)) });
    },
  );
  return bodySearches;
}

async function openEpicPanel(page: Page) {
  await page.getByTestId('epic-panel-toggle').click();
  await expect(page.getByTestId('epic-side-panel')).toBeVisible();
}

const backlog = (page: Page) => page.getByTestId('list-cycle-section-backlog');
const toggle = (page: Page) => page.getByTestId('show-all-closed-toggle');

/** 「완료 모두 보기」 꺼짐 + 누를 수 있음 + URL closed 없음. */
async function expectToggleOff(page: Page) {
  await expect(page).not.toHaveURL(/closed=all/);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(toggle(page)).toBeEnabled();
}

/** 종료된 에픽 30 선택 — 구역을 펼친 뒤(이미 펼쳐져 있으면 그대로) 누른다. */
async function selectClosedEpic(page: Page) {
  const sectionToggle = page.getByTestId('epic-closed-toggle');
  if ((await sectionToggle.getAttribute('aria-expanded')) !== 'true') await sectionToggle.click();
  await page.getByTestId('epic-closed-filter-30').click();
  await expect(page).toHaveURL(/parent=30/);
  await expect(page).toHaveURL(/closed=all/);
}

test.describe('에픽 선택과 「완료 모두 보기」 (WP-390)', () => {
  test('진행 중 에픽을 골라도 백로그에 지난 사이클 완료 이슈가 쌓이지 않고, 토글은 꺼진 채 누를 수 있다', async ({ authenticatedPage: page }) => {
    const searches = await setup(page);
    await page.goto(`/projects/${KEY}`);
    await openEpicPanel(page);

    await page.getByTestId('epic-filter-10').click();
    await expect(page).toHaveURL(/parent=10/);
    await expect(backlog(page)).toContainText('결제 남은 작업');
    await expect(backlog(page)).not.toContainText('결제 지난 완료 작업');
    await expectToggleOff(page);
    // 백로그 구간 요청이 숨김 파라미터를 보낸다.
    const backlogReq = searches.urls().filter((u) => u.searchParams.get('parent') === '10' && u.searchParams.get('cycle') === 'null').at(-1);
    expect(backlogReq?.searchParams.get('hideInactiveClosed')).toBe('true');

    // 사용자가 직접 켜면 그때 지난 완료분이 보인다.
    await toggle(page).click();
    await expect(page).toHaveURL(/closed=all/);
    await expect(backlog(page)).toContainText('결제 지난 완료 작업');
    // 진행 중 에픽에서 벗어나도 사용자가 켠 토글은 그대로다.
    await page.getByTestId('epic-filter-all').click();
    await expect(page).not.toHaveURL(/parent=/);
    await expect(page).toHaveURL(/closed=all/);
    await expect(backlog(page)).toContainText('지난 사이클 완료 작업');
  });

  test('종료된 에픽을 고르면 토글이 실제로 켜져 하위 이슈가 보이고, 사용자가 끌 수 있다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}`);
    await openEpicPanel(page);

    await selectClosedEpic(page);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle(page)).toBeEnabled();
    await expect(backlog(page)).toContainText('채팅 지난 완료 작업');

    await toggle(page).click();
    await expectToggleOff(page);
    await expect(page).toHaveURL(/parent=30/);
    await expect(backlog(page)).not.toContainText('채팅 지난 완료 작업');
  });

  test('종료된 에픽에서 벗어나면 토글이 다시 꺼진다 — 전체·미할당·진행 중 에픽·같은 에픽 재선택', async ({ authenticatedPage: page }) => {
    await setup(page);
    await page.goto(`/projects/${KEY}`);
    await openEpicPanel(page);

    // 전체
    await selectClosedEpic(page);
    await page.getByTestId('epic-filter-all').click();
    await expect(page).not.toHaveURL(/parent=/);
    await expectToggleOff(page);
    await expect(backlog(page)).toContainText('백로그 작업');
    await expect(backlog(page)).not.toContainText('지난 사이클 완료 작업');

    // 에픽 미할당
    await selectClosedEpic(page);
    await page.getByTestId('epic-filter-unassigned').click();
    await expect(page).toHaveURL(/topLevel=true/);
    await expectToggleOff(page);

    // 진행 중 에픽으로 이동
    await selectClosedEpic(page);
    await page.getByTestId('epic-filter-10').click();
    await expect(page).toHaveURL(/parent=10/);
    await expectToggleOff(page);
    await expect(backlog(page)).not.toContainText('결제 지난 완료 작업');

    // 같은 종료 에픽 재선택(해제)
    await selectClosedEpic(page);
    await page.getByTestId('epic-closed-filter-30').click();
    await expect(page).not.toHaveURL(/parent=/);
    await expectToggleOff(page);
  });

  test('보드도 에픽을 골랐을 때 종료 이슈 숨김을 유지한다', async ({ authenticatedPage: page }) => {
    const searches = await setup(page);
    await page.goto(`/projects/${KEY}?view=board&parent=10`);
    await expect(page.getByTestId('issue-card-11')).toBeVisible();
    await expect(page.getByTestId('issue-card-12')).toHaveCount(0);
    expect(searches.lastUrl()?.searchParams.get('parent')).toBe('10');
    expect(searches.lastUrl()?.searchParams.get('hideInactiveClosed')).toBe('true');
    await expectToggleOff(page);
  });
});
