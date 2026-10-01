// Phase 6d — chat panel E2E.
// page.route 로 7 endpoint 모킹. 5 케이스: happy path / mention typeahead / AGENT 시각 / 수정·삭제 / mark-read.

import { expect, test } from '../../fixtures/auth.fixture';
import { mockGatedEvents } from '../../fixtures/gatedEvents';
import {
  createChatMember,
  createChatMessage,
  createChatMessagePage,
  createChatThread,
} from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import { hydrateMentions } from '../../../src/lib/chat-mentions';
import { formatChatTimestamp } from '../../../src/pages/projects/components/chat/formatChatTimestamp';
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
      // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
      await page.getByTestId('issue-chat-open').click();

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
      // #358: fileIds/driveFileIds 빈 배열이 함께 전송됨 (첨부 없는 경우)
      await expect.poll(() => stubs.createPayloads).toEqual([
        { body: '안녕하세요', fileIds: [], driveFileIds: [] },
      ]);
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
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();

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

  // 회귀(#197 재발) — 메시지 전송 직후 입력창이 자동으로 비워진 상태에서 보내기 버튼이
  // 다시 비활성(disabled)이어야 한다. 과거 버그: RichInput 의 clearContent() 가 emitUpdate=false(기본)라
  // onUpdate 미발생 → isEmpty 가 직전 false 에 stale 고정 → 전송 후 빈 입력인데도 버튼이 활성으로 남고
  // 클릭 시 trim 가드로 silent no-op(POST 미발생). clearContent(true) 로 update 강제 → isEmpty 동기화로 수정.
  test('전송 직후 입력 자동 비움 → 보내기 버튼 다시 비활성 (post-send stale 회귀)', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'post-send empty guard' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();

    const input = page.getByTestId('chat-composer-input');
    const submit = page.getByTestId('chat-composer-submit');
    await expect(input).toBeVisible();

    // 1) 텍스트 입력 → 전송.
    await input.click();
    await page.keyboard.type('첫 메시지');
    await expect(submit).toBeEnabled();
    await submit.click();

    // 2) 서버 확정(POST 201) — clearOnSubmit 이 성공 resolve 후 입력창을 비운다.
    await expect.poll(() => stubs.createPayloads.map((p) => p.body.trim())).toEqual(['첫 메시지']);
    await expect(input).toHaveText('');

    // 3) 핵심 검증: 전송 직후 빈 입력 상태에서 보내기 버튼이 다시 비활성이어야 한다.
    //    (stale isEmpty=false 면 여기서 enabled 로 남아 fail → 회귀 포착)
    await expect(submit).toBeDisabled();

    // 4) 비활성 버튼 클릭해도 POST 가 추가로 발생하지 않는다(silent no-op 자체가 차단됨).
    await submit.click({ force: true }).catch(() => {});
    await expect.poll(() => stubs.createPayloads.length).toBe(1);

    // 5) 다시 텍스트 입력 → 버튼 재활성화(전송 후에도 정상 토글 동작 유지).
    await input.click();
    await page.keyboard.type('두 번째');
    await expect(submit).toBeEnabled();
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
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();

    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('hi @ai');
    await expect(page.getByTestId('chat-mention-popover')).toBeVisible();
    await page.getByTestId('chat-mention-option-99').click();

    await expect(input).toContainText('@AI Agent');

    await page.getByTestId('chat-composer-submit').click();

    await expect.poll(() => stubs.createPayloads.map((p) => p.body.trim())).toEqual(['hi <@99>']);
    const agentChip = page.getByTestId('chat-mention-chip-99');
    await expect(agentChip).toHaveText('@AI Agent');
    // #208: AGENT 멘션칩은 ai-accent 토큰(raw purple 회귀 방지).
    // #884: 이 메시지는 본인 말풍선(bg-primary/10) 안이라 칩 배경은 bg-background (타인 메시지는 bg-ai-accent-subtle).
    await expect(agentChip).toHaveClass(/bg-background/);
    await expect(agentChip).toHaveClass(/text-ai-accent/);
    await expect(agentChip).not.toHaveClass(/purple/);
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
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

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
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

    const row = page.getByTestId('chat-message-500');
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('data-agent', 'true');
    await expect(row.getByTestId('agent-badge')).toBeVisible();

    // #208: AGENT 표식 색이 ai-accent 토큰으로 통일됐는지 검증(raw purple 팔레트 회귀 방지).
    // 클래스 단언(getComputedStyle 의 oklch/rgb 표기는 브라우저별로 갈려 brittle).
    // 좌측 보더는 ai-accent, raw purple-400 잔존 없음.
    await expect(row).toHaveClass(/border-ai-accent/);
    await expect(row).not.toHaveClass(/border-purple/);
    // #289: ChatAvatar — 이니셜 원 + 우하단 AGENT 배지(bot icon)가 렌더되어야 한다.
    await expect(row.getByTestId('chat-avatar-99')).toBeVisible();
    await expect(row.getByTestId('chat-avatar-agent-99')).toBeVisible();
    // AgentBadge 배경/텍스트도 ai-accent-subtle / ai-accent.
    const badge = row.getByTestId('agent-badge');
    await expect(badge).toHaveClass(/bg-ai-accent-subtle/);
    await expect(badge).toHaveClass(/text-ai-accent/);
  });

  test('본인 메시지는 우측 말풍선, 타인은 좌측 — 툴바는 말풍선 위·키보드 접근 가능 (#884)', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '좌우 분리' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    // 멘션 hydrate 용 멤버 — 에이전트(99)와 동료(20).
    const members = [
      ...stubs.thread.members,
      createChatMember({ userId: 20, username: 'peer', name: '동료' }),
    ];
    stubs.thread = {
      ...stubs.thread,
      members,
      recentMessages: [
        createChatMessage({
          id: 610,
          threadId: THREAD_ID,
          authorId: 20,
          authorName: '동료',
          authorKind: 'HUMAN',
          body: '스테이징에서 메일 동기화 스케줄러가 3분 주기로 도는지 확인했습니다. <@99> <@1>',
          mentions: hydrateMentions('<@99> <@1>', members),
        }),
        createChatMessage({
          id: 611,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          // 공백 없는 긴 문자열 포함 — ScrollArea 안에서 말풍선이 패널을 옆으로 넓히지 않는지 확인.
          body: `확인했습니다 <@99> <@20> 참고: https://example.com/${'very-long-path-segment-'.repeat(12)}end`,
          mentions: hydrateMentions('<@99> <@20>', members),
          editedAt: '2026-01-01T10:00:00Z',
        }),
        // 긴 파일명 첨부만 있는 본인 메시지 — 카드가 본인 컬럼을 넘지 않는지 확인.
        createChatMessage({
          id: 612,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '',
          attachments: [
            {
              fileId: 950,
              messageId: 612,
              originalName: `2026-10-01_운영배포_체크리스트_최종_v3_${'아주긴파일명_'.repeat(14)}.xlsx`,
              mimeType: 'application/vnd.ms-excel',
              sizeBytes: 49152,
              attachedById: ME_ID,
              attachedByName: '테스트 사용자',
              attachedAt: '2026-01-01T10:00:00Z',
            },
          ],
        }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

    // 본인: 우측 말풍선, 아바타·이름 없음.
    const ownRow = page.getByTestId('chat-message-611');
    await expect(ownRow).toHaveAttribute('data-own', 'true');
    await expect(ownRow).toHaveClass(/justify-end/);
    const ownBody = page.getByTestId('chat-message-body-611');
    await expect(ownBody).toHaveClass(/rounded-2xl/);
    await expect(ownBody).toHaveClass(/bg-primary\/10/);
    await expect(ownRow.getByTestId(`chat-avatar-${ME_ID}`)).toHaveCount(0);
    await expect(ownRow.getByText('테스트 사용자', { exact: true })).toHaveCount(0);

    // 타인: 좌측, 아바타·이름 있음, 말풍선 없음.
    const peerRow = page.getByTestId('chat-message-610');
    await expect(peerRow).toHaveAttribute('data-own', 'false');
    await expect(peerRow).not.toHaveClass(/justify-end/);
    await expect(peerRow.getByTestId('chat-avatar-20')).toBeVisible();
    await expect(peerRow.getByText('동료', { exact: true })).toBeVisible();
    await expect(page.getByTestId('chat-message-body-610')).not.toHaveClass(/rounded-2xl/);
    // 타인 메시지의 멘션 칩은 기존 클래스를 유지한다(본인 말풍선 전용 bg-background 로 새지 않음).
    const peerAgentChip = peerRow.getByTestId('chat-mention-chip-99');
    await expect(peerAgentChip).toHaveClass(/bg-ai-accent-subtle/);
    await expect(peerAgentChip).toHaveClass(/text-ai-accent/);
    await expect(peerAgentChip).not.toHaveClass(/bg-background/);
    const peerHumanChip = peerRow.getByTestId('chat-mention-chip-1');
    await expect(peerHumanChip).toHaveClass(/bg-muted/);
    await expect(peerHumanChip).toHaveClass(/text-foreground/);
    await expect(peerHumanChip).not.toHaveClass(/bg-background/);

    // 회귀: 본인 메시지도 hover 없이 시각이 보인다(시각 줄 = 툴바와 같은 relative 컨테이너의 span).
    const ownTime = ownRow
      .locator('div.relative')
      .first()
      .locator('span', { hasText: formatChatTimestamp(stubs.thread.recentMessages[1].createdAt) })
      .first();
    await expect(ownTime).toBeVisible();
    await expect(ownTime).toHaveCSS('opacity', '1');

    // 본인 "(수정됨)" 은 좁은 시각 줄에서 단어 중간에 끊기지 않는다.
    await expect(ownRow.getByLabel('수정됨')).toHaveClass(/whitespace-nowrap/);

    // 본인 말풍선(bg-primary/10) 안에서 멘션 칩이 배경에 묻히지 않도록 칩은 bg-background 를 쓴다.
    const agentChip = ownRow.getByTestId('chat-mention-chip-99');
    await expect(agentChip).toHaveClass(/bg-background/);
    await expect(agentChip).toHaveClass(/text-ai-accent/);
    const humanChip = ownRow.getByTestId('chat-mention-chip-20');
    await expect(humanChip).toHaveClass(/bg-background/);
    await expect(humanChip).toHaveClass(/text-foreground/);
    // wrap-anywhere 말풍선 안에서 칩이 '@' 와 이름 사이에서 끊기지 않는다.
    await expect(agentChip).toHaveClass(/whitespace-nowrap/);
    await expect(humanChip).toHaveClass(/whitespace-nowrap/);

    // 첨부 카드: 본인 행 안에 들어오고 75%(lg 미만은 85% — U4-L1)를 넘지 않는다(기본 + 320px 폭).
    const assertCardInsideRow = async () => {
      const row = (await page.getByTestId('chat-message-612').boundingBox())!;
      const card = (await page.getByTestId('attachment-card-950').boundingBox())!;
      const ratio = page.viewportSize()!.width < 1024 ? 0.85 : 0.75;
      expect(card.x).toBeGreaterThanOrEqual(row.x);
      expect(card.x + card.width).toBeLessThanOrEqual(row.x + row.width + 1);
      expect(card.width).toBeLessThanOrEqual(row.width * ratio + 1);
    };
    await assertCardInsideRow();
    await page.setViewportSize({ width: 320, height: 800 });
    await assertCardInsideRow();
    await page.setViewportSize({ width: 1280, height: 720 });

    // 좌표: 본인 말풍선은 타인 본문보다 오른쪽에서 끝난다.
    const ownBox = (await ownBody.boundingBox())!;
    const peerBox = (await page.getByTestId('chat-message-body-610').boundingBox())!;
    expect(ownBox.x).toBeGreaterThan(peerBox.x);

    // 툴바: hover 전 opacity 0 이지만 tab 순서에는 있다 → 포커스만으로 드러난다.
    const toolbar = page.getByTestId('chat-message-toolbar-611');
    // 드로어를 여는 클릭 위치의 포인터가 행 위에 남아 hover 로 판정되지 않도록 치운다.
    await page.mouse.move(0, 0);
    await expect(toolbar).toHaveCSS('opacity', '0');
    await page.getByTestId('chat-message-edit-611').focus();
    await expect(toolbar).toHaveCSS('opacity', '1');

    // 툴바는 말풍선 위에 있고 겹치지 않는다.
    const toolbarBox = (await toolbar.boundingBox())!;
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(ownBox.y + 0.5);

    // 타인 메시지에는 툴바가 없다(수정·삭제는 본인만).
    await expect(page.getByTestId('chat-message-toolbar-610')).toHaveCount(0);

    // 긴 URL 이 있어도 목록과 그 조상(ScrollArea 뷰포트 포함) 어디에도 가로 넘침이 없다.
    const overflows = await page.getByTestId('chat-message-611').evaluate((el) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 1) return true;
      }
      return false;
    });
    expect(overflows).toBe(false);
  });

  // #884 후속: 드로워를 열면 바로 입력할 수 있게 컴포저에 포커스가 간다(툴바는 드러나지 않는다).
  // 첫 열기(스레드 로드 후 컴포저 마운트)와 재열기(캐시로 즉시 마운트) 두 경로를 모두 본다.
  test('드로워를 열면 컴포저에 포커스 — 첫 열기·재열기 (#884)', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '포커스' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({
          id: 620,
          threadId: THREAD_ID,
          authorId: ME_ID,
          authorName: '테스트 사용자',
          authorKind: 'HUMAN',
          body: '본인 메시지 — 툴바가 포커스로 드러나면 안 된다',
        }),
      ],
    };
    await setupChatStubs(page, stubs);
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    const input = page.getByTestId('chat-composer-input');
    const toolbar = page.getByTestId('chat-message-toolbar-620');
    for (const round of ['첫 열기', '재열기']) {
      await page.getByTestId('issue-chat-open').click();
      await expect(input, round).toBeFocused();
      // 여는 클릭의 포인터가 행 위에 남아 hover 로 판정되지 않도록 치운다.
      await page.mouse.move(0, 0);
      await expect(toolbar, round).toHaveCSS('opacity', '0');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('issue-chat-drawer')).toHaveCount(0);
    }
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
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

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

    // #125: Undo 토스트 — 즉시 DELETE 를 호출하지 않는다.
    await expect(page.getByText('메시지를 삭제했습니다')).toBeVisible();
    // 실행 취소가 없으면 지연(5s) 후 실제 DELETE 호출 + 마스킹.
    await expect.poll(() => stubs.deleteIds, { timeout: 8000 }).toEqual([601]);
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
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

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
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();
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
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();

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
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

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
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();

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
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();

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

    // SSE 게이트 모킹(WP-59) — 패널이 마운트돼 typing 버스를 구독한 뒤 typing 이벤트(본인 + 다른 멤버)를 1회 흘린다.
    // 예전엔 유한 스트림 재연결마다 재방출했는데, 재연결 catch-up(활성 쿼리 전체 재조회)이 함께 돌아 스텁을 흔들었다.
    // 본인(ME_ID) 이벤트는 self-filter 로 무시되고, 다른 멤버만 인디케이터에 보여야 한다.
    const events = await mockGatedEvents(page);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible();
    events.deliver(
      `event: chat.thread.typing\n` +
        `data: ${JSON.stringify({ threadId: THREAD_ID, userId: ME_ID, name: '테스트 사용자' })}\n\n` +
        `event: chat.thread.typing\n` +
        `data: ${JSON.stringify({ threadId: THREAD_ID, userId: 99, name: 'AI Agent' })}\n\n`,
    );

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
    // freshStubs() 빈 recentMessages → 패널 기본 접힘 → 수동 펼침.
    await page.getByTestId('issue-chat-open').click();

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
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

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

  // 회귀(#338) — 멀티데이 대화에서 날짜 구분선이 렌더되어야 한다.
  // 날짜가 같은 메시지 사이엔 구분선 없음, 날짜가 바뀌는 지점에만 삽입.
  test('멀티데이 메시지 목록 → 날짜 구분선 삽입 (#338)', async ({ authenticatedPage: page }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'date divider 회귀' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();

    // 3일에 걸친 메시지 4건: day1 × 2, day2 × 1, day3 × 1.
    // recentMessages 에 넣어야 initialData 시드로 즉시 렌더된다(staleTime=5s 로 API 재호출 없음).
    stubs.thread = {
      ...stubs.thread,
      recentMessages: [
        createChatMessage({ id: 10, body: 'day1-msg1', createdAt: '2026-06-01T01:00:00Z' }),
        createChatMessage({ id: 11, body: 'day1-msg2', createdAt: '2026-06-01T10:00:00Z' }),
        createChatMessage({ id: 12, body: 'day2-msg1', createdAt: '2026-06-02T03:00:00Z' }),
        createChatMessage({ id: 13, body: 'day3-msg1', createdAt: '2026-06-03T06:00:00Z' }),
      ],
    };
    stubs.messages = stubs.thread.recentMessages;
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    // #558: 채팅은 드로어 — 상호작용 전 헤더 버튼으로 연다.
    await page.getByTestId('issue-chat-open').click();

    // 날짜 구분선 3개(첫 메시지 앞 + 날짜 전환 2회)
    await expect(page.getByTestId('date-divider')).toHaveCount(3);

    // 각 구분선의 날짜 텍스트 확인 (KST = UTC+9 → 2026-06-01T01Z = 2026년 6월 1일 KST)
    const dividers = page.getByTestId('date-divider');
    await expect(dividers.nth(0)).toContainText('2026년');
    await expect(dividers.nth(1)).toContainText('2026년');
    await expect(dividers.nth(2)).toContainText('2026년');

    // 같은 날 메시지 사이엔 구분선이 추가되지 않는다
    // → day1-msg1, day1-msg2 사이에 구분선 없음 (총 4건 메시지, 3개 구분선)
    await expect(page.getByTestId('date-divider')).toHaveCount(3);
  });

  // 회귀(#357) — Shift+Enter 줄바꿈 미작동 (HardBreak extension 누락)
  // 과거 버그: extensions 배열에 HardBreak 없음 → Shift+Enter 가 줄바꿈 삽입 안 하고 단일 paragraph 유지.
  // HardBreak 추가 후 <br> 삽입 → 서버 전송 body에 newline 포함 검증.
  test('Shift+Enter 줄바꿈 삽입 → 서버 body 에 \\n 포함 (HardBreak 회귀)', async ({
    authenticatedPage: page,
  }) => {
    const detailRef = {
      current: createIssueDetail({
        summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: 'hard-break 테스트' }),
      }),
    };
    await setupCommonStubs(page, detailRef);
    const stubs = freshStubs();
    await setupChatStubs(page, stubs);

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await page.getByTestId('issue-chat-open').click();

    const input = page.getByTestId('chat-composer-input');
    await input.click();

    // "첫 번째 줄" 입력 → Shift+Enter → "두 번째 줄" 입력
    await page.keyboard.type('첫 번째 줄');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('두 번째 줄');

    // 핵심 검증: 전송 body에 줄바꿈(\n)이 포함되어야 한다.
    // HardBreak 없으면 단일 paragraph로 합쳐져 \n 없이 전송됨.
    await page.getByTestId('chat-composer-submit').click();
    await expect
      .poll(() => stubs.createPayloads.map((p) => p.body))
      .toEqual([expect.stringContaining('\n')]);
  });
});
