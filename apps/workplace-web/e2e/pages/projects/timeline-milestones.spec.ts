// 타임라인 마일스톤 UX E2E — 상단 고정 레인(칩)+세로 점선 렌더(#648), 툴바/레인 클릭 2경로 생성,
// 편집 팝오버(이름 수정·삭제), readOnly 비활성. 마일스톤 드래그 이동은 스코프 제외(팝오버 날짜 수정만 유지).
import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { CycleResponse } from '../../../src/types/cycle';
import type { MilestoneResponse } from '../../../src/types/milestone';

const KEY = 'WP';

function baseMilestones(): MilestoneResponse[] {
  return [
    { id: 1, projectId: 1, name: 'v1 출시', dueDate: '2026-08-01', description: null, createdAt: '', updatedAt: '' },
  ];
}

function setupStubs(
  page: Page,
  options: { milestones?: MilestoneResponse[]; viewerIsMember?: boolean } = {},
) {
  const milestones = options.milestones ?? baseMilestones();
  const viewerIsMember = options.viewerIsMember ?? true;
  return Promise.all([
    page.route(`**/api/v1/projects/${KEY}`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createProject({ key: KEY, viewerIsMember })),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const issues = [
        createIssue({ number: 1, title: '기간 이슈', startDate: '2026-07-01', dueDate: '2026-07-05' }),
        createIssue({ number: 2, title: '연결 이슈', dueDate: '2026-07-10', milestoneId: 1 }),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createIssueSearchResponse(issues)),
      });
    }),
    page.route(`**/api/v1/projects/${KEY}/cycles`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const cycles: CycleResponse[] = [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cycles) });
    }),
    page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(milestones) });
    }),
    page.route(`**/api/v1/projects/${KEY}/issue-dependencies`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
  ]);
}

test('마일스톤이 상단 레인 칩으로 렌더되고 이슈 행을 차지하지 않는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('milestone-lane')).toBeVisible();
  await expect(page.getByTestId('milestone-chip-1')).toContainText('v1 출시');
  // SVAR 차트에는 milestone 타입 다이아몬드가 더 이상 없다 — 완전히 레인으로 분리됐다.
  await expect(page.locator('.timeline-gantt-root .wx-bar.wx-milestone')).toHaveCount(0);
  // 마감일 세로 점선 렌더.
  await expect(page.getByTestId('milestone-vline-1')).toBeAttached();
});

test('마일스톤 레인의 그리드/차트 경계 구분선이 아래 차트 경계와 이어진다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('milestone-lane')).toBeVisible();
  const divider = page.getByTestId('milestone-lane-divider');
  await expect(divider).toBeAttached();
  // 레인 구분선의 left 오프셋이 0(끊어져 미배치)이 아니라 실제 그리드 패널 폭만큼 이동해
  // 아래 차트의 그리드/차트 경계선과 같은 x 좌표에 그려져야 한다.
  const dividerLeft = await divider.evaluate((el) => el.getBoundingClientRect().left);
  const chartLeft = await page
    .locator('.timeline-gantt-root .wx-chart')
    .first()
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(dividerLeft - chartLeft)).toBeLessThan(2);
});

