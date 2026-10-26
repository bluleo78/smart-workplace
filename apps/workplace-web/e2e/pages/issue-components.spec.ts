// 프로젝트 구성요소(WP-933) 화면 E2E — 설정 화면 배선(라우트 → 설정 페이지 → 구성요소 섹션 → 추가 POST → 재조회 행, @wiring) 1건만 남긴다.
// 편집·보관·복원·삭제 요청과 400 오류 문구, 이슈 상세 피커의 PUT·보관 구성요소·400 토스트, 만들기 창의 자동 지정 안내·componentIds,
// 비구성원 접수 창, 목록 필터의 component 파라미터·URL·주소에서 시작, 열 칩 +N, 구성요소가 없을 때 숨김은
// 화면·페이지 테스트 src/pages/projects/issueComponents.test.tsx 가 지킨다(WP-971).
// 서버 쪽 규칙(자동 지정·권한·유일성)은 백엔드 통합 테스트가 맡는다.
import type { Page } from '@playwright/test';

import type { ComponentResponse } from '../../src/types/component';
import { createAssignee, createComponent } from '../factories/component.factory';
import { systemTypes } from '../factories/issueType.factory';
import { createMember, createProject } from '../factories/project.factory';
import { expect, test } from '../fixtures/auth.fixture';
import { trackRequests } from '../fixtures/requests';

const KEY = 'WP';
const BASE = `/api/v1/projects/${KEY}`;

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** 박순(id 2) — 구성요소 담당자 후보. 현재 사용자(id 1)는 프로젝트 OWNER. */
const PARK = createAssignee();
const MEMBERS = [
  createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
  createMember({ userId: 2, username: 'park', name: '박순', role: 'MEMBER', active: true }),
];

/**
 * 설정 화면이 부르는 API 를 모킹한다. 구성요소 목록은 서버처럼 상태를 들고 있어 추가(POST)한 행이 재조회에 실린다.
 */
async function setup(page: Page) {
  let list: ComponentResponse[] = [];
  let nextId = 900;

  await page.route(`**${BASE}`, (route) => route.fulfill(json(createProject())));
  await page.route(`**${BASE}/members`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(MEMBERS)) : route.fallback(),
  );
  await page.route(`**${BASE}/types`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json(systemTypes())) : route.fallback(),
  );

  // 구성요소 목록 GET + 추가 POST.
  await page.route(
    (u) => u.pathname === `${BASE}/components`,
    (route) => {
      const req = route.request();
      if (req.method() === 'GET') return route.fulfill(json(list));
      if (req.method() !== 'POST') return route.fallback();
      const body = req.postDataJSON() as { name: string; description?: string | null; defaultAssigneeId?: number | null };
      const created = createComponent({
        id: nextId++,
        name: body.name,
        description: body.description ?? null,
        defaultAssignee: body.defaultAssigneeId === 2 ? PARK : null,
      });
      list = [...list, created];
      return route.fulfill(json(created, 201));
    },
  );
}

test.describe('프로젝트 구성요소 (WP-933)', () => {
  test(
    '설정에서 구성요소를 추가하면 POST 본문이 이름·설명·담당자를 담는다',
    { tag: ['@wiring', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      await setup(page);
      const posts = trackRequests(page, 'POST', `${BASE}/components`);

      await page.goto(`/projects/${KEY}/settings`);
      const section = page.getByTestId('component-section');
      await expect(section).toBeVisible();
      // 구성요소가 없으면 안내 문구.
      await expect(page.getByTestId('component-empty')).toBeVisible();

      await page.getByTestId('component-add').click();
      const dialog = page.getByTestId('component-edit-dialog');
      await expect(dialog).toBeVisible();
      await page.getByTestId('component-name-input').fill('  Compute ');
      await page.getByTestId('component-description-input').fill('컴퓨트 영역');
      await page.getByTestId('component-assignee-select').click();
      await page.getByRole('option', { name: '박순' }).click();
      await page.getByTestId('component-save').click();

      // 이름 앞뒤 공백은 잘려 나가고, 담당자는 id 로 간다.
      await expect.poll(() => posts.lastBody()).toEqual({
        name: 'Compute',
        description: '컴퓨트 영역',
        defaultAssigneeId: 2,
      });
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('구성요소를 추가했어요')).toBeVisible();
      const row = page.getByTestId('component-row-900');
      await expect(row).toContainText('Compute');
      await expect(row).toContainText('컴퓨트 영역');
      await expect(page.getByTestId('component-row-900-assignee')).toHaveText('박순');
      await expect(page.getByTestId('component-row-900-count')).toHaveText('이슈 0');
    },
  );
});
