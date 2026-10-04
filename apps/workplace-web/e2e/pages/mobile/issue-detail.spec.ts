// 모바일 이슈 상세(WP-196) — 제목 아래 속성 칩 · 「＋ 속성」 시트 · 첨부/하위 태스크 · 하단 코멘트 입력/편집 바.
import type { Page, Route } from '@playwright/test';

import type { IssueResponse } from '../../../src/types/issue';
import { createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeSubtaskType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { installFakeViewport, setKeyboard } from '../../fixtures/keyboard';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { expectStays } from '../../fixtures/wait';

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
    // multipart(첨부 업로드) 본문은 JSON 이 아니라 postDataJSON 이 던진다 — 본문 없이 기록.
    let body: unknown = null;
    try { body = req.postDataJSON?.() ?? null; } catch { /* multipart */ }
    calls.push({ method: req.method(), path: new URL(req.url()).pathname, body });
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
  // 코멘트 API 는 issueId 기반 글로벌 경로(/issues/{id}/comments — api/issueComments.ts).
  await page.route((u) => u.pathname === `/api/v1/issues/${issue.id}/comments`, (r) => {
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

  test('차단됨은 상태 칩에 합쳐지고(별도 칩 없음), 긴 담당자 이름이어도 +N 은 보인다', async ({ authenticatedPage: page }) => {
    await mockDetail(page, {
      blocked: true,
      blockedBy: [{ number: 3, title: '선행 작업', status: 'IN_PROGRESS', dueDate: null }] as IssueResponse['blockedBy'],
      assignees: [
        { id: 1, username: 'a', name: '아주긴이름을가진담당자홍길동선생님', kind: 'HUMAN' },
        { id: 2, username: 'b', name: '김개발', kind: 'HUMAN' },
        { id: 3, username: 'c', name: '이기획', kind: 'HUMAN' },
      ],
    });
    await openDetail(page);
    const status = page.getByTestId('mobile-prop-status');
    await expect(status.getByTestId('issue-blocked-badge')).toHaveText('· 차단됨');
    await expect(status).toHaveAttribute('aria-label', '상태: 할 일, 차단됨');
    await expect(page.getByTestId('issue-blocked-badge')).toHaveCount(1);
    const plus = page.getByTestId('mobile-prop-assignee').getByText('+2', { exact: true });
    await expect(plus).toBeVisible();
    // +N 이 칩 안에서 잘리지 않았는지(이름 span 만 말줄임).
    expect(await plus.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right)).toBe(true);
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
    // 달력 날짜 칸은 터치 최소 44px.
    const day = page.getByTestId('issue-due-sheet').locator('[data-day] button').first();
    expect((await day.boundingBox())!.width).toBeGreaterThanOrEqual(44);
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

  test('에픽 시트 완료/전체 숫자는 길이·선택(✓) 여부와 상관없이 오른쪽 끝이 맞는다', async ({ authenticatedPage: page }) => {
    await mockDetail(page, { parent: { number: 50, title: EPIC.title, type: makeEpicType() } });
    const BIG = createIssue({ id: 51, number: 51, projectKey: KEY, title: '레거시 이관', type: makeEpicType(), childCount: 125, childDoneCount: 10 });
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => {
      if (r.request().method() !== 'GET' || new URL(r.request().url()).searchParams.has('parent')) return r.fallback();
      return r.fulfill(json(createIssueSearchResponse([EPIC, BIG], null)));
    });
    await openDetail(page);
    await page.getByTestId('mobile-prop-epic').click();
    const sheet = page.getByTestId('issue-epic-sheet');
    await expect(sheet.getByTestId('picker-option-50')).toHaveAttribute('aria-selected', 'true');
    const right = async (n: number) => {
      const b = (await sheet.getByTestId(`picker-option-${n}`).locator('.tabular-nums').boundingBox())!;
      return b.x + b.width;
    };
    expect(await right(51)).toBeCloseTo(await right(50), 0);
  });

  test('에픽 목록 조회 중엔 「에픽 없음」 아래 「불러오는 중…」 — 응답 후 에픽 옵션으로 바뀐다', async ({ authenticatedPage: page }) => {
    await mockDetail(page);
    // 에픽 목록(부모 필터 없는 검색) 응답을 붙잡아 둔다 — 나중에 등록한 route 가 먼저 매칭된다.
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, async (r) => {
      if (r.request().method() !== 'GET' || new URL(r.request().url()).searchParams.has('parent')) return r.fallback();
      await gate;
      return r.fulfill(json(createIssueSearchResponse([EPIC], null)));
    });
    await openDetail(page);
    await page.getByTestId('mobile-prop-epic').click();
    const sheet = page.getByTestId('issue-epic-sheet');
    await expect(sheet.getByTestId('picker-option-none')).toBeVisible();
    await expect(sheet.getByTestId('issue-epic-sheet-loading')).toHaveText('불러오는 중…');
    await expect(sheet.getByTestId('picker-option-50')).toHaveCount(0);
    release();
    await expect(sheet.getByTestId('picker-option-50')).toBeVisible();
    await expect(sheet.getByTestId('issue-epic-sheet-loading')).toHaveCount(0);
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

  test('속성 시트 안 링크로 다른 이슈로 이동하면 시트가 닫힌다', async ({ authenticatedPage: page }) => {
    await mockDetail(page, { type: makeSubtaskType(), parent: { number: 3, title: '선행 작업', type: makeTaskType() } });
    // 이동 대상 이슈 3 — 이슈 7 스텁보다 나중에 등록해 우선한다.
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/3`, (r) =>
      r.fulfill(json(createIssueDetail({
        summary: createIssue({ id: 3, number: 3, projectKey: KEY, type: makeTaskType(), title: '선행 작업' }),
        body: '',
      }))));
    await openDetail(page);
    await page.getByTestId('mobile-prop-more').click();
    const sheet = page.getByTestId('issue-more-props-sheet');
    await expect(sheet).toBeVisible();
    await sheet.getByTestId('issue-parent-slot').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/issues/3$`));
    await expect(page.getByTestId('issue-title-heading')).toContainText('선행 작업');
    await expect(page.getByTestId('issue-more-props-sheet')).toHaveCount(0);
  });

  test('서브태스크는 시트에 부모 슬롯이 있다', async ({ authenticatedPage: page }) => {
    await mockDetail(page, { type: makeSubtaskType(), parent: { number: 3, title: '부모 태스크', type: makeTaskType() } });
    await openDetail(page);
    await page.getByTestId('mobile-prop-more').click();
    await expect(page.getByTestId('issue-more-props-sheet').getByTestId('issue-parent-slot')).toBeVisible();
  });
});

