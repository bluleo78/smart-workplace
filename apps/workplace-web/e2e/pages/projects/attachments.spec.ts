// 이슈 첨부 E2E — 브라우저가 있어야 판정되는 것만 남긴다.
// 남는 것: 다운로드·PDF/이미지 렌더·실시간 재조회(SSE)·닫기로 ?preview 지우기(history)(@platform), ‹ › 키보드 넘기기·포커스 복귀(@input),
//          드라이브 하위 폴더로 여는 두 화면 흐름(@flow).
// 업로드·삭제·25MB/10개 한도·스피너·버튼 이름·권한별 삭제, HWP 미지원·휴지통·삭제된 링크·요약 403·요약 패널·⋯·드라이브로 가져오기,
// 없는 첨부 딥링크 안내는 페이지 테스트 src/pages/projects/attachments.test.tsx 가 지킨다(WP-980).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '../../fixtures/auth.fixture';
import { mockGatedEvents, resourceChangedFrame } from '../../fixtures/gatedEvents';
import { trackRequests } from '../../fixtures/requests';
import { expectStays } from '../../fixtures/wait';
import { createAttachment } from '../../factories/attachment.factory';
import { createFile, createFolder, createSpace } from '../../factories/drive.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueAttachment } from '../../../src/types/attachment';

const PROJECT_KEY = 'WP';
// ESM 컨텍스트: __dirname 대신 이 스펙 파일 기준 디렉토리. 실제 PDF 바이트는 공용 픽스처를 쓴다(pdf.js 가 그려야 하므로).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = fs.readFileSync(path.join(HERE, '../../fixtures/sample-3p.pdf'));

// 공통 stub 묶음 — 프로젝트/멤버/이슈 상세/watcher/labels(PUT) 까지.
async function setupCommonStubs(
  page: import('@playwright/test').Page,
  attachmentCount: number,
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
    }),
  );

  // 현재 사용자(id=1) 는 멤버가 아님 → isOwner=false. (업로드/자기 첨부 삭제는 무관)
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({ id: 1, number: 1, title: '첨부 대상', attachmentCount }),
            body: '본문',
            comments: [],
            history: [],
            attachments: [],
          }),
        ),
      });
    },
  );

  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/watchers`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 라벨 PUT 등 측면 호출이 떨어질 가능성 대비.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // 프로젝트 라벨 목록 — 라벨 피커가 호출.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );

  // #80: 드라이브 링크·공간 쿼리 — IssueAttachmentList 가 항상 호출하므로 빈 배열로 스텁.
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/drive-links`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

