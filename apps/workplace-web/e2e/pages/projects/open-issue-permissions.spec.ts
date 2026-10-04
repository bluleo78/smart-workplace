// OPEN 프로젝트 이슈 상세·보드 권한 분기 E2E 테스트 (Task 11).
// 무엇을: 서버 플래그(viewerCanEditContent/viewerCanEditWorkflow/viewerCanDelete/viewerIsMember)로
//          UI 분기가 올바르게 동작하는지 검증.
// 왜: 백엔드가 reporter·멤버 구분을 플래그로 내려주므로, 프론트가 플래그를 정확히 반영하는지 확인한다.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'OPNQA';
const ISSUE_NUMBER = 1;

// OPEN 프로젝트 + 이슈 상세 API 스텁 공통 설정 헬퍼.
async function setupOpenProjectMocks(
  page: import('@playwright/test').Page,
  options: {
    viewerCanEditContent: boolean;
    viewerCanEditWorkflow: boolean;
    viewerCanDelete: boolean;
    viewerIsMember: boolean;
    /** 이슈 본문(미지정 시 팩토리 기본값) — 본문 이미지 열람 케이스에서 사용. */
    body?: string;
  },
) {
  const project = createProject({
    key: PROJECT_KEY,
    type: 'OPEN',
    viewerIsMember: options.viewerIsMember,
  });
  const summary = createIssue({ projectKey: PROJECT_KEY, number: ISSUE_NUMBER, reporterId: 2 });
  const detail = createIssueDetail({
    summary,
    ...(options.body !== undefined ? { body: options.body } : {}),
    viewerCanEditContent: options.viewerCanEditContent,
    viewerCanEditWorkflow: options.viewerCanEditWorkflow,
    viewerCanDelete: options.viewerCanDelete,
  });

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(project),
    }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail),
      }),
  );
  // 이슈 상세 진입 시 자동 호출되는 서브 엔드포인트 스텁
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // 드라이브·공간 쿼리 스텁 (IssueAttachmentList 자동 호출)
  await page.route('**/api/v1/drive/links*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // #798 — 실제 엔드포인트는 원시 배열을 반환한다(페이지네이션 envelope 아님).
  await page.route('**/api/v1/drive/spaces*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  // 이슈 유형·AI 컨텍스트 스텁
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issue-types`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/ai-summary`,
    (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  // 사이클 피커
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
}

// 보드 페이지 스텁 설정 헬퍼
async function setupBoardMocks(
  page: import('@playwright/test').Page,
  viewerIsMember: boolean,
) {
  const project = createProject({
    key: PROJECT_KEY,
    type: 'OPEN',
    viewerIsMember,
  });

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(project),
    }),
  );
  await page.route(
    (url) =>
      url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues` ||
      url.pathname.startsWith(`/api/v1/projects/${PROJECT_KEY}/issues`),
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
      }),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/saved-views`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/cycles/active`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }),
  );
}

// ─── 이슈 상세 — OPEN reporter (비멤버) 시나리오 ────────────────────────────────

test(
  'OPEN reporter: 제목 편집 버튼 활성, 상태 select 비활성',
  async ({ authenticatedPage: page }) => {
    // reporter (viewerCanEditContent=true, viewerCanEditWorkflow=false)
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
    });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 제목 편집 연필 버튼 — 활성(reporter 본인 이슈이므로 편집 허용)
    await expect(page.getByTestId('issue-title-edit')).toBeEnabled();

    // 상태 변경 select 트리거 버튼 — 비활성(워크플로 수정 불가)
    await expect(page.getByTestId('issue-status-select')).toBeDisabled();
  },
);

test(
  'OPEN reporter: 삭제 버튼 미표시 (viewerCanDelete=false)',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
    });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 삭제 버튼 미표시
    await expect(page.getByTestId('issue-delete')).not.toBeVisible();
  },
);

// ─── 이슈 상세 — 멤버 시나리오 ─────────────────────────────────────────────────

test(
  '멤버: 제목 편집·상태 select·삭제 버튼 모두 활성',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: true,
      viewerCanDelete: true,
      viewerIsMember: true,
    });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 제목 편집 연필 버튼 활성
    await expect(page.getByTestId('issue-title-edit')).toBeEnabled();

    // 상태 select 활성
    await expect(page.getByTestId('issue-status-select')).toBeEnabled();

    // 삭제 버튼 표시
    await expect(page.getByTestId('issue-delete')).toBeVisible();
  },
);

// ─── 보드 — 비멤버(OPEN reporter) 시나리오 ──────────────────────────────────────

test(
  'OPEN 비멤버: 보드에서 "새 태스크" 버튼 표시 (OPEN 프로젝트는 테넌트 전원 생성 가능)',
  async ({ authenticatedPage: page }) => {
    await setupBoardMocks(page, false);
    // board 뷰로 이동 (URL param 으로 board 뷰 지정)
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // OPEN 비멤버도 이슈 생성 가능 — canCreateIssue = isOpenProject || viewerIsMember
    await expect(page.getByRole('button', { name: '+ 새 태스크' })).toBeVisible();
  },
);

// ─── 보드 — OPEN 프로젝트 비멤버도 이슈 생성 허용 확인 ─────────────────────────

test(
  'OPEN 멤버: 보드에서 "새 태스크" 버튼 표시',
  async ({ authenticatedPage: page }) => {
    await setupBoardMocks(page, true);
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // 멤버는 이슈 생성 버튼 표시
    await expect(page.getByRole('button', { name: '+ 새 태스크' })).toBeVisible();
  },
);

// ─── 이슈 상세 — 첨부 드롭존 노출 (WP-202) ─────────────────────────────────────
// 왜: 첨부 업로드 권한은 본문 편집 권한과 같다. 편집 가능한 OPEN reporter 에겐 드롭존을 보여주고,
//     편집 불가 열람자에겐 숨겨 클릭 후 403("프로젝트 멤버가 아닙니다")을 받는 일이 없게 한다.

test(
  'OPEN reporter(비멤버): 첨부 드롭존 표시 + 파일 선택 시 업로드 POST',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
    });
    // 업로드 POST 스텁 — 비멤버 reporter 의 드롭존이 실제로 첨부 엔드포인트를 호출하는지 확인.
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/attachments`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const dropzone = page.getByTestId('attachment-dropzone');
    await expect(dropzone).toBeVisible();
    // 드라이브 링크 추가도 같은 권한(본문 편집)이라 함께 노출된다.
    await expect(page.getByTestId('issue-drive-link-add-btn')).toBeVisible();
    const uploadReq = page.waitForRequest(
      (req) =>
        req.method() === 'POST' &&
        req.url().endsWith(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/attachments`),
    );
    await dropzone.locator('input[type="file"]').setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    // multipart 본문에 선택한 파일이 files 필드로 실려 간다.
    expect((await uploadReq).postData() ?? '').toContain('filename="photo.png"');
  },
);

test(
  'OPEN 열람자(비멤버·비reporter): 첨부 드롭존·드라이브 링크 버튼 미표시',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: false,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
    });
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 권한 로드 완료의 양성 신호 — 본문 편집 버튼은 viewerCanEditContent 가 정해져야 비활성으로 렌더된다.
    // 그 뒤에 부재를 단언해야 로딩 중이라 없는 것과 권한이 없어 없는 것을 구분한다(WP-219).
    await expect(page.getByRole('button', { name: '본문 편집' })).toBeDisabled();
    // 첨부 스트립 자체는 렌더(목록 열람 가능)되지만 업로드 드롭존·링크 버튼은 없다.
    // 첨부 0건·편집 불가면 스트립은 내용 없는 0px 섹션이라 toBeVisible 은 로딩 문구가 보이는 순간에만 우연히 통과한다.
    await expect(page.getByTestId('issue-attachment-strip')).toBeAttached();
    await expect(page.getByTestId('attachment-dropzone')).toHaveCount(0);
    await expect(page.getByTestId('issue-drive-link-add-btn')).toHaveCount(0);
  },
);

// ─── 이슈 상세 — 본문 이미지 권한 (WP-199) ─────────────────────────────────────
// 왜: 이미지 업로드 권한도 본문 편집 권한과 같다. OPEN 비멤버 reporter 는 붙여넣기 업로드가 실제로 나가야 하고,
//     편집 불가 열람자는 이미지 버튼이 없지만 본문에 이미 있는 이미지는 볼 수 있어야 한다.

const IMG_URL = `/api/v1/projects/${PROJECT_KEY}/issue-images/77`;
// 1x1 투명 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test(
  'OPEN reporter(비멤버): 본문 편집에서 이미지 버튼 표시 + 붙여넣기 시 업로드 요청 전송',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: true,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
    });
    // 업로드 POST 스텁 — 비멤버도 실제로 엔드포인트를 호출하는지만 확인한다.
    await page.route(`**/api/v1/projects/${PROJECT_KEY}/issue-images`, (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ fileId: 77, url: IMG_URL, name: 'bug.png', mimeType: 'image/png', size: 70 }),
      }),
    );
    await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await page.getByRole('button', { name: '본문 편집' }).click();
    await expect(page.getByTestId('issue-body-image-button')).toBeVisible();

    const uploadReq = page.waitForRequest(
      (req) => req.method() === 'POST' && req.url().endsWith(`/projects/${PROJECT_KEY}/issue-images`),
    );
    await page.getByTestId('issue-body-textarea').evaluate((el) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'bug.png', { type: 'image/png' }));
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    });
    // multipart 본문에 붙여넣은 파일이 실려 간다.
    expect((await uploadReq).postData() ?? '').toContain('filename="bug.png"');
    await expect(page.getByTestId('issue-body-textarea')).toHaveValue(new RegExp(`!\\[bug\\.png\\]\\(${IMG_URL.replace(/\//g, '\\/')}\\)`));
  },
);

test(
  'OPEN 열람자(편집 불가): 본문 편집 비활성·이미지 버튼 없음, 본문 이미지는 표시',
  async ({ authenticatedPage: page }) => {
    await setupOpenProjectMocks(page, {
      viewerCanEditContent: false,
      viewerCanEditWorkflow: false,
      viewerCanDelete: false,
      viewerIsMember: false,
      body: `재현 화면\n\n![bug.png](${IMG_URL})`,
    });
    await page.route(`**${IMG_URL}`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 열람은 가능 — 인증 blob 으로 이미지가 로드된다.
    await expect(page.getByRole('img', { name: 'bug.png' })).toHaveAttribute('src', /^blob:/);
    // 편집 진입 불가 → textarea·이미지 버튼 모두 없다.
    await expect(page.getByRole('button', { name: '본문 편집' })).toHaveAttribute('aria-disabled', 'true');
    // eslint-disable-next-line playwright/no-force-option -- aria-disabled 버튼을 일부러 눌러 편집 진입이 막히는지 확인
    await page.getByRole('button', { name: '본문 편집' }).click({ force: true });
    await expect(page.getByTestId('issue-body-textarea')).toHaveCount(0);
    await expect(page.getByTestId('issue-body-image-button')).toHaveCount(0);
  },
);
