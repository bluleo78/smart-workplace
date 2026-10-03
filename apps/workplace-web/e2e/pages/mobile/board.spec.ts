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
    // Task 3 에서 한 컬럼 전체 폭이 되면 320 으로 올린다
    expect((await card.boundingBox())!.width).toBeGreaterThan(200);
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
