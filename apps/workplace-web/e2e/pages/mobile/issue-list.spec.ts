// 모바일 이슈 목록 2줄 행(WP-194)·툴바·에픽 시트 E2E.
// 브라우저가 있어야 판정되는 것만 남긴다 — 폭·줄 수·터치 크기·팝오버 위치(@layout), 검색창 포커스(@input),
// 히스토리 표식·시트를 닫고 상세로 가는 히스토리 이동(@platform), 목록 진입 대표 흐름(@wiring).
// 행 메타 규칙(에픽 메타 생략·높음만 표시), 그룹·필터·뷰·에픽 시트의 URL 반영·칩 라벨, 저장 뷰 POST·PATCH payload,
// 권한별 버튼(비멤버·남의 공유 뷰), 종료된 에픽 구역·검색은 페이지 테스트 src/pages/mobile/issueList.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { serverEpicFilter } from '../../fixtures/epic-search';
import { expect, expectNoHorizontalOverflow, historyMarks, stubChat, test } from '../../fixtures/mobile.fixture';
import { expectSelectedRow } from '../../fixtures/selection';
import type { IssueResponse } from '../../../src/types/issue';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const epicRef = { number: 30, title: '결제 안정화 및 운영 모니터링 체계 정비 (2026 하반기 핵심 과제)', type: makeEpicType() };
const user = (id: number, name: string) => ({ id, username: `u${id}`, name, kind: 'HUMAN' as const });

// 긴 제목 + 에픽 부모 + 높음 + 마감 + 하위 진행 + 라벨 3 + 담당자 4 — 한 행에 메타가 가장 많은 최악의 경우.
const LONG = createIssue({
  id: 21, number: 21, projectKey: KEY,
  title: '결제 모듈에서 환불 처리 시 간헐적으로 실패하는 문제의 원인을 분석하고 재시도 로직을 보강한다 — 운영 로그 기준 재현',
  parent: epicRef, priority: 'HIGH', dueDate: '2026-10-10', childCount: 3, childDoneCount: 1,
  labels: [
    { id: 1, name: '결제', colorToken: 'BLUE' },
    { id: 2, name: '버그', colorToken: 'RED' },
    { id: 3, name: '운영', colorToken: 'GREEN' },
  ],
  assignees: [user(1, '김하나'), user(2, '이둘'), user(3, '박셋'), user(4, '최넷')],
});
// 에픽 시트용 에픽 3건 — 진행 있는 것(4건 중 1건 완료), 하위 없는 것, 숫자가 긴 것(정렬 확인용).
const EPICS = [
  createIssue({ id: 30, number: 30, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 4, childDoneCount: 1 }),
  createIssue({ id: 12, number: 12, projectKey: KEY, title: '온보딩 개선', type: makeEpicType(), childCount: 0, childDoneCount: 0 }),
  createIssue({ id: 31, number: 31, projectKey: KEY, title: '레거시 이관', type: makeEpicType(), childCount: 125, childDoneCount: 10 }),
];
const PLAIN = createIssue({ id: 22, number: 22, projectKey: KEY, title: '일반 이슈', priority: 'MID' });
const SUB = createIssue({
  id: 23, number: 23, projectKey: KEY, title: '스토리 하위 이슈',
  parent: { number: 40, title: '스토리 부모', type: { ...makeTaskType(), name: 'STORY' } },
});


// 종료된 에픽(WP-245) — 에픽 조회에 status=DONE,CANCELED 가 오면 돌려주는 목록. 번호는 진행 중 EPICS 와 겹치지 않게 52·53.
const CLOSED_EPICS = [
  createIssue({ id: 52, number: 52, projectKey: KEY, title: '팀 채팅 1차', type: makeEpicType(), status: 'DONE' }),
  createIssue({ id: 53, number: 53, projectKey: KEY, title: '구 메신저 연동', type: makeEpicType(), status: 'CANCELED' }),
];

async function mock(
  page: Page,
  // activeCycle: 진행 중 사이클에 할당된 에픽 번호(WP-389) — 에픽 조회는 serverEpicFilter 로 서버처럼 거른다.
  opts: { views?: unknown[]; member?: boolean; closedEpics?: IssueResponse[]; epics?: IssueResponse[]; activeCycle?: number[] } = {},
) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: opts.member ?? true }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/members`, `/labels`, `/cycles`]) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/saved-views`, (r) => r.fulfill(json(opts.views ?? [])));
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const sp = new URL(r.request().url()).searchParams;
    const isEpicList = sp.get('type') === String(makeEpicType().id);
    // 에픽 조회 — 종료 구역(status=DONE,CANCELED)·위쪽 목록(hideInactiveClosed)을 서버처럼 거른다. closedEpics 기본 [] (구역 없음).
    const body = isEpicList
      ? serverEpicFilter(new URL(r.request().url()), [...(opts.epics ?? EPICS), ...(opts.closedEpics ?? [])], opts.activeCycle)
      : [LONG, PLAIN, SUB];
    return r.fulfill(json(createIssueSearchResponse(body as never[], null)));
  });
}

