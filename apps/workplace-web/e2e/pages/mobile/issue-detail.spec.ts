// 모바일 이슈 상세(WP-196) — 제목 아래 속성 칩 · 「＋ 속성」 시트 · 첨부/하위 태스크 · 하단 코멘트 입력/편집 바.
// 브라우저가 있어야 판정되는 것만 남긴다 — 칩 줄 위치·넘침·말줄임·팝오버 위치·키보드 위 하단 바(@layout),
// 포커스 유지·IME·파일 선택(@input), 상태 칩 → PATCH 대표 배선(@wiring).
// 칩 문구·조건부 렌더·시트 payload·비멤버 안내·＋ 속성 시트 구성·편집 바 저장/취소는
// 페이지 테스트 src/pages/mobile/mobileIssueDetail.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test';

import type { IssueDetailResponse, IssueResponse } from '../../../src/types/issue';
import { createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, makeTaskType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { statusFieldsOf } from '../../factories/projectStatus.factory';
import { pressMacChromeImeEnter } from '../../fixtures/ime';
import { installFakeViewport, setKeyboard } from '../../fixtures/keyboard';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';
import { bodyOf, trackRequests } from '../../fixtures/requests';
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

/** 이슈 7 상세 + 주변 API 스텁(PATCH 는 상세 응답에 반영). 돌려주는 calls() 는 쓰기 요청(PATCH/PUT/POST) 기록이다. */
async function mockDetail(
  page: Page,
  over: Partial<IssueResponse> = {},
  body = '본문 첫 줄',
  /** 상세 응답의 권한 플래그 등 — 비멤버 화면(WP-503)에서 viewerCanEditWorkflow 를 끈다. */
  detailOver: Partial<IssueDetailResponse> = {},
) {
  let issue = createIssue({
    id: 7, number: 7, projectKey: KEY, type: makeTaskType(), status: 'TODO', priority: 'MID',
    title: '모바일 상세에서 속성을 첫 화면에 보여주기',
    assignees: [{ id: 1, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' }],
    ...over,
  });
  const commentsPath = `/api/v1/issues/${issue.id}/comments`;
  // 기록 대상: 이슈 생성 POST · 상세 PATCH · 담당자/에픽(모든 메서드) · 코멘트/부속 POST.
  const recorded = (method: string, path: string) =>
    (method === 'POST' && path === `/api/v1/projects/${KEY}/issues`)
    || (method === 'PATCH' && path === BASE)
    || [`${BASE}/assignees`, `${BASE}/parent`].includes(path)
    || (method === 'POST' && (path === commentsPath || ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => path === `${BASE}/${s}`)));
  const tracked = trackRequests(page, 'ANY', (u, req) => recorded(req.method(), u.pathname));
  const calls = (): Call[] => tracked.requests().map((req) => ({ method: req.method(), path: new URL(req.url()).pathname, body: bodyOf(req) }));
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) => r.fulfill(json(MEMBERS)));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => {
    if (r.request().method() === 'POST') {
      return r.fulfill(json(createIssue({ id: 99, number: 99, projectKey: KEY, title: 'new' })));
    }
    const isChildren = new URL(r.request().url()).searchParams.has('parent');
    return r.fulfill(json(createIssueSearchResponse(isChildren ? [] : [EPIC], null)));
  });
  await page.route((u) => u.pathname === BASE, (r) => {
    if (r.request().method() === 'PATCH') {
      const patch = r.request().postDataJSON() as Partial<IssueResponse>;
      // 상태는 statusId 로 온다(WP-808) — 서버처럼 범주·이름까지 맞춘다.
      issue = { ...issue, ...patch, ...(patch.statusId != null ? statusFieldsOf(patch.statusId) : {}) };
    }
    return r.fulfill(json(createIssueDetail({ summary: issue, body, ...detailOver })));
  });
  await page.route((u) => [`${BASE}/assignees`, `${BASE}/parent`].includes(u.pathname), (r) =>
    r.fulfill(json(r.request().url().endsWith('/assignees') ? [] : createIssueDetail({ summary: issue, body }))));
  // 코멘트 API 는 issueId 기반 글로벌 경로(/issues/{id}/comments — api/issueComments.ts).
  await page.route((u) => u.pathname === commentsPath, (r) => {
    return r.fulfill(json(r.request().method() === 'POST'
      ? { id: 1, body: 'c', authorId: 1, authorKind: 'HUMAN', authorName: '양동희', createdAt: new Date().toISOString() }
      : []));
  });
  await page.route((u) => ['watchers', 'labels', 'attachments', 'drive-links'].some((s) => u.pathname === `${BASE}/${s}`), (r) => r.fulfill(json([])));
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
  test('제목 바로 아래 칩 줄 — 상태·담당자·우선순위·마감·에픽·＋ 속성, 가로 넘침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockDetail(page, { parent: { number: 50, title: EPIC.title, type: makeEpicType() }, dueDate: '2026-10-20' });
    await openDetail(page);
    const chips = page.getByTestId('mobile-prop-chips');
    for (const k of ['status', 'assignee', 'priority', 'due', 'epic', 'more']) {
      await expect(chips.getByTestId(`mobile-prop-${k}`)).toBeVisible();
    }
    await expect(chips.getByTestId('mobile-prop-status')).toContainText('할 일');
    // 칩 접근 이름에 보이는 값이 붙는다(WP-853 Label in Name) — 고정 이름(「상태」「에픽」)만 읽히던 문제.
    await expect(chips.getByRole('button', { name: '상태: 할 일', exact: true })).toBeVisible();
    await expect(chips.getByRole('button', { name: `에픽: ${EPIC.title}`, exact: true })).toBeVisible();
    await expect(chips.getByTestId('mobile-prop-due')).toContainText('10');
    // 칩 줄은 제목 블록 바로 아래(활동·코멘트보다 위)
    const chipsBox = await chips.boundingBox();
    const activity = await page.getByRole('region', { name: '활동' }).boundingBox();
    expect(chipsBox!.y).toBeLessThan(activity!.y);
    await expectNoHorizontalOverflow(page);
  });

  test('차단됨은 상태 칩에 합쳐지고(별도 칩 없음), 긴 담당자 이름이어도 +N 은 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
    await expect(page.getByTestId('mobile-prop-assignee')).toHaveAttribute('aria-label', '담당자: 아주긴이름을가진담당자홍길동선생님 +2');
    const plus = page.getByTestId('mobile-prop-assignee').getByText('+2', { exact: true });
    await expect(plus).toBeVisible();
    // +N 이 칩 안에서 잘리지 않았는지(이름 span 만 말줄임).
    expect(await plus.evaluate((el) => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().right <= el.parentElement!.getBoundingClientRect().right)).toBe(true);
  });

  // 상태 시트 선택지는 프로젝트 상태(시드 「완료」 id 3, WP-808) — statusId 로 보낸다.
  test('상태 칩 → 시트에서 완료 → PATCH statusId', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('mobile-prop-status').click();
    await page.getByTestId('issue-status-sheet').getByTestId('picker-option-3').click();
    await expect.poll(() => calls().find((c) => c.method === 'PATCH')?.body).toMatchObject({ statusId: 3 });
    await expect(page.getByTestId('mobile-prop-status')).toContainText('완료');
  });

  // 달력 날짜 칸은 터치 최소 44px — 실제 폭이라 jsdom 이 잴 수 없다. 우선순위·마감 PATCH 는 페이지 테스트가 본다.
  test('마감 칩 시트의 달력 날짜 칸은 터치 최소 44px', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockDetail(page, { dueDate: '2026-10-20' });
    await openDetail(page);
    await page.getByTestId('mobile-prop-due').click();
    const day = page.getByTestId('issue-due-sheet').locator('[data-day] button').first();
    expect((await day.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  });

  test('에픽 시트 완료/전체 숫자는 길이·선택(✓) 여부와 상관없이 오른쪽 끝이 맞는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
});

