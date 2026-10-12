// 드라이브 파일 이름 변경(WP-335) — 데스크톱 행 ⋯ 메뉴 → 이름 변경 다이얼로그(확장자 앞까지 선택) → PATCH → 목록 반영.
// 백엔드 없이 page.route 모킹.
import type { Page } from '@playwright/test'

import { createFile, createFolder, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { pressEnterAfterComposition, pressMacChromeImeEnter } from '../../fixtures/ime'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'
import type { DriveFile } from '../../../src/types/drive'

const SPACE_ID = 1
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** 공간·목록 모킹 — 목록은 state 를 그대로 돌려줘 이름 변경 후 재조회에 반영된다. */
async function stubDrive(page: Page, state: { files: DriveFile[]; folders?: unknown[] }, { archived = false } = {}) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace({ archived })])) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}`, (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(createSpace({ archived }))) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`, (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ folders: state.folders ?? [], files: state.files })) : r.fallback())
  await page.route(/\/api\/v1\/drive\/files\/\d+\/thumbnail/, (r) => r.fulfill({ status: 404 }))
}

/** PATCH /files/{id} 모킹 — 성공 시 state 의 이름을 바꾼다. respond 로 상태 코드를 바꿀 수 있다. */
async function stubRename(page: Page, state: { files: DriveFile[] }, id: number, respond: (name: string) => number = () => 200) {
  await page.route((u) => u.pathname === `/api/v1/drive/files/${id}`, (r) => {
    if (r.request().method() !== 'PATCH') return r.fallback()
    const { name } = r.request().postDataJSON() as { name: string }
    const status = respond(name)
    if (status !== 200) {
      return r.fulfill(json({ status, error: 'Conflict', message: `같은 폴더에 이미 같은 이름이 있습니다 (name: ${name})` }, status))
    }
    state.files = state.files.map((f) => (f.id === id ? { ...f, name } : f))
    return r.fulfill(json(state.files.find((f) => f.id === id)))
  })
}

/** 파일 행 ⋯ → "이름 변경" 으로 다이얼로그를 연다. */
async function openRename(page: Page, fileName: string) {
  const row = page.getByRole('listitem').filter({ hasText: fileName })
  await row.hover()
  await row.getByRole('button', { name: /더보기/ }).click()
  await page.getByRole('menuitem', { name: '이름 변경' }).click()
}

test('⋯ → 이름 변경 — 확장자 앞까지 선택된 채 열리고, 타이핑하면 이름만 바뀌어 PATCH 후 목록에 반영된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: '2026 사업계획서_최종.pdf', mimeType: 'application/pdf', category: 'PDF' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70)
  const patches = trackRequests(page, 'PATCH', '/api/v1/drive/files/70')
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, '2026 사업계획서_최종.pdf')
  const input = page.getByTestId('file-rename-input')
  await expect(input).toHaveValue('2026 사업계획서_최종.pdf')
  await expect(input).toBeFocused()
  // 확장자(.pdf) 앞까지만 선택돼 있다.
  expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, '2026 사업계획서_최종'.length])

  await page.keyboard.type('사업계획서_v2')
  await expect(input).toHaveValue('사업계획서_v2.pdf')
  await page.getByTestId('file-rename-confirm').click()

  await patches.waitFor()
  expect(patches.lastBody<{ name: string }>()).toEqual({ name: '사업계획서_v2.pdf' })
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByTestId('drive-row-file-70')).toContainText('사업계획서_v2.pdf')
})

test('같은 이름이 있으면(409) 다이얼로그를 유지한 채 인라인으로 알리고, 고쳐서 다시 저장할 수 있다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'memo.txt' }), createFile({ id: 71, name: 'notes.txt' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70, (name) => (name === 'notes.txt' ? 409 : 200))
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'memo.txt')
  const input = page.getByTestId('file-rename-input')
  await input.fill('notes.txt')
  await page.getByTestId('file-rename-confirm').click()
  await expect(page.getByTestId('file-rename-error')).toHaveText('같은 폴더에 같은 이름의 파일이 있습니다.')
  await expect(input).toHaveAttribute('aria-invalid', 'true')

  // 입력하면 에러가 사라지고, 다른 이름으로는 저장된다.
  await input.fill('notes-2.txt')
  await expect(page.getByTestId('file-rename-error')).toBeHidden()
  await page.getByTestId('file-rename-confirm').click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByTestId('drive-row-file-70')).toContainText('notes-2.txt')
})

test('빈 이름은 요청 없이 인라인 에러, 이름 그대로면 요청 없이 닫힌다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'memo.txt' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70)
  const patches = trackRequests(page, 'PATCH', '/api/v1/drive/files/70')
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'memo.txt')
  await page.getByTestId('file-rename-input').fill('   ')
  await page.getByTestId('file-rename-confirm').click()
  await expect(page.getByTestId('file-rename-error')).toHaveText('파일 이름을 입력해주세요.')

  await page.getByTestId('file-rename-input').fill('memo.txt')
  await page.getByTestId('file-rename-confirm').click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expectStays(page, patches.count, 0)
})

test('한글 조합을 끝내는 Enter 는 저장하지 않고, 그 다음 Enter 로 저장한다(WP-331 규칙)', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'memo.txt' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70)
  const patches = trackRequests(page, 'PATCH', '/api/v1/drive/files/70')
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'memo.txt')
  const input = page.getByTestId('file-rename-input')
  await input.fill('회의록.txt')
  await pressMacChromeImeEnter(input, '록')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectStays(page, patches.count, 0)

  await input.press('Enter')
  await patches.waitFor()
  expect(patches.lastBody<{ name: string }>()).toEqual({ name: '회의록.txt' })
})

test('보관된 공간에서는 ⋯ 메뉴의 이름 변경이 비활성', async ({ authenticatedPage: page }) => {
  await stubDrive(page, { files: [createFile({ id: 70, name: 'memo.txt' })] }, { archived: true })
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  const row = page.getByRole('listitem').filter({ hasText: 'memo.txt' })
  await row.hover()
  await row.getByRole('button', { name: /더보기/ }).click()
  await expect(page.getByRole('menuitem', { name: '이름 변경' })).toHaveAttribute('data-disabled', '')
})

test('폴더 이름 칸도 한글 조합을 끝내는 Enter 로는 저장하지 않는다', async ({ authenticatedPage: page }) => {
  const folder = createFolder({ id: 10, name: '문서' })
  await stubDrive(page, { files: [], folders: [folder] })
  const patches = trackRequests(page, 'PATCH', '/api/v1/drive/folders/10')
  await page.route((u) => u.pathname === '/api/v1/drive/folders/10', (r) =>
    r.request().method() === 'PATCH' ? r.fulfill(json({ ...folder, name: '회의록' })) : r.fallback())
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  const row = page.getByRole('listitem').filter({ hasText: '문서' })
  await row.hover()
  await row.getByRole('button', { name: '이름변경' }).click()
  const input = page.getByTestId('folder-name-input')
  await input.fill('회의록')
  await pressMacChromeImeEnter(input, '록')
  await expect(input).toBeVisible()
  await expectStays(page, patches.count, 0)

  // 모바일 키보드처럼 조합을 끝내며 진짜 Enter 한 번만 보내면 저장된다.
  await pressEnterAfterComposition(input, '록')
  await patches.waitFor()
  expect(patches.lastBody<{ name: string }>()).toEqual({ name: '회의록' })
})
