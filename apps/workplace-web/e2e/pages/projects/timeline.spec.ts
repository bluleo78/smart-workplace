// 타임라인 페이지 E2E — 간트 렌더 배선(@wiring)과 브라우저가 있어야 판정되는 것만 남긴다:
// 막대·오늘선·사이클 이름표·스케일 칸의 기하와 스크롤(@layout), 막대 끌기(@input).
// 진입 이동·일정 미정 배치 payload·줌 토글·필터(facet·URL)·상태 목록 관문(로딩·실패·다시 시도)은
// 페이지 테스트 src/pages/projects/timeline.test.tsx 가 지킨다(WP-971, WP-980).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { afterScroll, gotoTimeline } from '../../fixtures/timeline';
import { expectStays } from '../../fixtures/wait';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { CycleResponse } from '../../../src/types/cycle';
import type { MilestoneResponse } from '../../../src/types/milestone';
import { expectToggle } from '../../fixtures/selection';

const KEY = 'WP';

// 그룹 기본 상태는 "접힘"이다(사용자 요청 — 펼친 것만 localStorage 저장). 이 스펙의 이슈는
// 전부 에픽이 없어 "에픽 없음" 그룹에 묶이므로, 막대/드래그/의존을 검증하려면 먼저 펼친다.
// (행 클릭은 상세 이동이라 토글 아이콘만 클릭)
async function expandNoEpicGroup(page: Page) {
  await page
    .locator('.timeline-gantt-root .wx-grid .wx-row', { hasText: '에픽 없음' })
    .locator('.wx-toggle-icon, [class*="toggle"]')
    .first()
    .click();
}

function setupTimelineStubs(page: Page) {
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const members = [
        createMember({ userId: 2, name: '김개발', username: 'kim@example.com' }),
        createMember({ userId: 3, name: '이테스트', username: 'lee@example.com', role: 'MEMBER' }),
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(members) });
    }),
    page.route(`**/api/v1/projects/${KEY}/labels`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route(`**/api/v1/projects/${KEY}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject({ key: KEY })),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const issues = [
        createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
        createIssue({ number: 2, title: '마감일만 이슈', dueDate: '2026-07-10' }),
        createIssue({ number: 3, title: '미정 이슈' }),
        createIssue({ number: 4, title: '취소된 이슈', status: 'CANCELED', dueDate: '2026-07-08' }),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const now = new Date().toISOString();
      const cycles: CycleResponse[] = [
        {
          id: 7,
          projectId: 1,
          name: '사이클 7',
          goal: null,
          startDate: '2026-07-01',
          endDate: '2026-07-14',
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
        },
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycles) });
    }),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const milestones: MilestoneResponse[] = [
        { id: 1, projectId: 1, name: 'v1 출시', dueDate: '2026-08-01', description: null, createdAt: '', updatedAt: '' },
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(milestones) });
    }),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
  ]);
}

test('간트 영역이 컨텐츠 컨테이너 높이를 꽉 채운다 (Willow 테마 래퍼 height:auto 회귀 방지)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await setupTimelineStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  // timeline-gantt-root 는 간트 위젯이 채워야 할 실제 컨테이너 — .wx-chart 가 그 높이만큼
  // 채워지는지 확인한다(둘 다 같은 부모 아래라 동일해야 정상).
  const rootBox = await page.locator('.timeline-gantt-root').boundingBox();
  const chartBox = await page.locator('.timeline-gantt-root .wx-chart').boundingBox();
  expect(rootBox).not.toBeNull();
  expect(chartBox).not.toBeNull();
  // .wx-theme.wx-willow-theme 래퍼가 height:auto 로 되돌아가면 .wx-chart 가 행 개수만큼의
  // 콘텐츠 높이로 줄어들어 컨테이너 하단에 빈 여백이 남는다 — 두 높이가 거의 같아야 정상.
  expect(Math.abs((rootBox?.height ?? 0) - (chartBox?.height ?? 0))).toBeLessThan(4);
});

test('이슈 막대·사이클 밴드·오늘선 렌더', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await expandNoEpicGroup(page);
  // 기간 이슈 + 마감일만 이슈 막대가 렌더되고, 취소된 이슈/미정 이슈는 막대로 렌더되지 않는다.
  await expect(page.getByText('기간 이슈').first()).toBeVisible();
  await expect(page.getByText('마감일만 이슈').first()).toBeVisible();
  await expect(page.getByText('취소된 이슈')).toHaveCount(0);
  await expect(page.getByTestId('timeline-cycle-band')).toContainText('사이클 7');
  await expect(page.getByTestId('timeline-today-line')).toBeVisible();
});

test('이슈 막대가 상태별로 다른 색으로 렌더된다 (#639)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) }),
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    const issues = [
      createIssue({ number: 1, title: '할일 이슈', status: 'TODO', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({
        number: 2,
        title: '진행중 이슈',
        status: 'IN_PROGRESS',
        startDate: '2026-07-06',
        dueDate: '2026-07-10',
      }),
      createIssue({ number: 3, title: '완료 이슈', status: 'DONE', startDate: '2026-07-11', dueDate: '2026-07-15' }),
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssueSearchResponse(issues)),
    });
  });

  // 사이클이 없으면 기본 기간이 rolling(오늘−3개월~)이라 7월 고정 날짜 막대가 날짜가 지나며 빠진다 — 전체 기간으로 본다(WP-247).
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await expandNoEpicGroup(page);

  const bg = async (issueNumber: number) =>
    page
      .locator(`.wx-bar[data-task-id$="${issueNumber}"]`)
      .evaluate((el) => getComputedStyle(el).backgroundColor);

  await expect.poll(() => bg(1)).not.toBe('');
  const [todoBg, progressBg, doneBg] = await Promise.all([bg(1), bg(2), bg(3)]);
  expect(todoBg).not.toBe(progressBg);
  expect(progressBg).not.toBe(doneBg);
  expect(todoBg).not.toBe(doneBg);
});

test('막대 드래그 이동 시 startDate+dueDate PATCH', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`);
  await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssue({ number: 1, title: '기간 이슈' })),
      });
    }
    return route.fallback();
  });
  await gotoTimeline(page, `/projects/${KEY}/timeline`);
  await expandNoEpicGroup(page);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => patches.lastBody(), { timeout: 5000 }).toMatchObject({
    startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
});

