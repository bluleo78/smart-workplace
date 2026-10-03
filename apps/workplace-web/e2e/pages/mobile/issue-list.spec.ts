// 모바일 이슈 목록 2줄 행(WP-194) — 긴 제목 가시성·메타 한 줄·에픽 메타 생략 규칙.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

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
const PLAIN = createIssue({ id: 22, number: 22, projectKey: KEY, title: '일반 이슈', priority: 'MID' });
const SUB = createIssue({
  id: 23, number: 23, projectKey: KEY, title: '스토리 하위 이슈',
  parent: { number: 40, title: '스토리 부모', type: { ...makeTaskType(), name: 'STORY' } },
});

// 뷰 시트 테스트용 저장 뷰 — 필드는 src/types/savedView.ts 에 맞춘다.
const MY_BUG_VIEW = {
  id: 5, name: '내 버그', query: 'status=TODO&group=none', visibility: 'PRIVATE', ownerId: 1,
  mine: true, pinned: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

async function mock(page: Page, opts: { views?: unknown[] } = {}) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/members`, `/labels`, `/cycles`]) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/saved-views`, (r) => r.fulfill(json(opts.views ?? [])));
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const isEpicList = new URL(r.request().url()).searchParams.get('type') === String(makeEpicType().id);
    return r.fulfill(json(createIssueSearchResponse(isEpicList ? [] : [LONG, PLAIN, SUB], null)));
  });
}

test.describe('모바일 이슈 목록 2줄 행', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('2줄 행 — 긴 제목이 보이고 메타 줄은 한 줄, 가로 스크롤 없음', async ({ authenticatedPage: page }) => {
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

  test('그룹 「에픽」 안의 행은 에픽 메타를 생략한다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=epic`);
    await expect(page.getByTestId('list-group-epic-30')).toBeVisible();
    await expect(page.getByTestId('issue-row-21')).toBeVisible(); // 양성 대조 — 행은 렌더됨
    await expect(page.getByTestId('issue-row-21-epic')).toHaveCount(0);
  });

  test('특정 에픽으로 필터된 목록은 에픽 메타를 생략한다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none&parent=30`);
    await expect(page.getByTestId('issue-row-21')).toBeVisible();
    await expect(page.getByTestId('issue-row-21-epic')).toHaveCount(0);
  });
});

test.describe('모바일 툴바', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('첫 화면 — 툴바 한 줄, 데스크톱 칩 바 없음, 첫 행이 위쪽에 보인다', async ({ authenticatedPage: page }) => {
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

  test('검색 — 줄 전체가 검색창으로, 취소해도 검색어 유지 + 점 표시', async ({ authenticatedPage: page }) => {
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

  test('그룹 시트 — 에픽으로 묶기', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}`);
    const chip = page.getByTestId('mobile-chip-group');
    await expect(chip).toHaveText('그룹: 없음');
    await chip.click();
    await expect(page.getByTestId('mobile-group-sheet')).toBeVisible();
    await page.getByTestId('picker-option-epic').click();
    await expect(page).toHaveURL(/group=epic/);
    await expect(chip).toHaveText('그룹: 에픽');
    await expect(page.getByTestId('list-group-epic-30')).toBeVisible();
  });

  test('필터 시트 — ＋ 필터로 상태 추가, 칩 개수, 전체 해제', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('mobile-chip-filter').click();
    const sheet = page.getByTestId('mobile-filter-sheet');
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /필터/ }).click();
    await page.getByTestId('add-filter-facet-status').click();
    await page.getByRole('checkbox', { name: '진행 중' }).click();
    await expect(page).toHaveURL(/status=IN_PROGRESS/);
    // 팝오버 → 시트 순서로 닫는다(Escape 는 가장 위 레이어부터 닫힌다).
    // 팝오버 퇴장 애니메이션 동안엔 그 레이어가 Escape 를 받으므로, 사라진 뒤에 두 번째 Escape 를 보낸다.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-filter-facet-status')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId('mobile-chip-filter')).toHaveText('필터 1');
    await page.getByTestId('mobile-chip-filter').click();
    await page.getByTestId('mobile-filter-clear').click();
    await expect(page).not.toHaveURL(/status=/);
  });

  test('뷰 시트 — 저장 뷰 적용, 완료 모두 보기 토글', async ({ authenticatedPage: page }) => {
    await mock(page, { views: [MY_BUG_VIEW] });
    await page.goto(`/projects/${KEY}`);
    const chip = page.getByTestId('mobile-chip-view');
    await expect(chip).toHaveText('전체');
    await chip.click();
    await expect(page.getByTestId('mobile-view-sheet')).toBeVisible();
    await page.getByTestId('mobile-view-option-5').click();
    await expect(page).toHaveURL(/status=TODO/);
    await expect(chip).toHaveText('내 버그');
    // 상태 필터가 있는 뷰는 종료 이슈 숨김을 이미 해제한다(#876) — 토글은 켜진 채 비활성.
    await chip.click();
    const closedToggle = page.getByTestId('mobile-view-closed-toggle');
    await expect(closedToggle).toBeDisabled();
    await expect(closedToggle).toHaveAttribute('aria-checked', 'true');
    // 「전체」로 돌아가 토글을 켜면 closed=all — 토글은 시트를 닫지 않는다.
    await page.getByTestId('mobile-view-option-all').click();
    await expect(chip).toHaveText('전체');
    await chip.click();
    await closedToggle.click();
    await expect(page).toHaveURL(/closed=all/);
    await expect(page.getByTestId('mobile-view-sheet')).toBeVisible();
  });

  test('목록/보드 토글 — 보드로 전환', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}`);
    const toggle = page.getByTestId('mobile-view-toggle');
    await expect(toggle).toHaveAttribute('aria-label', '보드로 전환');
    await toggle.click();
    await expect(page).toHaveURL(/view=board/);
  });
});