test.describe('모바일 이슈 목록 2줄 행', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('2줄 행 — 긴 제목이 보이고 메타 줄은 한 줄, 가로 스크롤 없음', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    const title = page.getByTestId('issue-row-21-title');
    await expect(title).toBeVisible();
    expect((await title.boundingBox())!.width).toBeGreaterThan(200);
    const meta = page.getByTestId('issue-row-21-meta');
    await expect(meta).toContainText(`${KEY}-21`);
    await expect(meta).toContainText('높음');
    await expect(meta).toContainText('1/3');
    const box = (await meta.boundingBox())!;
    expect(box.height).toBeLessThan(24); // 한 줄 말줄임
    await expect(page.getByTestId('issue-row-21-epic')).toContainText('결제 안정화');
    await expect(page.getByTestId('issue-row-22-meta')).not.toContainText('보통'); // 높음만 표시
    await expect(page.getByTestId('issue-row-23-epic')).toHaveCount(0); // STORY 부모는 ◆ 아님
    await expect(page.locator('thead')).toBeHidden();
    await expectNoHorizontalOverflow(page);
  });

  test('긴 제목은 목록 폭 안에서 줄바꿈된다 — 오른쪽으로 잘리지 않음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    const title = page.getByTestId('issue-row-21-title');
    const scroll = page.getByTestId('issue-list-scroll');
    await expect(title).toBeVisible();
    const t = (await title.boundingBox())!;
    const c = (await scroll.boundingBox())!;
    // 제목 오른쪽 끝이 스크롤 컨테이너 안에 있어야 한다(표가 컨테이너보다 넓어 잘리면 실패).
    expect(t.x + t.width).toBeLessThanOrEqual(c.x + c.width + 0.5);
    // 제목 자체도, 목록 컨테이너도 가로로 넘치지 않는다.
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
});

test.describe('모바일 툴바', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('첫 화면 — 툴바 한 줄, 데스크톱 칩 바 없음, 첫 행이 위쪽에 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}`);
    const toolbar = page.getByTestId('mobile-issue-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(page.getByTestId('issue-row-21')).toBeVisible();
    expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(52);
    await expect(page.getByTestId('view-chip-bar')).toHaveCount(0);
    await expect(page.getByTestId('epic-panel-toggle')).toHaveCount(0);
    expect((await page.getByTestId('issue-row-21').boundingBox())!.y).toBeLessThanOrEqual(150);
    await expectNoHorizontalOverflow(page);
  });

  test('검색 — 줄 전체가 검색창으로, 취소해도 검색어 유지 + 점 표시', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('mobile-search-open').click();
    const input = page.getByTestId('mobile-search-input');
    await expect(input).toBeFocused();
    await input.fill('환불');
    await expect(page).toHaveURL(/q=%ED%99%98%EB%B6%88/);
    await page.getByTestId('mobile-search-cancel').click();
    await expect(page.getByTestId('mobile-chip-view')).toBeVisible();
    await expect(page.getByTestId('mobile-search-dot')).toBeVisible();
    await expect(page).toHaveURL(/q=%ED%99%98%EB%B6%88/);
    await page.getByTestId('mobile-search-open').click();
    await expect(page.getByTestId('mobile-search-input')).toHaveValue('환불');
  });

  // WP-1020 — 툴바 아래 빠른 필터 칩 줄은 넘치면 가로로 스크롤되고(세로로 꺾이지 않음), 걸린 칩은 맨 앞이라 늘 화면 안에 보인다.
  test('빠른 필터 칩 줄 — 한 줄 가로 스크롤, 걸린 칩은 맨 앞에서 화면 안에 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?priority=HIGH`);
    const row = page.getByTestId('mobile-quick-filter-row');
    const applied = page.getByTestId('mobile-quick-filter-priority');
    await expect(applied).toHaveAttribute('data-active', 'true');
    await expect(applied).toBeInViewport({ ratio: 1 });
    // 칩은 모두 한 줄 — 첫 칩과 마지막(「더 보기」) 칩의 세로 위치가 같고, 줄은 가로로 넘친다.
    const more = page.getByTestId('mobile-quick-filter-more');
    const [a, m] = [(await applied.boundingBox())!, (await more.boundingBox())!];
    expect(Math.abs(a.y - m.y)).toBeLessThanOrEqual(1);
    const overflow = await row.evaluate((el) => {
      const scroller = el.firstElementChild as HTMLElement;
      return scroller.scrollWidth > scroller.clientWidth;
    });
    expect(overflow).toBe(true);
  });
});

