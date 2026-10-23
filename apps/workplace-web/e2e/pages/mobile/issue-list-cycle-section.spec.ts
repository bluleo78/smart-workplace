// 모바일 이슈 목록 사이클 구간(WP-270 최종 리뷰) — 구간 헤더·빈 문구·「더 보기」가 구간(section) 폭 안에 들어온다.
// 데스크톱은 목록 바깥을 @container 로 잡고 헤더에 w-[100cqw-2px] 를 주지만, 모바일엔 컨테이너가 없어 cqw 가
// 뷰포트 폭으로 풀리고 → 헤더가 구간보다 px-4×2 만큼 넓어져 overflow-clip 에 잘렸다. 그 회귀를 지킨다.
import type { Page } from '@playwright/test';

import type { CycleProgress, CycleResponse } from '../../../src/types/cycle';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// 이름이 길고 기간·목표가 있는 진행 중 사이클 — 헤더가 가장 빽빽한 경우(제목 말줄임 + 상태 배지 + 기간 + 진행률).
const CYCLES: CycleResponse[] = [
  {
    id: 1, projectId: 1, status: 'ACTIVE', goal: '결제 승인 실패율을 낮춘다', createdAt: '', updatedAt: '',
    name: '2026 4분기 결제 모듈 재구축 1차 스프린트 — 이름이 아주 긴 사이클',
    startDate: '2026-10-19', endDate: '2026-10-30',
  },
];
const PROGRESS: CycleProgress[] = [{ cycleId: 1, total: 20, done: 9, byStatus: { DONE: 9, TODO: 11 } }];

/** 사이클 구간은 다음 페이지가 남아 「더 보기」가 보이고, 백로그 구간은 비어 빈 문구가 보인다. */
async function mock(page: Page) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM' }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of ['/members', '/labels', '/saved-views']) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/cycles`, (r) => r.fulfill(json(CYCLES)));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/cycles/progress`, (r) => r.fulfill(json(PROGRESS)));
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const cycle = new URL(r.request().url()).searchParams.get('cycle');
    if (cycle === '1') {
      const items = Array.from({ length: 3 }, (_, i) => createIssue({ id: 100 + i, number: 100 + i, title: `사이클 이슈 ${i}` }));
      return r.fulfill(json(createIssueSearchResponse(items, 'next')));
    }
    return r.fulfill(json(createIssueSearchResponse([], null)));
  });
}

/** 오른쪽 끝(x + width) — 소수점 반올림 오차는 1px 허용. */
async function rightEdge(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} 가 화면에 있어야 한다`).not.toBeNull();
  return box!.x + box!.width;
}

for (const width of [390, 700]) {
  test(`모바일 ${width}px — 사이클 구간 헤더·「더 보기」·빈 문구가 구간 오른쪽 끝을 넘지 않는다`, async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width, height: 800 });
    await stubChat(page);
    await mock(page);
    await page.goto(`/projects/${KEY}`);

    await expect(page.getByTestId('list-cycle-header-cycle-1')).toBeVisible();
    await expect(page.getByTestId('list-cycle-more-cycle-1').getByRole('button', { name: '더 보기' })).toBeVisible();
    await expect(page.getByTestId('list-cycle-empty-backlog')).toBeVisible();

    // 사이클 구간: 헤더(제목·배지·기간·진행률)와 「더 보기」가 구간 안.
    const cycleEnd = await rightEdge(page, 'list-cycle-section-cycle-1');
    expect(await rightEdge(page, 'list-cycle-header-cycle-1')).toBeLessThanOrEqual(cycleEnd + 1);
    expect(await rightEdge(page, 'list-cycle-more-cycle-1')).toBeLessThanOrEqual(cycleEnd + 1);
    // 상태 배지·진행률처럼 헤더 오른쪽 요소도 구간 안(잘림 없음).
    expect(await rightEdge(page, 'list-cycle-badge-cycle-1')).toBeLessThanOrEqual(cycleEnd + 1);
    // 백로그 구간: 헤더와 빈 문구가 구간 안.
    const backlogEnd = await rightEdge(page, 'list-cycle-section-backlog');
    expect(await rightEdge(page, 'list-cycle-header-backlog')).toBeLessThanOrEqual(backlogEnd + 1);
    expect(await rightEdge(page, 'list-cycle-empty-backlog')).toBeLessThanOrEqual(backlogEnd + 1);
  });
}
