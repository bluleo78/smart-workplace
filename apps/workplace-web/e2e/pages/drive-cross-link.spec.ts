// #80: 드라이브 교차링크 E2E (백엔드 없이 page.route 모킹).
// 시나리오:
//   1. 이슈 드라이브 링크 — ACTIVE 링크 렌더("링크" 배지 + spaceName), TRASHED 링크 dimmed + "휴지통에 있음"
//   2. 드라이브 가상 첨부 뷰 — ISSUE/MESSAGE 항목 렌더 + 출처 필터 chip → source 파라미터 캡처
//      + 저장 버튼 → import POST fileId 캡처; 빈 응답 시 ChatEmptyState 확인.
//   3. 백링크 (file-backlinks) — test.skip: FilePreviewModal은 drive-page 내에서 클릭으로만 열리며,
//      drive 공간 진입이 필요해 모킹 비용이 높다. 핵심 시나리오(1·2) 통과 후 추가 예정.

import type { Page } from '@playwright/test'

import type { DriveLink, VirtualAttachment, VirtualAttachmentPage } from '../../src/types/drive'

import { createFile, personalSpace } from '../factories/drive.factory'
import { mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'

// ── 공통 상수 ──────────────────────────────────────────────────────────────────
const PROJECT_KEY = 'WP'
const ISSUE_NUMBER = 42
const PERSONAL_SPACE_ID = 99

// ── 헬퍼: 이슈 상세 진입에 필요한 라우트 스텁 ──────────────────────────────────
async function stubIssuePage(page: Page) {
  // 프로젝트 단건
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: 1,
              key: PROJECT_KEY,
              name: '워크플레이스',
              description: null,
              ownerId: 1,
              type: 'TEAM',
              isDefault: false,
              createdAt: '',
              updatedAt: '',
            }),
          })
        : route.fallback(),
  )

  // 이슈 상세 (attachmentCount=1 로 스트립 렌더)
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              summary: {
                id: 100,
                projectKey: PROJECT_KEY,
                number: ISSUE_NUMBER,
                title: '드라이브 링크 테스트 이슈',
                status: 'TODO',
                priority: 'MID',
                dueDate: null,
                reporterId: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                labels: [],
                attachmentCount: 1,
                type: { id: 1, name: '작업', color: 'BLUE', icon: 'TASK', isDefault: true },
                assignees: [],
                parent: null,
                childCount: 0,
                childDoneCount: 0,
                blockedBy: [],
                blocks: [],
                blocked: false,
                customFields: [],
              },
              body: '본문',
              comments: [],
              history: [],
              attachments: [],
            }),
          })
        : route.fallback(),
  )

  // watchers
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/watchers`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  // 프로젝트 멤버 (isOwner 판단용)
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/members`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  // 이슈 업로드 첨부 목록
  await page.route(
    (url) => url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/attachments`,
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )

  // 스페이스 목록 — IssueAttachmentStrip 마운트 시 listSpaces 호출
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace({ id: PERSONAL_SPACE_ID })]),
          })
        : route.fallback(),
  )
}

// ── 시나리오 1: 이슈 드라이브 링크 렌더 ────────────────────────────────────────

test(
  '이슈 드라이브 링크 — ACTIVE 링크 "링크" 배지 + spaceName, TRASHED 링크 opacity-50 + "휴지통에 있음"',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const activeFileId = 501
    const trashedFileId = 502

    const activeLink: DriveLink = {
      driveFileId: activeFileId,
      fileId: activeFileId,
      name: 'spec.md',
      mimeType: 'text/plain',
      sizeBytes: 1024,
      hasThumbnail: false,
      spaceId: 1,
      spaceName: '팀 공간',
      availability: 'ACTIVE',
      createdById: 1,
      createdAt: new Date().toISOString(),
    }

    const trashedLink: DriveLink = {
      driveFileId: trashedFileId,
      fileId: trashedFileId,
      name: 'old-spec.md',
      mimeType: 'text/plain',
      sizeBytes: 512,
      hasThumbnail: false,
      spaceId: 1,
      spaceName: '팀 공간',
      availability: 'TRASHED',
      createdById: 1,
      createdAt: new Date().toISOString(),
    }

    await stubIssuePage(page)

    // 드라이브 링크 목록 — ACTIVE + TRASHED 각 1건
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/drive-links`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify([activeLink, trashedLink]),
            })
          : route.fallback(),
    )

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`)

    // 첨부 스트립 렌더 확인
    await expect(page.getByTestId('issue-attachment-strip')).toBeVisible()

    // ACTIVE 링크: 행 존재 + "링크" 배지 + spaceName 위치 버튼
    const activeRow = page.getByTestId(`issue-drive-link-${activeFileId}`)
    await expect(activeRow).toBeVisible()
    await expect(page.getByTestId(`issue-drive-link-badge-${activeFileId}`)).toContainText('링크')
    await expect(page.getByTestId(`issue-drive-link-location-${activeFileId}`)).toContainText('팀 공간')

    // TRASHED 링크: opacity-50 클래스 + "휴지통에 있음" 텍스트
    const trashedRow = page.getByTestId(`issue-drive-link-${trashedFileId}`)
    await expect(trashedRow).toBeVisible()
    await expect(trashedRow).toHaveClass(/opacity-50/)
    await expect(page.getByTestId(`issue-drive-link-location-${trashedFileId}`)).toContainText('휴지통에 있음')
  },
)

// ── 시나리오 1b: 드라이브 링크 추가 (ADD 흐름, POST 캡처) ─────────────────────

test(
  '이슈 드라이브 링크 — "드라이브에서 링크" 클릭 → 파일 피커 → POST drive-links(driveFileId 캡처)',
  async ({ authenticatedPage: page }) => {
    const FILE_ID = 999

    await stubIssuePage(page)

    // 초기 드라이브 링크 목록 — 빈 배열
    await page.route(
      (url) =>
        url.pathname === `/api/v1/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}/drive-links`,
      (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        }
        // POST — 201 응답(body 무시)
        if (route.request().method() === 'POST') {
          return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' })
        }
        return route.fallback()
      },
    )

    // 개인 스페이스 단건 — FolderPickerModal 내 스페이스 이름 표시용
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${PERSONAL_SPACE_ID}`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(personalSpace({ id: PERSONAL_SPACE_ID })),
            })
          : route.fallback(),
    )

    // 개인 스페이스 아이템 목록 — 파일 1건 포함
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${PERSONAL_SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                folders: [],
                files: [createFile({ id: FILE_ID, fileId: FILE_ID, name: 'target.pdf' })],
              }),
            })
          : route.fallback(),
    )

    await page.goto(`/projects/${PROJECT_KEY}/issues/${ISSUE_NUMBER}`)
    await expect(page.getByTestId('issue-attachment-strip')).toBeVisible()

    // "드라이브에서 링크" 버튼이 활성화(spacesResolved=true + personalSpaceId≠null)될 때까지 대기
    const addBtn = page.getByTestId('issue-drive-link-add-btn')
    await expect(addBtn).not.toBeDisabled()
    await addBtn.click()

    // 파일 피커 모달 열림 확인
    await expect(page.getByTestId('folder-picker')).toBeVisible()

    // 파일 행 클릭 → POST 캡처
    const [postReq] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes(`/issues/${ISSUE_NUMBER}/drive-links`) &&
          req.method() === 'POST',
      ),
      page.getByTestId(`file-picker-file-${FILE_ID}`).click(),
    ])

    const posted = postReq.postDataJSON() as Record<string, unknown>
    expect(posted.driveFileId).toBe(FILE_ID)
  },
)

