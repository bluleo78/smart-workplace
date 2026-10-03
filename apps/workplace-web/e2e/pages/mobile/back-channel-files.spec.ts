// 모바일 뒤로가기 히스토리 — 채널 파일 드로워(?files=1, 드로워 안 폴더 ?filesFolder)(WP-207).
// 폴더 진입은 push 라 back 한 번에 상위 폴더로, ✕ 는 하위 폴더가 몇 단이든 한 번에 채널로.
import type { Page } from '@playwright/test'

import { json, stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

const SPACE_ID = 8800
// 3단 폴더 — 실데이터 폭 확인용 긴 이름.
const FOLDERS = [
  { id: 101, parentId: null, name: '2026 하반기 마케팅 캠페인 기획 자료 모음' },
  { id: 102, parentId: 101, name: '10월 오프라인 행사 부스 디자인 시안' },
  { id: 103, parentId: 102, name: '최종 인쇄용 고해상도 원본' },
]

async function stubFiles(page: Page) {
  await stubChannelMessages(page)
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/drive-space', (r) =>
    r.fulfill(json({ spaceId: SPACE_ID, archived: false })))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}`, (r) =>
    r.fulfill(json({ id: SPACE_ID, type: 'CHANNEL', name: '모바일-개편', ownerId: 1, role: 'EDITOR', archived: false, createdAt: '2026-06-01T00:00:00Z' })))
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) => {
    const parentId = new URL(r.request().url()).searchParams.get('parentId')
    const folders = FOLDERS.filter((f) => String(f.parentId) === String(parentId)).map((f) => ({ ...f, createdAt: '2026-06-01T00:00:00Z' }))
    return r.fulfill(json({ folders, files: [] }))
  })
  for (const f of FOLDERS) {
    const path = FOLDERS.slice(0, FOLDERS.indexOf(f) + 1).map(({ id, name }) => ({ id, name }))
    await page.route((u) => u.pathname === `/api/v1/drive/folders/${f.id}/path`, (r) => r.fulfill(json(path)))
  }
}

// 일반 멤버 채널은 모바일 헤더 메뉴 항목이 '파일' 하나라 ⋯ 없이 인라인으로 렌더된다(MobileHeaderMore inline).
async function openFilesDrawer(page: Page) {
  await page.getByTestId('channel-files-button').tap()
  await expect(page.getByTestId('drive-space-drawer')).toBeVisible()
}

test('폴더 3단 진입 → goBack 은 상위 폴더로 한 단계씩, ✕ 는 한 번에 채널로', async ({ authenticatedPage: page }) => {
  await stubFiles(page)
  await page.goto('/chat/channels/1')
  await openFilesDrawer(page)
  await expect(page).toHaveURL(/\/chat\/channels\/1\?files=1$/)
  const drawer = page.getByTestId('drive-space-drawer')
  for (const f of FOLDERS) await drawer.getByRole('button', { name: f.name }).tap()
  await expect(page).toHaveURL(/files=1&filesFolder=103$/)

  await page.goBack()
  await expect(page).toHaveURL(/files=1&filesFolder=102$/)
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: FOLDERS[2].name })).toBeVisible()

  await drawer.getByRole('button', { name: 'Close' }).tap()
  await expect(drawer).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  // 풀페이지 드라이브 키(folderId)는 채널 URL 에 섞이지 않는다.
  expect(new URL(page.url()).searchParams.get('folderId')).toBeNull()
})

test('딥링크 ?files=1&filesFolder=102 → ✕ 는 하위 키까지 지우고 채널에 남는다', async ({ authenticatedPage: page }) => {
  await stubFiles(page)
  await page.goto('/chat/channels/1?files=1&filesFolder=102')
  const drawer = page.getByTestId('drive-space-drawer')
  await expect(drawer.getByRole('button', { name: FOLDERS[2].name })).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).tap()
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  await expect(page.getByTestId('channel-column')).toBeVisible()
})

test('전체에서 열기 → 드라이브 풀페이지, goBack 은 드로워가 아니라 채널로', async ({ authenticatedPage: page }) => {
  await stubFiles(page)
  await page.goto('/chat/channels/1')
  await openFilesDrawer(page)
  await page.getByTestId('drive-drawer-open-full').tap()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  await page.goBack()
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
  await expect(page.getByTestId('drive-space-drawer')).toHaveCount(0)
})

// 알려진 한계(D2) — "전체에서 열기"는 현재 항목(가장 깊은 폴더)만 드라이브로 replace 한다. 그 아래 쌓인
// 드로워 폴더 항목들은 남으므로, 폴더 깊이>0 에서 열면 back 이 채널이 아니라 드로워의 상위 폴더로 돌아온다.
// 드로워 항목을 모두 걷어내려면 비동기 go(-n) 뒤 push 가 필요해 경합이 생기므로 받아들인다. 실제 동작을 고정한다.
test('전체에서 열기(폴더 2단) → goBack 은 드로워의 상위 폴더로 돌아온다(알려진 한계)', async ({ authenticatedPage: page }) => {
  await stubFiles(page)
  await page.goto('/chat/channels/1')
  await openFilesDrawer(page)
  const drawer = page.getByTestId('drive-space-drawer')
  await drawer.getByRole('button', { name: FOLDERS[0].name }).tap()
  await drawer.getByRole('button', { name: FOLDERS[1].name }).tap()
  await expect(page).toHaveURL(/files=1&filesFolder=102$/)
  await page.getByTestId('drive-drawer-open-full').tap()
  await expect(page).toHaveURL(new RegExp(`/drive/spaces/${SPACE_ID}$`))
  await page.goBack()
  await expect(page).toHaveURL(/\/chat\/channels\/1\?files=1&filesFolder=101$/)
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('button', { name: FOLDERS[1].name })).toBeVisible()
  // 이 상태에서 ✕ 는 마크를 이어받았으므로 한 번에 채널로 닫힌다.
  await drawer.getByRole('button', { name: 'Close' }).tap()
  await expect(page).toHaveURL(/\/chat\/channels\/1$/)
})
