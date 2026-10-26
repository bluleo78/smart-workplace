// OPEN 접수함 통합 플로우 E2E — Task 12 안전망.
// 무엇을: 비멤버(reporter)가 OPEN 프로젝트 이슈 상세를 열 때 라우트 → 상세 → 하위 fetch → 화면이 이어지고
//          어떤 하위 fetch도 403 이 나지 않음을 검증한다("3분기 함정" 안전망, @wiring).
// 비멤버·멤버의 편집 게이트(상태·사이클·에픽 연결·삭제·하위 추가)와 보고자 건의의 홈 「내 작업」 노출은
// 페이지 테스트 src/pages/projects/openProjectFlow.test.tsx 가 지킨다(WP-980).
// 왜: Tasks 1~11이 완성했지만 "비멤버가 OPEN 이슈 상세를 열 때 프론트가 호출하는
//     모든 하위 엔드포인트(라벨·워처·첨부·AI 요약·사이클·커스텀 필드)"가 모두
//     완화(assertReadable)되어 있는지 한 번에 확인한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'OPNQA';
const ISSUE_NUMBER = 1;

// ─── 공통 스텁 헬퍼 ────────────────────────────────────────────────────────────

/**
 * OPEN 프로젝트 + 이슈 상세 API 스텁 공통 설정.
 * open-issue-permissions.spec.ts 의 setupOpenProjectMocks 와 동일 패턴.
 * @param viewerIsMember 뷰어(현재 사용자)가 멤버인지 여부
 * @param viewerCanEditWorkflow 워크플로(상태) 변경 허용 여부
 */
async function setupFlowMocks(
  page: import('@playwright/test').Page,
  options: {
    viewerIsMember: boolean;
    viewerCanEditContent: boolean;
    viewerCanEditWorkflow: boolean;
    viewerCanDelete: boolean;
  },
) {
  const project = createProject({
    key: PROJECT_KEY,
    type: 'OPEN',
    viewerIsMember: options.viewerIsMember,
  });

  // 이슈 제목이 reporter 가 작성한 건의 내용
  const issueSummary = createIssue({
    projectKey: PROJECT_KEY,
    number: ISSUE_NUMBER,
    title: '다크모드 추가 건의',
    reporterId: 1, // auth.fixture 기본 사용자 id=1
  });

  const issueDetail = createIssueDetail({
    summary: issueSummary,
    viewerCanEditContent: options.viewerCanEditContent,
    viewerCanEditWorkflow: options.viewerCanEditWorkflow,
    viewerCanDelete: options.viewerCanDelete,
  });

  // 프로젝트 메타
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(project),
    }),
  );

  // 프로젝트 멤버 목록 (비멤버 시나리오: 빈 목록)
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 이슈 상세
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(issueDetail),
      }),
  );

  // 이슈 상세 진입 시 자동 호출되는 서브 엔드포인트(라벨·워처·첨부).
  // Task 4 "assertReadable" 완화 대상 — 비멤버도 200이어야 함(안전망 핵심).
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }

  // 프로젝트 레벨 라벨 목록
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // AI 요약(없음 → 404)
  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/ai-summary`,
    (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );

  // 사이클
  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/cycle`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );

  // 커스텀 필드
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/custom-fields`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 이슈 유형
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issue-types`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 드라이브 링크·공간 스텁 (IssueAttachmentList 자동 호출)
  await page.route('**/api/v1/drive/links*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // #798 — 실제 엔드포인트는 원시 배열을 반환한다(페이지네이션 envelope 아님).
  await page.route('**/api/v1/drive/spaces*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

// ─── 시나리오 1: 비멤버(reporter)가 이슈 상세를 열고 모든 하위 뷰가 정상 렌더됨 ──────

test(
  'OPEN 비멤버(reporter): 이슈 상세 진입 시 하위 fetch 전체 정상(403 없음)',
  { tag: ['@wiring', '@smoke'] },
  async ({ authenticatedPage: page }) => {
    // reporter 시나리오: 내용 편집 허용, 워크플로·삭제 불가
    await setupFlowMocks(page, {
      viewerIsMember: false,
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
    });

    // 403 Forbidden 수집 — 안전망 핵심 어서션.
    // 401 은 스텁 미등록 엔드포인트가 목 인증 계층을 통과 못 한 정상적 결과이므로 제외한다.
    // 403 은 권한 거부(assertMember/assertReadable 누락)를 의미하므로 0개이어야 한다.
    const forbidden403: string[] = [];
    page.on('response', (res) => {
      if (res.status() === 403 && res.url().includes('/api/v1/')) {
        forbidden403.push(`403 ${res.url()}`);
      }
    });

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 이슈 제목이 보여야 함(상세 페이지 로드 확인)
    await expect(page.getByTestId('issue-title-edit')).toBeVisible();

    // 속성 레일이 렌더되어야 함(라벨·워처·사이클 등 포함)
    await expect(page.getByTestId('property-rail')).toBeVisible();

    // 분류 그룹(라벨 섹션)이 DOM에 존재해야 함(기본 접힘이므로 toBeAttached로 확인)
    await expect(page.getByTestId('property-group-classification')).toBeAttached();

    // 채팅 버튼이 렌더되어야 함(chat thread fetch 403 → 버튼 자체 미렌더 방지)
    await expect(page.getByTestId('issue-chat-open')).toBeVisible();

    // 403 Forbidden 이 없어야 함 — "3분기 함정" 안전망 핵심.
    // 비멤버(reporter)가 OPEN 이슈 상세를 열 때 어떤 서브 엔드포인트도 권한 거부(403)가
    // 나지 않아야 한다(Task 4 assertReadable 완화 커버리지 확인).
    expect(
      forbidden403,
      `비멤버 OPEN 이슈 상세 열기 중 403 권한 거부 발생: ${forbidden403.join(', ')}`,
    ).toHaveLength(0);
  },
);
