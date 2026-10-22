// 드라이브 파일 이름 변경(WP-335) — 데스크톱 행 ⋯ 메뉴 → 이름 변경 다이얼로그(확장자 앞까지 선택) → PATCH → 목록 반영.
// 백엔드 없이 page.route 모킹.
import type { Page } from '@playwright/test'

import { createFile, createFolder, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { pressEnterAfterComposition, pressMacChromeImeEnter } from '../../fixtures/ime'
import { trackRequests } from '../../fixtures/requests'
import { pausePageClock } from '../../fixtures/touch'
import { expectStays } from '../../fixtures/wait'
import type { DriveFile } from '../../../src/types/drive'

const SPACE_ID = 1
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** 공간·목록 모킹 — 목록은 state 를 그대로 돌려줘 이름 변경 후 재조회에 반영된다. */
async function stubDrive(page: Page, state: { files: DriveFile[]; folders?: unknown[] }) {
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json([personalSpace(), createSpace()])) : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/drive/spaces/${SPACE_ID}`, (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(createSpace())) : r.fallback())
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
      return r.fulfill(json({ status, error: 'Conflict', message: `같은 폴더에 이미 '${name}' 이름이 있습니다.` }, status))
    }
    state.files = state.files.map((f) => (f.id === id ? { ...f, name } : f))
    return r.fulfill(json(state.files.find((f) => f.id === id)))
  })
}

/** 파일 행 ⋯ → "이름 변경" 으로 다이얼로그를 연다. beforeRename 은 메뉴가 열린 뒤·이름 변경을 누르기 직전에 불린다. */
async function openRename(page: Page, fileName: string, beforeRename?: () => Promise<void>) {
  const row = page.getByRole('listitem').filter({ hasText: fileName })
  await row.hover()
  await row.getByRole('button', { name: /더보기/ }).click()
  await beforeRename?.()
  await page.getByRole('menuitem', { name: '이름 변경' }).click()
  // 다이얼로그는 열리며 포커스와 같은 태스크 안에서 「확장자 앞까지」로 선택을 좁힌다 — 포커스·선택이 자리 잡은 뒤에 입력한다.
  const input = page.getByTestId('rename-dialog-input')
  await expect(input).toBeFocused()
  await expect
    .poll(() => input.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.lastIndexOf('.')))
    .toBe(true)
}

test('⋯ → 이름 변경 — 확장자 앞까지 선택된 채 열리고, 타이핑하면 이름만 바뀌어 PATCH 후 목록에 반영된다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: '2026 사업계획서_최종.pdf', mimeType: 'application/pdf', category: 'PDF' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70)
  const patches = trackRequests(page, 'PATCH', '/api/v1/drive/files/70')
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, '2026 사업계획서_최종.pdf')
  const input = page.getByTestId('rename-dialog-input')
  await expect(input).toHaveValue('2026 사업계획서_최종.pdf')
  await expect(input).toBeFocused()
  // 확장자(.pdf) 앞까지만 선택돼 있다.
  expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, '2026 사업계획서_최종'.length])

  await page.keyboard.type('사업계획서_v2')
  await expect(input).toHaveValue('사업계획서_v2.pdf')
  await page.getByTestId('rename-dialog-confirm').click()

  await patches.waitFor()
  expect(patches.lastBody<{ name: string }>()).toEqual({ name: '사업계획서_v2.pdf' })
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByTestId('drive-row-file-70')).toContainText('사업계획서_v2.pdf')
})

test('⋯ 메뉴가 닫히며 포커스를 되돌리는 타이머가 늦게 돌아도, 열자마자 친 글자를 다시 선택해 덮어쓰지 않는다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: '2026 사업계획서_최종.pdf', mimeType: 'application/pdf', category: 'PDF' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70)
  const patches = trackRequests(page, 'PATCH', '/api/v1/drive/files/70')
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  // 페이지 시계(타이머·rAF)를 멈춰 부하로 늦게 도는 상황을 고정한다 — 그래도 열리자마자 확장자 앞까지 선택돼 있어야 한다(openRename 이 확인).
  await openRename(page, '2026 사업계획서_최종.pdf', () => pausePageClock(page))
  const input = page.getByTestId('rename-dialog-input')

  await page.keyboard.type('사업')
  await page.clock.runFor(1000) // 멈췄던 타이머·프레임이 이제 돈다
  await page.keyboard.type('계획서_v2')
  await expect(input).toHaveValue('사업계획서_v2.pdf')
  await page.getByTestId('rename-dialog-confirm').click()
  await patches.waitFor()
  expect(patches.lastBody<{ name: string }>()).toEqual({ name: '사업계획서_v2.pdf' })
})

test('고치기 전 Tab 으로 나갔다 Shift+Tab 으로 돌아와도 확장자 앞까지 다시 선택된다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'notes.txt' })] }
  await stubDrive(page, state)
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'notes.txt')
  const input = page.getByTestId('rename-dialog-input')
  await page.keyboard.press('Tab')
  await expect(input).not.toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(input).toBeFocused()
  await expect.poll(() => input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 'notes'.length])
  await page.keyboard.type('memo')
  await expect(input).toHaveValue('memo.txt')
})

// ⋯ 는 hover·키보드 포커스 때만 보여 닫힐 무렵엔 숨어 있다 — 그래도 포커스는 페이지 맨 위로 빠지지 않고 그 행에 머문다.
test('⋯ → 이름 변경을 취소하면 포커스는 그 행에 머문다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'notes.txt' }), createFile({ id: 71, name: 'memo.txt' })] }
  await stubDrive(page, state)
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'notes.txt')
  await page.getByRole('button', { name: '취소' }).click()
  await expect(page.getByTestId('rename-dialog-input')).toBeHidden()
  const row = page.getByRole('listitem').filter({ hasText: 'notes.txt' })
  await expect.poll(() => row.evaluate((el) => el.contains(document.activeElement))).toBe(true)
})

test('같은 이름이 있으면(409) 다이얼로그를 유지한 채 인라인으로 알리고, 고쳐서 다시 저장할 수 있다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'memo.txt' }), createFile({ id: 71, name: 'notes.txt' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70, (name) => (name === 'notes.txt' ? 409 : 200))
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'memo.txt')
  const input = page.getByTestId('rename-dialog-input')
  await input.fill('notes.txt')
  await page.getByTestId('rename-dialog-confirm').click()
  await expect(page.getByTestId('rename-dialog-error')).toHaveText("같은 폴더에 이미 'notes.txt' 이름이 있습니다.")
  await expect(input).toHaveAttribute('aria-invalid', 'true')

  // 입력하면 에러가 사라지고, 다른 이름으로는 저장된다.
  await input.fill('notes-2.txt')
  await expect(page.getByTestId('rename-dialog-error')).toBeHidden()
  await page.getByTestId('rename-dialog-confirm').click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByTestId('drive-row-file-70')).toContainText('notes-2.txt')
})

test('중복이 아닌 다른 실패는 서버 문구를 그대로 인라인으로 보여 준다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'memo.txt' })] }
  await stubDrive(page, state)
  await page.route((u) => u.pathname === '/api/v1/drive/files/70', (r) =>
    r.request().method() === 'PATCH'
      ? r.fulfill(json({ status: 400, error: 'Bad Request', message: '파일 이름에 / \\ 나 제어 문자는 쓸 수 없고, . 이나 .. 만으로 지을 수 없습니다.' }, 400))
      : r.fallback())
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'memo.txt')
  await page.getByTestId('rename-dialog-input').fill('..')
  await page.getByTestId('rename-dialog-confirm').click()
  await expect(page.getByTestId('rename-dialog-error')).toContainText('제어 문자는 쓸 수 없고')
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('빈 이름이면 이름 변경 버튼이 비활성, 이름 그대로면 요청 없이 닫힌다', async ({ authenticatedPage: page }) => {
  const state = { files: [createFile({ id: 70, name: 'memo.txt' })] }
  await stubDrive(page, state)
  await stubRename(page, state, 70)
  const patches = trackRequests(page, 'PATCH', '/api/v1/drive/files/70')
  await page.goto(`/drive/spaces/${SPACE_ID}`)

  await openRename(page, 'memo.txt')
  await expect(page.getByTestId('rename-dialog-confirm')).toHaveText('이름 변경')
  await page.getByTestId('rename-dialog-input').fill('   ')
  await expect(page.getByTestId('rename-dialog-confirm')).toBeDisabled()

  await page.getByTestId('rename-dialog-input').fill('memo.txt')
  await page.getByTestId('rename-dialog-confirm').click()
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
  const input = page.getByTestId('rename-dialog-input')
  await input.fill('회의록.txt')
  await pressMacChromeImeEnter(input, '록')
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectStays(page, patches.count, 0)

  await input.press('Enter')
  await patches.waitFor()
  expect(patches.lastBody<{ name: string }>()).toEqual({ name: '회의록.txt' })
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
  await row.getByRole('button', { name: /더보기/ }).click()
  await page.getByRole('menuitem', { name: '이름 변경' }).click()
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

test('⋯ 메뉴는 연 동안 트리거가 보이고 그 옆에 뜬다(왼쪽 위로 튀지 않음)', async ({ authenticatedPage: page }) => {
  await stubDrive(page, { files: [createFile({ id: 70, name: 'memo.txt' })] })
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  const row = page.getByRole('listitem').filter({ hasText: 'memo.txt' })
  await row.hover()
  await row.getByRole('button', { name: /더보기/ }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  // 메뉴가 열리면 hover 가 풀리지만 트리거는 남아 메뉴의 기준점이 된다.
  // (열린 동안 바깥이 aria-hidden 이라 role 대신 속성으로 찾는다.)
  const trigger = page.getByTestId('drive-row-file-70').locator('[aria-haspopup="menu"]')
  await expect(trigger).toBeVisible()
  const t = (await trigger.boundingBox())!
  await expect.poll(async () => {
    const m = (await page.getByRole('menu').boundingBox())!
    // align="end" — 메뉴 오른쪽 끝이 트리거 오른쪽 끝에 맞고, 트리거 바로 아래에 뜬다.
    return Math.abs(m.x + m.width - (t.x + t.width)) < 2 && m.y >= t.y + t.height - 1
  }).toBe(true)
})

// WP-817: 드라이브 대화상자를 Esc 로 닫으면 포커스가 연 컨트롤로 돌아간다 — body 로 빠지면 키보드 사용자가 처음부터 다시 Tab 해야 한다.
test('새 폴더 대화상자 — 키보드로 열고 Esc 로 닫으면 「새 폴더」 버튼으로 포커스가 돌아온다 (WP-817)', async ({ authenticatedPage: page }) => {
  await stubDrive(page, { files: [] })
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  const trigger = page.getByTestId('drive-new-folder')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('folder-name-input')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('folder-name-input')).toBeHidden()
  await expect(trigger).toBeFocused()

  // 다시 열어도 같다 — 앞선 닫힘의 기억이 남아 엉뚱한 곳으로 가지 않는다.
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('folder-name-input')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
})

test('⋯ → 이름 변경 대화상자 — Esc 로 닫으면 포커스가 body 로 빠지지 않고 그 행에 남는다 (WP-817)', async ({ authenticatedPage: page }) => {
  await stubDrive(page, { files: [createFile({ id: 71, name: '회의록.txt' })] })
  await page.goto(`/drive/spaces/${SPACE_ID}`)
  await openRename(page, '회의록.txt')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('rename-dialog-input')).toBeHidden()
  // ⋯ 는 hover·키보드 포커스 때만 보여 닫힐 무렵 숨어 있다 — 같은 행에서 포커스를 받는 첫 대상(선택 체크박스)으로 간다.
  const row = page.getByRole('listitem').filter({ hasText: '회의록.txt' })
  await expect(row.getByRole('checkbox')).toBeFocused()
})