test('PATCH 실패 시 토스트 노출 + 서버 상태 복원', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  const issueSearches = trackRequests(
    page,
    'GET',
    (u) => u.pathname === `/api/v1/projects/${KEY}/issues` && u.search !== '',
  );
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [
      createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({ number: 2, title: '마감일만 이슈', dueDate: '2026-07-10' }),
      createIssue({ number: 3, title: '미정 이슈' }),
      createIssue({ number: 4, title: '취소된 이슈', status: 'CANCELED', dueDate: '2026-07-08' }),
    ];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssueSearchResponse(issues)),
    });
  });
  await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '일정 변경에 실패했습니다' }),
      });
    }
    return route.fallback();
  });
  await gotoTimeline(page, `/projects/${KEY}/timeline`);
  await expandNoEpicGroup(page);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  const initialRefetchCount = issueSearches.count();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('일정 변경에 실패했습니다')).toBeVisible();
  // 실패 시 invalidate 로 이슈 목록을 재조회해 서버 상태로 복원한다.
  await issueSearches.waitFor(initialRefetchCount + 1);
});

test('비멤버는 드래그 비활성', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  // setupTimelineStubs 이후 등록한 라우트가 우선 매칭되므로, viewerIsMember:false 오버라이드가 적용된다.
  await page.route(`**/api/v1/projects/${KEY}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ key: KEY, viewerIsMember: false })),
    });
  });
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`);
  await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });
  await gotoTimeline(page, `/projects/${KEY}/timeline`);
  await expandNoEpicGroup(page);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expectStays(page, patches.count, 0);
});

