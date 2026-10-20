// 드라이브 팀 공간 멤버·보기 전용 E2E(WP-582) — 백엔드 없이 page.route 모킹.
// 노출·잠금 분기는 SpaceMemberDialog.test.tsx·driveSpaces.test.ts 가 맡고, 여기는 화면 배선(사이드바 ⋯ → 멤버 창 → API → 목록 반영)과
// 보기 전용 공간의 실제 버튼 상태를 본다.
import type { Page } from '@playwright/test'

import type { DriveMember, DriveSpace } from '../../../src/types/drive'
import { createMember } from '../../factories/auth.factory'
import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'

const SPACE_ID = 2

// 사이드바 + DrivePage 공통 경로 — 공간 목록·단건·쿼터·항목(파일 1개).
async function mockDrive(page: Page, team: DriveSpace) {
  const spaces = [personalSpace({ id: 1 }), team]
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 ** 3 } }))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: spaces }) : r.fallback(),
  )
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}`, (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: team }) : r.fallback(),
  )
  await page.route((u) => /\/api\/v1\/drive\/spaces\/\d+\/items$/.test(u.pathname), (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({ json: { folders: [], files: [createFile({ id: 20, name: '주간 회의록.docx' })] } })
      : r.fallback(),
  )
}

test.describe('드라이브 팀 공간 멤버', () => {
  test('소유자 — 사이드바 ⋯ → 멤버 → 추가(POST)·역할 변경(PATCH)·제거(DELETE)가 목록에 반영된다', { tag: '@smoke' }, async ({
    authenticatedPage: page,
  }) => {
    await mockDrive(page, createSpace({ id: SPACE_ID, name: '제품기획팀', role: 'OWNER' }))
    // 가변 멤버 상태 — 요청마다 바꿔 다음 GET(무효화 재조회)에 반영한다.
    let members: DriveMember[] = [
      { userId: 1, name: '테스트 사용자', role: 'OWNER' },
      { userId: 3, name: '박서준', role: 'EDITOR' },
    ]
    await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/members`, (r) => {
      const method = r.request().method()
      if (method === 'GET') return r.fulfill({ json: members })
      if (method === 'POST') {
        members = [...members, { userId: 2, name: '김민지', role: 'EDITOR' }]
        return r.fulfill({ status: 201, body: '' })
      }
      return r.fallback()
    })
    await page.route((u) => /^\/api\/v1\/drive\/spaces\/2\/members\/\d+$/.test(u.pathname), (r) => {
      const userId = Number(new URL(r.request().url()).pathname.split('/').pop())
      const method = r.request().method()
      if (method === 'PATCH') {
        const { role } = r.request().postDataJSON() as { role: DriveMember['role'] }
        members = members.map((m) => (m.userId === userId ? { ...m, role } : m))
        return r.fulfill({ status: 204, body: '' })
      }
      if (method === 'DELETE') {
        members = members.filter((m) => m.userId !== userId)
        return r.fulfill({ status: 204, body: '' })
      }
      return r.fallback()
    })
    await page.route((u) => u.pathname === '/api/v1/members', (r) =>
      r.fulfill({
        json: {
          content: [createMember({ userId: 2, username: 'minji', name: '김민지' })],
          page: 0, size: 20, totalElements: 1, totalPages: 1,
        },
      }),
    )
    const adds = trackRequests(page, 'POST', `/api/v1/drive/spaces/${SPACE_ID}/members`)
    const patches = trackRequests(page, 'PATCH', `/api/v1/drive/spaces/${SPACE_ID}/members/3`)
    const deletes = trackRequests(page, 'DELETE', `/api/v1/drive/spaces/${SPACE_ID}/members/3`)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId(`drive-space-menu-${SPACE_ID}`).click()
    await page.getByTestId(`drive-space-members-${SPACE_ID}`).click()
    const dialog = page.getByTestId('drive-members-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('멤버 2명')).toBeVisible()
    // 마지막 소유자(나)는 잠기고, 역할은 한국어로 보인다.
    await expect(page.getByTestId('drive-member-role-select-1')).toBeDisabled()
    await expect(page.getByTestId('drive-member-role-select-3').locator('option:checked')).toHaveText('편집자')

    // 추가 — 새 멤버는 편집자로 들어간다.
    await page.getByTestId('drive-member-add-trigger').click()
    await page.getByTestId('member-search-row-2').click()
    await adds.waitFor()
    expect(adds.lastBody()).toEqual({ userId: 2, role: 'EDITOR' })
    await expect(page.getByTestId('drive-member-row-2')).toContainText('김민지')
    await page.keyboard.press('Escape')

    // 역할 변경 — 박서준을 보기 전용으로.
    await page.getByTestId('drive-member-role-select-3').selectOption('VIEWER')
    await patches.waitFor()
    expect(patches.lastBody()).toEqual({ role: 'VIEWER' })
    await expect(page.getByTestId('drive-member-role-select-3').locator('option:checked')).toHaveText('보기 전용')

    // 제거 — 확인 뒤 DELETE, 행이 사라진다.
    await page.getByTestId('drive-member-remove-3').click()
    await page.getByTestId('drive-member-remove-confirm').click()
    await deletes.waitFor()
    await expect(page.getByTestId('drive-member-row-3')).toHaveCount(0)
    await expect(dialog.getByText('멤버 2명')).toBeVisible()
  })

  test('소유자 — 서버가 역할 변경을 거부하면(409) 그 이유를 알린다', async ({ authenticatedPage: page }) => {
    await mockDrive(page, createSpace({ id: SPACE_ID, name: '제품기획팀', role: 'OWNER' }))
    await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/members`, (r) =>
      r.fulfill({
        json: [
          { userId: 1, name: '테스트 사용자', role: 'OWNER' },
          { userId: 4, name: '정도윤', role: 'OWNER' },
        ],
      }),
    )
    // 다른 창에서 정도윤이 먼저 빠져 이제 내가 마지막 소유자인 경우 — 화면은 아직 둘이라 막지 않고, 서버가 거부한다.
    await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/members/1`, (r) =>
      r.fulfill({ status: 409, json: { status: 409, message: '마지막 소유자는 역할을 바꾸거나 뺄 수 없습니다.' } }),
    )
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId(`drive-space-menu-${SPACE_ID}`).click()
    await page.getByTestId(`drive-space-members-${SPACE_ID}`).click()
    await page.getByTestId('drive-member-role-select-1').selectOption('EDITOR')
    await expect(page.getByText('마지막 소유자는 역할을 바꾸거나 뺄 수 없습니다.')).toBeVisible()
  })

  test('소유자가 아닌 멤버 — ⋯ 에는 「멤버」만 있고, 멤버 창은 명단만 보인다', async ({ authenticatedPage: page }) => {
    await mockDrive(page, createSpace({ id: SPACE_ID, name: '제품기획팀', role: 'EDITOR' }))
    await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/members`, (r) =>
      r.fulfill({ json: [{ userId: 9, name: '김소유', role: 'OWNER' }, { userId: 1, name: '테스트 사용자', role: 'EDITOR' }] }),
    )
    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId(`drive-space-menu-${SPACE_ID}`).click()
    await expect(page.getByTestId(`drive-space-rename-${SPACE_ID}`)).toHaveCount(0)
    await expect(page.getByTestId(`drive-space-delete-${SPACE_ID}`)).toHaveCount(0)
    await page.getByTestId(`drive-space-members-${SPACE_ID}`).click()
    await expect(page.getByTestId('drive-member-role-9')).toHaveText('소유자')
    await expect(page.getByTestId('drive-member-add-trigger')).toHaveCount(0)
  })
})

test('보기 전용 멤버 — 버전 이력은 보이지만 롤백은 없다', async ({ authenticatedPage: page }) => {
  await mockDrive(page, createSpace({ id: SPACE_ID, name: '제품기획팀', role: 'VIEWER' }))
  const version = (versionNo: number, current: boolean) => ({
    versionNo, fileId: 100 + versionNo, sizeBytes: 2048, uploadedBy: 1, uploadedByName: '김소유',
    createdAt: '2026-10-18T00:00:00Z', comment: null, current,
  })
  await page.route((u) => u.pathname === '/api/v1/drive/files/20/versions', (r) =>
    r.fulfill({ json: [version(2, true), version(1, false)] }),
  )
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  const fileItem = page.getByRole('listitem').filter({ hasText: '주간 회의록.docx' })
  await fileItem.hover()
  await fileItem.getByRole('button', { name: /더보기/ }).click()
  await page.getByRole('menuitem', { name: '버전 이력' }).click()
  await expect(page.getByTestId('version-row-1')).toBeVisible()
  await expect(page.getByTestId('rollback-1')).toHaveCount(0)
})
