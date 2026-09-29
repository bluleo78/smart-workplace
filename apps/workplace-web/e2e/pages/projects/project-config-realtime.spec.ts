// WP-36/WP-60 — 서버 측(AI Chat 등) 프로젝트 설정 변경이 열린 화면에 새로고침 없이 반영되는지 E2E.
// /api/v1/events 를 게이트 모킹해 resource.changed 프레임을 첫 렌더 *뒤에* 흘려보내고, 재조회로 화면이 바뀌는지 본다.
import { createPageResponse } from '../../fixtures/api-mock';
import { expect, test } from '../../fixtures/auth.fixture';
import { mockGatedEvents } from '../../fixtures/gatedEvents';
import { createLabel } from '../../factories/label.factory';
import { createMember, createProject } from '../../factories/project.factory';

const KEY = 'WP';

test.describe('프로젝트 설정 변경 실시간 반영 (WP-60)', () => {
  test('라벨 생성 — 설정 라벨 목록에 새 라벨이 나타난다', async ({ authenticatedPage: page }) => {
    let labels = [createLabel({ id: 1, name: '기존 라벨' })];
    await page.route(`**/api/v1/projects/${KEY}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
    );
    await page.route(`**/api/v1/projects/${KEY}/members`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([createMember({ userId: 1, role: 'OWNER' })]),
      }),
    );
    await page.route(`**/api/v1/projects/${KEY}/labels`, (route) => {
      // 브라우저가 직접 쓰기 요청을 보내면 안 되는 시나리오 — 오면 404 로 드러낸다.
      if (route.request().method() !== 'GET') return route.fulfill({ status: 404 });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(labels) });
    });
    const events = await mockGatedEvents(page);

    await page.goto(`/projects/${KEY}/settings`);
    await expect(page.getByTestId('label-row-1')).toContainText('기존 라벨');
    await expect(page.getByText('AI 라벨')).toHaveCount(0);

    labels = [...labels, createLabel({ id: 5, name: 'AI 라벨' })];
    const data = { resource: 'label', op: 'created', scopeType: 'PROJECT', scopeId: 1, ids: [5], actorId: 99, projectKey: KEY };
    events.deliver(`event: resource.changed\ndata: ${JSON.stringify(data)}\n\n`);

    await expect(page.getByTestId('label-row-5')).toContainText('AI 라벨');
  });

  test('프로젝트 멤버 제거 — 사이드바 프로젝트 목록에서 프로젝트가 사라진다', async ({ authenticatedPage: page }) => {
    // 사이드바는 PERSONAL 프로젝트를 항상 노출한다.
    const p1 = createProject({ id: 1, key: 'P1', name: '프로젝트1', type: 'PERSONAL' });
    const p2 = createProject({ id: 2, key: 'P2', name: '프로젝트2', type: 'PERSONAL' });
    let list = [p1, p2];
    await page.route(
      (url) => url.pathname === '/api/v1/projects',
      (route) => {
        if (route.request().method() !== 'GET') return route.fulfill({ status: 404 });
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createPageResponse(list)),
        });
      },
    );
    const events = await mockGatedEvents(page);

    // 홈(/)에는 이슈 사이드바가 없어 이슈 모듈 레이아웃인 /projects 에서 검증한다.
    await page.goto('/projects');
    await expect(page.getByTestId('personal-project-P2')).toBeVisible();
    await expect(page.getByTestId('personal-project-P1')).toBeVisible();

    list = [p1];
    const data = { resource: 'project-member', op: 'deleted', scopeType: 'PROJECT', scopeId: 2, ids: [1], actorId: 99, projectKey: 'P2' };
    events.deliver(`event: resource.changed\ndata: ${JSON.stringify(data)}\n\n`);

    await expect(page.getByTestId('personal-project-P2')).toHaveCount(0);
    await expect(page.getByTestId('personal-project-P1')).toBeVisible();
  });
});
