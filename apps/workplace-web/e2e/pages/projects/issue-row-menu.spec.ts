// 이슈 행·카드 「⋯」/우클릭 메뉴 E2E(WP-273, 데스크톱 시안 A).
// 메뉴로 상태·담당자·우선순위·AI 위임·복사·삭제를 상세 진입 없이 수행하고, 요청 payload 와 화면 반영까지 확인한다.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createAgentMember, createMember, createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { bodyOf, trackRequests } from '../../fixtures/requests';

const KEY = 'WP';
const ISSUES = `/api/v1/projects/${KEY}/issues`;
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// 보는 사람(createUser id=1)은 OWNER 가 아닌 MEMBER — 삭제는 보고자일 때만 보여야 한다.
const ME = createMember({ userId: 1, name: '테스트 사용자', username: 'testuser', role: 'MEMBER' });
const KIM = createMember({ userId: 2, name: '김개발', username: 'kim', role: 'MEMBER' });
const BOT = createAgentMember({ userId: 99, name: '트리스타나' });
const EPIC = createIssue({ id: 10, number: 10, projectKey: KEY, title: '결제 안정화', type: makeEpicType(), childCount: 3, childDoneCount: 1 });
const A = createIssue({ id: 1, number: 7, projectKey: KEY, title: '로그인 세션 만료 처리', type: makeTaskType(), status: 'TODO', priority: 'MID', reporterId: 1, assignees: [{ id: 2, username: 'kim', name: '김개발', kind: 'HUMAN' }] });
const B = createIssue({ id: 2, number: 8, projectKey: KEY, title: '알림 인박스 지연', type: makeTaskType(), status: 'TODO', priority: 'LOW', reporterId: 5 });
const C = createIssue({ id: 3, number: 9, projectKey: KEY, title: '첨부 미리보기 깨짐', type: makeTaskType(), status: 'IN_PROGRESS', priority: 'HIGH', reporterId: 1 });

/** 목록·메타·변경 API 스텁 — 변경은 메모리 db 에 반영해 재조회에도 유지된다(settle 재조회 뒤 화면 확인용). 요청은 tracker 가 기록한다. */
async function mock(page: Page, { members = [ME, KIM, BOT], member = true } = {}) {
  const db = new Map([A, B, C].map((i) => [i.number, structuredClone(i)]));
  const writes = trackRequests(page, 'ANY', (u, req) => req.method() !== 'GET' && u.pathname.startsWith(`${ISSUES}/`));
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: member }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json(members)));
  for (const p of ['labels', 'cycles', 'views', 'milestones']) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const url = new URL(r.request().url());
    const isEpicList = url.searchParams.get('type') === String(makeEpicType().id);
    const status = url.searchParams.get('status');
    const all = [...db.values()];
    const list = isEpicList ? [EPIC] : status ? all.filter((i) => status.split(',').includes(i.status)) : all;
    return r.fulfill(json(createIssueSearchResponse(list, null)));
  });
  await page.route((u) => u.pathname.startsWith(`${ISSUES}/`), (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fallback();
    const [, num, sub] = new URL(req.url()).pathname.match(/issues\/(\d+)(?:\/(\w+))?$/) ?? [];
    const it = db.get(Number(num));
    const body = bodyOf(req) as Record<string, unknown> | null;
    if (req.method() === 'DELETE') {
      db.delete(Number(num));
      return r.fulfill({ status: 204 });
    }
    if (it && sub === 'status') it.status = body?.status as typeof it.status;
    if (it && sub === undefined && body?.priority) it.priority = body.priority as typeof it.priority;
    if (it && sub === 'assignees') {
      it.assignees = (body?.userIds as number[]).map((id) => {
        const m = members.find((x) => x.userId === id)!;
        return { id, username: m.username, name: m.name, kind: m.kind };
      });
      return r.fulfill(json(it.assignees));
    }
    return r.fulfill(json(it ?? {}));
  });
  return {
    calls: () => writes.requests().map((req) => ({ method: req.method(), path: new URL(req.url()).pathname, body: bodyOf(req) })),
    waitFor: writes.waitFor,
  };
}