// ── 시나리오 2: 드라이브 가상 첨부 뷰 ───────────────────────────────────────────

// 가상 첨부 스텁 헬퍼 — 드라이브 사이드바가 마운트 시 listSpaces 도 호출한다.
async function stubDriveSidebar(page: Page) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([personalSpace({ id: PERSONAL_SPACE_ID })]),
          })
        : route.fallback(),
  )
}

test(
  '드라이브 가상 첨부 뷰 — ISSUE/MESSAGE 항목 렌더 + 출처 필터칩 source 파라미터 캡처',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const issueFile: VirtualAttachment = {
      fileId: 201,
      name: 'design.png',
      mimeType: 'image/png',
      sizeBytes: 20480,
      hasThumbnail: true,
      sourceType: 'ISSUE',
      sourceLabel: 'WP-42',
      deepLink: '/projects/WP/issues/42',
      downloadUrl: '/api/v1/files/201/download',
      attachedAt: new Date().toISOString(),
    }

    const messageFile: VirtualAttachment = {
      fileId: 202,
      name: 'log.txt',
      mimeType: 'text/plain',
      sizeBytes: 512,
      hasThumbnail: false,
      sourceType: 'MESSAGE',
      sourceLabel: '#general',
      deepLink: '/messaging/channels/1',
      downloadUrl: '/api/v1/files/202/download',
      attachedAt: new Date().toISOString(),
    }

    const fullPage: VirtualAttachmentPage = { items: [issueFile, messageFile], nextCursor: null }
    const issuePage: VirtualAttachmentPage = { items: [issueFile], nextCursor: null }

    // 첨부 목록 — source 파라미터 없으면 전체, ISSUE 이면 이슈만 반환
    let capturedSourceParam: string | null = null
    await page.route(
      (url) => url.pathname === '/api/v1/drive/attachments',
      (route) => {
        const src = new URL(route.request().url()).searchParams.get('source')
        capturedSourceParam = src
        const body: VirtualAttachmentPage =
          src === 'ISSUE' ? issuePage : fullPage
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      },
    )

    await stubDriveSidebar(page)

    await page.goto('/drive/attachments')
    await expect(page.getByTestId('drive-attachments-view')).toBeVisible()

    // ISSUE 그룹 헤더 — "이슈" 배지 + 출처 라벨 딥링크. 행 자체는 그룹 안에 렌더.
    // (출처별 그룹화 재설계: 출처 배지는 행이 아니라 그룹 헤더에 위치한다)
    const issueGroup = page
      .getByTestId('drive-attachment-group')
      .filter({ has: page.getByTestId('drive-attachment-row-201') })
    await expect(issueGroup).toContainText('이슈')
    await expect(issueGroup.getByRole('link', { name: 'WP-42' })).toBeVisible()
    await expect(page.getByTestId('drive-attachment-row-201')).toBeVisible()

    // MESSAGE 그룹 헤더 — "메시지" 배지. sourceLabel('#general')은 '메시지'를 포함하지 않으므로
    // 아래 단언은 배지 렌더를 실제로 검증한다.
    const messageGroup = page
      .getByTestId('drive-attachment-group')
      .filter({ has: page.getByTestId('drive-attachment-row-202') })
    await expect(messageGroup).toContainText('메시지')
    await expect(page.getByTestId('drive-attachment-row-202')).toBeVisible()

    // 출처 필터칩 "이슈" 클릭 → refetch 시 source=ISSUE 파라미터 확인
    capturedSourceParam = null
    await page.getByTestId('drive-attachment-filter-issue').click()

    // MESSAGE 행이 사라지고 ISSUE 행만 남아야 한다
    await expect(page.getByTestId('drive-attachment-row-202')).toHaveCount(0)
    await expect(page.getByTestId('drive-attachment-row-201')).toBeVisible()

    // API 요청에 source=ISSUE 가 포함됐는지 확인
    expect(capturedSourceParam).toBe('ISSUE')
  },
)

