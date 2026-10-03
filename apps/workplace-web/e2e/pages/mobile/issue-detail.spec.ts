// 모바일 이슈 상세(WP-196) — 제목 아래 속성 칩 · 「＋ 속성」 시트 · 첨부/하위 태스크 · 하단 코멘트 입력/편집 바.
import type { Page, Route } from '@playwright/test';

import type { IssueResponse } from '../../../src/types/issue';
import { createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}/issues/7`;
const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
type Call = { method: string; path: string; body: unknown };

const EPIC = createIssue({
  id: 50, number: 50, projectKey: KEY, type: makeEpicType(), childCount: 3, childDoneCount: 1,
  title: '결제 시스템 전면 개편 에픽 — 칩에서 말줄임되는지 확인하는 아주 긴 제목',
});
const MEMBERS = [
  { userId: 1, name: '양동희', username: 'dh.yang@iacloud.kr', kind: 'HUMAN' },
  { userId: 2, name: '김개발', username: 'dev.kim@iacloud.kr', kind: 'HUMAN' },
];

/** 이슈 7 상세 + 주변 API 스텁. PATCH/PUT/POST 는 calls 에 기록하고 상세 응답에 반영한다. */
async function mockDetail(page: Page, over: Partial<IssueResponse> = {}, body = '본문 첫 줄') {
  const calls: Call[] = [];
  let issue = createIssue({
    id: 7, number: 7, projectKey: KEY, type: makeTaskType(), status: 'TODO', priority: 'MID',
    title: '모바일 상세에서 속성을 첫 화면에 보여주기',
    assignees: [{ id: 1, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' }],
    ...over,
  });
  const record = (r: Route) => {
    const req = r.request();
    calls.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.postDataJSON?.() ?? null });
  };
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json(MEMBERS)));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => {
    if (r.request().method() === 'POST') {
      record(r);
      return r.fulfill(json(createIssue({ id: 99, number: 99, projectKey: KEY, title: 'new' })));
    }
    const isChildren = new URL(r.request().url()).searchParams.has('parent');
    return r.fulfill(json(createIssueSearchResponse(isChildren ? [] : [EPIC], null)));
  });
  await page.route((u) => u.pathname === BASE, (r) => {
    if (r.request().method() === 'PATCH') {
      record(r);
      issue = { ...issue, ...(r.request().postDataJSON() as Partial<IssueResponse>) };
    }
    return r.fulfill(json(createIssueDetail({ summary: issue, body })));
  });
  await page.route((u) => [`${BASE}/assignees`, `${BASE}/parent`].includes(u.pathname), (r) => {
    record(r);
    return r.fulfill(json(r.request().url().endsWith('/assignees') ? [] : createIssueDetail({ summary: issue, body })));
  });
  await page.route((u) => u.pathname === `${BASE}/comments`, (r) => {
    if (r.request().method() === 'POST') record(r);
    return r.fulfill(json(r.request().method() === 'POST'
      ? { id: 1, body: 'c', authorId: 1, authorKind: 'HUMAN', authorName: '양동희', createdAt: new Date().toISOString() }
      : []));
  });
  await page.route((u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${BASE}/${s}`), (r) => {
    if (r.request().method() === 'POST') record(r);
    return r.fulfill(json([]));
  });
  await page.route((u) => u.pathname === `${BASE}/chat/thread`, (r) => r.fulfill(json(createChatThread({ threadId: 999, recentMessages: [] }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/labels`, (r) => r.fulfill(json([])));
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) => r.fulfill(json([{ id: 1, type: 'PERSONAL', name: '내 드라이브' }])));
  return calls;
}

async function openDetail(page: Page) {
  await page.goto(`/projects/${KEY}/issues/7`);
  await expect(page.getByTestId('issue-title-heading')).toBeVisible();
}

test.describe('속성 칩', () => {
  test('제목 바로 아래 칩 줄 — 상태·담당자·우선순위·마감·에픽·＋ 속성, 가로 넘침 없음', async ({ authenticatedPage: page }) => {
    await mockDetail(page, { parent: { number: 50, title: EPIC.title, type: makeEpicType() }, dueDate: '2026-10-20' });
    await openDetail(page);
    const chips = page.getByTestId('mobile-prop-chips');
    for (const k of ['status', 'assignee', 'priority', 'due', 'epic', 'more']) {
      await expect(chips.getByTestId(`mobile-prop-${k}`)).toBeVisible();
    }
    await expect(chips.getByTestId('mobile-prop-status')).toContainText('할 일');
    await expect(chips.getByTestId('mobile-prop-due')).toContainText('10');
    // 칩 줄은 제목 블록 바로 아래(활동·코멘트보다 위)
    const chipsBox = await chips.boundingBox();
    const activity = await page.getByRole('region', { name: '활동' }).boundingBox();
    expect(chipsBox!.y).toBeLessThan(activity!.y);
    await expectNoHorizontalOverflow(page);
  });

  test('상태 칩 → 시트에서 완료 → PATCH status', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('mobile-prop-status').click();
    await page.getByTestId('issue-status-sheet').getByTestId('picker-option-DONE').click();
    await expect.poll(() => calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ status: 'DONE' });
    await expect(page.getByTestId('mobile-prop-status')).toContainText('완료');
  });

  test('미완료 선행 이슈가 있으면 완료 전환 전에 확인한다', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page, { blocked: true, blockedBy: [{ number: 3, title: '선행 작업', status: 'IN_PROGRESS', dueDate: null }] as IssueResponse['blockedBy'] });
    await openDetail(page);
    await page.getByTestId('mobile-prop-status').click();
    await page.getByTestId('picker-option-DONE').click();
    await expect(page.getByTestId('status-done-blocked-dialog')).toBeVisible();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    await page.getByTestId('status-done-blocked-confirm').click();
    await expect.poll(() => calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ status: 'DONE' });
  });

  test('우선순위·마감 칩 — 선택/빠른 선택/지우기가 PATCH 로 반영', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page, { dueDate: '2026-10-20' });
    await openDetail(page);
    await page.getByTestId('mobile-prop-priority').click();
    await page.getByTestId('issue-priority-sheet').getByTestId('picker-option-HIGH').click();
    await expect.poll(() => calls.some((c) => (c.body as { priority?: string })?.priority === 'HIGH')).toBe(true);

    await page.getByTestId('mobile-prop-due').click();
    await page.getByTestId('issue-due-sheet-today').click();
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await expect.poll(() => calls.some((c) => (c.body as { dueDate?: string })?.dueDate === today)).toBe(true);

    await page.getByTestId('mobile-prop-due').click();
    await page.getByTestId('issue-due-sheet-clear').click();
    await expect.poll(() => calls.some((c) => (c.body as { clearDueDate?: boolean })?.clearDueDate === true)).toBe(true);
  });

  test('담당자 칩 → 다중 선택 → 완료 시 한 번에 PUT', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('mobile-prop-assignee').click();
    const sheet = page.getByTestId('issue-assignee-sheet');
    await sheet.getByTestId('multi-option-2').click();
    expect(calls.filter((c) => c.path.endsWith('/assignees'))).toHaveLength(0); // 닫을 때까지 커밋하지 않음
    await sheet.getByTestId('issue-assignee-sheet-done').click();
    await expect.poll(() => calls.find((c) => c.path.endsWith('/assignees'))?.body).toEqual({ userIds: [1, 2] });
  });

  test('에픽 칩 → 에픽 선택 → PATCH parent', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('mobile-prop-epic').click();
    await page.getByTestId('issue-epic-sheet').getByTestId('picker-option-50').click();
    await expect.poll(() => calls.find((c) => c.path.endsWith('/parent'))?.body).toEqual({ parentNumber: 50 });
  });

  test('에픽 이슈에는 에픽 칩이 없다', async ({ authenticatedPage: page }) => {
    await mockDetail(page, { type: makeEpicType() });
    await openDetail(page);
    await expect(page.getByTestId('mobile-prop-status')).toBeVisible();
    await expect(page.getByTestId('mobile-prop-epic')).toHaveCount(0);
  });

  test('서브태스크 이슈에는 에픽 칩이 없다', async ({ authenticatedPage: page }) => {
    await mockDetail(page, { type: makeSubtaskType(), parent: { number: 3, title: '부모 태스크', type: makeTaskType() } });
    await openDetail(page);
    await expect(page.getByTestId('mobile-prop-status')).toBeVisible();
    await expect(page.getByTestId('mobile-prop-epic')).toHaveCount(0);
  });
});

test.describe('＋ 속성 시트', () => {
  test('모바일에선 하단 레일이 없고, ＋ 속성 시트에 유형·일정·분류·커스텀 필드가 있다(칩과 중복 항목 없음)', async ({ authenticatedPage: page }) => {
    await mockDetail(page);
    await openDetail(page);
    await expect(page.getByTestId('property-rail')).toHaveCount(0);
    await page.getByTestId('mobile-prop-more').click();
    const sheet = page.getByTestId('issue-more-props-sheet');
    await expect(sheet.getByTestId('issue-more-props-type')).toBeVisible();
    await expect(sheet.getByTestId('property-group-planning')).toBeVisible();
    await expect(sheet.getByTestId('issue-cycles-section')).toBeVisible();
    await expect(sheet.getByTestId('issue-milestone-section')).toBeVisible();
    await expect(sheet.getByTestId('property-group-classification')).toBeVisible();
    await expect(sheet.getByTestId('property-group-custom-fields')).toBeVisible();
    // 칩과 겹치는 항목은 시트에 없다.
    await expect(sheet.getByTestId('issue-status-select')).toHaveCount(0);
    await expect(sheet.getByTestId('due-date-trigger')).toHaveCount(0);
    await expect(sheet.getByTestId('issue-parent-slot')).toHaveCount(0);
  });

  test('시트 안 시작일 팝오버가 시트 위에 화면 안으로 열린다', async ({ authenticatedPage: page }) => {
    await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('mobile-prop-more').click();
    await page.getByTestId('issue-more-props-sheet').getByTestId('start-date-trigger').click();
    const pop = page.getByTestId('start-date-popover');
    await expect(pop).toBeVisible();
    const box = (await pop.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    // 팝오버가 시트에 가려지지 않음 — 중심점의 최상위 요소가 팝오버 안.
    const onTop = await pop.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(onTop).toBe(true);
  });

  test('서브태스크는 시트에 부모 슬롯이 있다', async ({ authenticatedPage: page }) => {
    await mockDetail(page, { type: makeSubtaskType(), parent: { number: 3, title: '부모 태스크', type: makeTaskType() } });
    await openDetail(page);
    await page.getByTestId('mobile-prop-more').click();
    await expect(page.getByTestId('issue-more-props-sheet').getByTestId('issue-parent-slot')).toBeVisible();
  });
});