test('의존 화살표 렌더 (표시 전용)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setupTimelineStubs(page);
  // 기간 이슈(1)→마감일만 이슈(2) 엣지 — 양끝 모두 막대가 있어 렌더 대상.
  await page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ fromIssueNumber: 1, toIssueNumber: 2 }]),
    });
  });
  // 막대·화살표 좌표를 차례로 재므로 첫 진입 스크롤이 걸린 뒤에 잰다.
  await gotoTimeline(page, `/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await expandNoEpicGroup(page);
  const link = page.locator('[data-link-id]');
  await expect(link).toHaveCount(1);
  // 화살표가 finish-to-start(e2s) 로 그려지는지 실제 렌더 좌표로 검증(#671 회귀 방지) —
  // "표시된다"만 확인하면 s2s/e2s 오분류를 못 잡는다. 선행 이슈(1)의 우측(종료) 끝에서
  // 나와 후행 이슈(2)의 좌측(시작) 끝으로 들어가야 한다.
  const sourceBar = page.locator('[data-task-id="1"]');
  const targetBar = page.locator('[data-task-id="2"]');
  const sourceBox = (await sourceBar.boundingBox())!;
  const targetBox = (await targetBar.boundingBox())!;
  const polyline = link.locator('polyline.wx-line-draw').first();
  const points = await polyline.evaluate((el) => {
    const line = el as unknown as SVGPolylineElement;
    const svg = line.ownerSVGElement!;
    const ctm = svg.getScreenCTM()!;
    const toScreen = (p: DOMPoint) => ({
      x: p.x * ctm.a + p.y * ctm.c + ctm.e,
      y: p.x * ctm.b + p.y * ctm.d + ctm.f,
    });
    const len = line.getTotalLength();
    return { start: toScreen(line.getPointAtLength(0)), end: toScreen(line.getPointAtLength(len)) };
  });
  const TOLERANCE_PX = 12;
  // 화살표 시작점 == 선행 이슈 막대의 우측(종료) 끝
  expect(Math.abs(points.start.x - (sourceBox.x + sourceBox.width))).toBeLessThan(TOLERANCE_PX);
  // 화살표 끝점 == 후행 이슈 막대의 좌측(시작) 끝
  expect(Math.abs(points.end.x - targetBox.x)).toBeLessThan(TOLERANCE_PX);
  // 비멤버 조회 전용(readOnly)에서는 링크 편집 UI(연결점 드래그 핸들)가 노출되지 않는다 —
  // TimelineGantt 는 SVAR `readonly` prop 하나로 막대/링크 편집을 동시에 잠근다.
  await page.route(`**/api/v1/projects/${KEY}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject({ key: KEY, viewerIsMember: false })),
    });
  });
  // 재방문(reload) — 앞서 펼친 "에픽 없음" 그룹 상태가 localStorage 로 복원되므로
  // 여기서 다시 펼치면 오히려 접힌다. 복원된 펼침 상태 그대로 막대가 보여야 한다.
  await page.goto(`/projects/${KEY}/timeline`);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  await bar.hover();
  await expect(bar.locator('.wx-link')).toHaveCount(0);
});

