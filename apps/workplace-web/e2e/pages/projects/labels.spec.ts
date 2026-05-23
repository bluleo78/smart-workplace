// 라벨 도메인 E2E.
// 시나리오: 설정 페이지에서 OWNER 가 라벨을 생성 → 프로젝트로 이동해 라벨 필터 적용 → URL 의 label= 동기화.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { createLabel } from '../../factories/label.factory';
import { createMember, createProject } from '../../factories/project.factory';
import type { ColorToken, LabelResponse } from '../../../src/types/label';

const PROJECT_KEY = 'WP';

test.describe('라벨', () => {
  test(
    '설정 페이지에서 라벨 생성 → 보드/리스트 필터로 적용 → URL label= 반영',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 현재 사용자(id=1) 가 OWNER 인 멤버 목록으로 stub — LabelManagement 가 OWNER UI 를 렌더.
      const labels: LabelResponse[] = [];
      const issue = createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' });

      await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createProject()),
        }),
      );

      await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
          ]),
        });
      });

      // 라벨 GET/POST stub — POST 시 in-memory 배열에 누적.
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(labels),
          });
        }
        if (method === 'POST') {
          const body = route.request().postDataJSON() as { name: string; colorToken: ColorToken };
          const created = createLabel({ name: body.name, colorToken: body.colorToken });
          labels.push(created);
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(created),
          });
        }
        return route.fallback();
      });

      // 이슈 검색 — label CSV 가 들어오면 필터링 적용.
      const seenIssueSearches: string[] = [];
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const url = new URL(route.request().url());
          seenIssueSearches.push(url.search);
          const wantLabel = url.searchParams.get('label');
          let items = [issue];
          if (wantLabel) {
            const wanted = wantLabel.split(',').map(Number);
            items = items.filter((i) =>
              wanted.every((w) => i.labels.some((l) => l.id === w)),
            );
          }
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse(items, null)),
          });
        },
      );

      // 1) 설정 페이지에서 라벨 생성.
      await page.goto(`/projects/${PROJECT_KEY}/settings`);
      await expect(page.getByRole('heading', { name: '라벨', level: 2 })).toBeVisible();
      await expect(page.getByTestId('label-create-form')).toBeVisible();

      await page.getByTestId('label-create-form').getByLabel('이름').fill('버그');
      // 색상 팔레트에서 RED 선택 — testid 로 명확하게.
      await page.getByTestId('label-color-RED').click();

      // POST /labels payload 검증을 위해 캡처.
      const postedLabel = page.waitForRequest((req) =>
        req.url().endsWith(`/api/v1/projects/${PROJECT_KEY}/labels`) &&
        req.method() === 'POST',
      );
      await page.getByTestId('label-create-form').getByRole('button', { name: '추가' }).click();
      const req = await postedLabel;
      expect(req.postDataJSON()).toEqual({ name: '버그', colorToken: 'RED' });

      // 라벨이 목록에 표시되어야 함 — testid 로 검증.
      const createdId = labels[0]!.id;
      await expect(page.getByTestId(`label-row-${createdId}`)).toBeVisible();
      await expect(page.getByTestId(`label-row-${createdId}`)).toContainText('버그');

      // 2) 리스트로 이동 + 라벨 필터 popover 열기.
      await page.goto(`/projects/${PROJECT_KEY}`);
      await expect(page.getByTestId('issue-row-1')).toBeVisible();

      await page.getByTestId('label-filter-trigger').click();
      const filterOption = page.getByTestId(`label-filter-option-${createdId}`);
      await expect(filterOption).toBeVisible();
      await filterOption.click();

      // URL 에 label= 가 들어오고, 백엔드도 label CSV 를 받음.
      await expect(page).toHaveURL(/label=/);
      await expect.poll(() =>
        seenIssueSearches.some((s) => s.includes(`label=${createdId}`)),
      ).toBe(true);
    },
  );
});
