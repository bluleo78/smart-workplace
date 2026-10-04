// 모바일 이슈 생성(WP-196) — 전체 화면 시트, 헤더 [취소·새 이슈·생성], 제목 → 설명(자동 확장), 칩 줄은 키보드 바로 위, 작성 중 닫기 확인.
import type { Page } from '@playwright/test';

import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { makeEpicType, systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';
import { installFakeViewport, setKeyboard } from '../../fixtures/keyboard';
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture';

const KEY = 'WP';
const json = (b: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
const EPIC = createIssue({ id: 50, number: 50, projectKey: KEY, type: makeEpicType(), title: '결제 개편 에픽' });

async function mockCreate(page: Page) {
  const posts: Record<string, unknown>[] = [];
  await stubChat(page);
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/members`, (r) =>
    r.fulfill(json([{ userId: 1, name: '양동희', username: 'dh.yang@iacloud.kr', kind: 'HUMAN' }, { userId: 2, name: '김개발', username: 'dev.kim@iacloud.kr', kind: 'HUMAN' }])));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues`, (r) => {
    if (r.request().method() === 'POST') {
      posts.push(r.request().postDataJSON());
      return r.fulfill(json(createIssue({ id: 99, number: 99, projectKey: KEY, title: 'new' })));
    }
    return r.fulfill(json(createIssueSearchResponse([EPIC], null)));
  });
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/ai-classify`, (r) =>
    r.fulfill(json({ type: 'BUG', priority: 'HIGH', reason: '오류 재현 절차가 있어 버그로 분류', labels: [] })));
  for (const p of [`/api/v1/projects/${KEY}/labels`, `/api/v1/projects/${KEY}/cycles`, `/api/v1/projects/${KEY}/saved-views`]) {
    await page.route((u) => u.pathname === p, (r) => r.fulfill(json([])));
  }
  return posts;
}

async function openSheet(page: Page) {
  await page.goto(`/projects/${KEY}`);
  await page.getByTestId('mobile-new-issue').click();
  const sheet = page.getByTestId('issue-create-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('생성 시트', () => {
  test('전체 화면, 제목 자동 포커스, 제목 없으면 생성 비활성 → 입력 후 생성', async ({ authenticatedPage: page }) => {
    const posts = await mockCreate(page);
    const sheet = await openSheet(page);
    const vp = page.viewportSize()!;
    const box = (await sheet.boundingBox())!;
    expect(Math.round(box.y)).toBe(0);
    expect(Math.round(box.height)).toBe(vp.height);
    await expect(page.getByTestId('issue-create-title')).toBeFocused();
    await expect(page.getByTestId('issue-create-submit')).toBeDisabled();
    await page.getByTestId('issue-create-title').fill('결제 실패 시 재시도 안내');
    await page.getByTestId('issue-create-submit').click();
    await expect(sheet).toHaveCount(0);
    expect(posts[0]).toMatchObject({ title: '결제 실패 시 재시도 안내', priority: 'MID' });
    expect(posts[0]).not.toHaveProperty('parentNumber');
    await expectNoHorizontalOverflow(page);
  });

  test('설명은 내용에 따라 자라고 최소 3줄', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await openSheet(page);
    const body = page.getByTestId('issue-create-body');
    const h0 = (await body.boundingBox())!.height;
    expect(h0).toBeGreaterThanOrEqual(3 * 24 - 1);
    await body.fill(Array.from({ length: 8 }, (_, i) => `줄 ${i + 1}`).join('\n'));
    await expect.poll(async () => (await body.boundingBox())!.height).toBeGreaterThan(h0 + 48);
  });

  test('제목은 길면 줄바꿈되며 자라고, Enter 는 줄바꿈 대신 설명으로 이동', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await openSheet(page);
    const title = page.getByTestId('issue-create-title');
    const h0 = (await title.boundingBox())!.height;
    await title.fill('결제 페이지에서 카드사 점검 시간에 결제를 시도하면 오류 안내 없이 무한 로딩되는 문제');
    await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(h0 + 20);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('issue-create-body')).toBeFocused();
    expect(await title.inputValue()).not.toContain('\n');
  });

  test('내용이 있으면 취소·Esc 모두 버림 확인 — 계속 작성/버리기', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    const sheet = await openSheet(page);
    await page.getByTestId('issue-create-title').fill('작성 중');
    await page.getByTestId('issue-create-cancel').click();
    const dlg = page.getByTestId('issue-create-discard-dialog');
    await expect(dlg).toContainText('작성 중인 내용을 버릴까요?');
    await page.getByTestId('issue-create-discard-keep').click();
    // 확인창 닫힘 애니메이션(200ms) 중엔 그 레이어가 Esc 를 먼저 받으므로 완전히 사라진 뒤 Esc 를 누른다
    await expect(dlg).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('issue-create-title')).toHaveValue('작성 중');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeVisible();
    await page.getByTestId('issue-create-discard-confirm').click();
    await expect(sheet).toHaveCount(0);
  });

  test('비어 있으면 취소는 바로 닫힌다', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    const sheet = await openSheet(page);
    await page.getByTestId('issue-create-cancel').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('issue-create-discard-dialog')).toHaveCount(0);
  });

  test('빈 시트에서 시스템 back 하면 시트만 닫히고 페이지는 그대로(WP-222)', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    const sheet = await openSheet(page);
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
    await expect(page.getByTestId('mobile-new-issue')).toBeVisible();
  });

  test('내용이 있으면 back 은 버림 확인 — 계속 작성 후 다시 back, 버리기로 닫힘(WP-222)', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    const sheet = await openSheet(page);
    const title = page.getByTestId('issue-create-title');
    await title.fill('작성 중');
    await page.goBack();
    const dlg = page.getByTestId('issue-create-discard-dialog');
    await expect(dlg).toBeVisible();
    await expect(sheet).toBeVisible();
    await page.getByTestId('issue-create-discard-keep').click();
    await expect(dlg).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(title).toHaveValue('작성 중');
    await page.goBack();
    await expect(dlg).toBeVisible();
    await page.getByTestId('issue-create-discard-confirm').click();
    await expect(dlg).toBeHidden();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
  });

  test('취소로 닫은 뒤엔 표식이 남지 않아 back 한 번에 이전 페이지로 간다(WP-222)', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await page.goto('/');
    const sheet = await openSheet(page);
    // 시트가 열린 동안엔 표식이 있어야 아래 「남지 않음」 단언이 의미가 있다.
    await expect.poll(() => page.evaluate(() => JSON.stringify(history.state?.usr ?? null))).toContain('issueCreate');
    await page.getByTestId('issue-create-cancel').click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.stringify(history.state?.usr ?? null))).not.toContain('issueCreate');
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`/projects/${KEY}`));
  });

  test('키보드가 열리면 헤더는 맨 위, 칩 줄은 키보드 바로 위', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await installFakeViewport(page);
    const sheet = await openSheet(page);
    const visible = await setKeyboard(page, true);
    await expect.poll(async () => Math.round((await page.getByTestId('issue-create-submit').boundingBox())!.y)).toBeGreaterThanOrEqual(0);
    await expect.poll(async () => { const b = (await page.getByTestId('issue-create-chips').boundingBox())!; return Math.abs(b.y + b.height - visible); }).toBeLessThanOrEqual(2);
    await expect(sheet).toBeVisible();
  });
});

test.describe('생성 칩 줄', () => {
  test('칩 줄은 가로 스크롤 한 줄, 페이지 넘침 없음', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await openSheet(page);
    const row = page.getByTestId('issue-create-chips');
    for (const k of ['type', 'priority', 'assignee', 'due', 'epic', 'ai', 'more']) await expect(row.getByTestId(`create-chip-${k}`)).toBeAttached();
    const tops = await row.locator('[data-testid^="create-chip-"]').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(tops).toBe(1);
    // ✦ AI·⋯ 는 스크롤 밖에 고정 — 칩 줄을 밀지 않아도 화면 안. 스크롤 영역엔 오른쪽 페이드.
    await expect(row.getByTestId('create-chip-ai')).toBeInViewport({ ratio: 1 });
    await expect(row.getByTestId('create-chip-more')).toBeInViewport({ ratio: 1 });
    expect(await page.getByTestId('create-chips-scroller').evaluate((el) => getComputedStyle(el).maskImage)).toContain('linear-gradient');
    await expectNoHorizontalOverflow(page);
  });

  test('칩 줄을 끝까지 밀어도 긴 에픽 칩 제목이 보인다(페이드에 덮이지 않음)', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await openSheet(page);
    await page.getByTestId('create-chip-epic').click();
    await page.getByTestId('create-epic-sheet').getByTestId('picker-option-50').click();
    const scroller = page.getByTestId('create-chips-scroller');
    await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const epicText = page.getByTestId('create-chip-epic').locator('span.truncate');
    await expect(epicText).toHaveText('결제 개편 에픽');
    await expect(epicText).toBeInViewport({ ratio: 1 });
    // 말줄임 span 자체가 스크롤되지 않았는지(스크롤되면 글자가 비어 보인다).
    expect(await epicText.evaluate((el) => el.scrollLeft)).toBe(0);
    // 에픽 칩 오른쪽 끝이 페이드(스크롤 영역 오른쪽 32px) 밖에 있다.
    const sb = (await scroller.boundingBox())!;
    const eb = (await page.getByTestId('create-chip-epic').boundingBox())!;
    expect(eb.x + eb.width).toBeLessThanOrEqual(sb.x + sb.width - 32 + 1);
  });

  test('칩 탭 → 키보드 내림(포커스 해제) → 시트 → 선택 후 제목 칸 포커스 복귀', async ({ authenticatedPage: page }) => {
    const posts = await mockCreate(page);
    await openSheet(page);
    const title = page.getByTestId('issue-create-title');
    await title.fill('우선순위 높은 이슈');
    await expect(title).toBeFocused();
    await page.getByTestId('create-chip-priority').click();
    await expect(page.getByTestId('create-priority-sheet')).toBeVisible();
    await expect(title).not.toBeFocused();
    await page.getByTestId('create-priority-sheet').getByTestId('picker-option-HIGH').click();
    await expect(page.getByTestId('create-priority-sheet')).toHaveCount(0);
    await expect(title).toBeFocused();
    await expect(page.getByTestId('create-chip-priority')).toContainText('높음');
    await page.getByTestId('issue-create-submit').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ priority: 'HIGH' });
  });

  test('담당자·마감·에픽·시작일이 페이로드에 실린다', async ({ authenticatedPage: page }) => {
    const posts = await mockCreate(page);
    await openSheet(page);
    await page.getByTestId('issue-create-title').fill('속성 많은 이슈');
    await page.getByTestId('create-chip-assignee').click();
    await page.getByTestId('multi-option-2').click();
    await page.getByTestId('create-assignee-sheet-done').click();
    await expect(page.getByTestId('create-chip-assignee')).toContainText('김개발');
    await page.getByTestId('create-chip-due').click();
    await page.getByTestId('create-due-sheet-tomorrow').click();
    await page.getByTestId('create-chip-epic').click();
    await page.getByTestId('create-epic-sheet').getByTestId('picker-option-50').click();
    await expect(page.getByTestId('create-chip-epic')).toContainText('결제 개편 에픽');
    const title = page.getByTestId('issue-create-title');
    await title.focus();
    await page.getByTestId('create-chip-more').click();
    await page.getByTestId('mobile-action-start').click();
    // ⋯ → 시작일: 날짜 시트가 떠 있는 동안 제목은 포커스 없음(시트·키보드 동시 금지), 고른 뒤 제목으로 복귀.
    await expect(page.getByTestId('create-start-sheet')).toBeVisible();
    await expect(title).not.toBeFocused();
    await page.getByTestId('create-start-sheet-today').click();
    await expect(title).toBeFocused();
    await page.getByTestId('issue-create-submit').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ assigneeIds: [2], parentNumber: 50 });
    expect(posts[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(posts[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('⋯ 시트를 액션 없이 닫으면 제목 칸으로 포커스 복귀', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await openSheet(page);
    const title = page.getByTestId('issue-create-title');
    await title.fill('제목');
    await page.getByTestId('create-chip-more').click();
    await expect(page.getByTestId('create-more-sheet')).toBeVisible();
    await expect(title).not.toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('create-more-sheet')).toHaveCount(0);
    await expect(title).toBeFocused();
    await expect(page.getByTestId('issue-create-sheet')).toBeVisible();
  });

  test('에픽을 고른 뒤 유형을 하위 태스크로 바꾸면 에픽은 빠지고 상위 번호 입력이 생긴다', async ({ authenticatedPage: page }) => {
    const posts = await mockCreate(page);
    await openSheet(page);
    await page.getByTestId('issue-create-title').fill('하위 작업');
    await page.getByTestId('create-chip-epic').click();
    await page.getByTestId('picker-option-50').click();
    await page.getByTestId('create-chip-type').click();
    // systemTypes() 의 SUBTASK = id 5, 라벨 = getIssueTypeLabel('SUBTASK')(「하위 태스크」).
    await page.getByTestId('create-type-sheet').getByRole('option', { name: '하위 태스크' }).click();
    await expect(page.getByTestId('create-chip-type')).toContainText('하위 태스크');
    await expect(page.getByTestId('create-chip-epic')).toHaveCount(0);
    // 하위 태스크를 고르는 즉시 상위 번호 입력이 보인다(⋯ 를 거치지 않아도) — 포커스는 훔치지 않는다.
    const parent = page.getByTestId('create-parent-number');
    await expect(parent).toBeVisible();
    await expect(parent).not.toBeFocused();
    // ⋯ → 상위 이슈 번호 는 이미 보이는 입력칸으로 포커스만 옮긴다.
    await page.getByTestId('create-chip-more').click();
    await page.getByTestId('mobile-action-parent').click();
    await expect(parent).toBeFocused();
    await parent.fill('7');
    await page.getByTestId('issue-create-submit').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ parentNumber: 7, typeId: 5 });
  });

  test('✦ AI 제안 — 유형·우선순위 반영, 이유 표시, 제목 포커스 유지', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await openSheet(page);
    const title = page.getByTestId('issue-create-title');
    await title.fill('결제 버튼 누르면 500 오류');
    await page.getByTestId('create-chip-ai').click();
    await expect(page.getByTestId('create-chip-priority')).toContainText('높음');
    await expect(page.getByTestId('create-chip-type')).toContainText('버그');
    await expect(page.getByTestId('create-ai-reason')).toContainText('버그');
    await expect(title).toBeFocused();
  });

  test('칩 위에서 시작한 가로 스와이프는 제목 포커스를 빼앗지 않고, 이후 칩 탭은 정상 복귀', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    await openSheet(page);
    const title = page.getByTestId('issue-create-title');
    await title.fill('스와이프 중');
    await expect(title).toBeFocused();
    // click 없이 끝나는 누름(pointerdown → pointerup) — 칩 줄을 미는 제스처의 시작과 같다.
    const priority = page.getByTestId('create-chip-priority');
    await priority.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
    await priority.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true });
    // 실제 마우스로 칩 위에서 눌러 다른 칩까지 끌고 뗀다(click 은 버튼에 떨어지지 않음).
    const a = (await page.getByTestId('create-chip-due').boundingBox())!;
    const b = (await priority.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(title).toBeFocused();
    await expect(page.getByTestId('create-priority-sheet')).toHaveCount(0);
    await expect(page.getByTestId('create-due-sheet')).toHaveCount(0);
    // 이어서 칩 탭 → 시트 → 선택 → 제목으로 복귀.
    await priority.click();
    await expect(page.getByTestId('create-priority-sheet')).toBeVisible();
    await expect(title).not.toBeFocused();
    await page.getByTestId('create-priority-sheet').getByTestId('picker-option-LOW').click();
    await expect(title).toBeFocused();
    await expect(priority).toContainText('낮음');
  });

  test('에픽을 고른 뒤 유형을 에픽으로 바꾸면 페이로드에 parentNumber 가 없다', async ({ authenticatedPage: page }) => {
    const posts = await mockCreate(page);
    await openSheet(page);
    await page.getByTestId('issue-create-title').fill('새 에픽');
    await page.getByTestId('create-chip-epic').click();
    await page.getByTestId('create-epic-sheet').getByTestId('picker-option-50').click();
    await expect(page.getByTestId('create-chip-epic')).toContainText('결제 개편 에픽');
    await page.getByTestId('create-chip-type').click();
    // systemTypes() 의 EPIC = id 6.
    await page.getByTestId('create-type-sheet').getByTestId('picker-option-6').click();
    await expect(page.getByTestId('create-chip-epic')).toHaveCount(0);
    await page.getByTestId('issue-create-submit').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ typeId: 6 });
    expect(posts[0]).not.toHaveProperty('parentNumber');
  });

  test('개인 프로젝트는 유형·에픽 칩이 없다', async ({ authenticatedPage: page }) => {
    const PKEY = 'PME';
    await stubChat(page);
    await page.route(`**/api/v1/projects/${PKEY}`, (r) => r.fulfill(json(createProject({ id: 7, key: PKEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }))));
    await page.route((u) => u.pathname === `/api/v1/projects/${PKEY}/types`, (r) => r.fulfill(json(systemTypes())));
    await page.route((u) => u.pathname === `/api/v1/projects/${PKEY}/members`, (r) => r.fulfill(json([])));
    await page.route((u) => u.pathname === `/api/v1/projects/${PKEY}/issues`, (r) => r.fulfill(json(createIssueSearchResponse([], null))));
    for (const p of [`/api/v1/projects/${PKEY}/labels`, `/api/v1/projects/${PKEY}/cycles`, `/api/v1/projects/${PKEY}/saved-views`]) {
      await page.route((u) => u.pathname === p, (r) => r.fulfill(json([])));
    }
    await page.goto(`/projects/${PKEY}`);
    await page.getByRole('button', { name: '빠른 추가', exact: true }).click();
    await expect(page.getByTestId('issue-create-sheet')).toBeVisible();
    await expect(page.getByTestId('create-chip-priority')).toBeVisible();
    await expect(page.getByTestId('create-chip-type')).toHaveCount(0);
    await expect(page.getByTestId('create-chip-epic')).toHaveCount(0);
  });
});
