// 모바일 보드 — 프로젝트 상태별 탭·범주 색 띠·현재 탭 ⋯ 바텀시트(이름 변경·이 뒤에 상태 추가) (WP-808).
// 백엔드 없이 page.route 로 모킹 — 상태 목록은 POST·PATCH 를 반영하는 상태 있는 목으로 둔다(추가·이름 변경 뒤 재조회).

import type { Page } from '@playwright/test';

import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { makeProjectStatus, withCustomStatuses } from '../../factories/projectStatus.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { trackRequests } from '../../fixtures/requests';
import type { IssueResponse } from '../../../src/types/issue';
import type { ProjectStatus } from '../../../src/types/projectStatus';

const KEY = 'WP';
const ISSUES_PATH = `/api/v1/projects/${KEY}/issues`;
const STATUSES_PATH = `/api/v1/projects/${KEY}/statuses`;

// 8개 상태 — 할 일(1) · 진행 중(2)·설계(11)·리뷰 대기(12)·배포 대기(13) · 완료(3)·배포 완료(14) · 취소(4).
function boardStatuses(): ProjectStatus[] {
  return [
    ...withCustomStatuses('설계', '리뷰 대기', '배포 대기'),
    makeProjectStatus({ id: 14, name: '배포 완료', category: 'DONE', position: 7 }),
  ];
}

const PROG = createIssue({ id: 1, number: 1, projectKey: KEY, title: '진행 중인 일', statusId: 2, statusName: '진행 중', status: 'IN_PROGRESS' });
const REVIEW = createIssue({ id: 2, number: 2, projectKey: KEY, title: '리뷰할 것', statusId: 12, statusName: '리뷰 대기', status: 'IN_PROGRESS' });

// 프로젝트·멤버·상태·이슈 검색 목. 상태 목록은 POST(추가)·PATCH(이름 변경)를 반영해 다음 GET 에 돌려준다.
async function stubBoard(
  page: Page,
  {
    role = 'OWNER',
    statuses = boardStatuses(),
    issues = [PROG, REVIEW],
  }: { role?: 'OWNER' | 'MEMBER'; statuses?: ProjectStatus[]; issues?: IssueResponse[] } = {},
) {
  await stubChat(page);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }));
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, [createMember({ userId: 1, role })]);
  await page.route(`**${STATUSES_PATH}`, async (route) => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: statuses });
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { name: string; category: ProjectStatus['category']; afterStatusId?: number };
      const created = makeProjectStatus({ id: 20 + statuses.length, name: body.name, category: body.category, position: 50 });
      statuses.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    return route.fallback();
  });
  await page.route(`**${STATUSES_PATH}/*`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    const s = statuses.find((x) => x.id === id)!;
    s.name = (route.request().postDataJSON() as { name: string }).name;
    return route.fulfill({ json: s });
  });
  // 이슈 검색 — 컬럼 쿼리는 statusId 하나로 좁혀 온다. 서버처럼 그 상태 이슈만 돌려준다. 생성(POST)은 상세 하나를 돌려준다.
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: createIssueDetail({ summary: createIssue({ id: 99, number: 99, projectKey: KEY }) }) });
      if (route.request().method() !== 'GET') return route.fallback();
      const ids = (new URL(route.request().url()).searchParams.get('statusId') ?? '').split(',').filter(Boolean).map(Number);
      const items = issues.filter((i) => ids.length === 0 || ids.includes(i.statusId));
      return route.fulfill({ json: createIssueSearchResponse(items) });
    },
  );
  return statuses;
}

// 탭 순서(statusId) — 탭 줄 안의 role=tab 만 센다(board-tab-band-·count- 같은 접두 testid 와 섞이지 않게).
async function tabIds(page: Page) {
  return page
    .getByTestId('board-tabs')
    .getByRole('tab')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-testid')!.replace('board-tab-', ''))));
}

