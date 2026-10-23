// 이슈 상세 — 상태 아래 완료·취소 시각 줄, 보드 카드·모바일 메타의 완료일 E2E (WP-873).
// 무엇을: 끝난 이슈(DONE·CANCELED)의 상세 속성 레일·모바일 칩 줄 아래에 「✓ 날짜 완료」 줄과 늦음 「마감 +N일」이 보이는지 검증.
// 왜: 목록·카드 말고 상세에서도 「언제 끝났나」를 상태 바로 아래에서 알 수 있게 하려는 것.
// 시각은 브라우저 로컬 기준이라 타임존을 Asia/Seoul 로 고정하고(2026-10-23 은 금요일), 현재 시각도 page.clock 으로 고정한다.

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { stubChat } from '../../fixtures/mobile.fixture';
import type { IssueDetailResponse, IssueResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'PROJ';
const ISSUE_NUMBER = 1;

// 서울 시각으로 결정적으로 렌더되게 — closedAt 05:05Z = 서울 14:05.
test.use({ timezoneId: 'Asia/Seoul' });

// 이슈 상세 공통 API 스텁 — issue-detail-layout.spec.ts 의 최소 부분집합(본 검증에 필요한 엔드포인트만).
async function mockIssueDetail(page: import('@playwright/test').Page, overrides: Partial<IssueResponse>) {
  const summary = { ...createIssue({ projectKey: PROJECT_KEY }), ...overrides };
  const detail: IssueDetailResponse = createIssueDetail({ summary });
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: PROJECT_KEY })) }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }),
  );
  for (const sub of ['watchers', 'labels', 'attachments', 'drive-links']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels` || url.pathname === '/api/v1/drive/spaces',
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

const DONE_LATE = { status: 'DONE', statusId: 3, statusName: '완료', closedAt: '2026-10-23T05:05:00Z', dueDate: '2026-10-21' } as const;

test.describe('이슈 상세 — 상태 아래 완료 줄', () => {
  test('완료 이슈는 완료 시각과 마감 대비 늦은 일수를 보인다', async ({ authenticatedPage: page }) => {
    await mockIssueDetail(page, DONE_LATE);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const line = page.getByTestId('issue-closed-line');
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('✓ 10월 23일 (금) 오후 2:05 완료');
    await expect(line).toHaveAttribute('title', '2026-10-23 14:05');
    await expect(line.getByTestId('issue-closed-late')).toHaveText('마감 +2일');
  });

  test('마감 안에 끝난 완료 이슈에는 늦음 표시가 없다', async ({ authenticatedPage: page }) => {
    await mockIssueDetail(page, { ...DONE_LATE, dueDate: '2026-10-23' });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await expect(page.getByTestId('issue-closed-line')).toContainText('✓ 10월 23일 (금) 오후 2:05 완료');
    await expect(page.getByTestId('issue-closed-late')).toHaveCount(0);
  });

  test('취소 이슈는 「취소」 문구를 보이고 늦음은 없다', async ({ authenticatedPage: page }) => {
    await mockIssueDetail(page, { ...DONE_LATE, status: 'CANCELED', statusId: 4, statusName: '취소' });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await expect(page.getByTestId('issue-closed-line')).toContainText('⊘ 10월 23일 (금) 오후 2:05 취소');
    await expect(page.getByTestId('issue-closed-late')).toHaveCount(0);
  });

  test('진행 중 이슈에는 완료 줄이 없다', async ({ authenticatedPage: page }) => {
    await mockIssueDetail(page, { status: 'IN_PROGRESS', statusId: 2, statusName: '진행 중', closedAt: null });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await expect(page.getByTestId('property-rail')).toBeVisible();
    await expect(page.getByTestId('issue-closed-line')).toHaveCount(0);
  });

  test('종료 상태인데 closedAt 이 없으면(구버전 응답) 줄을 생략한다', async ({ authenticatedPage: page }) => {
    await mockIssueDetail(page, { ...DONE_LATE, closedAt: null });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await expect(page.getByTestId('property-rail')).toBeVisible();
    await expect(page.getByTestId('issue-closed-line')).toHaveCount(0);
  });

  test('모바일 뷰포트에서도 같은 문구가 한 번만 보인다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockIssueDetail(page, DONE_LATE);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await expect(page.getByTestId('mobile-prop-chips')).toBeVisible();
    const line = page.getByTestId('issue-closed-line');
    await expect(line).toHaveCount(1);
    await expect(line).toBeVisible();
    await expect(line).toContainText('✓ 10월 23일 (금) 오후 2:05 완료');
    await expect(line.getByTestId('issue-closed-late')).toHaveText('마감 +2일');
  });
});

// ── 보드 카드·모바일 메타 — 마감 자리를 완료일로 ──
// 무엇을: 끝난 이슈는 카드의 `~마감일` 자리에 「✓ 10월 23일」(+ 늦음 「+2일」)·「⊘ 10월 18일」을 보이고,
//   closedAt 이 없는 종료 이슈는 기존 마감 표기로 폴백하는지 검증. 왜: 카드·행에서도 「언제 끝났나」를 바로 알게 하려는 것.
const BOARD_ISSUES = [
  // DONE 늦음 — 마감 10/21, 종료 10/23(서울) → +2일
  createIssue({ id: 1, number: 1, title: '늦게 끝남', ...DONE_LATE }),
  // DONE 인데 closedAt 없음(구버전 응답) → 기존 마감 표기
  createIssue({ id: 2, number: 2, title: '종료 시각 없음', status: 'DONE', closedAt: null, dueDate: '2026-10-21' }),
  // CANCELED — 늦음 없음
  createIssue({ id: 3, number: 3, title: '취소됨', status: 'CANCELED', closedAt: '2026-10-18T03:00:00Z', dueDate: '2026-10-10' }),
];

async function mockBoardProject(page: import('@playwright/test').Page, issues: IssueResponse[]) {
  await page.clock.setFixedTime(new Date('2026-10-23T06:00:00Z'));
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: PROJECT_KEY })) }),
  );
  for (const sub of ['members', 'labels', 'cycles', 'saved-views']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(systemTypes()) }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // 보드 컬럼 쿼리는 statusId 로 좁혀 온다 — 서버처럼 그 상태의 이슈만 돌려준다.
      const statusId = new URL(route.request().url()).searchParams.get('statusId');
      const body = statusId ? issues.filter((i) => String(i.statusId) === statusId) : issues;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(body)) });
    },
  );
}

test.describe('보드 카드 — 종료 이슈는 완료일', () => {
  test('완료는 「✓ 날짜」+늦음, 취소는 「⊘ 날짜」, closedAt 없으면 마감 그대로', async ({ authenticatedPage: page }) => {
    await mockBoardProject(page, BOARD_ISSUES);
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    const done = page.getByTestId('issue-card-1');
    await expect(done.getByTestId('issue-card-1-closed')).toContainText('✓ 10월 23일');
    await expect(done.getByTestId('issue-card-1-closed')).toContainText('+2일');
    // 스크린리더용 구분어(sr-only) — 「10월 23일 +2일」 이 붙어 읽히지 않는다.
    await expect(done.getByTestId('issue-card-1-closed')).toContainText('10월 23일, 마감 +2일');
    await expect(done.getByTestId('issue-card-1-closed-late')).toHaveClass(/text-warning-text/);
    await expect(done.getByTestId('issue-card-1-due')).toHaveCount(0);

    // closedAt 이 null 인 종료 카드 — 기존 마감 표기(~마감일)로 폴백.
    await expect(page.getByTestId('issue-card-2-due')).toContainText('~2026-10-21');
    await expect(page.getByTestId('issue-card-2-closed')).toHaveCount(0);

    const canceled = page.getByTestId('issue-card-3');
    await expect(canceled.getByTestId('issue-card-3-closed')).toHaveText('⊘ 10월 18일');
    await expect(canceled.getByTestId('issue-card-3-due')).toHaveCount(0);
  });
});

test.describe('모바일 — 메타 줄의 완료일', () => {
  test('모바일 목록 행과 보드 카드의 메타에 완료일이 보인다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubChat(page);
    await mockBoardProject(page, BOARD_ISSUES);

    await page.goto(`/projects/${PROJECT_KEY}?group=none`);
    await expect(page.getByTestId('issue-row-1-meta')).toContainText('✓ 10월 23일');
    await expect(page.getByTestId('issue-row-1-meta')).toContainText('+2일');
    await expect(page.getByTestId('issue-row-3-meta')).toContainText('⊘ 10월 18일');
    // closedAt 없는 종료 이슈 — 마감 표기로 폴백. 마감도 완료일과 같은 표기(같은 해면 연도 생략, 스펙 4.6) —
    // 옆 줄의 「✓ 10월 23일」 과 「2026년 10월 21일」 이 섞여 보이지 않게.
    await expect(page.getByTestId('issue-row-2-meta')).not.toContainText('✓');
    await expect(page.getByTestId('issue-row-2-meta')).toContainText('10월 21일');
    await expect(page.getByTestId('issue-row-2-meta')).not.toContainText('2026년');

    // 모바일 보드는 상태 탭 하나씩 보인다 — 완료(3)·취소(4) 탭.
    await page.goto(`/projects/${PROJECT_KEY}?view=board&group=none&boardTab=3`);
    await expect(page.getByTestId('issue-card-1-meta')).toContainText('✓ 10월 23일');
    await expect(page.getByTestId('issue-card-1-meta')).toContainText('+2일');
    await page.goto(`/projects/${PROJECT_KEY}?view=board&group=none&boardTab=4`);
    await expect(page.getByTestId('issue-card-3-meta')).toContainText('⊘ 10월 18일');
  });
});