test.describe('첨부·하위 태스크', () => {
  test('첨부 버튼은 「＋ 첨부」 하나 → 파일/드라이브 액션 시트', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await expect(page.getByTestId('attachment-dropzone')).toHaveCount(0);
    await expect(page.getByTestId('issue-drive-link-add-btn')).toHaveCount(0);
    const add = page.getByTestId('mobile-attach-add');
    expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await add.click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('mobile-attach-sheet').getByTestId('mobile-action-file').click();
    await (await chooser).setFiles({ name: 'bug.png', mimeType: 'image/png', buffer: Buffer.from('x') });
    await expect.poll(() => calls.some((c) => c.method === 'POST' && c.path.endsWith('/attachments'))).toBe(true);

    await add.click();
    await page.getByTestId('mobile-action-drive').click();
    await expect(page.getByText('링크할 파일 선택').first()).toBeVisible();
  });

  test('「＋ 하위 태스크 추가」 탭 → 입력칸 펼침, Enter 로 추가해도 칸·포커스 유지', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await expect(page.getByTestId('child-add-input')).toHaveCount(0);
    await page.getByTestId('child-add-open').click();
    const input = page.getByTestId('child-add-input');
    await expect(input).toBeFocused();
    await input.fill('첫 하위');
    await input.press('Enter');
    await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/issues')).length).toBe(1);
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    // 「추가」 버튼 탭도 입력칸 포커스를 뺏지 않는다(iOS 키보드 유지).
    await input.fill('둘째 하위');
    await page.getByTestId('child-add-form').getByRole('button', { name: '추가' }).click();
    await expect.poll(() => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/issues')).length).toBe(2);
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    // 비운 채로 포커스를 잃으면 다시 접힌다.
    await input.blur();
    await expect(page.getByTestId('child-add-open')).toBeVisible();
  });
});