// 오늘 기준 days 일 뒤(음수면 앞) 날짜 — 첫 화면은 오늘 근처로 스크롤되므로 지난 마일스톤이 차트 왼쪽 밖에 놓인다.
function isoFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// WP-861: 차트 시작보다 이른 마일스톤의 칩·점선이 왼쪽 이슈 표 위에 겹쳐 그려졌다.
test('차트 왼쪽 밖의 마일스톤은 칩·점선을 그리드 위에 그리지 않고, 보이는 칩은 차트 영역 안에서 시작한다', async ({
  authenticatedPage: page,
}) => {
  await setupStubs(page, {
    milestones: [
      { id: 1, projectId: 1, name: '지난 마일스톤', dueDate: isoFromToday(-120), description: null, createdAt: '', updatedAt: '' },
      { id: 2, projectId: 1, name: '다음 마일스톤', dueDate: isoFromToday(7), description: null, createdAt: '', updatedAt: '' },
      // 첫 화면은 오늘 −7일 근처에서 시작하므로 −5일 마감은 차트 왼쪽 끝 바로 안쪽이다.
      { id: 3, projectId: 1, name: '경계 근처 마일스톤', dueDate: isoFromToday(-5), description: null, createdAt: '', updatedAt: '' },
    ],
  });
  // 기본 기간(사이클 없음 → 최근 3개월~향후 6개월)의 차트는 120일 전 마일스톤보다 늦게 시작한다.
  // 그 기간 안에 막대가 있어야 간트가 그려진다.
  await page.route(`**/api/v1/projects/${KEY}/issues?*`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const issues = [createIssue({ number: 1, title: '이번 주 이슈', startDate: isoFromToday(-1), dueDate: isoFromToday(3) })];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse(issues)) });
  });
  await page.goto(`/projects/${KEY}/timeline`);
  const scroller = page.locator('.timeline-gantt-root .wx-chart').first();
  await expect(page.getByTestId('milestone-chip-2')).toBeVisible();
  const chartLeft = await scroller.evaluate((el) => el.getBoundingClientRect().left);

  // 차트 시작 전 마일스톤은 칩·점선이 숨고, 보이는 칩은 차트 왼쪽 경계 오른쪽에 있다.
  await expect(page.getByTestId('milestone-chip-1')).toBeHidden();
  await expect(page.getByTestId('milestone-vline-1')).toBeHidden();
  expect((await page.getByTestId('milestone-chip-2').boundingBox())!.x).toBeGreaterThanOrEqual(chartLeft - 1);
  expect((await page.getByTestId('milestone-vline-2').boundingBox())!.x).toBeGreaterThanOrEqual(chartLeft - 1);

  // 마감일은 차트 안이지만 칩 가운데 정렬로는 왼쪽 경계를 넘는 마일스톤은 차트 왼쪽 끝에 붙는다.
  await expect(page.getByTestId('milestone-chip-3')).toBeVisible();
  expect((await page.getByTestId('milestone-chip-3').boundingBox())!.x).toBeGreaterThanOrEqual(chartLeft - 1);
});

test('툴바 버튼으로 마일스톤 생성', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const posts = trackRequests(page, 'POST', `/api/v1/projects/${KEY}/milestones`);
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
    if (route.request().method() === 'POST') {
      const posted = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 2,
          projectId: 1,
          name: posted.name,
          dueDate: posted.dueDate,
          description: null,
          createdAt: '',
          updatedAt: '',
        }),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-add-button').click();
  await expect(page.getByTestId('milestone-form-dialog')).toBeVisible();
  await page.getByTestId('milestone-name-input').fill('v1.0 베타');
  await page.getByTestId('milestone-due-date-input').fill('2026-07-18');
  await page.getByTestId('milestone-submit').click();
  await expect.poll(() => posts.lastBody()).toMatchObject({ name: 'v1.0 베타', dueDate: '2026-07-18' });
  await expect(page.getByTestId('milestone-form-dialog')).toBeHidden();
});

// WP-687: 이름·설명 칸은 서버 상한(100·2000자)에서 더 입력되지 않는다 — 넘긴 채 저장하면 400 영문 토스트만 떴다.
test('마일스톤 이름·설명은 서버 상한에서 더 입력되지 않고 상한까지 그대로 저장된다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const posts = trackRequests(page, 'POST', `/api/v1/projects/${KEY}/milestones`);
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const posted = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 2, projectId: 1, name: posted.name, dueDate: posted.dueDate, description: posted.description, createdAt: '', updatedAt: '' }),
    });
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-add-button').click();
  await page.getByTestId('milestone-name-input').fill('가'.repeat(101));
  await expect(page.getByTestId('milestone-name-input')).toHaveValue('가'.repeat(100));
  await page.getByLabel('마일스톤 설명').fill('나'.repeat(2001));
  await expect(page.getByLabel('마일스톤 설명')).toHaveValue('나'.repeat(2000));
  await page.getByTestId('milestone-due-date-input').fill('2026-07-18');
  await page.getByTestId('milestone-submit').click();
  await expect.poll(() => (posts.lastBody() as { name?: string } | undefined)?.name?.length).toBe(100);
});

