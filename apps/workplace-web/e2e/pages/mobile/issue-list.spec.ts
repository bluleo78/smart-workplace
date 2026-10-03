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
// 에픽 시트용 에픽 2건 — 진행 있는 것(4건 중 1건 완료)과 하위 없는 것.
const EPICS = [
  createIssue({ id: 30, number: 30, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 4, childDoneCount: 1 }),
  createIssue({ id: 12, number: 12, projectKey: KEY, title: '온보딩 개선', type: makeEpicType(), childCount: 0, childDoneCount: 0 }),
];
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

async function mock(page: Page, opts: { views?: unknown[]; member?: boolean } = {}) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: opts.member ?? true }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/members`, `/labels`, `/cycles`]) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/saved-views`, (r) => r.fulfill(json(opts.views ?? [])));
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const isEpicList = new URL(r.request().url()).searchParams.get('type') === String(makeEpicType().id);
    return r.fulfill(json(createIssueSearchResponse(isEpicList ? EPICS : [LONG, PLAIN, SUB], null)));
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

  test('긴 제목은 목록 폭 안에서 줄바꿈된다 — 오른쪽으로 잘리지 않음', async ({ authenticatedPage: page }) => {
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

  test('담당자 미지정 필터(assignee=null) — 필터 개수 1, 시트의 전체 해제로 URL 에서 제거', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none&assignee=null`);
    await expect(page.getByTestId('mobile-chip-filter')).toContainText('필터 1');
    await page.getByTestId('mobile-chip-filter').click();
    await expect(page.getByTestId('mobile-filter-clear')).toBeEnabled();
    await expect(page.getByTestId('mobile-filter-empty')).toHaveCount(0);
    await page.getByTestId('mobile-filter-clear').click();
    await expect(page).not.toHaveURL(/assignee=/);
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

  test('필터 시트 — 필터 없으면 안내 문구, ＋ 필터 팝오버는 아래로 열려 시트 제목을 가리지 않는다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('mobile-chip-filter').click();
    const sheet = page.getByTestId('mobile-filter-sheet');
    await expect(sheet.getByTestId('mobile-filter-empty')).toHaveText('적용된 필터 없음');
    const trigger = sheet.getByTestId('add-filter-trigger');
    await trigger.click();
    const first = page.getByTestId('add-filter-facet-status');
    await expect(first).toBeVisible();
    const tb = (await trigger.boundingBox())!;
    const fb = (await first.boundingBox())!;
    // 팝오버 첫 항목이 트리거 아래에 있다(위로 뒤집혀 시트 제목을 덮지 않음).
    expect(fb.y).toBeGreaterThanOrEqual(tb.y + tb.height);
    await expect(sheet.getByRole('heading', { name: '필터' })).toBeInViewport();
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

  test('저장된 에픽 패널 열림 상태가 있어도 모바일에선 패널을 그리지 않는다', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => localStorage.setItem('epicSidePanel.open.WP', 'true'));
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await expect(page.getByTestId('issue-row-21-title')).toBeVisible();
    await expect(page.getByTestId('epic-side-panel')).toHaveCount(0);
    expect((await page.getByTestId('issue-row-21-title').boundingBox())!.width).toBeGreaterThan(200);
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

test.describe('모바일 에픽 시트', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await stubChat(page);
  });

  test('에픽 선택 → parent 필터 + 칩 라벨, ✕ 로 해제', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('mobile-chip-epic').click();
    const sheet = page.getByTestId('mobile-epic-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('picker-option-all')).toBeVisible();
    await expect(page.getByTestId('picker-option-unassigned')).toBeVisible();
    await expect(page.getByTestId('picker-option-epic-30')).toContainText('1/4');
    await page.getByTestId('picker-option-epic-30').click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/parent=30/);
    await expect(page.getByTestId('mobile-chip-epic')).toContainText('결제 안정화');
    await page.getByTestId('mobile-chip-epic-clear').click();
    await expect(page).not.toHaveURL(/parent=/);
    await expect(page.getByTestId('mobile-chip-epic')).toHaveText('◆ 에픽');
  });

  test('이미 선택된 에픽을 다시 눌러도 필터가 유지된다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('mobile-chip-epic').click();
    await page.getByTestId('picker-option-epic-30').click();
    await expect(page).toHaveURL(/parent=30/);
    await page.getByTestId('mobile-chip-epic').click();
    await page.getByTestId('picker-option-epic-30').click();
    await expect(page.getByTestId('mobile-epic-sheet')).toBeHidden();
    await expect(page).toHaveURL(/parent=30/);
    await expect(page.getByTestId('mobile-chip-epic')).toContainText('결제 안정화');
  });

  test('에픽 칩 ✕ 터치 영역은 32×32 이상, 툴바 높이는 그대로', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none&parent=30`);
    const box = (await page.getByTestId('mobile-chip-epic-clear').boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(32);
    expect(box.height).toBeGreaterThanOrEqual(32);
    expect((await page.getByTestId('mobile-issue-toolbar').boundingBox())!.height).toBeLessThanOrEqual(52);
  });

  test('에픽 범위만 걸리면 뷰 칩은 「전체」', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none&parent=30`);
    await expect(page.getByTestId('mobile-chip-epic')).toContainText('결제 안정화');
    await expect(page.getByTestId('mobile-chip-view')).toHaveText('전체');
    // 대조 — 에픽 외 조건이 더해지면 「사용자 조건」.
    await page.goto(`/projects/${KEY}?group=none&parent=30&status=TODO`);
    await expect(page.getByTestId('mobile-chip-view')).toHaveText('사용자 조건');
  });

  test('에픽 범위만 걸린 상태에서 뷰 시트 「전체」 를 눌러도 에픽 필터가 유지된다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none&parent=30`);
    await page.getByTestId('mobile-chip-view').click();
    await page.getByTestId('mobile-view-option-all').click();
    await expect(page.getByTestId('mobile-view-sheet')).toBeHidden();
    await expect(page).toHaveURL(/parent=30/);
  });

  test('뷰 저장 — 시트가 닫히고 다이얼로그에서 저장하면 현재 조건으로 POST, 이후 화면이 눌린다', async ({ authenticatedPage: page }) => {
    await mock(page);
    let body: { name?: string; query?: string } | null = null;
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/saved-views`, (r) => {
      if (r.request().method() !== 'POST') return r.fallback();
      body = r.request().postDataJSON();
      return r.fulfill(json({ ...MY_BUG_VIEW, id: 9, name: body!.name, query: body!.query }));
    });
    await page.goto(`/projects/${KEY}?group=none&status=TODO`);
    await page.getByTestId('mobile-chip-view').click();
    await page.getByTestId('mobile-view-save').click();
    await expect(page.getByTestId('mobile-view-sheet')).toBeHidden();
    await expect(page.getByTestId('save-view-name')).toBeVisible();
    await page.getByTestId('save-view-name').fill('내 할 일');
    await page.getByTestId('save-view-submit').click();
    await expect(page.getByTestId('save-view-name')).toBeHidden();
    expect(body!.name).toBe('내 할 일');
    expect(body!.query).toContain('status=TODO');
    // 시트·다이얼로그 전환 뒤에도 body 가 잠기지 않고 화면이 눌린다.
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
    await page.getByTestId('mobile-chip-filter').click();
    await expect(page.getByTestId('mobile-filter-sheet')).toBeVisible();
  });

  test('공유 뷰 업데이트 — 확인 후 PATCH 로 새 조건 저장, 이후 화면이 눌린다', async ({ authenticatedPage: page }) => {
    const shared = { ...MY_BUG_VIEW, id: 7, name: '팀 뷰', query: 'priority=HIGH&group=none', visibility: 'SHARED' };
    await mock(page, { views: [shared] });
    let patch: { query?: string } | null = null;
    let patchUrl = '';
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/saved-views/7`, (r) => {
      if (r.request().method() !== 'PATCH') return r.fallback();
      patchUrl = r.request().url();
      patch = r.request().postDataJSON();
      return r.fulfill(json({ ...shared, query: patch!.query }));
    });
    await page.goto(`/projects/${KEY}?${shared.query}`);
    await expect(page.getByTestId('mobile-chip-view')).toHaveText('팀 뷰');
    // 필터(상태)를 하나 더 얹어 dirty 로 만든다.
    await page.getByTestId('mobile-chip-filter').click();
    const filterSheet = page.getByTestId('mobile-filter-sheet');
    await filterSheet.getByTestId('add-filter-trigger').click();
    await page.getByTestId('add-filter-facet-status').click();
    await page.getByRole('checkbox', { name: '진행 중' }).click();
    await expect(page).toHaveURL(/status=IN_PROGRESS/);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('add-filter-facet-status')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(filterSheet).toBeHidden();
    await page.getByTestId('mobile-chip-view').click();
    await page.getByTestId('mobile-view-update').click();
    await expect(page.getByTestId('mobile-view-sheet')).toBeHidden();
    await expect(page.getByTestId('update-view-confirm')).toBeVisible();
    await page.getByTestId('update-view-confirm').click();
    await expect(page.getByTestId('update-view-confirm')).toBeHidden();
    expect(patchUrl).toContain('/saved-views/7');
    expect(patch!.query).toContain('status=IN_PROGRESS');
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
    await page.getByTestId('mobile-chip-filter').click();
    await expect(page.getByTestId('mobile-filter-sheet')).toBeVisible();
  });

  test('에픽 미할당 선택 → topLevel 필터', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('mobile-chip-epic').click();
    await page.getByTestId('picker-option-unassigned').click();
    await expect(page).toHaveURL(/topLevel=true/);
    await expect(page.getByTestId('mobile-chip-epic')).toContainText('에픽 미할당');
  });

  test('멤버는 시트에서 에픽 만들기 → 생성 다이얼로그, 비멤버는 버튼 없음', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('mobile-chip-epic').click();
    await page.getByTestId('mobile-epic-create').click();
    await expect(page.getByTestId('mobile-epic-sheet')).toBeHidden();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('비멤버에겐 에픽 만들기 버튼이 없다', async ({ authenticatedPage: page }) => {
    await mock(page, { member: false });
    await page.goto(`/projects/${KEY}?group=none`);
    await page.getByTestId('mobile-chip-epic').click();
    await expect(page.getByTestId('mobile-epic-sheet')).toBeVisible();
    await expect(page.getByTestId('mobile-epic-create')).toHaveCount(0);
  });

  test('목록에 없는 에픽 번호로 진입하면 칩에 번호를 표시한다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?group=none&parent=99`);
    await expect(page.getByTestId('mobile-chip-epic')).toContainText('에픽 #99');
  });
});
