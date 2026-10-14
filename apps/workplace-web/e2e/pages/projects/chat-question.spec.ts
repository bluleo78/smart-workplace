// WP-373 — 이슈 챗 질문 표시 E2E.
// 열린 질문(주황 강조 + 「질문」)·답변됨(「질문 ✓ 답변됨」)·SSE 로 바뀌는 상태·AI 번호 목록 간격을 검증한다.
// 백엔드 없이 page.route 로 모킹하고, SSE 는 mockGatedEvents 로 프레임 1개를 주입한다. 시각은 시드로 고정한다.

import type { Page } from '@playwright/test';

import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { mockGatedEvents } from '../../fixtures/gatedEvents';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;
const AI_ID = 50;

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

const ai = (id: number, createdAt: string, body: string, question = false) =>
  createChatMessage({
    id,
    threadId: THREAD_ID,
    authorId: AI_ID,
    authorName: '코드 봇',
    authorKind: 'AGENT',
    body,
    question,
    createdAt,
  });

/** 시안과 같은 5개 메시지 — 102(번호 목록 3줄 질문, 답변됨), 105(열린 질문). */
function seedMessages() {
  return [
    ai(101, '2026-10-14T01:00:00Z', '작업을 시작합니다.'),
    ai(102, '2026-10-14T01:01:00Z', '확인이 필요합니다.\n\n1. 첫째 항목\n2. 둘째 항목\n3. 셋째 항목', true),
    createChatMessage({
      id: 103,
      threadId: THREAD_ID,
      authorId: ME_ID,
      authorName: '테스트 사용자',
      body: '2번으로 가주세요',
      createdAt: '2026-10-14T01:02:00Z',
    }),
    ai(104, '2026-10-14T01:03:00Z', '알겠습니다. 진행합니다.'),
    ai(105, '2026-10-14T01:04:00Z', '배포 전에 확인할 게 있어요. 계속할까요?', true),
  ];
}

async function setup(page: Page) {
  const messages = seedMessages();
  const detail = createIssueDetail({
    summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '질문 표시 테스트' }),
  });
  const thread = createChatThread({
    threadId: THREAD_ID,
    issueId: 1,
    members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
    recentMessages: messages,
  });
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (r) => r.fulfill(json(createProject())));
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (r) => r.fulfill(json([])));
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (r) => r.fulfill(json(detail)),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (r) => r.fulfill(json([])),
    );
  }
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (r) => r.fulfill(json([])),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (r) => r.fulfill(json(thread)),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    (r) =>
      r.request().method() !== 'GET'
        ? r.fallback()
        : r.fulfill(json({ items: messages, nextCursor: null, hasMore: false })),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
    (r) => r.fulfill({ status: 204 }),
  );
}

/** 드로워를 열고 시드 메시지가 그려질 때까지 기다린다(캐시 준비 신호). */
async function openDrawer(page: Page) {
  await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
  await page.getByTestId('issue-chat-open').click();
  await expect(page.getByTestId('chat-message-105')).toBeVisible();
}

/** chat.message.created SSE 프레임 — 서버 payload 와 같은 모양(question 키 포함). */
const frame = (msg: unknown) => `event: chat.message.created\ndata: ${JSON.stringify(msg)}\n\n`;

test.describe('이슈 챗 질문 표시', () => {
  test('열린 질문은 주황 강조와 「질문」 태그, 답이 달린 질문은 「질문 ✓ 답변됨」', async ({
    authenticatedPage: page,
  }) => {
    await setup(page);
    await openDrawer(page);

    await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문');
    await expect(page.locator('[data-message-id="105"]')).toHaveAttribute('data-question', 'open');
    await expect(page.getByTestId('chat-message-question-102')).toHaveText('질문 ✓ 답변됨');
    await expect(page.locator('[data-message-id="102"]')).toHaveAttribute('data-question', 'answered');
    // 질문이 아닌 글에는 태그·표식이 없다.
    await expect(page.getByTestId('chat-message-question-101')).toHaveCount(0);
    await expect(page.locator('[data-message-id="101"]')).not.toHaveAttribute('data-question', /.+/);

    await page.screenshot({ path: 'test-results/tc/chat-question/drawer-1280-light.png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: 'test-results/tc/chat-question/drawer-1280-dark.png' });
  });

  test('사람 답이 SSE 로 오면 열린 질문이 바로 답변됨으로 바뀐다', async ({ authenticatedPage: page }) => {
    await setup(page);
    const events = await mockGatedEvents(page);
    await openDrawer(page);
    await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문');

    events.deliver(
      frame(
        createChatMessage({
          id: 106,
          threadId: THREAD_ID,
          authorId: 7,
          authorName: '다른 사용자',
          authorKind: 'HUMAN',
          body: '네, 계속하세요',
          question: false,
          createdAt: '2026-10-14T01:05:00Z',
        }),
      ),
    );

    await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문 ✓ 답변됨');
    await expect(page.locator('[data-message-id="105"]')).toHaveAttribute('data-question', 'answered');
  });

  test('SSE 로 온 새 질문은 오자마자 강조된다', async ({ authenticatedPage: page }) => {
    await setup(page);
    const events = await mockGatedEvents(page);
    await openDrawer(page);

    events.deliver(frame(ai(107, '2026-10-14T01:06:00Z', '하나 더 여쭙니다.', true)));

    await expect(page.locator('[data-message-id="107"]')).toHaveAttribute('data-question', 'open');
    await expect(page.getByTestId('chat-message-question-107')).toHaveText('질문');
  });

  test('AI 메시지의 번호 목록은 항목 사이가 벌어지지 않는다', async ({ authenticatedPage: page }) => {
    await setup(page);
    await openDrawer(page);

    const items = page.getByTestId('chat-message-body-102').locator('li');
    await expect(items).toHaveCount(3);
    const a = await items.nth(0).boundingBox();
    const b = await items.nth(1).boundingBox();
    // 예전에는 바깥 pre-wrap 이 블록 사이 개행을 빈 줄로 그려 한 줄 이상 벌어졌다.
    expect(b!.y - (a!.y + a!.height)).toBeLessThan(8);
  });
});
