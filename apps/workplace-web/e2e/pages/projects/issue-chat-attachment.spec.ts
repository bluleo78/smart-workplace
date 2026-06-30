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
//   - POST /chat/threads/*/messages: createPayload 캡처 + 첨부 포함 응답 반환.

import { expect, test } from '../../fixtures/auth.fixture';
import { createChatMember, createChatThread } from '../../factories/chat.factory';
import { createFile } from '../../factories/drive.factory';
import { createIssue, createIssueDetail } from '../../factories/issue.factory';
import { createProject } from '../../factories/project.factory';
import type { MessageAttachment } from '../../../src/types/messaging';

const PROJECT_KEY = 'WP';
const ISSUE_NUMBER = 1;
const THREAD_ID = 100;
const ME_ID = 1;
const FILE_ID = 1;

test(
  '파일 첨부 버튼 노출 → 업로드 → fileIds 포함 전송 → 첨부 카드 렌더 (#358)',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
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
    let createPayload: Record<string, unknown> | null = null;
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        createPayload = route.request().postDataJSON();
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

    // ── 미읽음 mark-read 스텁 ─────────────────────────────────────────────
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
      (route) => route.fulfill({ status: 204 }),
    );

    // ── 페이지 진입 ──────────────────────────────────────────────────────
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);

    // 빈 recentMessages → 패널 접힘(open 토글 노출) → 클릭해서 펼침.
    await page.getByTestId('issue-chat-open').click();
    await expect(page.getByTestId('chat-section')).toBeVisible();

    // ── 검증 1: 첨부 버튼 노출 ───────────────────────────────────────────
    const attachBtn = page.getByTestId('chat-composer-attach-button');
    await expect(attachBtn).toBeVisible();

    // ── 검증 2: 파일 선택 → 업로드 스텁 호출 → 펜딩 칩 노출 ─────────────
    // setInputFiles: chat-composer-file-input(hidden) 에 직접 파일 주입.
    await page.getByTestId('chat-composer-file-input').setInputFiles({
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
    await expect.poll(() => createPayload).toMatchObject({
      fileIds: [FILE_ID],
    });

    // ── 검증 5: 서버 응답 attachments → 메시지 카드 렌더 (처리→출력 파이프라인) ──
    await expect(page.getByTestId(`attachment-card-${FILE_ID}`)).toContainText('test-file.txt');
  },
);

// ── 회귀 #446: FolderPickerModal f.fileId(blob ID) → f.id(drive_file PK) 수정 ────────────────
// 이슈 채팅 — 드라이브 링크 선택 시 driveFileIds 에 drive_file.id(PK) 전달 검증.
// 수정 전: f.fileId(blob ID) 전달 → 백엔드 drive_file 조회 404.
// 수정 후: f.id(PK) 전달 → 정상 처리.
// DriveFile.id(DRIVE_PK=300) ≠ fileId(BLOB_ID=999) 로 명확히 구분해 regression 고정.
test(
  '이슈 채팅 드라이브 링크 — 파일 피커에서 선택 시 drive_file.id(PK)가 driveFileIds 에 포함됨 (#446)',
  async ({ authenticatedPage: page }) => {
    const PERSONAL_SPACE_ID = 10;
    // drive_file.id(PK) 와 fileId(blob) 를 의도적으로 다른 값으로 설정 — 회귀 고정.
    const DRIVE_PK = 300;
    const BLOB_ID = 999;

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
              summary: createIssue({ id: 1, number: ISSUE_NUMBER, title: '드라이브 링크 테스트' }),
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

    // ── 드라이브 스페이스 스텁 — PERSONAL 1개 반환 → 드라이브 버튼 활성화 ──
    await page.route(
      (url) => url.pathname === '/api/v1/drive/spaces',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: PERSONAL_SPACE_ID,
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

    // ── FolderPickerModal 스페이스 아이템 — DRIVE_PK ≠ BLOB_ID 파일 1건 ──
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${PERSONAL_SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                folders: [],
                files: [
                  createFile({ id: DRIVE_PK, fileId: BLOB_ID, name: 'report.pdf' }),
                ],
              }),
            })
          : route.fallback(),
    );

    // ── 채팅 스레드 스텁 ─────────────────────────────────────────────────
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

    // ── GET /messages 스텁 (빈 목록) ─────────────────────────────────────
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

    // ── POST /messages — payload 캡처 ────────────────────────────────────
    let createPayload: Record<string, unknown> | null = null;
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/messages`,
      (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        createPayload = route.request().postDataJSON();
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 2001,
            threadId: THREAD_ID,
            authorId: ME_ID,
            authorName: '테스트 사용자',
            authorKind: 'HUMAN',
            body: '드라이브 링크 메시지',
            mentions: [],
            attachments: [],
            driveLinks: [],
            createdAt: new Date().toISOString(),
            editedAt: null,
            deleted: false,
          }),
        });
      },
    );

    // ── 미읽음 mark-read 스텁 ──────────────────────────────────────────────
    await page.route(
      (url) => url.pathname === `/api/v1/chat/threads/${THREAD_ID}/read`,
      (route) => route.fulfill({ status: 204 }),
    );

    // ── 페이지 진입 + 채팅 패널 펼침 ──────────────────────────────────────
    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`);
    await page.getByTestId('issue-chat-open').click();
    await expect(page.getByTestId('chat-section')).toBeVisible();

    // ── 검증 1: 드라이브 링크 버튼 활성화 ─────────────────────────────────
    const driveLinkBtn = page.getByTestId('chat-composer-drive-link-btn');
    await expect(driveLinkBtn).not.toBeDisabled();

    // ── 검증 2: 파일 피커 열림 → 파일 클릭 → 드라이브 칩 노출 (drive_file.id 기준) ──
    // data-testid="file-picker-file-{f.id}" → DRIVE_PK 로 렌더. 수정 전엔 f.fileId(BLOB_ID) 전달.
    await driveLinkBtn.click();
    await expect(page.getByTestId('folder-picker')).toBeVisible();
    await page.getByTestId(`file-picker-file-${DRIVE_PK}`).click();

    // 피커 닫힘 + pending 드라이브 칩 노출 (testid 는 addDrive 에 전달된 ID 기준)
    await expect(page.getByTestId('folder-picker')).not.toBeVisible();
    // 핵심 회귀 검증: chip testid 가 DRIVE_PK(300) — BLOB_ID(999)이면 버그 재현
    await expect(page.getByTestId(`chat-composer-drive-chip-${DRIVE_PK}`)).toBeVisible();

    // ── 검증 3: 전송 → POST payload 에 driveFileIds:[DRIVE_PK] 포함 ────────
    const input = page.getByTestId('chat-composer-input');
    await input.click();
    await page.keyboard.type('드라이브 링크 메시지');
    await page.getByTestId('chat-composer-submit').click();

    // 핵심 회귀 검증: driveFileIds 에 drive_file.id(PK=300) 전달 — fileId(blob=999) 이면 버그
    await expect.poll(() => createPayload).toMatchObject({
      driveFileIds: [DRIVE_PK],
    });
  },
);