test.describe('모바일 에픽 시트', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('에픽 행 끝 「›」 — 시트를 닫고 필터 없이 에픽 상세로 이동, 전체·미할당 행엔 없음 (WP-227)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('mobile-chip-epic').click();
    const sheet = page.getByTestId('mobile-epic-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('picker-option-all-detail')).toHaveCount(0);
    await expect(page.getByTestId('picker-option-unassigned-detail')).toHaveCount(0);
    const detail = page.getByTestId('picker-option-epic-30-detail');
    await expect(detail).toHaveAccessibleName('결제 안정화 상세 열기');
    // 터치 영역 44×44 이상.
    const box = (await detail.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    // 「›」 가 생겨도 제목·진행 힌트는 그대로 보인다.
    await expect(page.getByTestId('picker-option-epic-30')).toContainText('1/4');
    await expect(sheet).toHaveJSProperty('scrollWidth', await sheet.evaluate((el) => el.clientWidth));
    await detail.click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/30$`));
  });

  test('진행 바는 숫자 길이·선택(✓) 여부와 상관없이 줄마다 같은 자리에 선다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    // 30 을 선택해 둔다 — 선택된 줄에만 ✓ 가 붙어도 바가 밀리지 않아야 한다.
    await page.goto(`/projects/${KEY}?group=none&parent=30`);
    await page.getByTestId('mobile-chip-epic').click();
    const sheet = page.getByTestId('mobile-epic-sheet');
    await expect(sheet.getByTestId('picker-option-epic-30')).toHaveAttribute('aria-selected', 'true');
    const boxes = await Promise.all(
      [30, 12, 31].map(async (n) => (await sheet.getByTestId(`picker-option-epic-${n}`).getByRole('progressbar').boundingBox())!),
    );
    for (const b of boxes.slice(1)) expect(b.x).toBeCloseTo(boxes[0].x, 0);
    // WP-368 — 시트에서 현재 고른 에픽 행만 선택 전용 표시(막대 + bg-selected). 상세(›) 버튼이 붙는 행은 바깥 래퍼(행 버튼의 부모)가 맡는다.
    await expectSelectedRow(sheet.getByTestId('picker-option-epic-30').locator('..'), sheet.getByTestId('picker-option-epic-12').locator('..'));
  });

  test('에픽 칩 ✕ 터치 영역은 32×32 이상, 툴바 높이는 그대로', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none&parent=30`);
    const box = (await page.getByTestId('mobile-chip-epic-clear').boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
    expect((await page.getByTestId('mobile-issue-toolbar').boundingBox())!.height).toBeLessThanOrEqual(52);
  });

  test('에픽 만들기 시트를 취소로 닫으면(닫기 = 언마운트) 히스토리 표식이 남지 않는다(WP-222)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('mobile-chip-epic').click();
    await page.getByTestId('mobile-epic-create').click();
    const sheet = page.getByTestId('issue-create-sheet');
    await expect(sheet).toBeVisible();
    await expect.poll(() => historyMarks(page)).toContain('issueCreate');
    await page.getByTestId('issue-create-cancel').click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => historyMarks(page)).not.toContain('issueCreate');
  });

  // 종료 구역 펼침·필터·URL 진입 라벨은 src/pages/mobile/issueList.test.tsx 가 지킨다. 여기선 「›」 이동만 —
  // 시트가 쌓은 히스토리 항목을 되돌린 뒤 상세로 push 하는 흐름이라 실제 브라우저 히스토리에서만 판정된다.
  test('종료된 에픽 행 끝 「›」 — 시트를 닫고 그 에픽 상세로 이동한다 (WP-245)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await mock(page, { closedEpics: CLOSED_EPICS });
    await page.goto(`/projects/${KEY}?group=none&parent=52`);
    await page.getByTestId('mobile-chip-epic').click();
    await expect(page.getByTestId('mobile-epic-closed-53')).toBeVisible();

    // 「›」 = 시트 닫고 상세
    await page.getByTestId('mobile-epic-closed-53-detail').click();
    await expect(page).toHaveURL(/\/issues\/53$/);
  });
});
