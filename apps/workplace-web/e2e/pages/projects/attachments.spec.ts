// 이슈 첨부 E2E.
// - 정상 업로드/삭제 happy path (smoke)
// - 25MB 초과 파일은 클라이언트 사전 검증에서 토스트 + POST 차단

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

test.describe('이슈 첨부', () => {
  test(
    '드롭존으로 파일 업로드 → 목록 갱신 → 삭제 → 빈 상태',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      // 가변 첨부 저장소 — GET 은 이 배열, POST 는 누적, DELETE 는 제거.
      let store: IssueAttachment[] = [];

      await setupCommonStubs(page, 0);

      const posts = trackRequests(page, 'POST', `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`);
      const deletes = trackRequests(page, 'DELETE', /^\/api\/v1\/projects\/WP\/issues\/1\/attachments\/\d+$/);

      await page.route(
        (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
        (route) => {
          const method = route.request().method();
          if (method === 'GET') {
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(store),
            });
          }
          if (method === 'POST') {
            const added = createAttachment({
              fileId: 9001 + store.length,
              originalName: 'spec.pdf',
              sizeBytes: 1024,
              mimeType: 'application/pdf',
              attachedById: 1,
            });
            store = [...store, added];
            return route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([added]),
            });
          }
          return route.fallback();
        },
      );

      await page.route(
        (url) =>
          /\/api\/v1\/projects\/WP\/issues\/1\/attachments\/\d+$/.test(url.pathname),
        (route) => {
          if (route.request().method() !== 'DELETE') return route.fallback();
          const m = route.request().url().match(/attachments\/(\d+)$/);
          const fileId = m ? Number(m[1]) : -1;
          store = store.filter((a) => a.fileId !== fileId);
          return route.fulfill({ status: 204, body: '' });
        },
      );

      await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

      const dropzone = page.getByTestId('attachment-dropzone');
      await expect(dropzone).toBeVisible();
      await expect(dropzone).toContainText('파일을 드롭하거나 클릭해 첨부');
      // Task #343: 첨부가 본문 스트립으로 이동 → strip 모드에서는 빈 상태 텍스트 미표시 (드롭존만).
      // 오직 드롭존이 보여야 함 — 첨부가 없습니다 텍스트는 strip 에서 숨김.
      await expect(page.getByTestId('issue-attachment-strip')).toBeVisible();

      // 숨겨진 input 으로 파일 주입 — 클릭 핸들러 우회.
      await dropzone.locator('input[type=file]').setInputFiles({
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('hello-attachment'),
      });

      // 성공 토스트 + 목록 1행 — 토스트가 보이면 mutation 이 onSuccess 까지 도달.
      await expect(page.getByText('1개 첨부를 추가했습니다')).toBeVisible();
      expect(posts.count()).toBe(1);
      await expect(page.getByTestId('attachment-list')).toBeVisible();
      const row = page.getByTestId('attachment-row-9001');
      await expect(row).toBeVisible();
      await expect(row).toContainText('spec.pdf');

      // 삭제 → AlertDialog 확인 → 빈 상태 (#148: window.confirm → shadcn AlertDialog).
      // WP-203: 삭제 버튼은 hover 없이 항상 보인다.
      await row.getByRole('button', { name: 'spec.pdf 삭제' }).click();
      // AlertDialog 가 뜨고 삭제 버튼 클릭으로 확인.
      await expect(page.getByTestId('attachment-delete-dialog')).toBeVisible();
      await page.getByTestId('attachment-delete-confirm').click();
      await expect(page.getByText('첨부를 삭제했습니다')).toBeVisible();
      expect(deletes.count()).toBe(1);
      // Task #343: 첨부가 본문 스트립으로 이동 → strip 모드에서는 빈 상태 텍스트 미표시.
      // 오직 드롭존만 표시됨.
      const strip = page.getByTestId('issue-attachment-strip');
      await expect(strip.getByTestId('attachment-dropzone')).toBeVisible();
      // 삭제된 칩(attachment-row-9001)이 실제로 DOM 에서 사라졌는지 검증.
      // getByText('첨부가 없습니다')는 strip 모드에서 항상 0이라 삭제 여부를 증명하지 못함.
      await expect(strip.getByTestId('attachment-row-9001')).toHaveCount(0);
    },
  );

  test('25MB 초과 파일은 클라이언트 사전 검증으로 토스트 + POST 미발생', async ({
    authenticatedPage: page,
  }) => {
    await setupCommonStubs(page, 0);

    const posts = trackRequests(page, 'POST', `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          });
        }
        if (method === 'POST') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          });
        }
        return route.fallback();
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    const dropzone = page.getByTestId('attachment-dropzone');
    await expect(dropzone).toBeVisible();

    // 26MB 버퍼 — 한도(25MB) 초과.
    const oversized = Buffer.alloc(26 * 1024 * 1024, 0);
    await dropzone.locator('input[type=file]').setInputFiles({
      name: 'huge.bin',
      mimeType: 'application/octet-stream',
      buffer: oversized,
    });

    await expect(page.getByText('huge.bin는 25MB 한도를 초과합니다')).toBeVisible();
    // 사전 검증 통과 파일이 없으므로 POST 가 발생하지 않아야 한다.
    await expectStays(page, posts.count, 0);
  });

  test('이슈당 첨부 한도(10개) 초과 시 올바른 조사 포함 토스트 표시', async ({
    authenticatedPage: page,
  }) => {
    // attachmentCount=9 → currentCount=9. 2개 업로드 시 첫 번째(9+0<10)는 수락, 두 번째(9+1=10)는 한도 초과.
    await setupCommonStubs(page, 9);

    const posts = trackRequests(page, 'POST', `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`);
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '[]',
          });
        }
        if (method === 'POST') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([createAttachment({ fileId: 9999, originalName: 'first.pdf' })]),
          });
        }
        return route.fallback();
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    const dropzone = page.getByTestId('attachment-dropzone');
    await expect(dropzone).toBeVisible();

    // 2개 동시 업로드 — 첫 번째는 통과, 두 번째는 한도 초과 토스트.
    // 'test.pdf' 마지막 글자 'f'는 영문 → 받침 없음 → eulReul='를'.
    await dropzone.locator('input[type=file]').setInputFiles([
      { name: 'first.pdf', mimeType: 'application/pdf', buffer: Buffer.from('a') },
      { name: 'test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('b') },
    ]);

    await expect(
      page.getByText('이슈당 첨부 한도(10개)를 초과하여 test.pdf를 건너뜁니다'),
    ).toBeVisible();
    // 첫 번째 파일만 POST 발생해야 한다.
    await expectStays(page, posts.count, 1, { reach: true });
  });

  // #782 — 업로드 pending 동안 드롭존에 스피너(Loader2 + animate-spin) 표시 회귀 테스트.
  test('업로드 중에는 드롭존에 스피너가 표시된다', async ({ authenticatedPage: page }) => {
    await setupCommonStubs(page, 0);

    // POST 응답을 의도적으로 지연 — pending 상태에서 스피너를 관찰할 시간 확보.
    let resolvePost: (() => void) | undefined;
    const postGate = new Promise<void>((resolve) => {
      resolvePost = resolve;
    });

    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      async (route) => {
        const method = route.request().method();
        if (method === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        }
        if (method === 'POST') {
          await postGate;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([createAttachment({ fileId: 9101, originalName: 'slow.pdf' })]),
          });
        }
        return route.fallback();
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    const dropzone = page.getByTestId('attachment-dropzone');
    await expect(dropzone).toBeVisible();

    await dropzone.locator('input[type=file]').setInputFiles({
      name: 'slow.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('slow-upload'),
    });

    // pending 동안: 텍스트가 '업로드 중…' 이고 회전 스피너 아이콘이 렌더된다.
    await expect(dropzone).toContainText('업로드 중…');
    await expect(dropzone.locator('svg.animate-spin')).toBeVisible();

    // 응답 해제 → 업로드 완료 후 스피너가 사라진다.
    resolvePost?.();
    await expect(page.getByText('1개 첨부를 추가했습니다')).toBeVisible();
    await expect(dropzone.locator('svg.animate-spin')).toHaveCount(0);
  });

  // #783 — 여러 첨부의 삭제 버튼 접근성 이름이 파일명별로 달라야 함 회귀 테스트.
  test('여러 첨부가 있을 때 삭제 버튼 접근성 이름이 파일명별로 다르다', async ({
    authenticatedPage: page,
  }) => {
    await setupCommonStubs(page, 2);

    const attachments = [
      createAttachment({ fileId: 8101, originalName: 'alpha.pdf', mimeType: 'application/pdf' }),
      createAttachment({ fileId: 8102, originalName: 'beta.png', mimeType: 'image/png' }),
    ];

    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(attachments),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    const rowAlpha = page.getByTestId('attachment-row-8101');
    const rowBeta = page.getByTestId('attachment-row-8102');
    await expect(rowAlpha).toBeVisible();
    await expect(rowBeta).toBeVisible();

    // WP-203: 삭제 버튼은 항상 노출된다(hover-reveal 폐지).
    await expect(rowAlpha.getByRole('button', { name: 'alpha.pdf 삭제' })).toHaveCount(1);
    await expect(rowBeta.getByRole('button', { name: 'beta.png 삭제' })).toHaveCount(1);
    // 각 삭제 버튼의 접근성 이름은 자기 파일명을 포함해 서로 달라야 한다.
    await expect(rowAlpha.getByRole('button', { name: 'beta.png 삭제' })).toHaveCount(0);
    await expect(rowBeta.getByRole('button', { name: 'alpha.pdf 삭제' })).toHaveCount(0);
    // 정적 문자열 '첨부 삭제' 로는 더 이상 매치되지 않아야 한다(파일명 누락 회귀 방지).
    await expect(page.getByRole('button', { name: '첨부 삭제', exact: true })).toHaveCount(0);
  });

  // WP-203 — 다운로드·삭제 아이콘은 hover 없이 항상 보이고(휴대폰·키보드 접근), 삭제는 권한 있는 첨부에만.
  test('첨부 칩의 다운로드·삭제 버튼은 hover 없이 보이고 남의 첨부에는 삭제가 없다', async ({
    authenticatedPage: page,
  }) => {
    await setupCommonStubs(page, 2);

    // 현재 사용자 id=1, 프로젝트 OWNER 아님 → 내 첨부만 삭제 가능.
    const mine = createAttachment({ fileId: 8001, originalName: 'mine.pdf', attachedById: 1 });
    const others = createAttachment({ fileId: 8002, originalName: 'others.pdf', attachedById: 2 });

    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/attachments`,
      (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([mine, others]),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    const mineRow = page.getByTestId('attachment-row-8001');
    const othersRow = page.getByTestId('attachment-row-8002');
    await expect(mineRow.getByRole('button', { name: 'mine.pdf 다운로드' })).toBeVisible();
    await expect(mineRow.getByRole('button', { name: 'mine.pdf 삭제' })).toBeVisible();
    await expect(othersRow.getByRole('button', { name: 'others.pdf 다운로드' })).toBeVisible();
    await expect(othersRow.getByRole('button', { name: 'others.pdf 삭제' })).toHaveCount(0);
  });
});

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
    { tag: '@smoke' },
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

  test('PDF 첨부는 실제 PDF 바이트면 뷰어로, PDF 로 위장한 HTML 이면 오류로 표시된다', async ({
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

  test('EUC-KR 로 저장된 CSV 첨부도 한글이 깨지지 않고 표로 보인다', async ({ authenticatedPage: page }) => {
    // '이름,나이\n홍길동,30' 을 EUC-KR 로 인코딩한 바이트(한국어 엑셀 CSV 저장 형식).
    const eucKr = Buffer.from([
      0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xb3, 0xaa, 0xc0, 0xcc, 0x0a, 0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf, 0x2c, 0x33, 0x30,
    ]);
    await stubAttachments(
      page,
      [createAttachment({ fileId: 7201, originalName: 'members.csv', mimeType: 'text/csv' })],
      { 7201: { contentType: 'text/csv', body: eucKr } },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'members.csv 미리보기' }).click();
    const body = page.getByTestId('preview-body');
    await expect(body.getByRole('cell', { name: '홍길동' })).toBeVisible();
    await expect(body.getByRole('columnheader', { name: '이름' })).toBeVisible();
  });

  test('미리보기를 지원하지 않는 형식은 안내와 함께 모달에서 다운로드할 수 있다', async ({
    authenticatedPage: page,
  }) => {
    const requested = await stubAttachments(
      page,
      [createAttachment({ fileId: 7301, originalName: 'build.zip', mimeType: 'application/zip' })],
      { 7301: { contentType: 'application/zip', body: Buffer.from('PK') } },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'build.zip 미리보기' }).click();
    await expect(page.getByTestId('preview-body')).toContainText('미리보기를 지원하지 않는 형식입니다.');
    // 미지원 형식은 프리뷰용 콘텐츠를 받지 않는다.
    expect(requested[7301]).toBeUndefined();

    const download = page.waitForEvent('download');
    // 뷰어는 헤더와 안내 화면에 다운로드가 각각 있다 — 안내 화면의 버튼을 쓴다.
    await page.getByTestId('preview-body').getByRole('button', { name: '다운로드' }).click();
    expect((await download).suggestedFilename()).toBe('build.zip');
  });

  test('10MB 이하 텍스트 첨부는 묻지 않고 앞부분을 바로 보여준다', async ({ authenticatedPage: page }) => {
    // 2MB 로그 — WP-203 초기의 1MB 차단을 없애고 앞 20만 자 미리보기로 되돌린 동작.
    const body = Buffer.concat([Buffer.from('첫 줄 로그\n'), Buffer.alloc(2 * 1024 * 1024, 0x61)]);
    await stubAttachments(
      page,
      [createAttachment({ fileId: 7401, originalName: 'mid.log', mimeType: 'text/plain', sizeBytes: body.length })],
      { 7401: { contentType: 'text/plain', body } },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'mid.log 미리보기' }).click();
    await expect(page.getByTestId('preview-body').locator('pre')).toContainText('첫 줄 로그');
    await expect(page.getByTestId('preview-size-confirm')).toHaveCount(0);
  });

  test('10MB 를 넘는 첨부는 크기를 보여주고, 미리보기를 누를 때만 내려받는다', async ({
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

  test('칩의 다운로드 아이콘은 모달 없이 바로 내려받는다', async ({ authenticatedPage: page }) => {
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

  test('이미지·PDF·드라이브 링크 3건을 → 로 넘긴다', async ({ authenticatedPage: page }) => {
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

  test('드라이브 링크 원본이 휴지통이면 사용할 수 없음 안내만 보이고 다운로드는 없다', async ({
    authenticatedPage: page,
  }) => {
    await stubBundle(page, [], [driveLink(602, { name: 'gone.txt', availability: 'TRASHED' })]);
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'gone.txt 미리보기' }).click();
    await expect(page.getByTestId('preview-unavailable')).toBeVisible();
    await expect(page.getByTestId('preview-download')).toHaveCount(0);
  });

  test('원본이 삭제된 드라이브 링크 행에는 다운로드 아이콘이 없다(활성 링크에만 있다)', async ({ authenticatedPage: page }) => {
    await stubBundle(page, [], [driveLink(606, { name: 'deleted.txt', availability: 'DELETED' }), driveLink(607, { name: 'alive.txt' })]);
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await expect(page.getByRole('button', { name: 'alive.txt 다운로드' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'deleted.txt 미리보기' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'deleted.txt 다운로드' })).toHaveCount(0);
  });

  test('이슈 드라이브 링크의 요약이 403 이면 ✨ 버튼이 없다', async ({ authenticatedPage: page }) => {
    await stubBundle(page, [], [driveLink(603)]);
    await page.route(
      (url) => url.pathname === '/api/v1/drive/files/603/summary',
      (route) => route.fulfill({ status: 403, json: { message: 'forbidden' } }),
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByRole('button', { name: 'linked-603.txt 미리보기' }).click();
    await expect(page.getByTestId('preview-body')).toContainText('LINKED-BODY');
    await expect(page.getByRole('button', { name: 'AI 요약' })).toHaveCount(0);
  });

  test('이슈 드라이브 링크는 ✨ 로 요약 패널을 열고, ⋯ 에 드라이브에서 열기가 있다', async ({ authenticatedPage: page }) => {
    await stubBundle(page, [], [driveLink(604)]);
    await page.route(
      (url) => url.pathname === '/api/v1/drive/files/604/summary',
      (route) => route.fulfill({ json: { summary: '링크 요약', status: 'DONE' } }),
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByRole('button', { name: 'linked-604.txt 미리보기' }).click();
    // 이슈에서 열면 기본 접힘(defaultPanelOpen 없음).
    await expect(page.getByTestId('preview-body')).toContainText('LINKED-BODY');
    await expect(page.getByTestId('viewer-side-panel')).toHaveCount(0);
    await page.getByRole('button', { name: 'AI 요약' }).click();
    await expect(page.getByTestId('viewer-side-panel').getByTestId('drive-summary-card')).toContainText('링크 요약');
    await page.getByRole('button', { name: '더 보기' }).click();
    await expect(page.getByRole('menuitem', { name: '드라이브에서 열기' })).toBeVisible();
  });

  test('⋯ 드라이브에서 열기는 하위 폴더에 있는 링크 파일을 그 폴더에서 미리보기로 연다', async ({ authenticatedPage: page }) => {
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

  test('드라이브 링크 조회가 실패해도 없는 첨부 딥링크는 찾을 수 없음 안내로 끝난다', async ({ authenticatedPage: page }) => {
    await stubBundle(page, [], []);
    // 나중 등록이 우선 — 링크 목록만 403(재시도 없음).
    await page.route(
      (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/1/drive-links`,
      (route) => route.fulfill({ status: 403, json: { message: 'forbidden' } }),
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1?preview=drive:999`);
    await expect(page.getByTestId('preview-not-found')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/preview=/);
  });

  test('업로드 첨부는 ✨ 없이 ☁ 와 ⋯ 를 보여 주고 ☁ 로 드라이브에 가져온다', async ({ authenticatedPage: page }) => {
    await stubBundle(page, [createAttachment({ fileId: 7701, originalName: 'up.txt', mimeType: 'text/plain' })], []);
    await page.route(
      (url) => url.pathname === '/api/v1/projects/WP/issues/1/attachments/7701/content',
      (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: 'UP' }),
    );
    // 개인 공간·폴더 목록·임포트 — setupCommonStubs 의 빈 공간 목록보다 나중에 등록해 우선한다.
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces',
      (route) =>
        route.fulfill({
          json: [{ id: 1, type: 'PERSONAL', name: '내 드라이브', ownerId: 1, role: 'OWNER', archived: false, createdAt: '2026-06-01T00:00:00Z' }],
        }),
    );
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces/1/items',
      (route) => route.fulfill({ json: { folders: [], files: [] } }),
    );
    const imports = trackRequests(page, 'POST', /\/api\/v1\/drive\/spaces\/1\/import-attachment$/);
    await page.route(/\/api\/v1\/drive\/spaces\/1\/import-attachment$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);
    await page.getByRole('button', { name: 'up.txt 미리보기' }).click();
    await expect(page.getByTestId('preview-body')).toContainText('UP');
    await expect(page.getByRole('button', { name: 'AI 요약' })).toHaveCount(0);
    await page.getByRole('button', { name: '더 보기' }).click();
    await expect(page.getByRole('menuitem', { name: '링크 복사' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '드라이브로 가져오기' }).click();
    await expect(page.getByTestId('folder-picker')).toBeVisible();
    await page.getByTestId('folder-picker').getByTestId('folder-picker-confirm').click();
    await expect.poll(() => imports.count()).toBe(1);
  });
  test('열린 첨부가 실시간 재조회로 목록에서 빠져도 뷰어는 그 파일을 1건으로 유지한다', async ({ authenticatedPage: page }) => {
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

  test('삭제된 첨부 딥링크는 찾을 수 없음 안내를 보이고 닫으면 ?preview 가 지워진다', async ({ authenticatedPage: page }) => {
    await stubBundle(page, [createAttachment({ fileId: 7901, originalName: 'live.txt', mimeType: 'text/plain' })], []);
    await page.goto(`/projects/${PROJECT_KEY}/issues/1?preview=file:999`);
    await expect(page.getByTestId('preview-not-found')).toBeVisible();
    await expect(page.getByTestId('attachment-viewer')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview-not-found')).toHaveCount(0);
    await expect(page).not.toHaveURL(/preview=/);
  });

  test('뷰어를 닫으면 연 첨부 버튼으로 포커스가 돌아온다', async ({ authenticatedPage: page }) => {
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
