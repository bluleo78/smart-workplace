// WP-373 — 이슈 챗 질문 표시 E2E.
// 열린 질문(주황 강조 + 「질문」, 질문한 AI 가 INPUT_REQUIRED)·답변됨(「질문 ✓ 답변됨」)·AI 작업 상태 변경으로 바뀌는 상태·AI 번호 목록 간격을 검증한다.
// 백엔드 없이 page.route 로 모킹하고, SSE 는 mockGatedEvents 로 프레임 1개를 주입한다. 시각은 시드로 고정한다.
// 판정 태그: SSE 프레임 주입(@platform), 스크린샷·목록 간격(@layout), 드로워 닫기 → 담당자 변경 → 다시 열기(@flow).
// 이슈 채팅 드로워(TipTap 작성창)는 jsdom 에서 열리지 않고, 질문 상태 판정 자체는 questionState.test.ts 가 본다.

import type { Page } from '@playwright/test';

import { createAgentWork } from '../../factories/agentWork.factory';
import { createChatMember, createChatMessage, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createMember, createProject } from '../../factories/project.factory';
import { expect, test } from '../../fixtures/auth.fixture';
import { mockGatedEvents, resourceChangedFrame } from '../../fixtures/gatedEvents';
import { json } from '../../fixtures/mobile-chat';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;
const AI_ID = 50;

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

const KODI = { id: 77, username: 'kodi', name: '코디', kind: 'AGENT' as const };
const HINT = '답변 입력… 멘션 없이 보내도 코디가 이어받아요';