test('팝오버 — 마일스톤 이름도 100자에서 더 입력되지 않는다 (WP-687)', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/milestones/1`);
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const patch = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...baseMilestones()[0], ...patch }) });
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  const nameInput = page.getByTestId('milestone-popover-name-input');
  await nameInput.fill('다'.repeat(101));
  await expect(nameInput).toHaveValue('다'.repeat(100));
  await nameInput.blur();
  await expect.poll(() => (patches.lastBody() as { name?: string } | undefined)?.name?.length).toBe(100);
});

test('레인 빈 곳 클릭 → 클릭 좌표 날짜가 채워진 생성 다이얼로그', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const posts = trackRequests(page, 'POST', `/api/v1/projects/${KEY}/milestones`);
  await page.route(`**/api/v1/projects/${KEY}/milestones`, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-lane').click({ position: { x: 400, y: 16 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dueDateInput = dialog.locator('input[type="date"], input[name="dueDate"]').first();
  await expect(dueDateInput).not.toHaveValue('');
  await expect(dueDateInput).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await page.getByTestId('milestone-name-input').fill('레인 생성 마일스톤');
  await page.getByTestId('milestone-submit').click();
  await expect.poll(() => posts.lastBody()).toMatchObject({ name: '레인 생성 마일스톤' });
});

test('레인 좌측 끝(라벨 근처) 클릭 → 날짜가 클램프되어 비정상(1970년 등) 값이 채워지지 않는다', async ({
  authenticatedPage: page,
}) => {
  // 최종 리뷰 Minor #1 회귀 테스트 — dateFromClientX 가 클램프 없이 음수 offsetX 를 그대로
  // 날짜로 환산하면 "마일스톤" 라벨 근처(레인 좌측 끝) 클릭 시 1970년대 등 비정상 날짜가 채워졌다.
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  // x=2 는 "마일스톤" 라벨 바로 옆(레인 좌측 끝) — 스크롤 컨테이너 기준 offsetX 가 음수가 되는 지점.
  await page.getByTestId('milestone-lane').click({ position: { x: 2, y: 16 } });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const dueDateInput = dialog.locator('input[type="date"], input[name="dueDate"]').first();
  const value = await dueDateInput.inputValue();
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // 클램프된 값은 최소 scales.start 이상이어야 한다 — 1970년 등 음수 offsetX 환산값이면 실패.
  expect(new Date(value).getFullYear()).toBeGreaterThanOrEqual(2020);
});

test('칩 클릭 → 편집 팝오버에서 이름 수정', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/milestones/1`);
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...baseMilestones()[0], ...patch }),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  const popover = page.getByRole('dialog').or(page.getByTestId('milestone-edit-popover'));
  await expect(popover).toBeVisible();
  // 이름은 텍스트가 아니라 Input value 로 렌더된다.
  await expect(page.getByTestId('milestone-popover-name-input')).toHaveValue('v1 출시');
  await expect(popover).toContainText('연결된 이슈 1개 보기');
  await expect(page.getByTestId('milestone-linked-issues-link')).toHaveAttribute(
    'href',
    `/projects/${KEY}?milestone=1`,
  );
  const nameInput = page.getByTestId('milestone-popover-name-input');
  await nameInput.fill('v1 최종 출시');
  await nameInput.blur();
  await expect.poll(() => patches.lastBody()).toMatchObject({ name: 'v1 최종 출시' });
});

