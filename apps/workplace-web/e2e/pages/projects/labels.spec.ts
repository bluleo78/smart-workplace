// 라벨 도메인 E2E.
// 시나리오: 설정 페이지에서 OWNER 가 라벨을 생성 → 프로젝트로 이동해 라벨 필터 적용 → URL 의 label= 동기화.

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
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
      const issueSearches = trackRequests(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/issues`);
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          const url = new URL(route.request().url());
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
      // colorToken 열거형 원시값(RED 등)이 행에 노출되지 않아야 함 (#307).
      await expect(page.getByTestId(`label-row-${createdId}`)).not.toContainText('RED');

      // 2) 리스트로 이동 + 라벨 필터 popover 열기.
      await page.goto(`/projects/${PROJECT_KEY}`);
      await expect(page.getByTestId('issue-row-1')).toBeVisible();

      await page.getByTestId('add-filter-trigger').click();
      await page.getByTestId('add-filter-facet-label').click();
      await page.getByTestId(`facet-value-label-${createdId}`).click();
      await expect(page.getByTestId('filter-chip-label')).toBeVisible();

      // URL 에 label= 가 들어오고, 백엔드도 label CSV 를 받음.
      await expect(page).toHaveURL(/label=/);
      await expect.poll(() =>
        issueSearches.urls().some((u) => u.search.includes(`label=${createdId}`)),
      ).toBe(true);
    },
  );

  test(
    '라벨 2개 이상 선택 시 AND 결합(모두 포함) 표기 노출 — 다른 facet(OR)과 구분 (#626)',
    async ({ authenticatedPage: page }) => {
      const labelA = createLabel({ name: '라벨A', colorToken: 'RED' });
      const labelB = createLabel({ name: '라벨B', colorToken: 'BLUE' });
      const issue = createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' });

      await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createProject()),
        }),
      );

      await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([labelA, labelB]),
        });
      });

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([issue], null)),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}`);
      await expect(page.getByTestId('issue-row-1')).toBeVisible();

      // 라벨 필터 팝오버를 열면 AND 힌트가 선택 전부터 노출되어야 한다.
      await page.getByTestId('add-filter-trigger').click();
      await page.getByTestId('add-filter-facet-label').click();
      await expect(page.getByTestId('facet-value-label-and-hint')).toBeVisible();
      await expect(page.getByTestId('facet-value-label-and-hint')).toContainText('모두 가진');

      // 라벨 1개만 선택했을 땐 다른 facet과 구분할 게 없으므로 "+N"/"(모두 포함)" 표기가 없다.
      await page.getByTestId(`facet-value-label-${labelA.id}`).click();
      await expect(page.getByTestId('filter-chip-label')).toBeVisible();
      await expect(page.getByTestId('filter-chip-label')).not.toContainText('모두 포함');

      // 2개 선택 시 칩에 "외 N (모두 포함)" 표기 — 다른 facet(status/assignee 등)의 "+N"과 구분.
      await page.getByTestId(`facet-value-label-${labelB.id}`).click();
      const chip = page.getByTestId('filter-chip-label');
      await expect(chip).toContainText('외 1');
      await expect(chip).toContainText('모두 포함');
      await expect(page.getByTestId('filter-chip-label-and')).toBeVisible();
      await expect(chip).toHaveAttribute('title', /모두 가진/);

      const labelParam = new URL(page.url()).searchParams.get('label');
      expect(labelParam?.split(',').map(Number).sort()).toEqual([labelA.id, labelB.id].sort());
    },
  );

  test(
    '삭제된 라벨을 참조하는 필터 진입 시 원시 ID 대신 플레이스홀더 노출 (#609)',
    async ({ authenticatedPage: page }) => {
      // 라벨이 삭제되어 현재 옵션 목록에는 없지만, URL(또는 저장된 뷰)은 여전히
      // 존재하지 않는 라벨 ID(99999)를 참조하는 상황을 재현.
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
      // 라벨 목록은 비어있음 — 99999 는 더 이상 존재하지 않음(삭제됨).
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      });
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
        (route) => {
          if (route.request().method() !== 'GET') return route.fallback();
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createIssueSearchResponse([issue], null)),
          });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}?label=99999`);

      const chip = page.getByTestId('filter-chip-label');
      await expect(chip).toBeVisible();
      // 원시 숫자 ID(99999) 는 노출되면 안 되고, 대신 사람이 읽을 수 있는 플레이스홀더가 보여야 한다.
      await expect(chip).not.toContainText('99999');
      await expect(chip).toContainText('알 수 없음');
    },
  );

  test(
    '라벨 이름 변경 — shadcn Dialog 로 PATCH 발생, window.prompt 없음 (#160)',
    async ({ authenticatedPage: page }) => {
      const label = createLabel({ name: '원래이름', colorToken: 'GRAY' });
      // 이름 변경은 PUT/PATCH 어느 쪽이든 받는다 — 이 경로엔 다른 요청이 없어 메서드 구분 없이 기록.
      const labelUpdates = trackRequests(page, 'ANY', `/api/v1/projects/${PROJECT_KEY}/labels/${label.id}`);

      await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
      );
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([createMember({ userId: 1, username: 'me', name: 'Me', role: 'OWNER' })]),
        });
      });
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([label]),
        });
      });
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels/${label.id}`, (route) => {
        const method = route.request().method();
        if (method !== 'PUT' && method !== 'PATCH') return route.fallback();
        label.name = (route.request().postDataJSON() as { name: string }).name;
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(label),
        });
      });

      await page.goto(`/projects/${PROJECT_KEY}/settings`);
      const row = page.getByTestId(`label-row-${label.id}`);
      await expect(row).toBeVisible();

      // 이름 변경 버튼 클릭 → native prompt 가 아닌 shadcn Dialog 가 떠야 함.
      await row.getByRole('button', { name: '원래이름 이름 변경' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('라벨 이름 변경');

      // 새 이름 입력 후 확인 — PATCH payload 검증.
      const input = page.getByTestId('rename-dialog-input');
      await input.clear();
      await input.fill('새이름');
      await page.getByTestId('rename-dialog-confirm').click();

      await expect.poll(() => labelUpdates.lastBody<{ name?: string }>()?.name).toBe('새이름');
      // Dialog 가 닫혀야 함.
      await expect(dialog).toBeHidden();
    },
  );

  test(
    '라벨 삭제 — AlertDialog 확인 후 DELETE 발생 (#148)',
    async ({ authenticatedPage: page }) => {
      const label = createLabel({ name: '삭제대상', colorToken: 'RED' });
      let deleted = false;

      await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
      );
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([createMember({ userId: 1, username: 'me', name: 'Me', role: 'OWNER' })]),
        });
      });
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(deleted ? [] : [label]),
          });
        }
        return route.fallback();
      });
      const deletes = trackRequests(page, 'DELETE', `/api/v1/projects/${PROJECT_KEY}/labels/${label.id}`);
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels/${label.id}`, async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        deleted = true;
        return route.fulfill({ status: 204, body: '' });
      });

      await page.goto(`/projects/${PROJECT_KEY}/settings`);
      const row = page.getByTestId(`label-row-${label.id}`);
      await expect(row).toBeVisible();

      // 삭제 버튼 클릭 → AlertDialog 확인 버튼 클릭 → DELETE 발생.
      await row.getByRole('button', { name: `${label.name} 삭제` }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('button', { name: '삭제' }).last().click();

      await deletes.waitFor();
      await expect(page.getByTestId(`label-row-${label.id}`)).toBeHidden();
    },
  );
});

test.describe('라벨 행 hover 상태 (#308 회귀)', () => {
  // 라벨 목록 행에 hover:bg-accent/50 클래스가 있는지 검증 — 클릭 가능 행 시각 피드백 회귀 방지.
  test('라벨 목록 행에 hover 스타일 클래스가 적용된다', async ({ authenticatedPage: page }) => {
    const label = createLabel({ name: 'hover-test', colorToken: 'BLUE' });

    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([createMember({ userId: 1, username: 'me', name: 'Me', role: 'OWNER' })]),
      });
    });
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([label]) });
    });

    await page.goto(`/projects/${PROJECT_KEY}/settings`);
    const row = page.getByTestId(`label-row-${label.id}`);
    await expect(row).toBeVisible();

    // hover:bg-accent/50 + transition-colors 클래스가 className 속성에 있어야 함 (#308 회귀 방지).
    await expect(row).toHaveClass(/hover:bg-accent\/50/);
    await expect(row).toHaveClass(/transition-colors/);
  });
});

test.describe('프로젝트 설정 페이지 내비게이션 (#667)', () => {
  // 설정 페이지에 PageHeader 브레드크럼 + 프로젝트 복귀 버튼이 있어야 함 — 사이클/타임라인과 동일 패턴.
  test('PageHeader 프로젝트 복귀 내비게이션 노출', async ({ authenticatedPage: page }) => {
    await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([createMember({ userId: 1, username: 'me', name: 'Me', role: 'OWNER' })]),
      });
    });
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/labels`, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.goto(`/projects/${PROJECT_KEY}/settings`);

    const header = page.getByTestId('page-header');
    await expect(header).toBeVisible();
    await expect(header).toContainText(PROJECT_KEY);
    await header.getByRole('button', { name: '프로젝트로 돌아가기' }).click();
    await expect(page).toHaveURL(`/projects/${PROJECT_KEY}`);
  });
});