test.describe('＋ 속성 시트', () => {
  test('시트 안 시작일 팝오버가 시트 위에 화면 안으로 열린다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
});

test.describe('첨부·하위 태스크', () => {
  test('첨부 버튼은 「＋ 첨부」 하나 → 파일/드라이브 액션 시트', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
    await expect.poll(() => calls().some((c) => c.method === 'POST' && c.path.endsWith('/attachments'))).toBe(true);

    await add.click();
    await page.getByTestId('mobile-action-drive').click();
    await expect(page.getByText('링크할 파일 선택').first()).toBeVisible();
  });

  test('「＋ 하위 태스크 추가」 탭 → 입력칸 펼침, Enter 로 추가해도 칸·포커스 유지', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await expect(page.getByTestId('child-add-input')).toHaveCount(0);
    await page.getByTestId('child-add-open').click();
    const input = page.getByTestId('child-add-input');
    await expect(input).toBeFocused();
    await input.fill('첫 하위');
    await input.press('Enter');
    await expect.poll(() => calls().filter((c) => c.method === 'POST' && c.path.endsWith('/issues')).length).toBe(1);
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    // 「추가」 버튼 탭도 입력칸 포커스를 뺏지 않는다(iOS 키보드 유지).
    await input.fill('둘째 하위');
    await page.getByTestId('child-add-form').getByRole('button', { name: '추가' }).click();
    await expect.poll(() => calls().filter((c) => c.method === 'POST' && c.path.endsWith('/issues')).length).toBe(2);
    await expect(input).toHaveValue('');
    await expect(input).toBeFocused();
    // 비운 채로 포커스를 잃으면 다시 접힌다.
    await input.blur();
    await expect(page.getByTestId('child-add-open')).toBeVisible();
  });

  // WP-653 — 제목을 쓰기 전에 유형부터 누르면 입력칸 blur(relatedTarget 없음)로 폼 전체가 접혀 유형을 고를 수 없었다.
  test('에픽 「＋ 하위 이슈 추가」 — 제목 전에 유형부터 골라도 칸이 유지되고, 고르면 제목칸으로 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page, { type: makeEpicType() });
    await openDetail(page);
    await page.getByTestId('child-add-open').click();
    const input = page.getByTestId('child-add-input');
    await expect(input).toBeFocused();
    const typeSelect = page.getByTestId('epic-child-type-select');
    // iOS Safari(WebKit)는 버튼을 탭해도 포커스를 주지 않아 입력칸이 relatedTarget 없이 blur 된다 — Chromium 에서 같은 순서를 재현.
    await typeSelect.evaluate((el) => el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    }, { capture: true, once: true }));
    await typeSelect.tap();
    await page.getByRole('option', { name: '버그' }).click();
    await expect(typeSelect).toHaveText('버그');
    // 유형을 고른 다음은 제목 — 키보드가 바로 다시 올라오게 제목칸에 포커스.
    await expect(input).toBeFocused();
    await input.fill('결제 승인 실패 시 재시도');
    await input.press('Enter');
    await expect.poll(() => calls().filter((c) => c.method === 'POST' && c.path.endsWith('/issues')).length).toBe(1);
    expect(calls().find((c) => c.method === 'POST')!.body).toMatchObject({ title: '결제 승인 실패 시 재시도', typeId: 2, parentNumber: 7 });
    // 비운 채로 폼 밖을 누르면 지금처럼 접힌다.
    await input.blur();
    await expect(page.getByTestId('child-add-open')).toBeVisible();
  });
});