test.describe('모바일 보드 — 프로젝트 상태 탭(WP-808)', () => {
  test('탭이 상태 목록을 따르고 범주 색 띠가 있다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    await page.goto(`/projects/${KEY}?view=board&group=none`);

    await expect.poll(() => tabIds(page)).toEqual([1, 2, 11, 12, 13, 3, 14, 4]);
    // 기본 탭 = 진행 중 범주의 첫 상태 → 첫 로드 뒤 URL 에 statusId 로 고정.
    await expect(page.getByTestId('board-tab-2')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/boardTab=2(&|$)/);
    await expect(page.getByTestId('issue-card-1')).toBeVisible();
    await expect(page.getByTestId('issue-card-2')).toHaveCount(0);
    await expect(page.getByTestId('board-tab-12')).toContainText('리뷰 대기');
    await expect(page.getByTestId('board-tab-count-12')).toHaveText('1');

    // 범주 색 띠 — 같은 범주는 같은 색, 범주가 다르면 다른 색.
    const bg = (id: number) => page.getByTestId(`board-tab-band-${id}`).evaluate((el) => getComputedStyle(el).borderTopColor);
    expect(await bg(2)).toBe(await bg(12));
    expect(await bg(3)).toBe(await bg(14));
    expect(await bg(2)).not.toBe(await bg(1));
    expect(await bg(2)).not.toBe(await bg(3));

    // 탭을 누르면 그 상태 카드만, URL 은 statusId.
    await page.getByTestId('board-tab-12').click();
    await expect(page).toHaveURL(/boardTab=12/);
    await expect(page.getByTestId('issue-card-2')).toBeVisible();
    await expect(page.getByTestId('issue-card-1')).toHaveCount(0);
  });

  test('빈 탭의 「이슈 추가」는 그 탭 상태로 만든다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const creates = trackRequests(page, 'POST', ISSUES_PATH);
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=13`);
    await page.getByTestId('board-col-add-13').click();
    await page.getByTestId('issue-create-title').fill('배포 체크리스트');
    await page.getByTestId('issue-create-submit').click();
    await expect.poll(() => creates.lastBody<{ statusId?: number }>()?.statusId).toBe(13);
  });

  test('⋯ 바텀시트로 이 뒤에 상태를 추가한다', async ({ authenticatedPage: page }) => {
    const statuses = await stubBoard(page);
    const posts = trackRequests(page, 'POST', STATUSES_PATH);
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=12`);

    const menu = page.getByTestId('board-tab-menu');
    const box = (await menu.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await menu.click();
    const sheet = page.getByTestId('mobile-status-sheet');
    await expect(sheet).toContainText('리뷰 대기');
    await expect(sheet).toContainText('진행 중');
    await page.getByTestId('mobile-action-status-add-after').click();

    const nameSheet = page.getByTestId('mobile-status-name-sheet');
    await expect(nameSheet).toContainText('범주 진행 중');
    const input = nameSheet.getByTestId('status-name-input');
    await expect(input).toBeFocused();
    // iOS 자동 확대 방지 — 16px 이상, 저장 버튼은 44px 이상.
    expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    expect((await nameSheet.getByTestId('status-name-submit').boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // 30자 초과는 저장하지 않고 입력 아래 오류.
    await input.fill('가'.repeat(31));
    await nameSheet.getByTestId('status-name-submit').click();
    await expect(nameSheet.getByTestId('status-name-error')).toContainText('30자');
    expect(posts.count()).toBe(0);

    await input.fill('QA 대기');
    await nameSheet.getByTestId('status-name-submit').click();
    await expect.poll(() => posts.lastBody()).toEqual({ name: 'QA 대기', category: 'IN_PROGRESS', afterStatusId: 12 });
    await expect(nameSheet).toHaveCount(0);
    // 목이 만든 상태의 id 로 단언한다(id 규칙에 기대지 않게).
    const created = statuses.find((x) => x.name === 'QA 대기')!;
    const newTab = page.getByTestId(`board-tab-${created.id}`);
    await expect(newTab).toContainText('QA 대기');
    // 상태 목록 재조회가 끝난 뒤 새 탭이 선택되고 탭 줄에 보인다 — 기본 탭 고정이 되돌리지 않는다.
    await expect(newTab).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(new RegExp(`boardTab=${created.id}(&|$)`));
    await expect(newTab).toBeInViewport({ ratio: 0.95 });
    await expect(page.getByTestId('board-tab-header')).toContainText('QA 대기');
  });

  test('⋯ 바텀시트로 이름을 바꾼다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    const patches = trackRequests(page, 'PATCH', `${STATUSES_PATH}/12`);
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=12`);

    await page.getByTestId('board-tab-menu').click();
    await page.getByTestId('mobile-action-status-rename').click();
    const nameSheet = page.getByTestId('mobile-status-name-sheet');
    const input = nameSheet.getByTestId('status-name-input');
    await expect(input).toHaveValue('리뷰 대기');

    // 다른 상태와 같은 이름(대소문자·공백 무시)은 그 자리 오류, 시트는 열린 채.
    await input.fill(' 설계 ');
    await nameSheet.getByTestId('status-name-submit').click();
    await expect(nameSheet.getByTestId('status-name-error')).toContainText('이미 존재하는 상태 이름입니다');
    expect(patches.count()).toBe(0);

    await input.fill('코드 리뷰');
    await nameSheet.getByTestId('status-name-submit').click();
    await expect.poll(() => patches.lastBody()).toEqual({ name: '코드 리뷰' });
    await expect(nameSheet).toHaveCount(0);
    await expect(page.getByTestId('board-tab-12')).toContainText('코드 리뷰');
    await expect(page.getByTestId('board-tab-header')).toContainText('코드 리뷰');
  });

  test('서버가 거절하면(409) 오류를 시트 안에 보이고 입력을 유지한다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    await page.route(`**${STATUSES_PATH}`, (route) =>
      route.request().method() === 'POST'
        // 서버 문구는 「…: 이름」 꼴 — 입력기는 409 를 클라이언트 중복 문구로 보인다.
        ? route.fulfill({ status: 409, json: { status: 409, message: '이미 존재하는 상태 이름입니다: 동시 추가' } })
        : route.fallback(),
    );
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=2`);
    await page.getByTestId('board-tab-menu').click();
    await page.getByTestId('mobile-action-status-add-after').click();
    const nameSheet = page.getByTestId('mobile-status-name-sheet');
    await nameSheet.getByTestId('status-name-input').fill('동시 추가');
    await nameSheet.getByTestId('status-name-submit').click();
    await expect(nameSheet.getByTestId('status-name-error')).toHaveText('이미 존재하는 상태 이름입니다');
    await expect(nameSheet.getByTestId('status-name-input')).toHaveValue('동시 추가');
  });

  test('MEMBER 는 ⋯ 편집 항목이 없고 헤더 줄에서 긴 이름 전체를 본다', async ({ authenticatedPage: page }) => {
    const long = '고객사 보안 검토 및 법무 승인 대기 중인 배포 후보군';
    const statuses = [...withCustomStatuses(long), makeProjectStatus({ id: 14, name: '배포 완료', category: 'DONE', position: 5 })];
    await stubBoard(page, { role: 'MEMBER', statuses });
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=11`);
    await expect(page.getByTestId('board-tab-11')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('board-tab-menu')).toHaveCount(0);
    // 헤더 줄은 MEMBER 에게도 있다 — 탭에서 잘린 30자 이름 전체를 말줄임 없이 보인다(최대 2줄).
    const name = page.getByTestId('board-tab-header').getByTitle(long);
    await expect(name).toHaveText(long);
    expect(await name.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expectNoHorizontalOverflow(page);
  });

  test('「상태」 필터(statusId)로 고른 상태 탭만 보인다', async ({ authenticatedPage: page }) => {
    await stubBoard(page);
    await page.goto(`/projects/${KEY}?view=board&group=none&statusId=12,3`);
    await expect.poll(() => tabIds(page)).toEqual([12, 3]);
    // 진행 중(2)이 숨겨져 진행 중 범주의 보이는 첫 상태가 기본.
    await expect(page.getByTestId('board-tab-12')).toHaveAttribute('aria-selected', 'true');
  });

  test('30자 이름 7탭에서도 가로 넘침이 없다', async ({ authenticatedPage: page }) => {
    const long1 = '고객사 보안 검토 및 법무 승인 대기 중인 배포 후보군';
    const long2 = '운영 반영 전 성능 회귀 측정과 장애 대응 리허설 진행';
    expect([...long1].length).toBe(30);
    expect([...long2].length).toBe(30);
    const statuses = [
      ...withCustomStatuses(long1, long2),
      makeProjectStatus({ id: 14, name: '배포 완료', category: 'DONE', position: 6 }),
    ];
    await stubBoard(page, { statuses, issues: [createIssue({ id: 5, number: 5, projectKey: KEY, title: '긴 상태의 이슈', statusId: 11, statusName: long1, status: 'IN_PROGRESS' })] });
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=11`);
    await expect.poll(() => tabIds(page)).toEqual([1, 2, 11, 12, 3, 14, 4]);
    await expect(page.getByTestId('issue-card-5')).toBeVisible();
    // 긴 이름 탭은 말줄임(전체 이름은 title) — 탭 하나가 화면 폭을 다 먹지 않는다.
    expect((await page.getByTestId('board-tab-11').boundingBox())!.width).toBeLessThan(220);
    await expect(page.getByTestId('board-tab-11').getByTitle(long1)).toBeVisible();
    // 현재 탭 헤더도 긴 이름을 줄여 ⋯ 가 화면 안에 남는다.
    const menu = (await page.getByTestId('board-tab-menu').boundingBox())!;
    expect(menu.x + menu.width).toBeLessThanOrEqual(390);
    await expectNoHorizontalOverflow(page);

    // 화면 밖에 있는 탭이 선택되면(새로고침·스와이프) 탭 줄이 그 탭을 보이게 스크롤한다.
    await page.goto(`/projects/${KEY}?view=board&group=none&boardTab=4`);
    await expect(page.getByTestId('board-tab-4')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('board-tab-4')).toBeInViewport({ ratio: 0.95 });
    await expectNoHorizontalOverflow(page);
  });
});