test('팝오버 — 이름을 지우고 blur하면 저장 요청 없이 에러 토스트 + 원래 값으로 복원 (#672)', async ({
  authenticatedPage: page,
}) => {
  await setupStubs(page);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/milestones/1`);
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseMilestones()[0]) });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  const nameInput = page.getByTestId('milestone-popover-name-input');
  await nameInput.fill('');
  await nameInput.blur();
  await expect(page.getByText('마일스톤 이름은 비울 수 없습니다.')).toBeVisible();
  await expect(nameInput).toHaveValue('v1 출시');
  expect(patches.count()).toBe(0);
});

test('팝오버 — 이름 변경이 거절되면(중복 409) 오류 토스트 + 입력칸을 원래 이름으로 되돌린다 (WP-615)', async ({
  authenticatedPage: page,
}) => {
  await setupStubs(page);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/milestones/1`);
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ status: 409, message: '이미 존재하는 마일스톤 이름입니다: v2 출시' }),
      });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  const nameInput = page.getByTestId('milestone-popover-name-input');
  await nameInput.fill('v2 출시');
  await nameInput.blur();
  await expect.poll(() => patches.count()).toBe(1);
  await expect(page.getByText('이미 존재하는 마일스톤 이름입니다: v2 출시')).toBeVisible();
  await expect(nameInput).toHaveValue('v1 출시');
});

test('팝오버 — 마감일을 지우고 blur하면 저장 요청 없이 에러 토스트 + 원래 값으로 복원 (#672)', async ({
  authenticatedPage: page,
}) => {
  await setupStubs(page);
  const patches = trackRequests(page, 'PATCH', `/api/v1/projects/${KEY}/milestones/1`);
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(baseMilestones()[0]) });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  const dueDateInput = page.getByTestId('milestone-popover-due-date-input');
  await dueDateInput.fill('');
  await dueDateInput.blur();
  await expect(page.getByText('마감일은 비울 수 없습니다.')).toBeVisible();
  await expect(dueDateInput).toHaveValue('2026-08-01');
  expect(patches.count()).toBe(0);
});

test('팝오버에서 삭제 — AlertDialog 경고 경유', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  const deletes = trackRequests(page, 'DELETE', `/api/v1/projects/${KEY}/milestones/1`);
  await page.route(`**/api/v1/projects/${KEY}/milestones/1`, (route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  await page.getByTestId('milestone-delete-trigger').click();
  await expect(page.getByText('연결된 이슈 1개의 연결이 해제됩니다')).toBeVisible();
  await page.getByRole('button', { name: '삭제' }).last().click();
  await deletes.waitFor();
});

// WP-698 — 삭제 확인 창을 Esc 로 닫으면 확인 창만 닫히고 편집 팝오버는 남는다.
test('팝오버의 삭제 확인 창을 Esc 로 닫으면 팝오버는 남는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page);
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  await page.getByTestId('milestone-delete-trigger').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByTestId('milestone-edit-popover')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('milestone-edit-popover')).toHaveCount(0);
});

test('readOnly(비멤버) — 칩 편집·레인 클릭 생성이 비활성', async ({ authenticatedPage: page }) => {
  await setupStubs(page, { viewerIsMember: false });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await expect(page.getByTestId('milestone-add-button')).toHaveCount(0);
  // 레인 빈 곳 클릭 — readOnly 에서는 handleLaneClick 이 조기 반환해 생성 다이얼로그가 뜨지 않는다.
  await page.getByTestId('milestone-lane').click({ position: { x: 400, y: 16 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('readOnly(비멤버) — 마일스톤 칩 클릭 시 편집 팝오버가 열리지 않는다', async ({ authenticatedPage: page }) => {
  await setupStubs(page, { viewerIsMember: false });
  await page.goto(`/projects/${KEY}/timeline?period=all`);
  await page.getByTestId('milestone-chip-1').click();
  const popover = page.getByRole('dialog').or(page.getByTestId('milestone-edit-popover'));
  await expect(popover).toHaveCount(0);
});
