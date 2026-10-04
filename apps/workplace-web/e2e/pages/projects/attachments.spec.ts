// 이슈 첨부 E2E.
// - 정상 업로드/삭제 happy path (smoke)
// - 25MB 초과 파일은 클라이언트 사전 검증에서 토스트 + POST 차단

import { expect, test } from '../../fixtures/auth.fixture';
import { expectStays } from '../../fixtures/wait';
import { createAttachment } from '../../factories/attachment.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { IssueAttachment } from '../../../src/types/attachment';

const PROJECT_KEY = 'WP';

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

      let postCount = 0;
      let deleteCount = 0;

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
            postCount += 1;
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
          deleteCount += 1;
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
      expect(postCount).toBe(1);
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
      expect(deleteCount).toBe(1);
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

    let postCount = 0;
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
          postCount += 1;
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
    await expectStays(page, () => postCount, 0);
  });

  test('이슈당 첨부 한도(10개) 초과 시 올바른 조사 포함 토스트 표시', async ({
    authenticatedPage: page,
  }) => {
    // attachmentCount=9 → currentCount=9. 2개 업로드 시 첫 번째(9+0<10)는 수락, 두 번째(9+1=10)는 한도 초과.
    await setupCommonStubs(page, 9);

    let postCount = 0;
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
          postCount += 1;
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
    await expectStays(page, () => postCount, 1, { reach: true });
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
        7101: { contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF') },
        7102: { contentType: 'application/pdf', body: Buffer.from('<html><script>alert(1)</script></html>') },
      },
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/1`);

    await page.getByRole('button', { name: 'real.pdf 미리보기' }).click();
    await expect(page.getByTestId('preview-body').locator('iframe[title="real.pdf"]')).toBeVisible();
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
    await page.getByRole('dialog').getByRole('button', { name: '다운로드' }).click();
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