test(
  '드라이브 가상 첨부 뷰 — 빈 응답 시 ChatEmptyState 렌더',
  async ({ authenticatedPage: page }) => {
    await page.route(
      (url) => url.pathname === '/api/v1/drive/attachments',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], nextCursor: null }),
        }),
    )

    await stubDriveSidebar(page)

    await page.goto('/drive/attachments')
    await expect(page.getByTestId('drive-attachments-view')).toBeVisible()

    // ChatEmptyState 확인 — "첨부가 없어요" 텍스트
    await expect(page.getByTestId('drive-attachments-view')).toContainText('첨부가 없어요')
  },
)

test(
  '드라이브 가상 첨부 뷰 — 저장 버튼 클릭 → 폴더 피커 → import POST fileId 캡처',
  async ({ authenticatedPage: page }) => {
    const FILE_ID = 301

    const attachment: VirtualAttachment = {
      fileId: FILE_ID,
      name: 'report.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sizeBytes: 8192,
      hasThumbnail: false,
      sourceType: 'ISSUE',
      sourceLabel: 'WP-10',
      deepLink: '/projects/WP/issues/10',
      downloadUrl: `/api/v1/files/${FILE_ID}/download`,
      attachedAt: new Date().toISOString(),
    }

    await page.route(
      (url) => url.pathname === '/api/v1/drive/attachments',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [attachment], nextCursor: null } satisfies VirtualAttachmentPage),
        }),
    )

    // 개인 스페이스 단건 — FolderPickerModal 내 헤더 표시
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${PERSONAL_SPACE_ID}`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(personalSpace({ id: PERSONAL_SPACE_ID })),
            })
          : route.fallback(),
    )

    // 개인 스페이스 아이템 — 루트 빈 목록 (폴더 선택 confirm 으로 진행)
    await page.route(
      (url) => url.pathname === `/api/v1/drive/spaces/${PERSONAL_SPACE_ID}/items`,
      (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ folders: [], files: [] }),
            })
          : route.fallback(),
    )

    // import-attachment — POST 캡처
    const importCapture = await mockApi(
      page,
      'POST',
      `/api/v1/drive/spaces/${PERSONAL_SPACE_ID}/import-attachment`,
      createFile({ id: FILE_ID, fileId: FILE_ID, name: 'report.xlsx' }),
      { status: 201, capture: true },
    )

    await stubDriveSidebar(page)

    await page.goto('/drive/attachments')
    await expect(page.getByTestId(`drive-attachment-row-${FILE_ID}`)).toBeVisible()

    // 저장 버튼 활성화 대기(spacesResolved=true + personalSpaceId≠null)
    const saveBtn = page.getByTestId(`drive-attachment-save-${FILE_ID}`)
    await expect(saveBtn).not.toBeDisabled()
    await saveBtn.click()

    // 폴더 피커 모달 열림 확인
    await expect(page.getByTestId('folder-picker')).toBeVisible()

    // 루트 선택 확인 버튼 클릭 → import POST 발화
    const confirmBtn = page.getByTestId('folder-picker-confirm')
    await expect(confirmBtn).toBeVisible()

    const [postedReq] = await Promise.all([
      page.waitForRequest(
        (req) =>
          req.url().includes(`/spaces/${PERSONAL_SPACE_ID}/import-attachment`) &&
          req.method() === 'POST',
      ),
      confirmBtn.click(),
    ])

    const posted = postedReq.postDataJSON() as Record<string, unknown>
    expect(posted.fileId).toBe(FILE_ID)

    // importCapture 도 동일 fileId 캡처 확인
    const captured = importCapture.lastRequest()
    expect((captured?.payload as Record<string, unknown>)?.fileId).toBe(FILE_ID)
  },
)

// ── 시나리오 3: 백링크 (skip — FilePreviewModal 은 drive-page 내에서만 열림) ───

test.skip(
  '파일 미리보기 모달 — /drive/files/{id}/backlinks mock → file-backlinks 렌더·href 확인',
  async ({ authenticatedPage: page }) => {
    // TODO: FilePreviewModal 은 DrivePage 에서 파일 행 클릭으로만 열린다.
    // DrivePage 자체가 스페이스/아이템 목록 등 다수의 모킹이 필요하고,
    // 파일 row를 hover → click 해야 미리보기가 열리는 구조.
    // drive.spec.ts 에서 이미 PreviewModal 기본 동작을 커버하므로,
    // 백링크 특화 시나리오는 향후 drive.spec.ts 확장으로 추가 예정.
    void page
  },
)