// WP-203 — 이슈 첨부 프리뷰: 파일명 클릭은 다운로드가 아니라 공용 프리뷰 모달을 연다.
test.describe('이슈 첨부 프리뷰 (WP-203)', () => {
  const CONTENT = (fileId: number) =>
    `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments/${fileId}/content`;

  // 첨부 목록 GET + 첨부별 콘텐츠 응답을 스텁하고, 콘텐츠 요청 횟수를 fileId 별로 센다.
  async function stubAttachments(
    page: import('@playwright/test').Page,
    attachments: IssueAttachment[],
    contents: Record<number, { contentType: string; body: Buffer }>,
  ) {
    await setupCommonStubs(page, attachments.length);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(attachments) })
          : route.fallback(),
    );
    const requested: Record<number, number> = {};
    for (const [id, c] of Object.entries(contents)) {
      await page.route(
        (url) => url.pathname === CONTENT(Number(id)),
        (route) => {
          requested[Number(id)] = (requested[Number(id)] ?? 0) + 1;
          return route.fulfill({ status: 200, contentType: c.contentType, body: c.body });
        },
      );
    }
    return requested;
  }

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  test(
    '이미지 첨부 파일명을 클릭하면 프리뷰 모달에 이미지가 보이고 모달에서 다운로드할 수 있다',
    { tag: ['@platform', '@smoke'] },
    async ({ authenticatedPage: page }) => {
      const requested = await stubAttachments(
        page,
        [createAttachment({ fileId: 7001, originalName: 'shot.png', mimeType: 'image/png' })],
        { 7001: { contentType: 'image/png', body: PNG } },
      );
      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      await page.getByRole('button', { name: 'shot.png 미리보기' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'shot.png' })).toBeVisible();
      await expect(page.getByTestId('preview-body').locator('img')).toBeVisible();
      expect(requested[7001]).toBeGreaterThanOrEqual(1);
      // 이슈 첨부는 드라이브 전용 패널(AI 요약·참조된 곳)을 쓰지 않는다.
      await expect(page.getByTestId('drive-summary-card')).toHaveCount(0);

      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: '다운로드' }).click();
      expect((await download).suggestedFilename()).toBe('shot.png');
    },
  );

  test('PDF 첨부는 실제 PDF 바이트면 뷰어로, PDF 로 위장한 HTML 이면 오류로 표시된다', { tag: '@platform' }, async ({
    authenticatedPage: page,
  }) => {
    await stubAttachments(
      page,
      [
        createAttachment({ fileId: 7101, originalName: 'real.pdf', mimeType: 'application/pdf' }),
        createAttachment({ fileId: 7102, originalName: 'fake.pdf', mimeType: 'application/pdf' }),
      ],
      {
        7101: { contentType: 'application/pdf', body: SAMPLE_PDF },
        7102: { contentType: 'application/pdf', body: Buffer.from('<html><script>alert(1)</script></html>') },
      },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'real.pdf 미리보기' }).click();
    // WP-277: PDF 는 iframe 이 아니라 pdf.js 캔버스(페이지별 testid)로 그린다.
    await expect(page.getByTestId('pdf-page-1')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'fake.pdf 미리보기' }).click();
    const body = page.getByTestId('preview-body');
    await expect(body).toContainText('미리보기를 불러오지 못했습니다.');
    await expect(body.locator('iframe')).toHaveCount(0);
  });

  test('미리 볼 수 없는 형식은 안내와 함께 모달에서 다운로드할 수 있다', { tag: '@platform' }, async ({
    authenticatedPage: page,
  }) => {
    const requested = await stubAttachments(
      page,
      [createAttachment({ fileId: 7301, originalName: 'build.zip', mimeType: 'application/zip' })],
      { 7301: { contentType: 'application/zip', body: Buffer.from('PK') } },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'build.zip 미리보기' }).click();
    await expect(page.getByTestId('preview-body')).toContainText('이 형식은 미리 볼 수 없어요');
    // 미지원 형식은 프리뷰용 콘텐츠를 받지 않는다.
    expect(requested[7301]).toBeUndefined();

    const download = page.waitForEvent('download');
    // 뷰어는 헤더와 안내 화면에 다운로드가 각각 있다 — 안내 화면의 버튼을 쓴다.
    await page.getByTestId('preview-body').getByRole('button', { name: '다운로드' }).click();
    expect((await download).suggestedFilename()).toBe('build.zip');
  });

  test('10MB 를 넘는 첨부는 크기를 보여주고, 미리보기를 누를 때만 내려받는다', { tag: '@platform' }, async ({
    authenticatedPage: page,
  }) => {
    const size = 12 * 1024 * 1024;
    const requested = await stubAttachments(
      page,
      [createAttachment({ fileId: 7402, originalName: 'huge.log', mimeType: 'text/plain', sizeBytes: size })],
      { 7402: { contentType: 'text/plain', body: Buffer.concat([Buffer.from('HEAD-LINE\n'), Buffer.alloc(size, 0x61)]) } },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'huge.log 미리보기' }).click();
    const confirm = page.getByTestId('preview-size-confirm');
    await expect(confirm).toContainText('12.0 MB');
    // 묻는 동안에는 콘텐츠를 받지 않는다.
    expect(requested[7402]).toBeUndefined();

    // 확인 화면의 다운로드도 동작한다.
    const download = page.waitForEvent('download');
    await confirm.getByRole('button', { name: '다운로드' }).click();
    expect((await download).suggestedFilename()).toBe('huge.log');

    await confirm.getByRole('button', { name: '미리보기' }).click();
    await expect(page.getByTestId('preview-body').locator('pre')).toContainText('HEAD-LINE');
    await expect(confirm).toHaveCount(0);
  });

  test('칩의 다운로드 아이콘은 모달 없이 바로 내려받는다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubAttachments(
      page,
      [createAttachment({ fileId: 7501, originalName: 'spec.pdf', mimeType: 'application/pdf' })],
      { 7501: { contentType: 'application/pdf', body: Buffer.from('%PDF-1.4') } },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    const row = page.getByTestId('attachment-row-7501');
    // 아이콘은 hover 없이도 항상 보인다(휴대폰·키보드 접근).
    const dl = row.getByRole('button', { name: 'spec.pdf 다운로드' });
    await expect(dl).toBeVisible();
    const download = page.waitForEvent('download');
    await dl.click();
    expect((await download).suggestedFilename()).toBe('spec.pdf');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

// WP-277 — 이슈 첨부·드라이브 링크를 한 묶음으로 → 로 넘기고, 휴지통 원본은 사용할 수 없음 안내만 보인다.
test.describe('이슈 첨부 뷰어 묶음 (WP-277)', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  const driveLink = (driveFileId: number, over: Record<string, unknown> = {}) => ({
    driveFileId,
    fileId: driveFileId + 1000,
    name: `linked-${driveFileId}.txt`,
    mimeType: 'text/plain',
    sizeBytes: 4,
    hasThumbnail: false,
    spaceId: 1,
    spaceName: '팀 공간',
    availability: 'ACTIVE',
    createdById: 1,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  });

  // 첨부 목록 + 드라이브 링크 목록·콘텐츠·요약·참조된 곳 stub.
  async function stubBundle(
    page: import('@playwright/test').Page,
    attachments: IssueAttachment[],
    links: ReturnType<typeof driveLink>[],
  ) {
    await setupCommonStubs(page, attachments.length);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(attachments) })
          : route.fallback(),
    );
    // setupCommonStubs 의 빈 drive-links 보다 나중에 등록해 우선한다.
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/drive-links`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(links) })
          : route.fallback(),
    );
    for (const l of links) {
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/drive-links/${l.driveFileId}/content`,
        (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'LINKED-BODY' }),
      );
      await page.route(
        (url) => url.pathname === `/api/v1/drive/files/${l.driveFileId}/summary`,
        (route) => route.fulfill({ json: { summary: null, status: 'PENDING' } }),
      );
      await page.route(
        (url) => url.pathname === `/api/v1/drive/files/${l.driveFileId}/backlinks`,
        (route) => route.fulfill({ json: [] }),
      );
    }
  }

  test('이미지·PDF·드라이브 링크 3건을 → 로 넘긴다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubBundle(
      page,
      [
        createAttachment({ fileId: 7601, originalName: 'shot.png', mimeType: 'image/png' }),
        createAttachment({ fileId: 7602, originalName: 'doc.pdf', mimeType: 'application/pdf' }),
      ],
      [driveLink(601)],
    );
    for (const [id, contentType, body] of [
      [7601, 'image/png', PNG],
      [7602, 'application/pdf', SAMPLE_PDF],
    ] as const) {
      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments/${id}/content`,
        (route) => route.fulfill({ status: 200, contentType, body }),
      );
    }
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'shot.png 미리보기' }).click();
    await expect(page.getByTestId('preview-body').locator('img')).toBeVisible();
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 3');
    await expect(page).toHaveURL(/preview=file(%3A|:)7601/);

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('pdf-page-1')).toBeVisible();
    await expect(page.getByTestId('preview-meta')).toContainText('2 / 3');

    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('preview-body')).toContainText('LINKED-BODY');
    await expect(page.getByTestId('viewer-live')).toHaveText('linked-601.txt, 3개 중 3번째');
    await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0);
  });

  test('⋯ 드라이브에서 열기는 하위 폴더에 있는 링크 파일을 그 폴더에서 미리보기로 연다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
    // 링크 응답에는 폴더 id 가 없다 — 공간 이름 검색으로 폴더(5)를 찾아 ?folderId=5&preview=605 로 가야 한다.
    await stubBundle(page, [], [driveLink(605, { name: 'deep.txt' })]);
    const searches = trackRequests(page, 'GET', '/api/v1/drive/spaces/1/search');
    const deep = createFile({ id: 605, folderId: 5, fileId: 1605, name: 'deep.txt', sizeBytes: 4 });
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces/1/search',
      (route) => route.fulfill({ json: { folders: [], files: [{ ...deep, folderPath: '하위' }] } }),
    );
    // 공간 루트에는 이 파일이 없다 — 루트로 열면 "찾을 수 없음"이 된다(회귀 조건).
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces/1/items',
      (route) =>
        route.fulfill({
          json:
            new URL(route.request().url()).searchParams.get('parentId') === '5'
              ? { folders: [], files: [deep] }
              : { folders: [createFolder({ id: 5, name: '하위' })], files: [] },
        }),
    );
    await page.route((url) => url.pathname === '/api/v1/drive/spaces/1', (route) => route.fulfill({ json: createSpace({ id: 1 }) }));
    await page.route((url) => url.pathname === '/api/v1/drive/folders/5/path', (route) => route.fulfill({ json: [{ id: 5, name: '하위' }] }));
    await page.route((url) => url.pathname === '/api/v1/drive/quota', (route) => route.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 } }));
    await page.route((url) => url.pathname === '/api/v1/drive/files/605/content', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: 'DEEP' }),
    );
    await page.route((url) => url.pathname === '/api/v1/drive/files/605/thumbnail', (route) => route.fulfill({ status: 404 }));

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByRole('button', { name: 'deep.txt 미리보기' }).click();
    await expect(page.getByTestId('preview-body')).toContainText('LINKED-BODY');
    await page.getByRole('button', { name: '더 보기' }).click();
    await page.getByRole('menuitem', { name: '드라이브에서 열기' }).click();

    await expect(page).toHaveURL(/\/drive\/spaces\/1\?folderId=5&preview=605$/);
    expect(searches.lastUrl()?.searchParams.get('q')).toBe('deep.txt');
    // 드라이브 쪽 콘텐츠 경로로 같은 파일이 열린다 — 찾을 수 없음 안내가 아니다.
    await expect(page.getByTestId('preview-body')).toContainText('DEEP');
    await expect(page.getByTestId('preview-not-found')).toHaveCount(0);
  });

  test('열린 첨부가 실시간 재조회로 목록에서 빠져도 뷰어는 그 파일을 1건으로 유지한다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const a = createAttachment({ fileId: 7801, originalName: 'keep.txt', mimeType: 'text/plain' });
    const b = createAttachment({ fileId: 7802, originalName: 'other.txt', mimeType: 'text/plain' });
    await stubBundle(page, [a, b], []);
    // 가변 목록 — 재조회 시 열린 첨부까지 모두 빠진다(마지막 첨부 삭제 = 목록 컴포넌트의 빈 분기).
    let list: IssueAttachment[] = [a, b];
    const listCalls = trackRequests(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
          : route.fallback(),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments/7801/content`,
      (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'KEEP-BODY' }),
    );
    const events = await mockGatedEvents(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByRole('button', { name: 'keep.txt 미리보기' }).click();
    await expect(page.getByTestId('preview-body')).toContainText('KEEP-BODY');
    await expect(page.getByTestId('preview-meta')).toContainText('1 / 2');
    const before = listCalls.count();

    list = [];
    events.deliver(
      resourceChangedFrame({ resource: 'issue', op: 'updated', scopeType: 'PROJECT', scopeId: 1, ids: [1], actorId: 99, projectKey: PROJECT_KEY, issueNumber: 1 }),
    );
    await expect.poll(() => listCalls.count()).toBeGreaterThan(before);
    // 스냅숏 1건 묶음 — 파일은 그대로, 순번·‹ › 는 없다. 찾을 수 없음 안내도 뜨지 않는다.
    await expect(page.getByTestId('preview-meta')).not.toContainText('/ 2');
    await expect(page.getByTestId('preview-body')).toContainText('KEEP-BODY');
    await expect(page.getByRole('button', { name: '다음 파일' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '이전 파일' })).toHaveCount(0);
    await expect(page.getByTestId('preview-not-found')).toHaveCount(0);
    await expect(page).toHaveURL(/preview=file(%3A|:)7801/);
  });

  test('목록이 비는 재조회 뒤에도 뷰어가 다시 마운트되지 않아 확대 배율이 유지된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const img = createAttachment({ fileId: 7811, originalName: 'zoom.png', mimeType: 'image/png' });
    await stubBundle(page, [img], []);
    let list: IssueAttachment[] = [img];
    const listCalls = trackRequests(page, 'GET', `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
          : route.fallback(),
    );
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments/7811/content`,
      (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
    );
    const events = await mockGatedEvents(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByRole('button', { name: 'zoom.png 미리보기' }).click();
    await expect(page.getByTestId('preview-body').locator('img')).toBeVisible();
    await page.getByRole('button', { name: '확대' }).click();
    await page.getByRole('button', { name: '확대' }).click();
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('150%');
    const before = listCalls.count();

    // 마지막 첨부가 빠지는 재조회 — 목록 컴포넌트가 빈 분기로 바뀌어도 뷰어는 같은 자리에 남아야 한다.
    list = [];
    events.deliver(
      resourceChangedFrame({ resource: 'issue', op: 'updated', scopeType: 'PROJECT', scopeId: 1, ids: [1], actorId: 99, projectKey: PROJECT_KEY, issueNumber: 1 }),
    );
    await expect.poll(() => listCalls.count()).toBeGreaterThan(before);
    await expect(page.getByTestId('attachment-list')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '맞춤' })).toHaveText('150%');
  });

  // 안내 표시는 페이지 테스트가, 닫기(Esc)로 ?preview 를 지우는 것은 브라우저 history(useHistoryParam)라 여기서 본다.
  test('삭제된 첨부 딥링크는 찾을 수 없음 안내를 보이고 닫으면 ?preview 가 지워진다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await stubBundle(page, [createAttachment({ fileId: 7901, originalName: 'live.txt', mimeType: 'text/plain' })], []);
    await page.goto(`/projects/${PROJECT_KEY}/issues/1?preview=file:999`);
    await expect(page.getByTestId('preview-not-found')).toBeVisible();
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview-not-found')).toHaveCount(0);
    await expect(page).not.toHaveURL(/preview=/);
  });

  test('뷰어를 닫으면 연 첨부 버튼으로 포커스가 돌아온다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
    await stubBundle(page, [createAttachment({ fileId: 7951, originalName: 'focus.txt', mimeType: 'text/plain' })], []);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments/7951/content`,
      (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'F' }),
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    const trigger = page.getByRole('button', { name: 'focus.txt 미리보기' });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'focus.txt 미리보기' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