// #669 — 의존성 순서와 실제 일정이 모순되는 링크(후행 마감일 < 선행 마감일)는 destructive 톤으로
// 강조된다. 정상 링크(선행이 먼저 끝남)는 강조되지 않아야 대조가 성립한다.
test('일정 모순 의존성 링크가 destructive 색으로 강조된다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.route(`**/api/v1/projects/${KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject({ key: KEY })) }),
  );
  await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/labels`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    const issues = [
      // 선행(1) 마감 07-10 > 후행(2) 마감 07-05 — 모순.
      createIssue({ number: 1, title: '선행 A', startDate: '2026-07-01', dueDate: '2026-07-10' }),
      createIssue({ number: 2, title: '후행 A', startDate: '2026-07-02', dueDate: '2026-07-05' }),
      // 선행(3) 마감 07-01 < 후행(4) 마감 07-15 — 정상(대조군).
      createIssue({ number: 3, title: '선행 B', startDate: '2026-06-28', dueDate: '2026-07-01' }),
      createIssue({ number: 4, title: '후행 B', startDate: '2026-07-03', dueDate: '2026-07-15' }),
    ];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  await page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { fromIssueNumber: 1, toIssueNumber: 2 },
        { fromIssueNumber: 3, toIssueNumber: 4 },
      ]),
    }),
  );

  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await expandNoEpicGroup(page);
  await expect(page.locator('[data-link-id]')).toHaveCount(2);

  // 링크 순서(id 부여 방식)는 SVAR 내부 구현에 의존하므로 특정 id 로 매칭하지 않고, 2개 중
  // 정확히 1개만 destructive 로 강조되는지(모순 1건 vs 정상 1건) 로 검증한다.
  const strokes = () =>
    page
      .locator('[data-link-id] polyline.wx-line-draw')
      .evaluateAll((els) => els.map((el) => (el as SVGPolylineElement).style.stroke));

  await expect
    .poll(async () => (await strokes()).filter((s) => s === 'var(--destructive)').length)
    .toBe(1);
  const finalStrokes = await strokes();
  expect(finalStrokes.filter((s) => s !== 'var(--destructive)').length).toBe(1);
});

// WP-486 — 1024 폭에서는 차트가 좁아 처음 열면 이른 이슈 쪽(차트 시작)만 보이고 오늘선·사이클 구간이 화면 밖이었다.
// 처음 열 때 조회 기간 시작(기본은 활성 사이클)으로 스크롤해 오늘선과 사이클 구간이 차트 안에 보인다.
test('1024 폭에서 처음 열면 조회 기간(활성 사이클)으로 스크롤돼 오늘선이 차트 안에 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z')); // 오늘 = 활성 사이클(7/1~7/14) 안
  await setupTimelineStubs(page);
  // 차트 시작을 앞당기는 이른 이슈(1월)를 더한다 — 나중에 등록한 route 가 우선한다.
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [
      createIssue({ number: 9, title: '연초 이슈', startDate: '2026-01-05', dueDate: '2026-01-20' }),
      createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
    ];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  const chart = page.locator('.timeline-gantt-root .wx-chart');
  const todayLine = page.getByTestId('timeline-today-line');
  const todayInChart = async () => {
    const c = await chart.boundingBox();
    const t = await todayLine.boundingBox();
    return !!c && !!t && t.x >= c.x && t.x <= c.x + c.width;
  };
  // 기본(활성 사이클) 기간 — 사이클 시작으로 스크롤.
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await expect.poll(todayInChart).toBe(true);
  // 전체 기간 — 차트는 1월 이슈부터 시작하지만 처음 열 때 오늘 근처로 스크롤.
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await expect.poll(todayInChart).toBe(true);
});

// WP-489 — 기간이 겹치는 사이클 이름표가 서로 겹치고, 차트 왼쪽으로 지난 사이클 이름표가 왼쪽 표 위까지 그려지던 문제.
// 겹치는 사이클은 줄을 나눠 쌓고, 이름표는 차트 영역 안에서만 그린다(차트 왼쪽 끝에 붙고 잘린다).
test('겹치는 사이클 이름표는 줄을 나눠 겹치지 않고, 차트 왼쪽 밖(표 영역)으로 넘지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-10-19T03:00:00Z'));
  await setupTimelineStubs(page);
  const now = new Date().toISOString();
  const cyc = (id: number, name: string, startDate: string, endDate: string, status: CycleResponse['status']): CycleResponse => ({
    id, projectId: 1, name, goal: null, startDate, endDate, status, createdAt: now, updatedAt: now,
  });
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        cyc(1, '스프린트 1 (지난)', '2026-10-01', '2026-10-14', 'COMPLETED'),
        cyc(2, '스프린트 2 (현재)', '2026-10-15', '2026-10-28', 'ACTIVE'),
        cyc(3, '스프린트 3 (겹침)', '2026-10-20', '2026-11-03', 'PLANNED'),
      ]),
    });
  });
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [createIssue({ number: 1, title: '9월 이슈', startDate: '2026-09-01', dueDate: '2026-09-10' })];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  const labels = page.getByTestId('timeline-cycle-band');
  await expect(labels).toHaveCount(3);
  // 지난 사이클이 차트 왼쪽 밖에 걸치도록 오른쪽으로 스크롤한다(10/8 을 왼쪽 끝에).
  await page.getByRole('button', { name: '오늘' }).click();
  const chart = (await page.locator('.timeline-gantt-root .wx-chart').boundingBox())!;
  await expect
    .poll(async () => {
      const boxes = await labels.evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, shown: getComputedStyle(e).visibility !== 'hidden' };
        }),
      );
      const shown = boxes.filter((b) => b.shown && b.w > 0);
      // 차트 왼쪽 밖(표 영역)으로 넘지 않는다.
      const inside = shown.every((b) => b.x >= chart.x - 0.5);
      // 서로 겹치지 않는다(가로·세로 모두 겹치는 쌍이 없다).
      const overlap = shown.some((a, i) =>
        shown.some((b, j) => j > i && a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom),
      );
      return inside && !overlap;
    })
    .toBe(true);
});

// WP-595 — 기간이 아주 긴 이슈(1900~2099) 하나가 간트 축을 200년으로 늘려, 처음 열 때도 「오늘」을 눌러도 2005년 근처가 보였다.
// 축 범위를 조회 기간 앞뒤로 자르므로 오늘선이 차트 안에 보이고, 긴 이슈 막대는 잘린 채 남는다.
test('기간이 아주 긴 이슈가 있어도 처음 열 때·「오늘」 뒤 오늘선이 차트 안에 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z')); // 오늘 = 스텁의 활성 사이클(7/1~7/14) 안
  await setupTimelineStubs(page);
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [
      createIssue({ number: 7, title: '아주 긴 이슈', startDate: '1900-01-01', dueDate: '2099-12-31' }),
      createIssue({ number: 1, title: '이번 주 이슈', startDate: '2026-07-06', dueDate: '2026-07-10' }),
    ];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  const chart = page.locator('.timeline-gantt-root .wx-chart');
  const todayLine = page.getByTestId('timeline-today-line');
  const todayInChart = async () => {
    const c = await chart.boundingBox();
    const t = await todayLine.boundingBox();
    return !!c && !!t && t.x >= c.x && t.x <= c.x + c.width;
  };
  for (const period of ['', '?period=all']) {
    await page.goto(`/projects/${KEY}/timeline${period}`);
    await expect(page.getByTestId('timeline-gantt')).toBeVisible();
    await expect.poll(todayInChart).toBe(true);
    // 축이 200년(약 100만 px)으로 늘지 않는다 — 조회 기간 앞뒤로 자른 폭.
    const scrollWidth = await chart.evaluate((el) => el.scrollWidth);
    expect(scrollWidth).toBeLessThan(200_000);
    // 오른쪽 끝으로 밀어 둔 뒤 「오늘」을 누르면 다시 오늘선이 보인다.
    await chart.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await page.getByRole('button', { name: '오늘' }).click();
    await expect.poll(todayInChart).toBe(true);
  }
  // 긴 이슈 막대는 잘린 채로 남는다(사라지지 않는다).
  await expandNoEpicGroup(page);
  await expect(page.locator('.wx-bar[data-task-id$="7"]')).toBeVisible();
});

// WP-938 — 스크롤 요청을 날짜로만 넘겨, 이미 요청한 날짜(「오늘」을 한 번 누른 뒤 등)를 다시 요청하면 상태가 그대로라
// 스크롤하지 않았다. 차트를 옆으로 밀어 둔 뒤 「오늘」을 다시 누르면 매번 오늘선이 차트 안으로 돌아온다.
test('「오늘」을 다시 눌러도(같은 날짜) 옆으로 밀어 둔 차트가 오늘로 돌아온다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z'));
  await setupTimelineStubs(page);
  // 차트를 넓히는 이른(1월)·늦은(12월) 이슈 — 「전체」 기간이라 축이 1년 가까이 퍼져 가로 스크롤이 생긴다.
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [
      createIssue({ number: 9, title: '연초 이슈', startDate: '2026-01-05', dueDate: '2026-01-20' }),
      createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({ number: 8, title: '연말 이슈', startDate: '2026-12-01', dueDate: '2026-12-20' }),
    ];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  const chart = page.locator('.timeline-gantt-root .wx-chart');
  const todayLine = page.getByTestId('timeline-today-line');
  const todayInChart = async () => {
    const c = await chart.boundingBox();
    const t = await todayLine.boundingBox();
    return !!c && !!t && t.x >= c.x && t.x <= c.x + c.width;
  };
  await gotoTimeline(page, `/projects/${KEY}/timeline?period=all`);
  await expect.poll(todayInChart).toBe(true);
  const todayButton = page.getByRole('button', { name: '오늘' });
  // 「오늘」을 누르고 그 스크롤이 걸릴 때까지 기다린다 — 걸리기 전에 밀면 늦게 온 스크롤이 다시 오늘로 되돌렸다.
  const clickToday = () => afterScroll(page, () => todayButton.click());
  // 같은 날짜를 두 번 요청하는 경우 — 첫 「오늘」 뒤 밀어 두고 다시 누른다. 양 끝 모두 확인.
  for (const edge of ['start', 'end'] as const) {
    await clickToday();
    await expect.poll(todayInChart).toBe(true);
    await chart.evaluate((el, e) => el.scrollTo({ left: e === 'start' ? 0 : el.scrollWidth }), edge);
    await expect.poll(todayInChart).toBe(false);
    await clickToday();
    await expect.poll(todayInChart).toBe(true);
  }
});

// WP-605 — 주 보기 위쪽 월 칸이 축 시작에서 멀어질수록 밀려(21개월에 3달) 오늘(10월) 위에 「7월」이 적혔다.
// 위쪽 행을 주 경계에 맞춘 달로 그리므로, 오늘선 위 월 칸이 실제 달이고 월 칸 경계가 주 칸 경계와 겹친다.
test('주 보기 — 축이 길어도 오늘선 위 월 칸이 실제 달이고 월 칸 경계가 주 칸 경계와 맞는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-10-20T03:00:00Z'));
  await setupTimelineStubs(page);
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [
      createIssue({ number: 1, title: '작년 초 이슈', startDate: '2025-01-06', dueDate: '2025-01-20' }),
      createIssue({ number: 2, title: '이번 주 이슈', startDate: '2026-10-20', dueDate: '2026-10-25' }),
    ];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await page.getByRole('button', { name: '오늘' }).click();
  const todayLine = page.getByTestId('timeline-today-line');
  await expect(todayLine).toBeVisible();

  // 오늘선 x 를 덮는 위·아래 스케일 칸의 글자
  const cellAt = (row: 'first' | 'last') =>
    todayLine.evaluate((line, which) => {
      const x = line.getBoundingClientRect().left;
      const rows = document.querySelectorAll('.timeline-gantt-root .wx-scale .wx-row');
      const r = which === 'first' ? rows[0] : rows[rows.length - 1];
      const cell = [...r.querySelectorAll<HTMLElement>('.wx-cell')].find((c) => {
        const b = c.getBoundingClientRect();
        return b.left <= x && x < b.right;
      });
      return cell?.textContent?.trim() ?? null;
    }, row);
  await expect.poll(() => cellAt('first')).toBe('2026년 10월');
  expect(await cellAt('last')).toBe('W43');

  // 그려진 월 칸의 왼쪽 경계는 모두 주 칸 경계 위에 있다(달이 주 중간에서 갈리지 않는다).
  // 스케일은 보이는 칸만 그리므로 그려진 주 칸 범위 안의 월 경계만 본다.
  const bounds = await page.locator('.timeline-gantt-root .wx-scale').evaluate((scale) => {
    const rows = scale.querySelectorAll('.wx-row');
    const lefts = (r: Element) => [...r.querySelectorAll<HTMLElement>('.wx-cell')].map((c) => Math.round(c.getBoundingClientRect().left));
    return { months: lefts(rows[0]), weeks: lefts(rows[rows.length - 1]) };
  });
  const [lo, hi] = [Math.min(...bounds.weeks), Math.max(...bounds.weeks)];
  const inRange = bounds.months.filter((l) => l >= lo && l <= hi);
  expect(inRange.length).toBeGreaterThan(0);
  for (const l of inRange) expect(bounds.weeks.some((w) => Math.abs(w - l) <= 1)).toBe(true);
});

// WP-889 — 「일」 보기: 위 행은 달·아래 행은 날짜·요일, 주말 음영, 막대 끌기는 하루 단위, 고른 보기 단위는 다시 열어도 남는다.
test('일 보기 — 날짜·요일 칸과 주말 음영, 하루 단위 막대 끌기, 보기 단위 기억', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z')); // 오늘 = 7/8(수)
  await setupTimelineStubs(page);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`);
  await page.route(`**/api/v1/projects/${KEY}/issues/1`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-04', dueDate: '2026-07-08' })),
    });
  });
  await gotoTimeline(page, `/projects/${KEY}/timeline`);
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  const dayButton = page.getByRole('button', { name: '일', exact: true });
  // 보기를 바꾸면 보던 날짜로 다시 가운데를 맞추고, 「오늘」도 스크롤한다 — 막대를 끌기 전에 둘 다 걸린 뒤로 기다린다.
  await afterScroll(page, async () => {
    await dayButton.click();
    await expectToggle(dayButton, true);
  });
  await expectToggle(page.getByRole('button', { name: '주' }), false);

  // 오늘선 아래의 위·아래 스케일 칸 — 달과 「날짜 요일」.
  await afterScroll(page, () => page.getByRole('button', { name: '오늘' }).click());
  const todayLine = page.getByTestId('timeline-today-line');
  const cellAt = (row: 'first' | 'last') =>
    todayLine.evaluate((line, which) => {
      const x = line.getBoundingClientRect().left;
      const rows = document.querySelectorAll('.timeline-gantt-root .wx-scale .wx-row');
      const r = which === 'first' ? rows[0] : rows[rows.length - 1];
      const cell = [...r.querySelectorAll<HTMLElement>('.wx-cell')].find((c) => {
        const b = c.getBoundingClientRect();
        return b.left <= x && x < b.right;
      });
      return cell?.textContent?.trim() ?? null;
    }, row);
  await expect.poll(() => cellAt('first')).toBe('2026년 7월');
  expect(await cellAt('last')).toBe('8 수');

  // 주말 음영 — 날짜 칸 중 토·일 칸에만 음영 클래스가 붙는다(차트 본문 음영도 같은 판정에서 나온다).
  const dayCells = await page
    .locator('.timeline-gantt-root .wx-scale .wx-row:last-child .wx-cell')
    .evaluateAll((cells) => cells.map((c) => [c.textContent?.trim() ?? '', c.classList.contains('timeline-weekend')] as const));
  expect(dayCells.some(([, shaded]) => shaded)).toBe(true);
  for (const [label, shaded] of dayCells) expect(shaded).toBe(/ [토일]$/.test(label));

  // 막대(7/1~7/5)를 칸 3개만큼 끌면 하루 단위로 3일 옮겨진다.
  await expandNoEpicGroup(page);
  const bar = page.locator('[data-task-id="1"]');
  await expect(bar).toBeVisible();
  const cellWidth = await page
    .locator('.timeline-gantt-root .wx-scale .wx-row:last-child .wx-cell')
    .first()
    .evaluate((c) => c.getBoundingClientRect().width);
  const box = (await bar.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + cellWidth * 3, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => patches.lastBody()).toEqual({ startDate: '2026-07-04', dueDate: '2026-07-08' });

  // 다시 열어도 일 보기로 시작한다.
  await page.reload();
  await expect(page.getByTestId('timeline-gantt')).toBeVisible();
  await expectToggle(page.getByRole('button', { name: '일', exact: true }), true);
});

