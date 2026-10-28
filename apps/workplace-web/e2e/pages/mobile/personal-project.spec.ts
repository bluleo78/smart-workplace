// 모바일 개인 프로젝트(WP-221) — 팀과 같은 한 줄 툴바(개인 옵션: 뷰 칩·에픽 없음, 그룹 = 없음·상태·우선순위, 체크리스트/보드)와
// 전체 화면 작업 상세(Task 8).
// 브라우저가 있어야 판정되는 전체 화면 레이어·토스트 겹침·입력줄 위치·행 폭과 시스템 뒤로가기만 남긴다. 툴바 구성·그룹 시트·보드 카드 → 상세,
// 속성 칩 저장(상태·라벨·라벨 만들기·담당자)·제목 편집은 페이지 테스트 src/pages/mobile/personalProject.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test';

import { createChatMessagePage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createLabel, toLabelSummary } from '../../factories/label.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { mockApi } from '../../fixtures/api-mock';
import { expect, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture';
import { trackRequests } from '../../fixtures/requests';

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

test.describe('작업 상세(전체 화면)', () => {
  test('체크리스트 행 탭 → 화면 전체를 덮는 상세, 칩 = 상태·우선순위·마감·담당자·반복·라벨(＋ 속성·에픽 없음, 반복은 WP-989)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
    expect(order).toEqual(['mobile-prop-status', 'mobile-prop-priority', 'mobile-prop-due', 'mobile-prop-assignee', 'mobile-prop-recurrence', 'mobile-prop-label']);
    await expect(layer.getByTestId('mobile-prop-label')).toContainText('세금');
    await expect(layer).toContainText('영수증은 드라이브'); // 메모(읽기 전용)
    await expect(page.getByTestId('personal-task-panel')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('저장 실패 토스트가 전체 화면 레이어 위에 보인다(z-index)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    const { patch } = await stubPersonal(page);
    // 뒤에 등록한 스텁이 우선 — 속성 PATCH 를 500 으로 실패시킨다.
    await mockApi(page, 'PATCH', `/api/v1/projects/${KEY}/issues/1`, { message: 'fail' }, { status: 500 });
    await page.goto(`/projects/${KEY}?task=1`);
    await expect(page.getByTestId('personal-task-mobile')).toBeVisible();
    await page.getByTestId('mobile-prop-status').tap();
    const statusSheet = page.getByTestId('issue-status-sheet');
    await statusSheet.getByTestId('picker-option-3').tap();
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

  test('시스템 뒤로가기·‹ 로 닫힌다 — 800px 에서도 400px 패널 대신 전체 화면', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

  test('채팅 입력줄은 레이어 맨 아래(본문 스크롤 밖)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubPersonal(page);
    await page.goto(`/projects/${KEY}?task=1`);
    const composer = page.getByTestId('personal-task-bottom-bar').getByTestId('chat-composer');
    await expect(composer).toBeVisible();
    await expect(page.getByTestId('personal-panel-chat').getByTestId('chat-composer')).toHaveCount(0);
    const cb = (await composer.boundingBox())!;
    expect(cb.y + cb.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 2);
  });
});

// 개인 목록 모바일 행(WP-918) — 레이블은 1개 + +N, 긴 제목도 7rem(112px) 이상 남고 가로로 넘치지 않는다.
test('개인 목록 모바일 행 — 레이블 5개면 칩 1개와 +4, 제목 폭 ≥ 112px', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubPersonal(page);
  const labels = ['세금', '긴급', '가족', '병원', '보험'].map((name, i) => toLabelSummary(createLabel({ id: i + 1, name })));
  // 뒤에 등록한 스텁이 우선 — 레이블 5개·긴 제목 작업 1건으로 목록을 바꾼다.
  await mockApi(page, 'GET', `/api/v1/projects/${KEY}/issues`, createIssueSearchResponse([
    createIssue({ projectKey: KEY, number: 1, title: LONG_TITLE, status: 'TODO', dueDate: '2020-01-10', labels }),
  ]));
  await page.goto(`/projects/${KEY}`);
  const meta = page.getByTestId('personal-task-labels-1');
  await expect(meta).toBeVisible();
  await expect(meta).toContainText('세금');
  await expect(meta).not.toContainText('긴급');
  await expect(meta).toContainText('+4');
  const title = page.getByTestId('personal-task-title-1');
  expect((await title.boundingBox())!.width).toBeGreaterThanOrEqual(112);
  await expectNoHorizontalOverflow(page);
});