test.describe('하단 코멘트 입력·편집 바', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await installFakeViewport(page);
  });

  test('코멘트 입력은 화면 하단 — 키보드가 열리면 바로 위로, 헤더는 제자리', async ({ authenticatedPage: page }) => {
    await mockDetail(page);
    await openDetail(page);
    const bar = page.getByTestId('mobile-bottom-bar');
    const vpH = page.viewportSize()!.height;
    await expect.poll(async () => { const b = (await bar.boundingBox())!; return Math.round(b.y + b.height); }).toBeGreaterThan(vpH - 60);
    await page.getByTestId('issue-comment-input').click();
    const visible = await setKeyboard(page, true);
    await expect.poll(async () => { const b = (await bar.boundingBox())!; return Math.abs(b.y + b.height - visible); }).toBeLessThanOrEqual(2);
    expect((await page.getByTestId('mobile-back').boundingBox())!.y).toBeGreaterThanOrEqual(0);
  });

  test('전송 중 에디터가 한 번도 blur 되지 않고 포커스 유지, 4줄 넘으면 내부 스크롤', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    const editor = page.getByTestId('issue-comment-input');
    await editor.click();
    await page.keyboard.type('첫 코멘트');
    // iOS 는 blur 가 한 번이라도 일어나면 키보드가 내려가고, 전송 뒤 비동기 refocus 로는 다시 안 올라온다 — focusout 0회를 단언.
    await editor.evaluate((el) => {
      (window as unknown as { __blurs: number }).__blurs = 0;
      el.addEventListener('focusout', () => { (window as unknown as { __blurs: number }).__blurs++; }, true);
    });
    await page.getByTestId('issue-comment-submit').click();
    await expect.poll(() => calls.some((c) => c.method === 'POST' && c.path === '/api/v1/issues/7/comments')).toBe(true);
    await expect.poll(() => editor.evaluate((el) => el.contains(document.activeElement) || el === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => (window as unknown as { __blurs: number }).__blurs)).toBe(0);
    // 전송 성공 후 비동기 clear 가 끝난 뒤에 줄을 넣는다 — 먼저 넣으면 clear 가 지워 버려 넘침 단언이 흔들린다.
    await expect(editor).toHaveText('');
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+Enter');
    // 높이만 잘린 게 아니라 실제로 내용이 넘쳐 내부 스크롤이 생겼는지(줄 추가 렌더를 기다린다).
    await expect.poll(() => editor.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    // 정확히 4줄 + 세로 패딩 + 테두리(터치 16px 글꼴의 실제 줄 높이로 계산).
    const expected = await editor.evaluate((el) => {
      const cs = getComputedStyle(el);
      const n = (v: string) => parseFloat(v);
      return 4 * n(cs.lineHeight) + n(cs.paddingTop) + n(cs.paddingBottom) + n(cs.borderTopWidth) + n(cs.borderBottomWidth);
    });
    const h = (await editor.boundingBox())!.height;
    expect(Math.abs(h - expected)).toBeLessThanOrEqual(1);
  });

  test('제목 편집 중엔 코멘트 대신 [취소·저장] 바 — 저장은 PATCH 1회', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('issue-title-edit').click();
    await expect(page.getByTestId('mobile-edit-bar')).toBeVisible();
    // 작성창은 언마운트하지 않고 숨긴다(초안 보존).
    await expect(page.getByTestId('issue-comment-input')).toBeHidden();
    await page.getByTestId('issue-title-input').fill('새 제목');
    await page.getByTestId('mobile-edit-save').click();
    await expect(page.getByTestId('mobile-edit-bar')).toHaveCount(0);
    await expect(page.getByTestId('issue-comment-input')).toBeVisible();
    await expectStays(page, () => calls.filter((c) => c.method === 'PATCH').length, 1, { reach: true });
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches[0].body).toMatchObject({ title: '새 제목' });
  });

  test('제목 편집 중 다른 속성을 바꿔도(요청 중 상태 변화) 편집 바가 사라지지 않는다', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('issue-title-edit').click();
    await expect(page.getByTestId('mobile-edit-bar')).toBeVisible();
    await page.getByTestId('mobile-prop-priority').click();
    await page.getByTestId('issue-priority-sheet').getByTestId('picker-option-HIGH').click();
    await expect.poll(() => calls.some((c) => (c.body as { priority?: string })?.priority === 'HIGH')).toBe(true);
    await expect(page.getByTestId('mobile-edit-bar')).toBeVisible();
    await expect(page.getByTestId('issue-title-input')).toBeVisible();
  });

  test('긴 제목은 3줄까지 보이고, 편집은 줄바꿈되는 입력칸 — Enter 로 저장', async ({ authenticatedPage: page }) => {
    const long = '결제 페이지에서 카드사 점검 시간에 결제를 시도하면 오류 안내 없이 무한 로딩되는 문제를 재현하고 수정하기';
    const calls = await mockDetail(page, { title: long });
    await openDetail(page);
    const lines = await page.getByTestId('issue-title-heading').locator('h1 span span').first().evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeGreaterThan(1);
    expect(lines).toBeLessThanOrEqual(3);
    await page.getByTestId('issue-title-edit').click();
    const input = page.getByTestId('issue-title-input');
    await expect(input).toBeFocused();
    // 자동 확장 — 내부 스크롤 없이 전체 제목이 보인다.
    expect(await input.evaluate((el) => el.tagName === 'TEXTAREA' && el.scrollHeight <= el.clientHeight + 1 && el.clientHeight > 40)).toBe(true);
    await input.fill('짧은 제목');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('mobile-edit-bar')).toHaveCount(0);
    await expect.poll(() => calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ title: '짧은 제목' });
  });

  test('제목 편집 취소는 PATCH 없음', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('issue-title-edit').click();
    await page.getByTestId('issue-title-input').fill('버릴 제목');
    await page.getByTestId('mobile-edit-cancel').click();
    await expect(page.getByTestId('mobile-edit-bar')).toHaveCount(0);
    await expectStays(page, () => calls.filter((c) => c.method === 'PATCH').length, 0);
  });

  test('본문 편집도 바로 저장 — 본문 아래 저장/취소 버튼은 모바일에 없다', async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByRole('button', { name: '본문 편집' }).click();
    await expect(page.getByTestId('issue-body-save')).toHaveCount(0);
    await page.getByTestId('issue-body-textarea').fill('바뀐 본문');
    await page.getByTestId('mobile-edit-save').click();
    await expect.poll(() => calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ body: '바뀐 본문' });
    await expect(page.getByTestId('mobile-edit-bar')).toHaveCount(0);
    await expect(page.getByTestId('issue-comment-input')).toBeVisible();
    await expectStays(page, () => calls.filter((c) => c.method === 'PATCH').length, 1);
  });

  test('편집 바로 바뀌어도 쓰던 코멘트 초안은 남는다', async ({ authenticatedPage: page }) => {
    await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('issue-comment-input').click();
    await page.keyboard.type('쓰다 만 코멘트');
    await page.getByTestId('issue-title-edit').click();
    await expect(page.getByTestId('mobile-edit-bar')).toBeVisible();
    await page.getByTestId('mobile-edit-cancel').click();
    await expect(page.getByTestId('mobile-edit-bar')).toHaveCount(0);
    await expect(page.getByTestId('issue-comment-input')).toHaveText('쓰다 만 코멘트');
  });

  // 모바일 제목은 blur 저장이 없어 본문을 탭해도 편집이 유지된다 — 두 편집기가 동시에 열린 상태에서
  // 나중에 연 쪽을 저장하면 바가 먼저 연 쪽으로 넘어가고, 그것까지 끝나야 작성창이 돌아온다.
  for (const order of ['title→body', 'body→title'] as const) {
    test(`제목·본문 동시 편집(${order}) — 나중 쪽 저장 후 바가 먼저 쪽을 저장한다`, async ({ authenticatedPage: page }) => {
      const calls = await mockDetail(page);
      await openDetail(page);
      const openTitle = async () => {
        await page.getByTestId('issue-title-edit').click();
        await page.getByTestId('issue-title-input').fill('동시 편집 제목');
      };
      const openBody = async () => {
        await page.getByRole('button', { name: '본문 편집' }).click();
        await page.getByTestId('issue-body-textarea').fill('동시 편집 본문');
      };
      const [first, second] = order === 'title→body' ? [openTitle, openBody] : [openBody, openTitle];
      const [firstField, secondField] = order === 'title→body' ? ['title', 'body'] : ['body', 'title'];
      await first();
      await second();
      const patches = () => calls.filter((c) => c.method === 'PATCH');

      await page.getByTestId('mobile-edit-save').click();
      await expect.poll(() => patches().length).toBe(1);
      expect(patches()[0].body).toHaveProperty(secondField);
      expect(patches()[0].body).not.toHaveProperty(firstField);
      // 먼저 연 편집기가 아직 편집 중 — 바가 남아 그쪽 저장 경로가 된다.
      await expect(page.getByTestId('mobile-edit-bar')).toBeVisible();
      await expect(page.getByTestId('mobile-edit-save')).toBeEnabled();
      await page.getByTestId('mobile-edit-save').click();
      await expect.poll(() => patches().length).toBe(2);
      expect(patches()[1].body).toMatchObject(
        firstField === 'title' ? { title: '동시 편집 제목' } : { body: '동시 편집 본문' },
      );
      await expect(page.getByTestId('mobile-edit-bar')).toHaveCount(0);
      await expect(page.getByTestId('issue-comment-input')).toBeVisible();
    });
  }
});