// WP-938 — 상태 목록 관문(받기 전 로딩·실패 다시 시도)의 동작은 timeline.test.tsx, 여기선 그 화면의 세로 위치만 본다.
const STATUSES_PATH = `/api/v1/projects/${KEY}/statuses`;

// 관문 로딩 문구와 실패 화면 덩어리(아이콘 위 ~ 「다시 시도」 아래)가 본문 자리(timeline-body)의 세로 가운데에서 벗어난 px.
async function offsetFromBodyCenter(page: Page, top: Locator, bottom: Locator = top) {
  const slot = (await page.getByTestId('timeline-body').boundingBox())!;
  const a = (await top.boundingBox())!;
  const b = (await bottom.boundingBox())!;
  return Math.abs((a.y + b.y + b.height) / 2 - (slot.y + slot.height / 2));
}

// WP-938 디자이너 리뷰 — 실패 화면 감싸개가 flex 가 아니어서 ResourceErrorState 가 60vh 상자로 줄어, 로딩 문구(본문 가운데)에서
// 실패 화면으로 바뀔 때 덩어리가 위로 약 150px 튀었다. 로딩 문구와 실패 화면이 같은 본문 자리의 세로 가운데에 놓인다.
test('상태 목록 로딩 문구와 실패 화면이 본문 자리의 같은 세로 가운데에 놓인다 (WP-938)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupTimelineStubs(page);
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(`**${STATUSES_PATH}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await held;
    return route.fulfill({ status: 500, json: { status: 500, message: '서버 오류' } });
  });
  await page.goto(`/projects/${KEY}/timeline`);

  const loading = page.getByTestId('timeline-body').getByText('로딩 중…');
  await expect(loading).toBeVisible();
  expect(await offsetFromBodyCenter(page, loading)).toBeLessThan(4);

  release();
  const error = page.getByTestId('project-statuses-error');
  await expect(error).toBeVisible();
  expect(await offsetFromBodyCenter(page, error.locator('svg').first(), error.getByRole('button', { name: '다시 시도' }))).toBeLessThan(4);
});

// WP-889 — 보기 단위를 바꾸면 보던 날짜(차트 가운데)가 그대로 가운데에 남는다. 전에는 가로 스크롤 px 만 남아 일 보기로 바꾸면
// 몇 달 뒤가, 월 보기로 바꾸면 축 끝이 보였다.
test('보기 단위를 바꿔도 차트 가운데 보던 날짜가 가운데에 남는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.clock.setFixedTime(new Date('2026-07-08T03:00:00Z'));
  await setupTimelineStubs(page);
  // 「전체」 기간에 1월·12월 이슈 — 축이 1년 가까이 퍼져 어느 보기에서도 가로 스크롤이 생긴다.
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [
      createIssue({ number: 9, title: '연초 이슈', startDate: '2026-01-05', dueDate: '2026-01-20' }),
      createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
      createIssue({ number: 8, title: '연말 이슈', startDate: '2026-12-01', dueDate: '2026-12-20' }),
    ];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  const chart = page.locator('.timeline-gantt-root .wx-chart');
  const todayLine = page.getByTestId('timeline-today-line');
  // 오늘선이 차트 가운데에서 몇 px 떨어져 있는지
  const offCenter = async () => {
    const c = (await chart.boundingBox())!;
    const t = (await todayLine.boundingBox())!;
    return Math.abs(t.x - (c.x + c.width / 2));
  };
  await gotoTimeline(page, `/projects/${KEY}/timeline?period=all`);
  // 「오늘」 스크롤은 효과 다음 프레임에 걸려 부하에 따라 늦게 온다 — 걸린 뒤에 오늘선을 차트 가운데로 옮긴다. 프레임 두 개만
  // 기다리면 그 뒤에 스크롤이 와서 가운데로 옮겨 둔 차트를 다시 밀어, 병렬 실행에서 보기 전환 뒤 가운데가 크게 어긋났다.
  await afterScroll(page, () => page.getByRole('button', { name: '오늘' }).click());
  await expect(todayLine).toBeVisible();
  const shift = (await todayLine.boundingBox())!.x - ((await chart.boundingBox())!.x + (await chart.boundingBox())!.width / 2);
  await chart.evaluate((el, dx) => el.scrollBy({ left: dx }), shift);
  await expect.poll(offCenter).toBeLessThan(4);
  // 일 칸 하나(44px)·월 보기의 하루(약 3px) 안쪽 오차만 허용한다.
  for (const name of ['일', '월', '주', '일']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(offCenter).toBeLessThan(44);
  }
});
