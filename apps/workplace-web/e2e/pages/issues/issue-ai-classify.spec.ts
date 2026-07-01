// AI 이슈 분류 제안 E2E 테스트 — API 모킹으로 백엔드 없이 실행.
// 무엇을: 이슈 생성 다이얼로그 + 이슈 편집 화면에서 AI 제안 버튼을 클릭해 폼/속성 필드가 채워지는 흐름을 검증.
// 왜: Task 3·4 구현 후 AI 분류 제안 UX 를 결정론적으로 보장.

import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { createIssueSearchResponse, createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createChatThread } from '../../factories/chat.factory';

const PROJECT_KEY = 'TEST';

// 라벨 목록 목 데이터.
const mockLabels = [
  { id: 1, name: 'backend', colorToken: 'violet' },
  { id: 2, name: 'bug', colorToken: 'red' },
];

// AI 분류 제안 응답 목 데이터.
const mockClassifyResponse = {
  type: 'BUG',
  priority: 'HIGH',
  labels: ['backend'],
  reason: '500 오류 + 사용자 직접 영향 → HIGH, 버그 유형',
};

// 프로젝트 상세 + 이슈 목록 + 이슈 유형 + 라벨 공통 스텁.
// issue-create-validation.spec.ts 의 stubProject 패턴 미러.
async function stubProject(page: import('@playwright/test').Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject({ key: PROJECT_KEY, name: '테스트 프로젝트', type: 'TEAM' }));
  await mockApi(
    page,
    'GET',
    `/api/v1/projects/${PROJECT_KEY}/issues`,
    createIssueSearchResponse([]),
  );
  // 이슈 유형 — /types 경로.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(systemTypes()),
      }),
  );
  // 라벨 목록.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockLabels),
      }),
  );
  // 기타 GET 은 빈 목록으로 처리(이슈 관련 경로는 제외).
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/**`, (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/issues')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.fallback();
  });
}

test.describe('이슈 AI 분류 제안', () => {
  test('생성 다이얼로그에서 AI 제안 받기', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    await stubProject(page);

    // AI 분류 API 목 — stubProject 의 catch-all 보다 나중에 등록하여 우선 처리.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/ai-classify`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockClassifyResponse),
        }),
    );

    await page.goto(`/projects/${PROJECT_KEY}`);

    // "+ 새 태스크" 버튼 클릭 — 기존 테스트 패턴 동일.
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 제목 없을 때 버튼 비활성화 확인.
    const aiBtn = dialog.getByTestId('ai-classify-btn');
    await expect(aiBtn).toBeDisabled();

    // 제목 입력.
    await dialog.getByLabel('제목').fill('로그인 버튼 클릭 시 500 오류');

    // 제목 있을 때 버튼 활성화 확인.
    await expect(aiBtn).toBeEnabled();

    // AI 제안 요청 payload 검증.
    const [classifyReq] = await Promise.all([
      page.waitForRequest((req) =>
        req.url().includes('/issues/ai-classify') && req.method() === 'POST',
      ),
      aiBtn.click(),
    ]);
    const body = classifyReq.postDataJSON() as { title: string; body: string };
    expect(body.title).toBe('로그인 버튼 클릭 시 500 오류');

    // reason 서브텍스트가 표시됨 확인.
    await expect(dialog.getByTestId('ai-classify-reason')).toBeVisible();
    await expect(dialog.getByTestId('ai-classify-reason')).toContainText('500 오류');

    // 우선순위가 HIGH(높음) 로 변경됨 확인.
    const prioritySelect = dialog.locator('#issue-priority');
    await expect(prioritySelect).toContainText('높음');

    // 사용자가 직접 우선순위 변경 가능 확인.
    await prioritySelect.click();
    await page.getByRole('option', { name: '낮음' }).click();
    await expect(prioritySelect).toContainText('낮음');

    // 정상 저장 (이슈 생성 API 목).
    await mockApi(
      page,
      'POST',
      `/api/v1/projects/${PROJECT_KEY}/issues`,
      createIssue({ title: '로그인 버튼 클릭 시 500 오류' }),
    );
    await dialog.getByRole('button', { name: '생성' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('편집 화면 IssuePropertyRail AI 제안', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    // 이슈 상세 페이지 공통 스텁 — issue-detail-layout.spec.ts 패턴 미러.
    const issueDetail = createIssueDetail({
      summary: createIssue({ projectKey: PROJECT_KEY, number: 1, title: '기존 이슈 제목', priority: 'LOW' }),
      body: '기존 본문',
    });

    // 프로젝트 상세 — TEAM 타입이어야 리다이렉트 없이 풀페이지 렌더.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}`,
      (route) => route.fulfill({ json: createProject({ key: PROJECT_KEY, name: '테스트 프로젝트', type: 'TEAM' }) }),
    );
    // 이슈 상세 GET.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
      (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: issueDetail });
        // PATCH — 성공 응답으로 처리.
        return route.fulfill({ json: issueDetail });
      },
    );
    // AI 분류 엔드포인트 목.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/ai-classify`,
      (route) => route.fulfill({ json: mockClassifyResponse }),
    );
    // 라벨 목록.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
      (route) => route.fulfill({ json: mockLabels }),
    );
    // 멤버 목록.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/members`,
      (route) => route.fulfill({ json: [] }),
    );
    // 채팅 스레드 — IssueChatPanel 이 항상 호출.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/chat/thread`,
      (route) => route.fulfill({ json: createChatThread({ threadId: 1, recentMessages: [] }) }),
    );
    // 나머지 이슈 하위 엔드포인트(watchers·attachments·drive-links 등) 빈 배열.
    await page.route(
      (url) => url.pathname.startsWith(`/api/v1/projects/${PROJECT_KEY}/issues/1/`),
      (route) => route.fulfill({ json: [] }),
    );
    // 드라이브 spaces.
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces',
      (route) => route.fulfill({ json: [] }),
    );
    // 이슈 유형.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`,
      (route) => route.fulfill({ json: systemTypes() }),
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    // 속성 레일의 AI 제안 버튼 확인 — 편집 화면은 이슈가 있으므로 항상 활성화.
    const aiBtn = page.getByTestId('ai-classify-btn');
    await expect(aiBtn).toBeVisible();
    await expect(aiBtn).toBeEnabled();

    // 클릭 후 reason 서브텍스트 표시 확인.
    await aiBtn.click();
    await expect(page.getByTestId('ai-classify-reason')).toBeVisible();
    await expect(page.getByTestId('ai-classify-reason')).toContainText('500 오류');

    // #578 회귀 방지 — 우선순위·유형·라벨 3개 mutation 이 개별 토스트 대신
    // 통합 토스트 1개만 노출해야 한다.
    await expect(page.getByText('AI 제안을 적용했습니다')).toBeVisible();
    await expect(page.getByText('유형을 변경했습니다')).not.toBeVisible();
    await expect(page.getByText('라벨을 저장했습니다')).not.toBeVisible();
    await expect(page.getByText('이슈 필드가 업데이트되었습니다')).not.toBeVisible();
    // sonner 토스트 DOM 자체도 1개만 존재하는지 확인 — 텍스트 매칭만으로는
    // stacking 여부(2개 이상 동시 존재)를 놓칠 수 있으므로 개수도 직접 센다.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1);
  });

  test('AI 제안 실패 시 토스트 표시 + 폼 동작 유지', async ({ authenticatedPage: page }) => {
    await stubProject(page);

    // 실패 응답으로 재목.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/ai-classify`,
      (route) =>
        route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'issue_classify_failed' }),
        }),
    );

    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('제목').fill('제목');
    await dialog.getByTestId('ai-classify-btn').click();

    // 에러 토스트 확인.
    await expect(page.getByText('AI 제안을 받지 못했습니다')).toBeVisible();

    // 폼은 여전히 열려있음 확인.
    await expect(dialog).toBeVisible();
  });
});
