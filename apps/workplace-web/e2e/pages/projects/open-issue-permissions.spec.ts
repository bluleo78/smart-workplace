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

// 이슈 상세 reporter·멤버 권한 분기(제목 편집·상태 select·삭제 버튼)는 open-project-flow.spec.ts 가 맡는다.

// ─── 보드 — 비멤버(OPEN reporter) 시나리오 ──────────────────────────────────────
// 판정(OPEN·TEAM × 멤버 여부)은 src/lib/projectPermissions.test.ts 가 맡고, 여기서는 서버 플래그 → 버튼 배선만 본다(WP-413).

test(
  'OPEN 비멤버: 보드에서 "새 태스크" 버튼 표시 (OPEN 프로젝트는 테넌트 전원 생성 가능)',
  async ({ authenticatedPage: page }) => {
    await setupBoardMocks(page, false);
    // board 뷰로 이동 (URL param 으로 board 뷰 지정)
    await page.goto(`/projects/${PROJECT_KEY}?view=board`);

    // OPEN 비멤버도 이슈 생성 가능 — canCreateIssueIn(project)
    await expect(page.getByRole('button', { name: '+ 새 태스크' })).toBeVisible();
  },
);

// WP-713 — 드래그가 막힌 비멤버 보드 카드에 dnd-kit 의 aria-disabled 가 붙어 카드와 「상세 보기」 링크까지 「사용 불가」로 읽혔다.
test('OPEN 비멤버: 드래그 못 하는 보드 카드도 사용 불가로 표시되지 않고 상세로 열린다', async ({ authenticatedPage: page }) => {
  await setupBoardMocks(page, false);
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [createIssue({ id: 7, number: 7, title: '공개 카드' })], nextCursor: null, hasMore: false }),
      }),
  );
  await page.goto(`/projects/${PROJECT_KEY}?view=board`);

  const card = page.getByTestId('issue-card-7');
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute('aria-disabled', /.+/);
  await expect(card).not.toHaveAttribute('aria-roledescription', /.+/);
  const link = card.getByRole('link');
  await expect(link).toBeEnabled();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${PROJECT_KEY}/issues/7$`));
});

// WP-741 — 저장된 뷰는 서버가 멤버 전용이라 비멤버가 보드를 열 때마다 목록 요청이 403 이었고, 쓸 수 없는 「뷰 저장」이 보였다.
test('OPEN 비멤버: 저장된 뷰를 요청하지 않고 「뷰 저장」도 없다 (멤버는 그대로)', async ({ authenticatedPage: page }) => {
  let savedViewRequests = 0;
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === `/api/v1/projects/${PROJECT_KEY}/saved-views`) savedViewRequests += 1;
  });
  await setupBoardMocks(page, false);
  await page.goto(`/projects/${PROJECT_KEY}?view=board`);
  await expect(page.getByTestId('view-chip-bar')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ 새 태스크' })).toBeVisible();
  await expect(page.getByTestId('save-view-button')).toHaveCount(0);
  expect(savedViewRequests).toBe(0);
});

test('OPEN 멤버: 저장된 뷰를 불러오고 「뷰 저장」이 보인다 (WP-741 반대쪽)', async ({ authenticatedPage: page }) => {
  const savedViews = page.waitForRequest((r) => new URL(r.url()).pathname === `/api/v1/projects/${PROJECT_KEY}/saved-views`);
  await setupBoardMocks(page, true);
  await page.goto(`/projects/${PROJECT_KEY}?view=board`);
  await savedViews;
  await expect(page.getByTestId('save-view-button')).toBeVisible();
});

// WP-477 — OPEN 비멤버는 접수만 한다: 새 이슈 다이얼로그가 유형·우선순위·일정 칸 대신 안내를 보이고, 제목·본문만 보낸다
// (서버는 기본값이 아닌 멤버 전용 값을 403 으로 거부). 판정은 projectPermissions.test.ts 의 isIntakeOnly 가 맡는다.
test('OPEN 비멤버: 새 이슈 다이얼로그는 접수 칸만 보이고 제목·본문만 보낸다', async ({ authenticatedPage: page }) => {
  await setupBoardMocks(page, false);
  let posted: Record<string, unknown> | undefined;
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(createIssue({ projectKey: PROJECT_KEY, number: 2, title: '접수 건의' })),
      });
    },
  );
  await page.goto(`/projects/${PROJECT_KEY}?view=board`);
  await page.getByRole('button', { name: '+ 새 태스크' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('create-intake-notice')).toHaveText('우선순위·일정은 처리팀이 정합니다');
  await expect(dialog.getByLabel('우선순위')).toHaveCount(0);
  await expect(dialog.getByLabel('시작일')).toHaveCount(0);
  await expect(dialog.getByTestId('create-type-select')).toHaveCount(0);

  await dialog.getByLabel('제목').fill('접수 건의');
  await dialog.getByLabel('본문').fill('내용');
  await dialog.getByRole('button', { name: '생성' }).click();
  await expect.poll(() => posted).toEqual({ title: '접수 건의', body: '내용' });
});

// ─── 이슈 상세 — 워크플로 잠김 안내 (WP-503) ───────────────────────────────────
// 왜: 비멤버에겐 유형·상태 등이 흐리게만 보여 「기능이 없다」고 받아들였다(VOC WPV-8). 서버 플래그 → 배지 줄 표시 → 팝오버 문구 배선만 본다.
//     문구 분기(멤버·reporter·열람자)는 projectPermissions.test.ts 의 workflowLockedNotice 가 맡는다(WP-413).

test('OPEN reporter(비멤버): 유형 배지 옆 「멤버만 변경」을 누르면 이유와 코멘트 안내가 뜬다', async ({ authenticatedPage: page }) => {
  await setupOpenProjectMocks(page, {
    viewerCanEditContent: true,
    viewerCanEditWorkflow: false,
    viewerCanDelete: true,
    viewerIsMember: false,
  });
  await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

  await expect(page.getByTestId('issue-type-trigger')).toBeDisabled();
  const hint = page.getByTestId('issue-workflow-locked-hint');
  await expect(hint).toHaveText('멤버만 변경');
  await hint.click();
  await expect(page.getByTestId('issue-workflow-locked-popover')).toHaveText(
    '이슈 속성(유형·상태·일정 등)은 프로젝트 멤버만 바꿀 수 있어요. 바꿔야 하면 코멘트로 알려 주세요.',
  );
});

// 서버가 멤버만 허용하는 라벨·의존성·커스텀 필드·AI 제안(우선순위·유형·라벨 변경)도 비멤버에겐 막는다 — 예전엔 열려 있어 누르면 403,
// AI 제안은 셋 다 403 인데도 「적용했습니다」 토스트가 떴다(WP-503). 위젯별 분기는 IssueDependenciesSection·CustomFieldEditor 컴포넌트 테스트.
test('OPEN reporter(비멤버): 라벨·의존성·커스텀 필드는 꺼져 있고 AI 제안 버튼은 없다', async ({ authenticatedPage: page }) => {
  await setupOpenProjectMocks(page, {
    viewerCanEditContent: true,
    viewerCanEditWorkflow: false,
    viewerCanDelete: true,
    viewerIsMember: false,
  });
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/fields`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 11, name: '고객사', type: 'TEXT', options: null, position: 0 }]),
      }),
  );
  await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

  await expect(page.getByTestId('issue-workflow-locked-hint')).toBeVisible();
  await expect(page.getByRole('button', { name: /AI 제안/ })).toHaveCount(0);
  await page.getByTestId('property-group-classification').getByRole('button', { name: /분류/ }).click();
  await expect(page.getByTestId('label-picker-trigger')).toBeDisabled();
  await page.getByTestId('property-group-dependencies').getByRole('button', { name: /의존성/ }).click();
  await expect(page.getByTestId('issue-link-picker-trigger-blockedBy')).toBeDisabled();
  await page.getByTestId('property-group-custom-fields').getByRole('button', { name: /커스텀 필드/ }).click();
  await expect(page.getByTestId('field-input-11')).toBeDisabled();
});

// ─── 이슈 상세 — 첨부 드롭존 노출 (WP-202) ─────────────────────────────────────
// 왜: 첨부 업로드 권한은 본문 편집 권한과 같다. 편집 가능한 OPEN reporter 에겐 드롭존을 보여주고,
//     편집 불가 열람자에겐 숨겨 클릭 후 403("프로젝트 멤버가 아닙니다")을 받는 일이 없게 한다.
//     열람자 숨김 분기는 IssueAttachmentStrip.test.tsx(컴포넌트 테스트)가 맡는다(WP-413).

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
