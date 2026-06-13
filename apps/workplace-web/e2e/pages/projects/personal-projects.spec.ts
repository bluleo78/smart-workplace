// 개인(PERSONAL) 프로젝트 E2E — 생성 다이얼로그(유형 토글·key 자동) → 사이드바 개인 섹션 → 설정 멤버 관리 숨김.
// + 팀 프로젝트 key 유효성(deferred U5) 회귀.
// 전 구간 page.route 모킹(백엔드 무관). 모킹 데이터는 실제 ProjectResponse 타입(factory) 사용.

import { createMember, createProject } from '../../factories/project.factory';
import { createPageResponse, mockApi } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';

// Test 1 — happy path 전체 파이프라인:
// 개인 프로젝트 생성(payload 에 key 없음·type PERSONAL) → 사이드바 개인 섹션 노출 → 설정에 멤버 관리 없음.
test(
  '개인 프로젝트 생성 → 개인 섹션 노출 → 설정에 멤버 관리 없음',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const personal = createProject({
      id: 7,
      key: 'PABC',
      name: '개인 작업',
      type: 'PERSONAL',
      isDefault: true,
    });

    // GET /projects — 생성 전엔 빈 목록, POST 이후엔 PABC 노출(create → 사이드바 반영 파이프라인 검증).
    // created 토글은 POST 라우트 핸들러에서 처리(테스트 본문 타이밍 의존 race 회피).
    let created = false;
    const createdPayloads: unknown[] = [];
    await page.route(
      (url) => url.pathname === '/api/v1/projects',
      (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(createPageResponse(created ? [personal] : [])),
          });
        }
        if (method === 'POST') {
          createdPayloads.push(route.request().postDataJSON());
          created = true;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(personal),
          });
        }
        return route.fallback();
      },
    );

    await page.goto('/projects');

    // 생성 다이얼로그 열기 — 기본 유형은 TEAM 이라 key 필드가 보인다.
    await page.getByRole('button', { name: '+ 새 프로젝트' }).click();
    await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible();
    await expect(page.getByLabel('key (예: WP)')).toBeVisible();

    // 개인 유형 선택 → key 필드 사라짐(서버 자동 생성).
    await page.getByTestId('project-type-PERSONAL').click();
    await expect(page.getByLabel('key (예: WP)')).toHaveCount(0);

    await page.getByLabel('이름').fill('개인 작업');
    await page.getByRole('button', { name: '생성' }).click();

    // 사이드바 개인 섹션에 생성된 프로젝트 노출(목록 invalidate → 재페치 반영).
    const sidebar = page.getByTestId('sidebar-personal-projects');
    await expect(sidebar).toContainText('개인 작업');
    await expect(page.getByTestId('personal-project-PABC')).toBeVisible();

    // 페이로드 검증 — name·type 전달, key 는 미전송(서버 자동).
    expect(createdPayloads).toHaveLength(1);
    const payload = createdPayloads[0] as { name: string; type: string; key?: string };
    expect(payload).toMatchObject({ name: '개인 작업', type: 'PERSONAL' });
    expect(payload.key).toBeUndefined();

    // 설정 페이지 — 개인 프로젝트는 멤버 관리 섹션이 없다.
    await mockApi(page, 'GET', '/api/v1/projects/PABC', personal);
    await mockApi(page, 'GET', '/api/v1/projects/PABC/members', [createMember({ userId: 1 })]);

    await page.goto('/projects/PABC/settings');
    // 로딩 화면이 아닌 실제 설정 페이지가 떴음을 먼저 확정(거짓 통과 방지).
    await expect(page.getByRole('heading', { name: '프로젝트 설정' })).toBeVisible();
    // 멤버 관리 헤딩(<h2>멤버</h2>) 부재 확인.
    await expect(page.getByRole('heading', { name: '멤버' })).toHaveCount(0);
  },
);

// Test 2 (deferred U5) — 팀 프로젝트 생성 시 잘못된 key 는 UI 에러를 보여주고 POST 가 발생하지 않는다.
test('팀 프로젝트 생성 시 잘못된 key 는 UI 에러를 보여준다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([]));
  // POST 캡처 — zod 검증 실패 시 mutation 자체가 막혀 요청이 없어야 함.
  const createCapture = await mockApi(
    page, 'POST', '/api/v1/projects', createProject(), { capture: true },
  );

  await page.goto('/projects');
  await page.getByRole('button', { name: '+ 새 프로젝트' }).click();
  await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible();

  // 기본 유형 TEAM — key 필드가 보인다.
  await expect(page.getByLabel('key (예: WP)')).toBeVisible();
  // 잘못된 key(소문자) + 정상 이름 입력 후 제출.
  await page.getByLabel('key (예: WP)').fill('abc');
  await page.getByLabel('이름').fill('팀 프로젝트');
  await page.getByRole('button', { name: '생성' }).click();

  // 한국어 유효성 에러 노출 — zod 가 동기적으로 mutation 을 막는다.
  await expect(
    page.getByText('대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다'),
  ).toBeVisible();
  // 에러 렌더 시점엔 POST 가 발생했을 수 없다 → 캡처된 요청 0건, 다이얼로그 유지.
  expect(createCapture.requests).toHaveLength(0);
  await expect(page.getByRole('dialog', { name: '새 프로젝트' })).toBeVisible();
});
