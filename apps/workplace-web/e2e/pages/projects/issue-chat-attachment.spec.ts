// 이슈 채팅 파일 첨부 E2E (#358) —
// 첨부 버튼 노출 → setInputFiles → POST /attachments 스텁 → 펜딩 칩 노출 →
// 본문 입력 + 전송 → POST /messages payload 에 fileIds 포함 → 첨부 카드 렌더.
//
// 스텁 전략:
//   - chat/stream: auth.fixture 에서 빈 event-stream 으로 이미 스텁 → frame-detached flake 없음.
//   - drive/spaces: useAttachmentDraft 마운트 시 PERSONAL 스페이스를 조회하므로 빈 배열 대신
//     PERSONAL 1개를 반환해 spacesResolved 를 true 로 세팅 (드라이브 버튼 활성화).
//   - POST /chat/threads/*/attachments: [{fileId:1,...}] 반환 → pending 칩 노출.
//   - GET /chat/threads/*/messages: 빈 목록(초기).
//   - POST /chat/threads/*/messages: 첨부 포함 응답 반환(본문은 trackRequests 로 검증).
//
// 실제 파일 선택기(filechooser)로 고른 파일이 업로드되는 흐름이라 @input 으로 남는다.
// 25MB 초과 사전 거름(WP-848)·드라이브 링크 drive_file.id 전송(#446)은
// src/pages/projects/issueChatAttachment.test.tsx(vitest 페이지 테스트, WP-980)가 맡는다.

import type { Page } from '@playwright/test';

import { expect, test } from '../../fixtures/auth.fixture';
import { trackRequests } from '../../fixtures/requests';
import { createChatMember, createChatThread } from '../../factories/chat.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { MessageAttachment } from '../../../src/types/messaging';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;
const FILE_ID = 1;

/** 이슈 상세 + 이슈 채팅 스레드(빈 메시지)·드라이브 스페이스·읽음 스텁 — 첨부 테스트 공통. */
async function stubIssueChatBase(page: Page) {
  // ── 이슈 상세 공통 스텁 ────────────────────────────────────────────────
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
        body: JSON.stringify(
          createIssueDetail({
            summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '첨부 테스트' }),
          }),
        ),
      }),
  );
  for (const sub of ['watchers', 'labels', 'attachments']) {
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/${sub}`,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
  }
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/labels`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  
  // ── 드라이브 스페이스 스텁 — useAttachmentDraft 마운트 시 listSpaces 호출 ──
  // PERSONAL 스페이스 1개 반환 → spacesResolved=true, personalSpaceId 세팅.
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 10,
            type: 'PERSONAL',
            name: '개인 공간',
            ownerId: ME_ID,
            role: 'OWNER',
            archived: false,
            createdAt: new Date().toISOString(),
          },
        ]),
      }),
  );
  
  // ── 채팅 스레드 스텁 ──────────────────────────────────────────────────
  const thread = createChatThread({
    threadId: THREAD_ID,
    issueId: 1,
    members: [createChatMember({ userId: ME_ID, username: 'testuser', name: '테스트 사용자' })],
    recentMessages: [],
  });
  await page.route(
    (url) =>
      url.pathname ===
      `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/chat/thread`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(thread),
      }),
  );
  
  // ── GET/POST /messages 스텁 ────────────────────────────────────────
  // chat.spec.ts 패턴: GET 핸들러와 POST 핸들러를 각각 route.fallback() 으로 체이닝.
  // auth.fixture 기본 글롭(**/chat/threads/*/messages)보다 늦게 등록되므로 LIFO 로 우선함.
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], nextCursor: null, hasMore: false }),
      });
    },
  );
  
  // ── 미읽음 mark-read 스텁 ─────────────────────────────────────────────
  await page.route(
    (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
    (route) => route.fulfill({ status: 204 }),
  );
}

test(
  '파일 첨부 버튼 노출 → 업로드 → fileIds 포함 전송 → 첨부 카드 렌더 (#358)',
  { tag: ['@input', '@smoke'] },
  async ({ authenticatedPage: page }) => {
    await stubIssueChatBase(page);

    // ── POST /attachments — 업로드 스텁: 파일 1개 → fileId=1 반환 ────────
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/attachments`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              fileId: FILE_ID,
              originalName: 'test-file.txt',
              mimeType: 'text/plain',
              sizeBytes: 5,
            },
          ]),
        });
      },
    );

    // ── POST /messages — payload 캡처 + 첨부 포함 응답 ───────────────────
    const creates = trackRequests(page, 'POST', `/api/v1/chat/threads/${THREAD_ID}/messages`);
    const attachment: MessageAttachment = {
      fileId: FILE_ID,
      messageId: 1001,
      originalName: 'test-file.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
      attachedById: ME_ID,
      attachedByName: '테스트 사용자',
      attachedAt: new Date().toISOString(),
    };
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 1001,
            threadId: THREAD_ID,
            authorId: ME_ID,
            authorName: '테스트 사용자',
            authorKind: 'HUMAN',
            body: '파일 첨부 메시지',
            mentions: [],
            attachments: [attachment], // 첨부 포함 응답 → attachment-card 렌더
            driveLinks: [],
            createdAt: new Date().toISOString(),
            editedAt: null,
            deleted: false,
          }),
        });
      },
    );

    // ── 페이지 진입 ──────────────────────────────────────────────────────
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 빈 recentMessages → 패널 접힘(open 토글 노출) → 클릭해서 펼침.
    await page.getByTestId('issue-chat-open').click();
    await expect(page.getByTestId('chat-section')).toBeVisible();

    // ── 검증 1: ＋ 첨부 메뉴 → 파일 첨부 항목 노출 (WP-235 한 줄 레이아웃) ─────
    await page.getByTestId('chat-composer-attach-button').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('chat-composer-attach-file').click();

    // ── 검증 2: 파일 선택 → 업로드 스텁 호출 → 펜딩 칩 노출 ─────────────
    await (await chooser).setFiles({
      name: 'test-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    });
    // 업로드 완료 후 pending 칩 목록에 파일명 노출.
    await expect(page.getByTestId('chat-composer-attachments')).toContainText('test-file.txt');

    // ── 검증 3: 본문 입력 + 전송 ─────────────────────────────────────────
    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('파일 첨부 메시지');
    await page.getByTestId('chat-composer-submit').click();

    // ── 검증 4: POST payload 에 fileIds:[1] 포함 (입력→처리 파이프라인) ──
    await expect.poll(() => creates.lastBody()).toMatchObject({
      fileIds: [FILE_ID],
    });

    // ── 검증 5: 서버 응답 attachments → 메시지 카드 렌더 (처리→출력 파이프라인) ──
    await expect(page.getByTestId(`attachment-card-${FILE_ID}`)).toContainText('test-file.txt');
  },
);
