// 모바일 개인 프로젝트(WP-221) — 팀과 같은 한 줄 툴바(개인 옵션: 뷰 칩·에픽 없음, 그룹 = 없음·상태·우선순위, 체크리스트/보드)와
// 전체 화면 작업 상세(Task 8).
import type { Page } from '@playwright/test';

import { createChatMessagePage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createLabel, toLabelSummary } from '../../factories/label.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';

const KEY = 'PME';
// 실데이터 폭 검증용 긴 제목.
const LONG_TITLE = '연말정산 증빙서류 정리 및 의료비·교육비 공제 항목 누락 여부 재확인 후 회사 제출';
const LABELS = [createLabel({ id: 1, name: '세금' }), createLabel({ id: 2, name: '긴급' })];

/** 개인 프로젝트 + 작업 1건 스텁. PATCH(이슈)·PUT(라벨) 은 캡처해 돌려준다. savedViews 는 요청 기록만 돌려준다. */
async function stubPersonal(page: Page) {
  const issue = createIssue({ projectKey: KEY, number: 1, title: LONG_TITLE, status: 'TODO', labels: [toLabelSummary(LABELS[0])] });
  const savedViewRequests = trackRequests(page, 'ANY', `/api/v1/projects/${KEY}/saved-views`);
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/saved-views`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}`, createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }));
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse([issue]));
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/labels`, LABELS);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/members`, [createMember({ userId: 1, name: '양동희' })]);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/cycles`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/types`, []);
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1`, createIssueDetail({ summary: issue, body: '영수증은 드라이브 「2026 연말정산」 폴더에 있음' }));
  const patch = await mockApi(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`, createIssueDetail({ summary: issue }), { capture: true });
  const putLabels = await mockApi(page, 'PUT', `/api/v1/projects/${KEY}/issues/1/labels`, [], { capture: true });
  const thread = createChatThread();
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues/1/chat/thread`, thread);
  await mockApi(page, 'GET', `/api/v1/chat/threads/${thread.threadId}/messages`, createChatMessagePage([]));
  return { patch, putLabels, savedViewRequests };
}

test.describe('개인 툴바', () => {
  test('뷰 칩·에픽 칩 없이 필터·그룹·검색·체크리스트 토글, 저장 뷰 조회 없음', async ({ authenticatedPage: page }) => {
    const { savedViewRequests } = await stubPersonal(page);
    await page.goto(`/projects/${KEY}`);
    const bar = page.getByTestId('mobile-issue-toolbar');
    await expect(bar).toBeVisible();
    await expect(page.getByTestId('personal-checklist')).toBeVisible();
    await expect(bar.getByTestId('mobile-chip-view')).toHaveCount(0);
    await expect(bar.getByTestId('mobile-chip-epic')).toHaveCount(0);
    await expect(bar.getByTestId('mobile-chip-filter')).toBeVisible();
    await expect(bar.getByTestId('mobile-chip-group')).toHaveText('그룹: 없음');
    await expect(bar.getByTestId('mobile-search-open')).toBeVisible();
    const toggle = bar.getByTestId('mobile-view-toggle');
    await expect(toggle).toHaveAttribute('aria-label', '보드로 전환');
    await toggle.tap();
    await expect(page).toHaveURL(/view=board/);
    await expect(toggle).toHaveAttribute('aria-label', '체크리스트로 전환');
    await expectStays(page, savedViewRequests.count, 0);
    await expectNoHorizontalOverflow(page);
  });

  test('그룹 시트 = 없음·상태·우선순위, 필터 시트에 사이클·유형 없음', async ({ authenticatedPage: page }) => {
    await stubPersonal(page);
    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('mobile-chip-group').tap();
    const group = page.getByTestId('mobile-group-sheet');
    await expect(group.getByRole('option')).toHaveCount(3);
    for (const v of ['none', 'status', 'priority']) await expect(group.getByTestId(`picker-option-${v}`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(group).toBeHidden();

    await page.getByTestId('mobile-chip-filter').tap();
    const sheet = page.getByTestId('mobile-filter-sheet');
    await sheet.getByTestId('add-filter-trigger').tap();
    await expect(page.getByTestId('add-filter-facet-status')).toBeVisible();
    await expect(page.getByTestId('add-filter-facet-cycle')).toHaveCount(0);
    await expect(page.getByTestId('add-filter-facet-type')).toHaveCount(0);
  });
});

test.describe('작업 상세(전체 화면)', () => {
  test('체크리스트 행 탭 → 화면 전체를 덮는 상세, 칩 = 상태·우선순위·마감·담당자·라벨(＋ 속성·에픽 없음)', async ({ authenticatedPage: page }) => {
    await stubPersonal(page);
    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('personal-task-row-1').tap();
    const layer = page.getByTestId('personal-task-mobile');
    await expect(layer).toBeVisible();
    const vp = page.viewportSize()!;
    const box = (await layer.boundingBox())!;
    expect(box.width).toBe(vp.width);
    expect(box.height).toBeGreaterThanOrEqual(vp.height - 1);
    await expect(layer.getByTestId('personal-task-panel-title')).toContainText('연말정산');
    await expect(layer).toContainText('개인 작업'); // 상단 바 프로젝트 이름
    const order = await layer.locator('[data-testid^="mobile-prop-"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-testid')).filter((id) => id !== 'mobile-prop-chips'),
    );
    expect(order).toEqual(['mobile-prop-status', 'mobile-prop-priority', 'mobile-prop-due', 'mobile-prop-assignee', 'mobile-prop-label']);
    await expect(layer.getByTestId('mobile-prop-label')).toContainText('세금');
    await expect(layer).toContainText('영수증은 드라이브'); // 메모(읽기 전용)
    await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('보드 카드 탭도 모달 대신 같은 전체 화면 상세', async ({ authenticatedPage: page }) => {
    await stubPersonal(page);
    await page.goto(`/projects/${KEY}?view=board`);
    await page.getByTestId('issue-card-1').getByRole('link').tap();
    await expect(page.getByTestId('personal-task-mobile')).toBeVisible();
    await expect(page.getByTestId('personal-task-modal')).toHaveCount(0);
  });

  test('상태 칩 → 완료 → PATCH status', async ({ authenticatedPage: page }) => {
    const { patch } = await stubPersonal(page);
    await page.goto(`/projects/${KEY}?task=1`);
    await page.getByTestId('mobile-prop-status').tap();
    const sheet = page.getByTestId('issue-status-sheet');
    await sheet.getByTestId('picker-option-DONE').tap();
    await expect(sheet).toBeHidden();
    await expect.poll(() => patch.requests.map((r) => r.payload)).toContainEqual(expect.objectContaining({ status: 'DONE' }));
  });

  test('라벨 칩 — 그대로 닫으면 요청 없음, 바꾸고 완료하면 PUT 1회', async ({ authenticatedPage: page }) => {
    const { putLabels } = await stubPersonal(page);
    await page.goto(`/projects/${KEY}?task=1`);
    const sheet = page.getByTestId('issue-label-sheet');
    await page.getByTestId('mobile-prop-label').tap();
    await sheet.getByTestId('issue-label-sheet-done').tap();
    await expect(sheet).toBeHidden();
    expect(putLabels.requests).toHaveLength(0);

    await page.getByTestId('mobile-prop-label').tap();
    await sheet.getByTestId('multi-option-2').tap();
    await sheet.getByTestId('issue-label-sheet-done').tap();
    await expect(sheet).toBeHidden();
    await expect.poll(() => putLabels.requests.length).toBe(1);
    expect(putLabels.requests[0].payload).toEqual({ labelIds: [1, 2] });
  });

  test('담당자 칩 — 그대로 완료하면 요청 없음, 바꾸고 완료하면 PUT 1회', async ({ authenticatedPage: page }) => {
    await stubPersonal(page);
    const putAssignees = await mockApi(page, 'PUT', `/api/v1/projects/${KEY}/issues/1/assignees`, [], { capture: true });
    await page.goto(`/projects/${KEY}?task=1`);
    const sheet = page.getByTestId('issue-assignee-sheet');
    await page.getByTestId('mobile-prop-assignee').tap();
    await sheet.getByTestId('issue-assignee-sheet-done').tap();
    await expect(sheet).toBeHidden();
    // 동기 확인만으론 늦게 나가는 요청을 놓친다 — 아래 2단계(바꾼 뒤 정확히 1회)가 앞선 무요청을 함께 보증한다.
    await page.getByTestId('mobile-prop-assignee').tap();
    await sheet.getByTestId('multi-option-1').tap();
    await sheet.getByTestId('issue-assignee-sheet-done').tap();
    await expect(sheet).toBeHidden();
    await expect.poll(() => putAssignees.requests.length).toBe(1);
  });

  test('저장 실패 토스트가 전체 화면 레이어 위에 보인다(z-index)', async ({ authenticatedPage: page }) => {
    const { patch } = await stubPersonal(page);
    // 뒤에 등록한 스텁이 우선 — 속성 PATCH 를 500 으로 실패시킨다.
    await mockApi(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`, { message: 'fail' }, { status: 500 });
    await page.goto(`/projects/${KEY}?task=1`);
    await expect(page.getByTestId('personal-task-mobile')).toBeVisible();
    await page.getByTestId('mobile-prop-status').tap();
    const statusSheet = page.getByTestId('issue-status-sheet');
    await statusSheet.getByTestId('picker-option-DONE').tap();
    await expect(statusSheet).toBeHidden();
    // auth.fixture 가 에러 토스트를 pointer-events:none 으로 꺼 두므로(다른 테스트의 클릭 방해 방지) 이 테스트에서만 되살려 실제 클릭 가능 여부를 본다.
    await page.addStyleTag({ content: '[data-sonner-toast][data-type="error"] { pointer-events: auto !important; }' });
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    // PATCH 는 한 번 나갔고(응답은 뒤에 등록한 500 스텁) 그 실패로 토스트가 떴다.
    expect(patch.requests).toHaveLength(1);
    // 토스트 중앙 좌표의 최상단 요소가 토스트 자신(레이어가 덮지 않음).
    const onTop = await toast.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && el.contains(hit);
    });
    expect(onTop).toBe(true);
    // 시각적으로 위여도 body 가 pointer-events:none 이면 토스트 액션(되돌리기)을 누를 수 없다 — 레이어 Dialog 는 non-modal.
    // 실제 앱의 토스트(되돌리기 버튼)는 body 의 pointer-events 를 상속하므로 body 가 none 이 아니어야 누를 수 있다.
    expect(await page.evaluate(() => document.body.style.pointerEvents)).not.toBe('none');
  });

  test('시스템 뒤로가기·‹ 로 닫힌다 — 800px 에서도 400px 패널 대신 전체 화면', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 800, height: 1000 });
    await stubPersonal(page);
    await page.goto(`/projects/${KEY}`);
    await page.getByTestId('personal-task-row-1').click();
    const layer = page.getByTestId('personal-task-mobile');
    await expect(layer).toBeVisible();
    expect((await layer.boundingBox())!.width).toBe(800);
    await page.goBack();
    await expect(layer).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));

    await page.getByTestId('personal-task-row-1').click();
    await expect(layer).toBeVisible();
    const back = page.getByTestId('personal-task-panel-close');
    const bb = (await back.boundingBox())!;
    expect(bb.width).toBeGreaterThanOrEqual(44);
    expect(bb.height).toBeGreaterThanOrEqual(44);
    await back.click();
    await expect(layer).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
  });

  test('제목 편집 — 하단이 [취소·저장] 바로 바뀌고, Esc 는 편집만 취소(레이어 유지), 저장은 PATCH title', async ({ authenticatedPage: page }) => {
    const { patch } = await stubPersonal(page);
    await page.goto(`/projects/${KEY}?task=1`);
    const layer = page.getByTestId('personal-task-mobile');
    const bottom = layer.getByTestId('personal-task-bottom-bar');
    await expect(bottom.getByTestId('chat-composer')).toBeVisible();

    await layer.getByTestId('issue-title-edit').tap();
    await expect(bottom.getByTestId('mobile-edit-bar')).toBeVisible();
    await expect(bottom.getByTestId('chat-composer')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(layer.getByTestId('issue-title-input')).toHaveCount(0);
    await expect(layer).toBeVisible();
    await expect(bottom.getByTestId('chat-composer')).toBeVisible();

    await layer.getByTestId('issue-title-edit').tap();
    const input = layer.getByTestId('issue-title-input');
    await input.fill('연말정산 서류 제출');
    await bottom.getByTestId('mobile-edit-save').tap();
    await expect.poll(() => patch.requests.map((r) => r.payload)).toContainEqual(expect.objectContaining({ title: '연말정산 서류 제출' }));
    // Esc 취소 때는 PATCH 가 나가지 않았다 — 저장 1건만(Esc 가 저장을 유발했다면 2건).
    expect(patch.requests).toHaveLength(1);
  });

  test('채팅 입력줄은 레이어 맨 아래(본문 스크롤 밖)', async ({ authenticatedPage: page }) => {
    await stubPersonal(page);
    await page.goto(`/projects/${KEY}?task=1`);
    const composer = page.getByTestId('personal-task-bottom-bar').getByTestId('chat-composer');
    await expect(composer).toBeVisible();
    await expect(page.getByTestId('personal-panel-chat').getByTestId('chat-composer')).toHaveCount(0);
    const cb = (await composer.boundingBox())!;
    expect(cb.y + cb.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
  });
});