test.describe('이슈 행 ⋯ 메뉴 — 목록(데스크톱)', () => {
  test('⋯ 는 호버 때만 보이고, 누르면 메뉴가 열리며 상세로 이동하지 않는다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    const btn = page.getByTestId('issue-row-7-menu');
    await expect(btn).toHaveCSS('opacity', '0');
    await page.getByTestId('issue-row-7').hover();
    await expect(btn).toHaveCSS('opacity', '1');
    await btn.click();
    const menu = page.getByTestId('issue-row-menu');
    await expect(menu).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?view=list&group=none$`));
    // 항목 구성 — 보고자인 단건이라 삭제까지 보인다.
    for (const id of ['status', 'assignee', 'priority', 'epic', 'ai', 'copy-link', 'copy-key', 'open-tab', 'delete']) {
      await expect(page.getByTestId(`row-menu-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('row-menu-copy-key')).toContainText('WP-7');
    await page.screenshot({ path: 'test-results/tc/issue-row-menu/desktop-row-menu.png' });
  });

  test('우클릭 → 상태 › 진행 중 → PATCH status, 행 아이콘이 즉시 바뀐다', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-8').click({ button: 'right' });
    await page.getByTestId('row-menu-status').hover();
    await page.getByTestId('row-menu-status-IN_PROGRESS').click();
    await api.waitFor();
    expect(api.calls()).toEqual([{ method: 'PATCH', path: `${ISSUES}/8/status`, body: { status: 'IN_PROGRESS' } }]);
    await expect(page.getByTestId('issue-row-menu')).toHaveCount(0);
    await expect(page.getByTestId('issue-row-8').getByLabel('상태: 진행 중')).toBeVisible();
  });

  test('우선순위 › 높음 → PATCH issue { priority: HIGH }', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-8').click({ button: 'right' });
    await page.getByTestId('row-menu-priority').hover();
    await page.getByTestId('row-menu-priority-HIGH').click();
    await api.waitFor();
    expect(api.calls()).toEqual([{ method: 'PATCH', path: `${ISSUES}/8`, body: { priority: 'HIGH' } }]);
  });

  test('담당자 › 체크 토글은 기존 담당자를 유지한 채 추가하고, 메뉴는 열려 있다', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-7').click({ button: 'right' });
    await page.getByTestId('row-menu-assignee').hover();
    await expect(page.getByTestId('row-menu-assignee-2')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('row-menu-assignee-1').click();
    await api.waitFor();
    expect(api.calls()[0]).toEqual({ method: 'PUT', path: `${ISSUES}/7/assignees`, body: { userIds: [2, 1] } });
    await expect(page.getByTestId('row-menu-assignee-1')).toHaveAttribute('aria-checked', 'true');
    // 다시 누르면 뺀다.
    await page.getByTestId('row-menu-assignee-2').click();
    await api.waitFor(2);
    expect(api.calls()[1].body).toEqual({ userIds: [1] });
  });

  test('AI에게 맡기기 → 기존 담당자 + AI 멤버로 PUT, 이미 AI 담당이면 항목이 없다', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-7').click({ button: 'right' });
    await page.getByTestId('row-menu-ai').click();
    await api.waitFor();
    expect(api.calls()).toEqual([{ method: 'PUT', path: `${ISSUES}/7/assignees`, body: { userIds: [2, 99] } }]);
    await expect(page.getByText('트리스타나에게 맡겼습니다')).toBeVisible();
    // 낙관적 반영 — 같은 행 메뉴를 다시 열면 위임 상태라 AI 항목이 사라진다.
    await page.getByTestId('issue-row-7').click({ button: 'right' });
    await expect(page.getByTestId('row-menu-status')).toBeVisible();
    await expect(page.getByTestId('row-menu-ai')).toHaveCount(0);
  });

  test('에픽 › 결제 안정화 → PUT parent', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-8').click({ button: 'right' });
    await page.getByTestId('row-menu-epic').hover();
    await page.getByTestId('row-menu-epic-10').click();
    await api.waitFor();
    expect(api.calls()[0]).toMatchObject({ path: `${ISSUES}/8/parent`, body: { parentNumber: 10 } });
  });

  test('링크 복사·키 복사 — 클립보드에 상세 주소와 키가 담긴다', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-7').click({ button: 'right' });
    await page.getByTestId('row-menu-copy-link').click();
    await expect(page.getByText('링크를 복사했습니다')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/projects/${KEY}/issues/7$`));
    await page.getByTestId('issue-row-7').click({ button: 'right' });
    await page.getByTestId('row-menu-copy-key').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('WP-7');
  });

  test('삭제 → 확인 다이얼로그 → DELETE, 보고자가 아니면(OWNER 도 아님) 삭제 항목이 없다', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-8').click({ button: 'right' });
    await expect(page.getByTestId('row-menu-status')).toBeVisible();
    await expect(page.getByTestId('row-menu-delete')).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByTestId('issue-row-7').click({ button: 'right' });
    await page.getByTestId('row-menu-delete').click();
    await expect(page.getByTestId('issue-row-delete-dialog')).toContainText('로그인 세션 만료 처리');
    await page.getByTestId('issue-row-delete-confirm').click();
    await api.waitFor();
    expect(api.calls()).toEqual([{ method: 'DELETE', path: `${ISSUES}/7`, body: null }]);
  });

  test('비멤버는 복사·새 탭만 보인다', async ({ authenticatedPage: page }) => {
    await mock(page, { member: false, members: [KIM] });
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('issue-row-7').click({ button: 'right' });
    await expect(page.getByTestId('row-menu-copy-link')).toBeVisible();
    for (const id of ['status', 'assignee', 'priority', 'epic', 'ai', 'delete']) {
      await expect(page.getByTestId(`row-menu-${id}`)).toHaveCount(0);
    }
  });

  test('선택된 행에서 열면 선택 전체에 적용, 선택 밖 행이면 그 행만', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=list&group=none`);
    await page.getByTestId('select-issue-7').check();
    await page.getByTestId('select-issue-8').check();

    // 선택 밖 행(9) — 단건 메뉴.
    await page.getByTestId('issue-row-9').click({ button: 'right' });
    await expect(page.getByTestId('row-menu-copy-link')).toBeVisible();
    await expect(page.getByTestId('issue-row-menu')).not.toContainText('선택한');
    await page.keyboard.press('Escape');

    // 선택된 행(8) — 「선택한 2개 이슈」, 복사·에픽·AI 없음, 우선순위 일괄.
    await page.getByTestId('issue-row-8').click({ button: 'right' });
    const menu = page.getByTestId('issue-row-menu');
    await expect(menu).toContainText('선택한 2개 이슈');
    await expect(page.getByTestId('row-menu-copy-link')).toHaveCount(0);
    await expect(page.getByTestId('row-menu-epic')).toHaveCount(0);
    await expect(page.getByTestId('row-menu-delete')).toContainText('2개 삭제');
    await page.screenshot({ path: 'test-results/tc/issue-row-menu/desktop-row-menu-bulk.png' });
    await page.getByTestId('row-menu-priority').hover();
    await page.getByTestId('row-menu-priority-LOW').click();
    await api.waitFor(2);
    expect(api.calls().map((c) => [c.path, c.body]).sort()).toEqual([
      [`${ISSUES}/7`, { priority: 'LOW' }],
      [`${ISSUES}/8`, { priority: 'LOW' }],
    ]);
    // 일괄 작업 성공 → 선택 해제(일괄 바와 같은 동작).
    await expect(page.getByTestId('issue-bulk-toolbar')).toHaveCount(0);
  });
});

