// 새 이슈 창이 화면보다 길어질 때 창 안에서 스크롤되는지 E2E(WP-1453, @layout).
// 「AI 에게 맡기기」를 펼치면 창이 화면(높이 741px)보다 길어지는데, 창에 높이 상한·스크롤이 없고 Radix 가 body 스크롤을 잠가
// 제목 칸과 만들기 버튼에 닿을 수 없었다. 넘침·스크롤·화면 안 위치는 jsdom 이 잴 수 없어 실제 브라우저로 잰다.
// 펼친 칸의 내용·요청 차례는 src/pages/projects/issueCreateAiHandoff.test.tsx 화면 테스트가 지킨다.

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { mockApi } from '../../fixtures/api-mock';
import { createIssue, createIssueSearchResponse } from '../../factories/issue.factory';
import { systemTypes } from '../../factories/issueType.factory';
import { createProject } from '../../factories/project.factory';

const PROJECT_KEY = 'WP';
const VIEWPORT = { width: 1280, height: 741 };

/** JSON 응답 한 건. */
function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/** 프로젝트 보드와 새 이슈 창이 부르는 조회를 깐다 — 담당 AI 후보 하나를 주어 「AI 에게 맡기기」 칸이 다 펼쳐지게 한다. */
async function stubProject(page: Page) {
  await mockApi(page, 'GET', `/api/v1/projects/${PROJECT_KEY}`, createProject());
  await mockApi(
    page,
    'GET',
    `/api/v1/projects/${PROJECT_KEY}/issues`,
    createIssueSearchResponse([createIssue({ title: '기존 이슈' })]),
  );
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/**`, (route) => {
    if (route.request().method() === 'GET' && !route.request().url().includes('/issues')) {
      return route.fulfill(json([]));
    }
    return route.fallback();
  });
  // 위 넓은 라우트보다 나중에 등록해 먼저 잡힌다(Playwright 는 마지막 등록 라우트부터 본다).
  await page.route((url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/types`, (route) =>
    route.fulfill(json(systemTypes())),
  );
  await page.route((url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/recurrence-agents`, (route) =>
    route.fulfill(json([{ id: 5, username: 'my-ai', name: '도우미', personalAssistant: true }])),
  );
  // 「만들고 지금 실행」 뒤의 실행 일정 저장·지금 실행.
  await page.route((url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/42/recurrence`, (route) =>
    route.fulfill(json({ rrule: 'FREQ=ONCE', time: '09:00', enabled: true, nextRunAt: null, consecutiveFailures: 0, lastRunAt: null, agentUserId: 5, agentName: '도우미' })),
  );
  await page.route((url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/42/recurrence/test-runs`, (route) =>
    route.fulfill({ status: 202, body: '' }),
  );
}

test.describe('새 이슈 창 — 화면보다 길면 창 안에서 스크롤 (WP-1453)', () => {
  test('AI 에게 맡기기를 펼쳐도 창은 화면 안에 있고, 창을 스크롤해 제목 칸과 만들기 버튼에 닿는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await stubProject(page);
    const create = await mockApi(
      page,
      'POST',
      `/api/v1/projects/${PROJECT_KEY}/issues`,
      createIssue({ number: 42, projectKey: PROJECT_KEY }),
      { status: 201, capture: true },
    );
    await page.setViewportSize(VIEWPORT);
    await page.goto(`/projects/${PROJECT_KEY}`);
    await page.getByRole('button', { name: '+ 새 태스크' }).click();
    const dialog = page.getByRole('dialog', { name: '새 이슈' });
    await expect(dialog).toBeVisible();

    await dialog.getByTestId('create-ai-handoff-toggle').click();
    await expect(dialog.getByTestId('create-ai-handoff-panel')).toBeVisible();
    // 담당 AI 를 받아 버튼이 「만들고 지금 실행」으로 바뀌고 풀릴 때까지 — 펼친 칸이 다 그려진 상태에서 잰다.
    await expect(dialog.getByTestId('create-and-run')).toBeEnabled();
    // 창이 열릴 때 zoom-in-95(200ms) 애니메이션 중이면 상자가 95% 로 줄어 화면 안 판정이 거짓으로 통과한다 — 창과 그 안의 애니메이션이 끝난 뒤 잰다.
    await expect.poll(() => dialog.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);

    // 창의 위·아래가 화면 안이다(가운데 정렬된 채 넘치면 위가 음수, 아래가 화면 밖으로 나갔다).
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT.height);
    // 내용이 창보다 길다 — 창 안에서 스크롤된다.
    const { scrollHeight, clientHeight } = await dialog.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(scrollHeight).toBeGreaterThan(clientHeight);

    // 제목 칸이 화면 안에 보여 입력할 수 있다.
    const title = dialog.getByLabel(/^제목/);
    await expect(title).toBeInViewport();
    await title.fill('회의록 정리');

    // 창을 끝까지 스크롤하면 만들기 버튼이 화면 안에 보이고, 눌러 만들기 요청이 나간다.
    await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const submit = dialog.getByTestId('create-and-run');
    await expect(submit).toBeInViewport({ ratio: 1 });
    await submit.click();
    const sent = await create.waitForRequest();
    expect(sent.payload).toMatchObject({ title: '회의록 정리' });
  });
});
