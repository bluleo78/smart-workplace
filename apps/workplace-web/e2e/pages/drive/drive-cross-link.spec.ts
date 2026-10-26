// #80: 드라이브 교차링크 E2E (백엔드 없이 page.route 모킹).
// 이슈 상세의 드라이브 링크 — ACTIVE 링크 "링크" 배지 + 공간 이름, TRASHED 링크 흐림 + "휴지통에 있음", 링크 제거 X 가 키보드 Tab 으로 닿는지(@input).
// 「드라이브에서 링크」 payload·첨부 모아보기(출처 그룹·필터 source·빈 화면·저장 import payload)는
// src/pages/drive/driveAttachmentsView.test.tsx 가 지킨다(WP-971, WP-984). 뷰어의 참조된 곳은 src/pages/drive/drivePreview.test.tsx.

import type { Page } from '@playwright/test'

import type { DriveLink } from '../../../src/types/drive'

import { personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

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
              // 첨부 추가 컨트롤(드롭존·드라이브 링크)은 본문 편집 권한일 때만 노출(WP-202) — 멤버 뷰어로 고정.
              viewerCanEditContent: true,
              viewerCanEditWorkflow: true,
              viewerCanDelete: true,
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
  { tag: ['@input', '@smoke'] },
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

    // WP-498 — 링크 제거 X 는 키보드로도 닿는다: 다운로드에서 Tab 하면 포커스를 받고 보이며, Enter 로 확인창이 열린다.
    await page.getByRole('button', { name: 'spec.md 다운로드' }).focus()
    await page.keyboard.press('Tab')
    const remove = page.getByTestId(`issue-drive-link-remove-${activeFileId}`)
    await expect(remove).toBeFocused()
    await expect(remove).toHaveCSS('opacity', '1')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('drive-link-remove-confirm')).toBeVisible()
  },
)
