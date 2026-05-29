// Phase 6d — chat panel E2E.
// page.route 로 7 endpoint 모킹. 5 케이스: happy path / mention typeahead / AGENT 시각 / 수정·삭제 / mark-read.

import { expect, test } from '../../fixtures/auth.fixture';
import {
  createChatMember,
  createChatMessage,
  createChatMessagePage,
  createChatThread,
} from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { ChatMessageResponse } from '../../../src/types/chat';
import type { IssueDetailResponse } from '../../../src/types/issue';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;

async function setupCommonStubs(
  page: import('@playwright/test').Page,
  detailRef: { current: IssueDetailResponse },
) {
  await page.route(`**/api/v1/projects/${PROJECT_KEY}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createProject()),
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
        body: JSON.stringify(detailRef.current),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
}

interface ChatStubs {
  thread: ReturnType<typeof createChatThread>;
  messages: ChatMessageResponse[];
  createPayloads: { body: string }[];
  patchPayloads: { id: number; body: string }[];
  deleteIds: number[];
  markReadPayloads: { uptoMessageId: number }[];
}

async function setupChatStubs(page: import('@playwright/test').Page, stubs: ChatStubs) {
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stubs.thread),
      }),
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createChatMessagePage(stubs.messages)),
      });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const payload = route.request().postDataJSON() as { body: string };
      stubs.createPayloads.push(payload);
      const saved = createChatMessage({
        id: 1000 + stubs.createPayloads.length,
        threadId: THREAD_ID,
        authorId: ME_ID,
        authorName: '테스트 사용자',
        authorKind: 'HUMAN',
        body: payload.body,
      });
      stubs.messages = [...stubs.messages, saved];
      // optimistic(pending) 상태가 관찰 가능하도록 약간의 지연 — 실제 네트워크 지연 모사.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(saved),
      });
    },
  );
  await page.route(
    (url) => /\/api\/v1\/chat\/messages\/\d+$/.test(url.pathname),
    (route) => {
      const url = new URL(route.request().url());
      const id = Number(url.pathname.split('/').pop());
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON() as { body: string };
        stubs.patchPayloads.push({ id, body: payload.body });
        stubs.messages = stubs.messages.map((m) =>
          m.id === id ? { ...m, body: payload.body, editedAt: new Date().toISOString() } : m,
        );
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(stubs.messages.find((m) => m.id === id)),
        });
      }
      if (route.request().method() === 'DELETE') {
        stubs.deleteIds.push(id);
        stubs.messages = stubs.messages.map((m) =>
          m.id === id ? { ...m, deleted: true, body: '(삭제됨)' } : m,
        );
        return route.fulfill({ status: 204 });
      }
      return route.fallback();
    },
  );
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
    (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const payload = route.request().postDataJSON() as { uptoMessageId: number };
      stubs.markReadPayloads.push(payload);
      return route.fulfill({ status: 204 });
    },
  );
}

function freshStubs(): ChatStubs {
  return {
    thread: createChatThread({
      threadId: THREAD_ID,
      issueId: 1,
      members: [
        createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' }),
        createChatMember({
          userId: 99,
          username: 'ai-agent',
          name: 'AI Agent',
          kind: 'AGENT',
        }),
      ],
      recentMessages: [],
    }),
    messages: [],
    createPayloads: [],
    patchPayloads: [],
    deleteIds: [],
    markReadPayloads: [],
  };
}

test.describe('이슈 chat panel', () => {
  test(
    'happy path: chat section 노출 → 메시지 작성 → optimistic + 서버 확정',
    { tag: '@smoke' },
    async ({ authenticatedPage: page }) => {
      const detailRef = {
        current: createIssueDetail({
          summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'chat 테스트' }),
        }),
      };
      await setupCommonStubs(page, detailRef);
      const stubs = freshStubs();
      await setupChatStubs(page, stubs);

      await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

      await expect(page.getByTestId('chat-section')).toBeVisible();
      await expect(page.getByTestId('chat-empty')).toBeVisible();

      await page.getByTestId('chat-composer-input').fill('안녕하세요');
      await page.getByTestId('chat-composer-submit').click();

      // optimistic 즉시 노출 — pending 마커.
      await expect(
        page.locator('[data-testid^=chat-message-][data-pending="true"]'),
      ).toContainText('안녕하세요');

      // 서버 확정 — pending 사라지고 영구 id 의 row 가 보임.
      await expect.poll(() => stubs.createPayloads).toEqual([{ body: '안녕하세요' }]);
      await expect(page.getByTestId(`chat-message-${1001}`)).toBeVisible();
    },
  );

  test('@mention typeahead — 멤버 선택 → textarea 치환', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'mention 테스트' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const ta = page.getByTestId('chat-composer-input');
    await ta.fill('hi @ai');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    await expect(page.getByTestId('chat-mention-option-99')).toBeVisible();
    await page.getByTestId('chat-mention-option-99').click();

    await expect(ta).toHaveValue('hi @ai-agent ');

    await page.getByTestId('chat-composer-submit').click();
    await expect.poll(() => stubs.createPayloads).toEqual([{ body: 'hi @ai-agent' }]);
  });

  test('AGENT 메시지 시각 구분', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'AGENT 시각' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 500,
          threadId: THREAD_ID,
          authorId: 99,
          authorName: 'AI Agent',
          authorKind: 'AGENT',
          body: 'AI 응답입니다',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const row = page.getByTestId('chat-message-500');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-agent', 'true');
    await expect(row.getByTestId('agent-badge')).toBeVisible();
  });

  test('본인 메시지 수정 + 삭제', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '수정삭제' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 600,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '원본',
        }),
        createChatMessage({
          id: 601,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '지울 것',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 수정.
    const row600 = page.getByTestId('chat-message-600');
    await row600.hover();
    await page.getByTestId('chat-message-edit-600').click();
    await page.getByTestId('chat-message-editor-input').fill('수정본');
    await page.getByTestId('chat-message-editor-save').click();

    await expect.poll(() => stubs.patchPayloads).toEqual([{ id: 600, body: '수정본' }]);
    await expect(page.getByTestId('chat-message-body-600')).toHaveText('수정본');

    // 삭제.
    const row601 = page.getByTestId('chat-message-601');
    await row601.hover();
    await page.getByTestId('chat-message-delete-601').click();

    await expect.poll(() => stubs.deleteIds).toEqual([601]);
    await expect(page.getByTestId('chat-message-body-601')).toContainText('(삭제됨)');
  });

  test('mark-as-read — 마지막 메시지 viewport 진입 시 POST /read', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'read' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 700,
          threadId: THREAD_ID,
          authorId: 99,
          authorName: 'AI Agent',
          authorKind: 'AGENT',
          body: '마지막 메시지',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 마지막 행이 viewport 안에 있어야 함 (section 전체가 보임).
    await page.getByTestId('chat-message-700').scrollIntoViewIfNeeded();

    await expect
      .poll(() => stubs.markReadPayloads, { timeout: 3000 })
      .toEqual([{ uptoMessageId: 700 }]);
  });

  // #40-1 회귀 — 한글 IME 조합 중 Enter 는 음절 확정용이므로 전송하지 않는다.
  // (가드 없으면 "안녕"/"녕" 처럼 중복 전송됨)
  test('한글 IME 조합 중 Enter 는 전송하지 않는다 — 중복 메시지 방지', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'IME' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const ta = page.getByTestId('chat-composer-input');
    await ta.fill('안녕');

    // IME 조합 중(마지막 음절 확정) Enter — isComposing=true 인 native keydown 을
    // React 위임 리스너에 도달하도록 직접 dispatch.
    await ta.evaluate((el) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(ev, 'isComposing', { get: () => true });
      el.dispatchEvent(ev);
    });

    // 조합 Enter 로는 전송되면 안 된다.
    await page.waitForTimeout(300);
    expect(stubs.createPayloads).toEqual([]);

    // 조합 종료 후 실제 Enter → 정확히 1건만 전송.
    await ta.press('Enter');
    await expect.poll(() => stubs.createPayloads).toEqual([{ body: '안녕' }]);
  });

  // #40-2 회귀 — 메시지가 많으면 로드 시 ScrollArea 뷰포트가 바닥으로 스크롤된다.
  test('메시지가 많으면 로드 시 마지막 메시지로 스크롤된다', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'scroll' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    // 30건 — h-[min(60vh,480px)] 를 넘겨 스크롤이 생기도록.
    const many = Array.from({ length: 30 }, (_, i) =>
      createChatMessage({
        id: i + 1,
        threadId: THREAD_ID,
        authorId: 99,
        authorName: 'AI Agent',
        authorKind: 'AGENT',
        body: `메시지 ${i + 1}`,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
      }),
    );
    stubs.thread = { ...stubs.thread, recentMessages: many };
    stubs.messages = many;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await expect(page.getByTestId('chat-message-list')).toBeVisible();

    // 뷰포트가 바닥에 도달했는지 직접 검증 (chat section 이 페이지 fold 아래라 toBeInViewport 는 혼동됨).
    await expect
      .poll(async () =>
        page.getByTestId('chat-message-list').evaluate((root) => {
          const vp = root.querySelector<HTMLElement>(
            '[data-radix-scroll-area-viewport]',
          );
          if (!vp) return -1; // 뷰포트 노드를 못 찾으면 명시적 실패값.
          return vp.scrollHeight - vp.scrollTop - vp.clientHeight;
        }),
      )
      .toBeLessThan(4);
  });

  // #41 회귀 — 전송 후에도 입력창 포커스가 유지되어 마우스 클릭 없이 연속 입력 가능.
  test('전송 후 입력창 포커스가 유지된다 — 연속 입력 가능', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'focus' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const ta = page.getByTestId('chat-composer-input');
    await ta.fill('첫 메시지');
    await ta.press('Enter');

    // 전송이 서버로 나갔는지 확인 (mutation pending 구간 진입 보장).
    await expect.poll(() => stubs.createPayloads).toEqual([{ body: '첫 메시지' }]);

    // 전송 후에도 포커스가 입력창에 남아 있어야 한다.
    await expect(ta).toBeFocused();

    // 마우스 클릭 없이 곧바로 이어서 타이핑 가능.
    await page.keyboard.type('이어서');
    await expect(ta).toHaveValue('이어서');
  });
});
