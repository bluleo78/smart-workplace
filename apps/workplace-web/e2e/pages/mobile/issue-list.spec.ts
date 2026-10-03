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
const PLAIN = createIssue({ id: 22, number: 22, projectKey: KEY, title: '일반 이슈', priority: 'MID' });
const SUB = createIssue({
  id: 23, number: 23, projectKey: KEY, title: '스토리 하위 이슈',
  parent: { number: 40, title: '스토리 부모', type: { ...makeTaskType(), name: 'STORY' } },
});

async function mock(page: Page) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill(json(createProject({ key: KEY, type: 'TEAM', viewerIsMember: true }))));
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/types`, (r) => r.fulfill(json(systemTypes())));
  for (const p of [`/members`, `/labels`, `/cycles`, `/views`]) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}${p}`, (r) => r.fulfill(json([])));
  }
  await page.route((u) => u.pathname === ISSUES, (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const isEpicList = new URL(r.request().url()).searchParams.get('type') === String(makeEpicType().id);
    return r.fulfill(json(createIssueSearchResponse(isEpicList ? [] : [LONG, PLAIN, SUB], null)));
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