test.describe('하단 코멘트 입력·편집 바', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await installFakeViewport(page);
  });

  test('코멘트 입력은 화면 하단 — 키보드가 열리면 바로 위로, 헤더는 제자리', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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

  test('전송 중 에디터가 한 번도 blur 되지 않고 포커스 유지, 4줄 넘으면 내부 스크롤', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
    await expect.poll(() => calls().some((c) => c.method === 'POST' && c.path === '/api/v1/issues/7/comments')).toBe(true);
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

  test('긴 제목은 3줄까지 보이고, 편집은 줄바꿈되는 입력칸 — Enter 로 저장', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
    await expect.poll(() => calls().find((c) => c.method === 'PATCH')?.body).toMatchObject({ title: '짧은 제목' });
  });

  test('한글 IME — 조합 Enter 와 확정 직후 꼬리 Enter 로는 저장하지 않고, 다음 Enter 에 저장(WP-331)', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    const calls = await mockDetail(page);
    await openDetail(page);
    await page.getByTestId('issue-title-edit').click();
    const input = page.getByTestId('issue-title-input');
    await input.fill('새 제목');
    await pressMacChromeImeEnter(input, '목');
    // 마지막 글자 확정만 — 편집 바가 그대로이고 PATCH 도 없다. 꼬리 Enter 로 개행이 들어가지도 않는다.
    await expect(page.getByTestId('mobile-edit-bar')).toBeVisible();
    await expect(input).toHaveValue('새 제목');
    await expectStays(page, () => calls().filter((c) => c.method === 'PATCH').length, 0);
    await input.press('Enter');
    await expect(page.getByTestId('mobile-edit-bar')).toHaveCount(0);
    await expect.poll(() => calls().find((c) => c.method === 'PATCH')?.body).toMatchObject({ title: '새 제목' });
  });

  test('편집 바로 바뀌어도 쓰던 코멘트 초안은 남는다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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
});

test.describe('헤더 ⬆︎ 공유(WP-1234)', () => {
  test('390px 상세 헤더에 ⬆︎·채팅·⋯ 가 넘침 없이 한 줄로 들어가고 이슈 키 제목도 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockDetail(page);
    await openDetail(page);
    const header = page.getByTestId('page-header');
    const share = header.getByTestId('mobile-share-button');
    await expect(share).toBeVisible();
    const headerBox = (await header.boundingBox())!;
    // 오른쪽 클러스터 버튼이 모두 헤더 높이 안 한 줄에, 화면 오른쪽 끝 안에 있다.
    for (const el of [share, header.getByTestId('mobile-header-more')]) {
      const box = (await el.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(headerBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    // 제목(이슈 키)이 밀려 사라지지 않는다 — 키 글자(WP-7)가 잘리지 않을 만큼 폭이 남는다.
    const title = header.getByTestId('breadcrumb-current');
    await expect(title).toContainText('WP-7');
    const { scrollWidth, clientWidth } = await title.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    // ⬆︎ 는 공유 시트를 연다(실제 브라우저 탭).
    await share.click();
    await expect(page.getByTestId('share-sheet')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