async function setup(page: Page, opts: { externalAgent?: typeof KODI | null } = {}) {
  const messages = seedMessages();
  // 질문한 AI(50)의 작업 상태 — 「답변됨」 판정 기준이므로 기본은 답변 대기. 테스트가 바꾼 뒤 이슈 상세 리페치로 반영된다.
  // updatedAt 을 주면 작업의 마지막 갱신 시각을 고정한다(WP-391 — 질문 글보다 이른지 비교), fail 이면 이슈 상세가 500 을 돌려준다.
  const workRef: { state: 'INPUT_REQUIRED' | 'WORKING' | null; updatedAt?: string; fail?: boolean } = {
    state: 'INPUT_REQUIRED',
  };
  // 스레드 응답이 싣는 외부 실행 AI — 담당자 변경 시나리오에서 테스트가 바꾼다.
  const agentRef = { current: opts.externalAgent ?? null };
  const detailNow = () =>
    createIssueDetail({
      summary: createIssue({
        id: 1,
        number: ISSUE_NUMBER,
        title: '질문 표시 테스트',
        agentWork: workRef.state
          ? [
              createAgentWork({
                worker: { id: AI_ID, username: 'codebot', name: '코드 봇', kind: 'AGENT' },
                state: workRef.state,
                ...(workRef.updatedAt && { updatedAt: workRef.updatedAt }),
              }),
            ]
          : [],
      }),
    });
  const thread = createChatThread({
    threadId: THREAD_ID,
    issueId: 1,
    members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
    recentMessages: messages,
    externalAgent: opts.externalAgent ?? null,
  });
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (r) => r.fulfill(json(createProject())));
  await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (r) => r.fulfill(json([])));
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (r) => (workRef.fail ? r.fulfill({ status: 500, body: '{}' }) : r.fulfill(json(detailNow()))),
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
    (r) => r.fulfill(json({ ...thread, externalAgent: agentRef.current })),
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
  return { agentRef, workRef };
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
  test('열린 질문은 주황 강조와 「질문」 태그, 답이 달린 질문은 「질문 ✓ 답변됨」', { tag: '@layout' }, async ({
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

  test('사람 답으로 AI 가 작업 중으로 돌아오면 열린 질문이 답변됨으로 바뀐다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const { workRef } = await setup(page);
    const events = await mockGatedEvents(page);
    await openDrawer(page);
    await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문');

    // 사람이 답하면 서버가 AI 를 WORKING 으로 바꾸고 issue 변경 알림을 낸다 → 상세 리페치.
    workRef.state = 'WORKING';
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
      ) +
        resourceChangedFrame({ resource: 'issue', op: 'updated', projectKey: PROJECT_KEY, issueNumber: ISSUE_NUMBER }),
    );

    await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문 ✓ 답변됨');
    await expect(page.locator('[data-message-id="105"]')).toHaveAttribute('data-question', 'answered');
  });

  test('SSE 로 온 새 질문은 오자마자 강조된다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    await setup(page);
    const events = await mockGatedEvents(page);
    await openDrawer(page);

    events.deliver(frame(ai(107, '2026-10-14T01:06:00Z', '하나 더 여쭙니다.', true)));

    await expect(page.locator('[data-message-id="107"]')).toHaveAttribute('data-question', 'open');
    await expect(page.getByTestId('chat-message-question-107')).toHaveText('질문');
  });

  // WP-391: 질문 글은 실시간으로 먼저 오고 이슈(작업 상태)는 그 뒤 다시 받는다 — 그 사이 작업 상태가 질문 전(WORKING)이어도 「답변됨」으로 깜빡이지 않는다.
  test('작업 상태가 아직 질문 전 값이면 새 질문은 답변됨으로 깜빡이지 않고 열린 질문이다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const { workRef } = await setup(page);
    // 105 의 답을 받아 작업 중으로 돌아온 뒤(01:05:30)의 상태 — 105 는 답변됨.
    workRef.state = 'WORKING';
    workRef.updatedAt = '2026-10-14T01:05:30Z';
    const events = await mockGatedEvents(page);
    await openDrawer(page);
    await expect(page.locator('[data-message-id="105"]')).toHaveAttribute('data-question', 'answered');

    // 새 질문만 오고 이슈 변경 알림은 아직 — 화면의 작업 상태는 질문보다 이른 WORKING 그대로다.
    events.deliver(frame(ai(107, '2026-10-14T01:06:00Z', '하나 더 여쭙니다.', true)));

    await expect(page.getByTestId('chat-message-107')).toBeVisible();
    await expect(page.locator('[data-message-id="107"]')).toHaveAttribute('data-question', 'open');
    await expect(page.getByTestId('chat-message-question-107')).toHaveText('질문');
  });

  // WP-391: 이슈 리페치가 실패하면 쿼리는 옛 데이터(답변 대기)를 들고 있다 — 그 사이 답이 달렸을 수 있어 열림·답변됨 어느 쪽도 단정하지 않는다.
  test('이슈를 다시 받지 못하면 질문을 무채색 「질문」으로 두고 주황 강조를 하지 않는다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
    const { workRef } = await setup(page);
    const events = await mockGatedEvents(page);
    await openDrawer(page);
    await expect(page.locator('[data-message-id="105"]')).toHaveAttribute('data-question', 'open');

    // 사람이 답했고 서버가 이슈 변경 알림을 냈지만, 다시 받기가 실패한다.
    workRef.fail = true;
    events.deliver(
      resourceChangedFrame({ resource: 'issue', op: 'updated', projectKey: PROJECT_KEY, issueNumber: ISSUE_NUMBER }),
    );

    const row = page.locator('[data-message-id="105"]');
    await expect(row).toHaveAttribute('data-question', 'unknown');
    await expect(page.getByTestId('chat-message-question-105')).toHaveText('질문');
    await expect(row).not.toHaveClass(/bg-caution-subtle/);
    // 앞선 질문(102)은 같은 AI 의 뒤 질문이 있어 이슈 정보와 상관없이 답변됨이다.
    await expect(page.getByTestId('chat-message-question-102')).toHaveText('질문 ✓ 답변됨');
    await page.screenshot({ path: 'test-results/tc/chat-question/unknown-1280-light.png' });
  });

  test('AI 메시지의 번호 목록은 항목 사이가 벌어지지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await setup(page);
    await openDrawer(page);

    const items = page.getByTestId('chat-message-body-102').locator('li');
    await expect(items).toHaveCount(3);
    const a = await items.nth(0).boundingBox();
    const b = await items.nth(1).boundingBox();
    // 예전에는 바깥 pre-wrap 이 블록 사이 개행을 빈 줄로 그려 한 줄 이상 벌어졌다.
    expect(b!.y - (a!.y + a!.height)).toBeLessThan(8);
  });

  test.describe('작성창 안내 (WP-373 §5.2)', () => {
    const emptyLine = (page: Page) =>
      page.getByTestId('chat-composer').locator('.ProseMirror p.is-editor-empty');

    // WP-990 — 데스크톱에서도 이슈 챗 칸이 좁으면 긴 안내가 두 줄로 접힌다. 화면 폭(모바일)과 상관없이
    // 입력창이 접힌 안내 높이만큼 늘어나 둘째 줄이 잘리지 않아야 한다.
    test('데스크톱 좁은 이슈 챗 칸에서 긴 안내가 두 줄로 접혀도 입력창이 늘어나 잘리지 않는다', { tag: '@layout' }, async ({
      authenticatedPage: page,
    }) => {
      await setup(page, { externalAgent: { ...KODI, name: 'AI 개발자1' } });
      await openDrawer(page);
      const line = emptyLine(page);
      await expect(line).toHaveAttribute('data-placeholder', '답변 입력… 멘션 없이 보내도 AI 개발자1이(가) 이어받아요');

      const m = await line.evaluate((p) => {
        const editor = p.closest('.ProseMirror') as HTMLElement;
        const lineHeight = parseFloat(getComputedStyle(p).lineHeight);
        return {
          lineHeight,
          hint: parseFloat(getComputedStyle(p, '::before').height),
          p: p.getBoundingClientRect().height,
          editorBottom: editor.getBoundingClientRect().bottom,
          pBottom: p.getBoundingClientRect().bottom,
        };
      });
      // 이 폭에서 안내가 두 줄로 접히므로 빈 입력 줄도 두 줄 높이가 되고(고치기 전엔 한 줄이라 둘째 줄이 잘렸다),
      // 접힌 안내 높이를 모두 품으며, 입력창이 그 끝까지 보인다.
      expect(m.p).toBeGreaterThanOrEqual(m.lineHeight * 2 - 1);
      expect(m.p).toBeGreaterThanOrEqual(m.hint - 0.5);
      expect(m.editorBottom).toBeGreaterThanOrEqual(m.pBottom - 0.5);
      await page.screenshot({ path: 'test-results/tc/chat-question/composer-hint-desktop-narrow.png' });

      // 글자를 치면 안내가 사라지고 입력창은 한 줄로 돌아간다(첫 줄에 캐럿).
      await page.getByTestId('chat-composer').locator('.ProseMirror').click();
      await page.keyboard.type('네');
      const typed = await page.getByTestId('chat-composer').locator('.ProseMirror p').first().evaluate((p) => ({
        h: p.getBoundingClientRect().height,
        lh: parseFloat(getComputedStyle(p).lineHeight),
      }));
      expect(typed.h).toBeLessThan(typed.lh * 1.5);
    });

    test('담당자를 바꿔 스레드가 다시 오면 열린 작성창 안내도 바뀐다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
      const { agentRef } = await setup(page, { externalAgent: KODI });
      // 담당자 교체 PUT — 성공하면 서버가 다음 스레드 응답에서 externalAgent 를 null 로 돌려준다.
      await page.route(
        (u) => u.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/assignees`,
        (r) => {
          if (r.request().method() !== 'PUT') return r.fallback();
          agentRef.current = null;
          return r.fulfill(json({}));
        },
      );
      await page.route(`**/api/v1/projects/${PROJECT_KEY}/members`, (r) =>
        r.fulfill(
          json([
            createMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
            createMember({ userId: KODI.id, username: KODI.username, name: KODI.name, role: 'MEMBER' }),
          ]),
        ),
      );
      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
      await page.getByTestId('issue-chat-open').click();
      await expect(emptyLine(page)).toHaveAttribute('data-placeholder', HINT);

      // 드로워는 모달이라 닫고 상세의 담당자 선택기에서 사람 한 명으로 바꾼 뒤 다시 연다 —
      // 변경 성공이 챗 스레드 캐시를 무효화해 새 응답(externalAgent=null)을 받아야 한다.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('issue-chat-drawer')).toBeHidden();
      await page.getByTestId('assignee-picker-trigger').click();
      await page.getByTestId(`assignee-option-${ME_ID}`).click();
      await page.keyboard.press('Escape');
      await expect(page.getByText('담당자를 저장했습니다')).toBeVisible();

      await page.getByTestId('issue-chat-open').click();
      await expect(emptyLine(page)).not.toHaveAttribute('data-placeholder', /이어받아요/);
    });

    test('열려 있는 작성창은 다시 만들어지지 않고도 스레드 응답이 바뀌면 안내가 바뀐다', { tag: '@platform' }, async ({
      authenticatedPage: page,
    }) => {
      const { agentRef } = await setup(page, { externalAgent: KODI });
      const events = await mockGatedEvents(page);
      await openDrawer(page);
      await expect(emptyLine(page)).toHaveAttribute('data-placeholder', HINT);
      await page.screenshot({ path: 'test-results/tc/chat-question/composer-hint-1280.png' });

      // 에디터가 다시 만들어지지 않았음을 증명할 표식 — DOM 요소가 바뀌면 사라진다.
      const editor = page.getByTestId('chat-composer').locator('.ProseMirror');
      await editor.evaluate((el) => el.setAttribute('data-e2e-mounted', 'same'));

      // 서버가 이슈 챗 스레드 변경을 알리는 실제 경로(resource.changed 'chat-thread' → 스레드 쿼리 무효화) —
      // 이번엔 담당 AI 가 빠져 externalAgent=null 로 내려온다. 드로워는 닫지 않는다.
      agentRef.current = null;
      events.deliver(
        resourceChangedFrame({
          resource: 'chat-thread',
          op: 'updated',
          projectKey: PROJECT_KEY,
          issueNumber: ISSUE_NUMBER,
        }),
      );

      // 안내 문구(agentReplyHint)는 composerHint.test.ts 가 담당 — 외부 실행 AI 가 빠지면 기본 안내로 돌아오는지만 본다.
      await expect(emptyLine(page)).toHaveAttribute('data-placeholder', '메시지 입력 (Shift+Enter 로 줄바꿈)');
      await expect(editor).toHaveAttribute('data-e2e-mounted', 'same');
    });
  });
});
