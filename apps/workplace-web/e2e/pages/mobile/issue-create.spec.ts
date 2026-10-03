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

  test('내용이 있으면 취소·Esc 모두 버림 확인 — 계속 작성/버리기', async ({ authenticatedPage: page }) => {
    await mockCreate(page);
    const sheet = await openSheet(page);
    await page.getByTestId('issue-create-title').fill('작성 중');
    await page.getByTestId('issue-create-cancel').click();
    const dlg = page.getByTestId('issue-create-discard-dialog');
    await expect(dlg).toContainText('작성 중인 내용을 버릴까요?');
    await page.getByTestId('issue-create-discard-keep').click();
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
