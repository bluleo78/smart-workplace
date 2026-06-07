// 이슈 첨부 E2E.
// - 정상 업로드/삭제 happy path (smoke)
// - 25MB 초과 파일은 클라이언트 사전 검증에서 토스트 + POST 차단

import { expect, test } from '../../fixtures/auth.fixture';
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
      await expect(page.getByText('첨부가 없습니다')).toBeVisible();

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
      await row.getByRole('button', { name: '첨부 삭제' }).click();
      // AlertDialog 가 뜨고 삭제 버튼 클릭으로 확인.
      await expect(page.getByTestId('attachment-delete-dialog')).toBeVisible();
      await page.getByTestId('attachment-delete-confirm').click();
      await expect(page.getByText('첨부를 삭제했습니다')).toBeVisible();
      expect(deleteCount).toBe(1);
      await expect(page.getByText('첨부가 없습니다')).toBeVisible();
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
    // 짧은 대기 후 카운트 확인 — 즉시 검사 시 mutate 비동기 진입 전에 통과할 수 있음.
    await page.waitForTimeout(300);
    expect(postCount).toBe(0);
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
    await page.waitForTimeout(300);
    expect(postCount).toBe(1);
  });
});
