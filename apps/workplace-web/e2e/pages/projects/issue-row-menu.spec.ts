// 이슈 행·카드 「⋯」/우클릭 메뉴 E2E(WP-273, 데스크톱 시안 A).
// 브라우저가 있어야 판정되는 것만 남긴다 — 호버 때만 보이는 ⋯(@input)과 클립보드 복사(@platform).
// 메뉴 항목 구성(권한·선택)과 상태·담당자·우선순위·AI 위임·에픽·삭제 payload 는
// 페이지 테스트 src/pages/projects/issueRowMenu.test.tsx 가 지킨다(WP-971).
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createAgentMember, createMember, createProject } from '../../factories/project.factory';
import { statusFieldsOf } from '../../factories/projectStatus.factory';
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
async function mock(page: Page, { members = [ME, KIM, BOT] } = {}) {
  const db = new Map([A, B, C].map((i) => [i.number, structuredClone(i)]));
  const writes = trackRequests(page, 'ANY', (u, req) => req.method() !== 'GET' && u.pathname.startsWith(`${ISSUES}/`));
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))));
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
    // 상태는 프로젝트 상태 id(statusId, WP-808) 또는 범주(status, 일괄 바) — statusId 면 시드 상태로 범주·이름을 맞춘다.
    if (it && sub === 'status') {
      Object.assign(it, body?.statusId != null ? statusFieldsOf(body.statusId as number) : { status: body?.status });
    }
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
  test('⋯ 는 호버 때만 보이고, 누르면 메뉴가 열리며 상세로 이동하지 않는다', { tag: ['@input', '@wiring'] }, async ({ authenticatedPage: page }) => {
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

  test('링크 복사·키 복사 — 클립보드에 상세 주소와 키가 담긴다', { tag: '@platform' }, async ({ authenticatedPage: page, context }) => {
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
});
