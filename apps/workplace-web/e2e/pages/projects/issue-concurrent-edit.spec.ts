// #611 이슈 동시 편집 충돌 감지 E2E — 수정 요청에 읽은 version 을 싣고, 서버가 409 면 안내 후 최신 이슈를 다시 불러온다.
// 스텁 서버가 version 을 추적한다: PATCH 의 version 이 현재와 다르면 409, 같으면 반영하고 version+1.

import { expect, test } from '../../fixtures/auth.fixture';
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const ISSUES_PATH = `/api/v1/projects/${PROJECT_KEY}/issues`;
const ISSUE_DETAIL_PATH = `${ISSUES_PATH}/${ISSUE_NUMBER}`;

interface Server {
  title: string;
  body: string;
  version: number;
  patches: Record<string, unknown>[];
  gets: number;
}

/**
 * version 을 추적하는 상세 GET/PATCH 스텁. refetchDelayMs 로 첫 로드 이후의 상세 재조회를 늦춘다 — 저장 직후 리페치가 끝나기 전에
 * 다음 편집을 하는 상황(캐시에 옛 version 이 남아 거짓 409 가 나기 쉬운 구간)을 만든다.
 */
async function setupServer(page: import('@playwright/test').Page, refetchDelayMs = 0): Promise<Server> {
  const server: Server = { title: '원본 제목', body: '원본 본문', version: 1, patches: [], gets: 0 };
  const detail = () =>
    createIssueDetail({
      summary: createIssue({ id: ISSUE_NUMBER, number: ISSUE_NUMBER, title: server.title, version: server.version }),
      body: server.body,
    });

  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createProject()) }),
  );
  // 로그인 사용자를 멤버로 — 상태·우선순위 같은 워크플로 필드도 편집할 수 있게.
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([createMember()]) }),
  );
  await page.route(
    (url) => url.pathname === ISSUES_PATH,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createIssueSearchResponse([])) })
        : route.fallback(),
  );
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route(
      (url) => url.pathname === `${ISSUE_DETAIL_PATH}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === ISSUE_DETAIL_PATH,
    async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        server.gets += 1;
        if (server.gets > 1 && refetchDelayMs) await new Promise((r) => setTimeout(r, refetchDelayMs));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail()) });
      }
      if (method !== 'PATCH') return route.fallback();
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      server.patches.push(payload);
      if (payload.version !== undefined && payload.version !== server.version) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 409,
            message: `다른 사용자가 먼저 이 이슈를 수정했습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요: ${PROJECT_KEY}-${ISSUE_NUMBER}`,
          }),
        });
      }
      if (typeof payload.title === 'string') server.title = payload.title;
      if (typeof payload.body === 'string') server.body = payload.body;
      server.version += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail()) });
    },
  );
  return server;
}

/** 상세 페이지에서 제목을 인라인 편집해 저장한다. */
async function editTitle(page: import('@playwright/test').Page, title: string) {
  await page.getByRole('button', { name: '제목 편집' }).click();
  const input = page.getByTestId('issue-title-input');
  await input.fill(title);
  await input.press('Enter');
}

test.describe('이슈 동시 편집 충돌 감지 (#611)', () => {
  test('저장 직후 재조회가 끝나기 전에 다시 편집해도 새 version 을 실어 성공한다', async ({
    authenticatedPage: page,
  }) => {
    const server = await setupServer(page, 2000);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();

    await editTitle(page, '첫 번째');
    await editTitle(page, '두 번째');

    await expect.poll(() => server.patches.length).toBe(2);
    expect(server.patches.map((p) => p.version)).toEqual([1, 2]);
    await expect(page.getByTestId('issue-title-heading').getByText('두 번째')).toBeVisible();
    await expect(page.getByText('다른 사용자가 먼저')).toHaveCount(0);
  });

  test('다른 곳에서 먼저 수정됐으면 409 안내 후 입력을 유지한 채 최신 이슈를 다시 불러오고, 다시 저장하면 성공한다', async ({
    authenticatedPage: page,
  }) => {
    const server = await setupServer(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();

    // 다른 탭이 먼저 저장한 상황 — 서버만 앞서간다.
    server.title = '다른 탭 제목';
    server.version = 2;
    const getsBefore = server.gets;

    await editTitle(page, '내 제목');
    await expect(page.getByText('다른 사용자가 먼저 이 이슈를 수정했습니다', { exact: false })).toBeVisible();
    expect(server.patches[0].version).toBe(1);
    // 입력한 제목은 버리지 않고 편집을 다시 열어 두고, 최신 이슈를 다시 불러온다.
    await expect(page.getByTestId('issue-title-input')).toHaveValue('내 제목');
    await expect.poll(() => server.gets).toBeGreaterThan(getsBefore);

    // 최신 version 으로 다시 저장하면 성공한다.
    await page.getByTestId('issue-title-input').press('Enter');
    await expect.poll(() => server.patches.length).toBe(2);
    expect(server.patches[1].version).toBe(2);
    await expect(page.getByTestId('issue-title-heading').getByText('내 제목')).toBeVisible();
  });

  test('편집하는 사이 캐시가 새로 받아져도 편집 시작 시점의 version 으로 저장해 충돌을 놓치지 않는다', async ({
    authenticatedPage: page,
  }) => {
    const server = await setupServer(page);
    // 통합 SSE 스트림 — sendComment 가 켜지면 다음 (재)연결에 코멘트 이벤트를 실어 상세 캐시 무효화를 일으킨다.
    let sendComment = false;
    await page.route('**/api/v1/events', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sendComment
          ? `event: issue.commented\ndata: ${JSON.stringify({ projectKey: PROJECT_KEY, issueNumber: ISSUE_NUMBER })}\n\n`
          : ': connected\n\n',
      }),
    );
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('issue-title-heading').getByText('원본 제목')).toBeVisible();

    // 편집을 시작한 뒤, 다른 탭의 저장이 반영되고 누군가의 코멘트 SSE 로 이 화면의 상세 캐시가 새로 받아진다.
    await page.getByRole('button', { name: '제목 편집' }).click();
    const input = page.getByTestId('issue-title-input');
    await expect(input).toBeVisible();
    server.title = '다른 탭 제목';
    server.version = 2;
    const getsBefore = server.gets;
    sendComment = true;
    await expect.poll(() => server.gets, { timeout: 15_000 }).toBeGreaterThan(getsBefore);

    // 편집 시작 때 본 version(1)으로 저장 → 다른 탭의 변경을 모른 채 덮어쓰지 않고 409.
    await input.fill('내 제목');
    await input.press('Enter');
    await expect.poll(() => server.patches.length).toBe(1);
    expect(server.patches[0].version).toBe(1);
    await expect(page.getByText('다른 사용자가 먼저 이 이슈를 수정했습니다', { exact: false })).toBeVisible();
    expect(server.title).toBe('다른 탭 제목');
  });

  test('본문을 쓰는 중에 같은 화면에서 상태를 바꿔도 본문 저장은 스스로와 충돌하지 않는다', async ({
    authenticatedPage: page,
  }) => {
    const server = await setupServer(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByText('원본 본문')).toBeVisible();

    await page.getByRole('button', { name: '본문 편집' }).click();
    const textarea = page.getByTestId('issue-body-textarea');
    await textarea.fill('새 본문');
    // 본문 편집을 연 채로 상태 변경(내 저장 → version 1→2).
    await page.getByRole('combobox', { name: '상태' }).click();
    await page.getByRole('option', { name: '진행 중' }).click();
    await expect.poll(() => server.patches.length).toBe(1);

    await textarea.click();
    await textarea.press('ControlOrMeta+Enter');
    await expect.poll(() => server.patches.length).toBe(2);
    expect(server.patches[1]).toMatchObject({ body: '새 본문', version: 2 });
    expect(server.body).toBe('새 본문');
    await expect(page.getByText('다른 사용자가 먼저', { exact: false })).toHaveCount(0);
  });

  test('본문 저장이 409 로 실패하면 입력한 본문을 잃지 않고 편집을 다시 열며, 다시 저장하면 최신 version 으로 성공한다', async ({
    authenticatedPage: page,
  }) => {
    const server = await setupServer(page);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByText('원본 본문')).toBeVisible();

    await page.getByRole('button', { name: '본문 편집' }).click();
    const textarea = page.getByTestId('issue-body-textarea');
    await textarea.fill('공들여 쓴 본문');
    // 다른 탭이 먼저 저장.
    server.title = '다른 탭 제목';
    server.version = 2;
    await textarea.press('ControlOrMeta+Enter');

    await expect(page.getByText('다른 사용자가 먼저 이 이슈를 수정했습니다', { exact: false })).toBeVisible();
    await expect(page.getByTestId('issue-body-textarea')).toHaveValue('공들여 쓴 본문');
    // 최신 이슈가 다시 불러와진 뒤 다시 저장 → 최신 version 으로 성공.
    await expect(page.getByTestId('issue-title-heading').getByText('다른 탭 제목')).toBeVisible();
    await page.getByTestId('issue-body-textarea').press('ControlOrMeta+Enter');
    await expect.poll(() => server.patches.length).toBe(2);
    expect(server.patches[1]).toMatchObject({ body: '공들여 쓴 본문', version: 2 });
    expect(server.body).toBe('공들여 쓴 본문');
  });
});
