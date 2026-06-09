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
import { hydrateMentions } from '../../../src/lib/chat-mentions';
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
        // 백엔드 hydrator 모사 — body 의 <@id> 토큰을 멤버 정보로 채운다.
        mentions: hydrateMentions(payload.body, stubs.thread.members),
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

      await page.getByTestId('chat-composer-input').click();
      await page.keyboard.type('안녕하세요');
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

  // 회귀(#197) — 빈/공백 입력에서 '보내기' 버튼이 비활성(disableWhenEmpty)이어야 한다.
  // 과거 버그: prop 미전달로 버튼이 항상 활성 → 클릭해도 trim 가드로 silent no-op(POST 미발생).
  // 팀채팅 컴포저(MessageComposer)와 동일 동작으로 정합.
  test('빈/공백 입력 시 보내기 버튼 비활성 → 텍스트 입력 시 활성화 (POST 미발생 보장)', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'empty guard' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const input = page.getByTestId('chat-composer-input');
    const submit = page.getByTestId('chat-composer-submit');
    await expect(input).toBeVisible();

    // 1) 초기 빈 상태 → 버튼 비활성.
    await expect(submit).toBeDisabled();

    // 2) 공백만 입력 → 여전히 비활성 (isEmpty 가 trim 기준).
    await input.click();
    await page.keyboard.type('   ');
    await expect(submit).toBeDisabled();

    // 3) 비활성 버튼 클릭 시도 → POST 미발생(silent no-op 자체가 발생할 여지가 없음).
    await submit.click({ force: true }).catch(() => {});
    await expect.poll(() => stubs.createPayloads.length).toBe(0);

    // 4) 실제 텍스트 입력 → 버튼 활성화. (force-click 으로 잃은 포커스를 다시 잡고 입력)
    await input.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('안녕');
    await expect(submit).toBeEnabled();

    // 5) 전송 → POST 1건 발생(공백 trim 후 본문만).
    await submit.click();
    await expect.poll(() => stubs.createPayloads.map((p) => p.body.trim())).toEqual(['안녕']);
  });

  test('@mention — 멤버 선택 → 칩 → <@id> 전송 + 이름 칩 렌더', async ({
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

    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('hi @ai');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    await page.getByTestId('chat-mention-option-99').click();

    await expect(input).toContainText('@AI Agent');

    await page.getByTestId('chat-composer-submit').click();

    await expect.poll(() => stubs.createPayloads.map((p) => p.body.trim())).toEqual(['hi <@99>']);
    await expect(page.getByTestId('chat-mention-chip-99')).toHaveText('@AI Agent');
  });

  // 회귀 — 인라인 편집기의 멘션 팝업이 열린 상태에서 composer 로 포커스 이동 후 Enter.
  // (예전 버그: Enter 가드가 DOM 전역 조회라 다른 인스턴스 팝업까지 잡혀 composer 전송이 차단됨)
  test('다른 인스턴스의 멘션 팝업이 열려있어도 composer Enter 전송은 차단되지 않는다', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'cross-instance popup' }),
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
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '편집 대상',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 인라인 편집기 열고 '@' 입력으로 그 인스턴스의 멘션 팝업을 띄운다.
    const row700 = page.getByTestId('chat-message-700');
    await row700.hover();
    await page.getByTestId('chat-message-edit-700').click();
    const editor = page.getByTestId('chat-message-editor-input');
    await editor.click();
    await page.keyboard.type(' @ai');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();

    // 편집기 팝업이 열린 채로 composer 로 포커스 이동 → 평범한 메시지 작성 → Enter 전송.
    const composer = page.getByTestId('chat-composer-input');
    await composer.click();
    await page.keyboard.type('전송되어야 함');
    await page.keyboard.press('Enter');

    // composer 의 멘션 없는 body 가 POST 되어야 한다 (Enter 가 삼켜지지 않음).
    await expect
      .poll(() => stubs.createPayloads.map((p) => p.body.trim()))
      .toEqual(['전송되어야 함']);
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
    const editor = page.getByTestId('chat-message-editor-input');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('수정본');
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

  // 전송 후에도 입력창에 포커스가 남아 마우스 클릭 없이 연속 입력 가능 (ProseMirror).
  test('전송 후 입력창 포커스 유지 — 연속 입력', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'focus' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('첫 메시지');
    await page.keyboard.press('Enter');

    await expect.poll(() => stubs.createPayloads.map((p) => p.body.trim())).toEqual(['첫 메시지']);
    // #123 — 성공 시에만 입력창을 비운다. 서버 확정(1001) 후 컴포저가 비워지고 포커스가 복귀한다.
    await expect(page.getByTestId('chat-message-1001')).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).not.toContainText('첫 메시지');

    await page.keyboard.type('이어서');
    await expect(input).toContainText('이어서');
  });

  // #44 회귀 — 인라인 편집기에서 본문을 바꾸지 않고 저장하면 PATCH 를 호출하지 않고 닫힌다.
  test('변경 없이 저장하면 PATCH 를 호출하지 않는다', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'noop save' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 800,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '원본',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const row = page.getByTestId('chat-message-800');
    await row.hover();
    await page.getByTestId('chat-message-edit-800').click();
    await expect(page.getByTestId('chat-message-editor-input')).toBeVisible();

    // 변경 없이 바로 저장.
    await page.getByTestId('chat-message-editor-save').click();

    // 에디터는 닫히고(취소처럼 처리), PATCH 는 호출되지 않아야 한다.
    await expect(page.getByTestId('chat-message-editor')).toHaveCount(0);
    await expect(page.getByTestId('chat-message-body-800')).toHaveText('원본');
    await page.waitForTimeout(300);
    expect(stubs.patchPayloads).toEqual([]);
  });

  // #43 회귀 — 멘션 메시지 전송 시 서버 응답 전 optimistic 칩이 올바른 이름으로 보인다(@알 수 없음 X).
  test('optimistic 멘션 칩이 서버 응답 전에도 올바른 이름으로 보인다', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'optimistic mention' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    // POST 응답을 길게(3s) 지연시켜 optimistic(pending) 윈도를 확보 — 서버 hydrate 전 상태를 검증.
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const payload = route.request().postDataJSON() as { body: string };
        stubs.createPayloads.push(payload);
        const saved = createChatMessage({
          id: 2000,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: payload.body,
          mentions: hydrateMentions(payload.body, stubs.thread.members),
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(saved),
        });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('hi @ai');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    await page.getByTestId('chat-mention-option-99').click();
    await page.getByTestId('chat-composer-submit').click();

    // 서버 응답(3s) 전에 optimistic 칩 이름이 올바라야 한다 (2s 안에 단언).
    await expect(page.getByTestId('chat-mention-chip-99')).toHaveText('@AI Agent', {
      timeout: 2000,
    });
  });

  // #37 — 입력 중 typing 송신: 본문이 바뀌면 POST /chat/threads/{id}/typing 가 호출된다.
  test('입력 중 typing 송신 (POST /typing)', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'typing 테스트' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    const typingCalls: number[] = [];
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/typing`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        typingCalls.push(Date.now());
        return route.fulfill({ status: 204 });
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    await page.getByTestId('chat-composer-input').click();
    await page.keyboard.type('타이핑');

    // 입력 시작과 동시에 typing 이 최소 1회 송신돼야 한다 (3초 throttle).
    await expect.poll(() => typingCalls.length).toBeGreaterThanOrEqual(1);
  });

  // #37 — 다른 멤버의 typing SSE 이벤트가 "X 입력 중…" 인디케이터로 보인다.
  test('다른 멤버 typing 인디케이터 노출', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'typing indicator' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    // SSE 스트림 모킹 — 매 연결마다 typing 이벤트(본인 + 다른 멤버)를 흘려보낸다.
    // 컴포넌트 구독 시점과의 경합을 피하려 재연결마다 재방출(스트림은 finite → 재연결됨).
    // 본인(ME_ID) 이벤트는 self-filter 로 무시되고, 다른 멤버만 인디케이터에 보여야 한다.
    await page.route(
      (url) => url.pathname === '/api/v1/chat/stream',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-cache' },
          body:
            `event: chat.thread.typing\n` +
            `data: ${JSON.stringify({ threadId: THREAD_ID, userId: ME_ID, name: '테스트 사용자' })}\n\n` +
            `event: chat.thread.typing\n` +
            `data: ${JSON.stringify({ threadId: THREAD_ID, userId: 99, name: 'AI Agent' })}\n\n`,
        }),
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 다른 멤버 typing → 인디케이터 노출. 본인 이벤트는 self-filter 로 표시되지 않는다.
    // (TTL 소멸은 재방출 모킹과 경합해 안정적으로 검증하기 어려워 생략 — TTL 로직은 단위 미검증.)
    const indicator = page.getByTestId('chat-typing');
    await expect(indicator).toContainText('AI Agent 입력 중…');
    await expect(indicator).not.toContainText('테스트 사용자');
  });

  // #123 회귀 — 전송 실패(POST 500) 시 컴포저 입력이 소실되지 않고 보존돼 재시도할 수 있어야 한다.
  // (예전 버그: clearOnSubmit 가 제출 즉시 동기적으로 입력을 비워 토스트 외 복구 수단이 없었음)
  test('전송 실패(500) 시 입력 텍스트 보존 + 재시도 성공', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'send fail' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    // POST 를 첫 1회만 500 으로 강제, 이후엔 setup 핸들러로 위임해 정상 처리.
    let failNext = true;
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        if (failNext) {
          failNext = false;
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: '서버 오류' }),
          });
        }
        return route.fallback();
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('전송실패될메시지XYZ');
    await page.getByTestId('chat-composer-submit').click();

    // 실패 토스트 표시 + 낙관적 행 제거. 그러나 컴포저 입력은 보존돼야 한다(핵심).
    await expect(page.getByText('서버 오류')).toBeVisible();
    await expect(input).toContainText('전송실패될메시지XYZ');
    // 첫 시도는 500 이라 성공 payload 가 기록되지 않는다(setup 핸들러는 성공 시에만 push).
    expect(stubs.createPayloads).toEqual([]);

    // 재시도: 보존된 입력을 그대로 다시 전송하면 이번엔 성공한다.
    await page.getByTestId('chat-composer-submit').click();
    await expect
      .poll(() => stubs.createPayloads.map((p) => p.body.trim()))
      .toEqual(['전송실패될메시지XYZ']);
    // 성공 확정 후엔 컴포저가 비워진다(#123: 성공 시에만 clear).
    await expect(input).not.toContainText('전송실패될메시지XYZ');
  });

  // #123 회귀 — 수정 실패(PATCH 500) 시 에디터가 강제로 닫히지 않고 입력 내용을 보존해야 한다.
  // (예전 버그: onSettled 가 실패에도 setEditingId(null) 로 에디터를 닫아 수정 내용이 소실됐음.
  //  useUpdateChatMessage 의 onError 캐시 보존 의도 "재시도 가능" 과 정면 모순)
  test('수정 실패(500) 시 에디터 유지 + 수정 내용 보존 + 재시도 성공', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'edit fail' }),
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
          body: '원본메시지테스트',
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    // PATCH 를 첫 1회만 500 으로 강제, 이후엔 setup 핸들러로 위임해 정상 처리.
    let failNext = true;
    await page.route(
      (url) => /\/api\/v1\/chat\/messages\/\d+$/.test(url.pathname),
      (route) => {
        if (route.request().method() !== 'PATCH') return route.fallback();
        if (failNext) {
          failNext = false;
          return route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: '수정 서버 오류' }),
          });
        }
        return route.fallback();
      },
    );

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const row = page.getByTestId('chat-message-600');
    await row.hover();
    await page.getByTestId('chat-message-edit-600').click();
    const editor = page.getByTestId('chat-message-editor-input');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('원본메시지테스트_수정중인내용');
    await page.getByTestId('chat-message-editor-save').click();

    // 실패 토스트 + 에디터 유지 + 수정 내용 보존(에디터가 닫히지 않아야 함 — 핵심).
    await expect(page.getByText('수정 서버 오류')).toBeVisible();
    await expect(page.getByTestId('chat-message-editor')).toBeVisible();
    await expect(editor).toContainText('원본메시지테스트_수정중인내용');
    // 첫 PATCH 는 내 핸들러가 500 으로 가로채 setup 핸들러에 도달하지 않으므로 payload 미기록.
    expect(stubs.patchPayloads).toEqual([]);

    // 재시도: 보존된 수정 내용으로 다시 저장하면 이번엔 성공하고 에디터가 닫힌다.
    await page.getByTestId('chat-message-editor-save').click();
    await expect
      .poll(() => stubs.patchPayloads)
      .toEqual([{ id: 600, body: '원본메시지테스트_수정중인내용' }]);
    await expect(page.getByTestId('chat-message-editor')).toHaveCount(0);
    await expect(page.getByTestId('chat-message-body-600')).toHaveText(
      '원본메시지테스트_수정중인내용',
    );
  });
});
