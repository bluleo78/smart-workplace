// 이슈 라벨 선택기에서 없는 라벨을 그 자리에서 만들기(WP-394) E2E.
// 브라우저 입력이 있어야 판정되는 한글 조합 중 Enter(IME, @input)만 남긴다 — 조합 확정용 Enter 로는 만들지 않는다.
// 만들기 → POST(GRAY) → 체크 → 닫으면 PUT 한 번, 40자 제한, 빠른 두 번 클릭, Enter 로 만들기·일부 겹침 Enter 무시, 생성 실패는
// 페이지 테스트 src/pages/projects/labelInlineCreate.test.tsx 가 지킨다(WP-980).

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createLabel, toLabelSummary } from '../../factories/label.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { LabelResponse } from '../../../src/types/label';

const PROJECT_KEY = 'WP';
const LABELS_PATH = `/api/v1/projects/${PROJECT_KEY}/labels`;
const ISSUE_LABELS_PATH = `/api/v1/projects/${PROJECT_KEY}/issues/1/labels`;

/**
 * 이슈 상세 + 라벨 목록 스텁. 현재 사용자(id=1)는 일반 MEMBER — 멤버도 라벨을 만들 수 있어야 한다.
 * createStatus 가 200 이 아니면 POST /labels 를 그 상태로 실패시킨다.
 */
async function stubIssueWithLabels(page: Page, opts: { createStatus?: number } = {}) {
  const bug = createLabel({ id: 1, name: 'bug', colorToken: 'RED' });
  const labels: LabelResponse[] = [bug, createLabel({ id: 2, name: 'severity:minor', colorToken: 'YELLOW' })];
  const detail = createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '로그인 오류', labels: [toLabelSummary(bug)] }) });

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'MEMBER' })]),
        })
      : route.fallback(),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) })
        : route.fallback(),
  );
  for (const sub of ['watchers', 'attachments']) {
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  // 라벨 목록 GET + 생성 POST — 만든 라벨은 목록에 누적돼 재조회에도 보인다.
  await page.route(
    (url) => url.pathname === LABELS_PATH,
    (route) => {
      if (route.request().method() === 'POST') {
        if (opts.createStatus && opts.createStatus !== 200) {
          return route.fulfill({
            status: opts.createStatus,
            contentType: 'application/json',
            body: JSON.stringify({ message: '프로젝트 멤버가 아닙니다' }),
          });
        }
        const { name, colorToken } = route.request().postDataJSON() as { name: string; colorToken: 'GRAY' };
        const created = createLabel({ id: 99, name, colorToken, viewerCanManage: true });
        labels.push(created);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(labels) });
    },
  );
  await page.route(
    (url) => url.pathname === ISSUE_LABELS_PATH,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

/** 이슈 상세로 가서 접혀 있는 「분류」 그룹을 펼치고 라벨 선택기를 연다. */
async function openPicker(page: Page) {
  await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
  const group = page.getByTestId('property-group-classification');
  await group.getByRole('button', { name: /분류/ }).click();
  await page.getByTestId('label-picker-trigger').click();
  const picker = page.getByTestId('label-picker');
  await expect(picker).toBeVisible();
  // 라벨 목록이 로드된 뒤에만 만들기를 판단한다.
  await expect(picker.getByTestId('label-option-1')).toBeVisible();
  return picker;
}

test.describe('이슈 라벨 즉석 만들기', () => {
  test('한글 조합 중 Enter 는 만들지 않고, 조합이 끝난 Enter 로 만든다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubIssueWithLabels(page);
    const posts = trackRequests(page, 'POST', LABELS_PATH);
    const picker = await openPicker(page);
    const search = picker.getByLabel('라벨 검색');

    await search.fill('긴급');
    // 조합 확정용 Enter(isComposing) — Mac Chrome 에서 마지막 글자 확정과 함께 오는 keydown.
    await search.evaluate((el) =>
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })),
    );
    await expect(picker.getByTestId('label-create-option')).toBeVisible();
    expect(posts.count()).toBe(0);

    await search.press('Enter');
    await posts.waitFor();
    expect(posts.lastBody()).toEqual({ name: '긴급', colorToken: 'GRAY' });
    await expect(picker.getByLabel('긴급')).toBeChecked();
    expect(posts.count()).toBe(1);
  });
});