test.describe('이슈 카드 ⋯ 메뉴 — 보드(데스크톱)', () => {
  test('카드 ⋯ → 상태 › 완료 → PATCH status, 상세로 이동하지 않는다', async ({ authenticatedPage: page }) => {
    const api = await mock(page);
    await page.goto(`/projects/${KEY}?view=board`);
    const card = page.getByTestId('issue-card-8');
    await card.hover();
    await page.getByTestId('issue-card-8-menu').click();
    await expect(page.getByTestId('issue-row-menu')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}\\?view=board$`));
    await page.screenshot({ path: 'test-results/tc/issue-row-menu/desktop-card-menu.png' });
    await page.getByTestId('row-menu-status').hover();
    await page.getByTestId('row-menu-status-DONE').click();
    await api.waitFor();
    expect(api.calls()).toEqual([{ method: 'PATCH', path: `${ISSUES}/8/status`, body: { status: 'DONE' } }]);
  });

  test('카드 우클릭으로도 같은 메뉴가 열린다', async ({ authenticatedPage: page }) => {
    await mock(page);
    await page.goto(`/projects/${KEY}?view=board`);
    await page.getByTestId('issue-card-7').click({ button: 'right' });
    await expect(page.getByTestId('row-menu-copy-key')).toContainText('WP-7');
  });
});
