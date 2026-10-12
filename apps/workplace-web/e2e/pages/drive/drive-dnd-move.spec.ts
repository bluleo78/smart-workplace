// 드라이브 끌어 옮기기(WP-364) E2E — 목록 행을 폴더 행·경로(상위 폴더/루트)로 끌어 bulkMove 로 옮긴다.
// 이슈 → 에픽 DnD(epic-dnd.spec)와 같은 마우스 다운→이동(PointerSensor distance:5) 방식으로 끈다.
import type { Page } from '@playwright/test'

import type { DriveFile, DriveFolder } from '../../../src/types/drive'
import { createFile, createFolder, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { stableBox } from '../../fixtures/wait'

const SPACE_ID = 1
// 화면: 드라이브 / 문서(7) / 기획(8) — 기획 폴더 안에서 끈다.
const DOCS = 7
const PLAN = 8
const MEETING = 11
const REFS = 12
const SPEC = 21
const DESIGN = 22

type MoveBody = { fileIds: number[]; folderIds: number[]; targetFolderId: number | null }

// 공간·경로·목록·이동 API 를 모킹한다. 목록은 이동 요청을 반영하는 가변 상태(옮겨진 항목은 기획 폴더에서 빠진다).
async function setup(page: Page, opts: { moveStatus?: number; archived?: boolean } = {}) {
  const state: { folders: DriveFolder[]; files: DriveFile[] } = {
    folders: [
      createFolder({ id: MEETING, parentId: PLAN, name: '회의록' }),
      createFolder({ id: REFS, parentId: PLAN, name: '참고 자료' }),
    ],
    files: [
      createFile({ id: SPEC, folderId: PLAN, name: '요구사항 정의서.docx' }),
      createFile({ id: DESIGN, folderId: PLAN, name: '화면 설계 v3.pdf' }),
    ],
  }
  // 이동으로 빠졌다가 되돌리기로 돌아오는 항목 보관소.
  const moved: { folders: DriveFolder[]; files: DriveFile[] } = { folders: [], files: [] }
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) => route.fulfill(json([personalSpace(), createSpace()])),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}`,
    (route) => route.fulfill(json(createSpace({ archived: opts.archived ?? false }))),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/folders/${PLAN}/path`,
    (route) => route.fulfill(json([{ id: DOCS, name: '문서' }, { id: PLAN, name: '기획' }])),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) => route.fulfill(json(state)),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items/move`,
    (route) => {
      if (opts.moveStatus && opts.moveStatus >= 400) {
        return route.fulfill(json({ message: '같은 이름의 항목이 이미 있습니다.' }, opts.moveStatus))
      }
      const body = route.request().postDataJSON() as MoveBody
      if (body.targetFolderId === PLAN) {
        // 되돌리기 — 보관소에서 기획 폴더로 복귀.
        state.folders.push(...moved.folders.filter((f) => body.folderIds.includes(f.id)))
        state.files.push(...moved.files.filter((f) => body.fileIds.includes(f.id)))
      } else {
        moved.folders.push(...state.folders.filter((f) => body.folderIds.includes(f.id)))
        moved.files.push(...state.files.filter((f) => body.fileIds.includes(f.id)))
        state.folders = state.folders.filter((f) => !body.folderIds.includes(f.id))
        state.files = state.files.filter((f) => !body.fileIds.includes(f.id))
      }
      return route.fulfill({ status: 204, body: '' })
    },
  )
  const moves = trackRequests(page, 'PATCH', `/api/v1/drive/spaces/${SPACE_ID}/items/move`)
  await page.goto(`/drive/spaces/${SPACE_ID}?folderId=${PLAN}`)
  await expect(page.getByTestId(`drive-row-file-${SPEC}`)).toBeVisible()
  await expect(page.getByTestId(`drive-crumb-${DOCS}`)).toBeVisible()
  return { moves }
}

// 드래그 시작 — 행 아이콘 부근을 잡고 PointerSensor distance:5 를 넘기도록 조금 움직인다.
async function startDrag(page: Page, sourceTestId: string) {
  const box = await stableBox(page.getByTestId(sourceTestId), sourceTestId)
  const x = box.x + 40
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 8, y + 8, { steps: 4 })
  await expect(page.getByTestId('drive-drag-overlay')).toBeVisible()
}
async function moveOver(page: Page, targetTestId: string) {
  const box = await stableBox(page.getByTestId(targetTestId), targetTestId)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
}
async function dragTo(page: Page, sourceTestId: string, targetTestId: string) {
  await startDrag(page, sourceTestId)
  await moveOver(page, targetTestId)
  await page.mouse.up()
}

test.describe('드라이브 끌어 옮기기', () => {
  test('파일을 폴더 행에 놓으면 그 폴더로 옮기고 되돌리기 토스트를 보인다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    await dragTo(page, `drive-row-file-${SPEC}`, `drive-row-folder-${MEETING}`)

    await moves.waitFor(1)
    expect(moves.lastBody<MoveBody>()).toEqual({ fileIds: [SPEC], folderIds: [], targetFolderId: MEETING })
    await expect(page.getByText('1개 항목을 「회의록」으로 옮겼습니다')).toBeVisible()
    // 재조회로 옮겨진 파일이 목록에서 빠진다.
    await expect(page.getByTestId(`drive-row-file-${SPEC}`)).toHaveCount(0)
  })

  test('드래그 중 폴더 행·상위 경로는 놓을 수 있음, 현재 폴더는 흐림, 포인터 아래는 강조', async ({ authenticatedPage: page }) => {
    await setup(page)
    await startDrag(page, `drive-row-file-${SPEC}`)
    // 끄는 원본은 흐려지고, 칩은 잡은 항목 이름.
    await expect(page.getByTestId(`drive-row-file-${SPEC}`)).toHaveClass(/opacity-40/)
    await expect(page.getByTestId('drive-drag-overlay')).toHaveText('요구사항 정의서.docx')
    await expect(page.getByTestId(`drive-row-folder-${MEETING}`)).toHaveAttribute('data-drop-state', 'allowed')
    await expect(page.getByTestId('drive-root')).toHaveAttribute('data-drop-state', 'allowed')
    await expect(page.getByTestId(`drive-crumb-${DOCS}`)).toHaveAttribute('data-drop-state', 'allowed')
    await expect(page.getByTestId(`drive-crumb-${PLAN}`)).toHaveClass(/opacity-50/)
    // 파일 행은 대상이 아니다.
    await expect(page.getByTestId(`drive-row-file-${DESIGN}`)).not.toHaveAttribute('data-drop-state')

    await moveOver(page, `drive-row-folder-${REFS}`)
    await expect(page.getByTestId(`drive-row-folder-${REFS}`)).toHaveAttribute('data-drop-state', 'over')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('drive-drag-overlay')).toHaveCount(0)
    await page.mouse.up()
    // 드래그가 끝나면 표시가 사라진다.
    await expect(page.getByTestId(`drive-row-folder-${REFS}`)).not.toHaveAttribute('data-drop-state')
  })

  test('선택한 묶음을 끌어 경로 루트에 놓으면 선택 전체를 루트로 옮긴다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    await page.getByTestId(`select-file-${DESIGN}`).check()
    await page.getByTestId(`select-folder-${REFS}`).check()

    await startDrag(page, `drive-row-file-${DESIGN}`)
    await expect(page.getByTestId('drive-drag-overlay')).toContainText('화면 설계 v3.pdf')
    await expect(page.getByTestId('drive-drag-overlay')).toContainText('외 1개')
    // 함께 끌리는 폴더는 대상이 될 수 없다.
    await expect(page.getByTestId(`drive-row-folder-${REFS}`)).not.toHaveAttribute('data-drop-state', 'allowed')
    await moveOver(page, 'drive-root')
    await page.mouse.up()

    await moves.waitFor(1)
    expect(moves.lastBody<MoveBody>()).toEqual({ fileIds: [DESIGN], folderIds: [REFS], targetFolderId: null })
    await expect(page.getByText('2개 항목을 「드라이브」로 옮겼습니다')).toBeVisible()
  })

  test('선택 밖 행을 끌면 그 항목만 옮긴다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    await page.getByTestId(`select-file-${DESIGN}`).check()
    await dragTo(page, `drive-row-file-${SPEC}`, `drive-crumb-${DOCS}`)
    await moves.waitFor(1)
    expect(moves.lastBody<MoveBody>()).toEqual({ fileIds: [SPEC], folderIds: [], targetFolderId: DOCS })
  })

  test('놓을 수 없는 곳(현재 폴더·끄는 폴더 자신·빈 곳)에 놓으면 요청하지 않는다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    await dragTo(page, `drive-row-folder-${MEETING}`, `drive-row-folder-${MEETING}`)
    await dragTo(page, `drive-row-folder-${MEETING}`, `drive-crumb-${PLAN}`)
    await dragTo(page, `drive-row-file-${SPEC}`, `drive-row-file-${DESIGN}`)
    // 마지막으로 허용 대상에 놓아 요청 순서를 확인 — 앞의 세 번은 요청이 없어야 첫 요청이 이것이다.
    await dragTo(page, `drive-row-folder-${MEETING}`, `drive-row-folder-${REFS}`)
    await moves.waitFor(1)
    expect(moves.count()).toBe(1)
    expect(moves.lastBody<MoveBody>()).toEqual({ fileIds: [], folderIds: [MEETING], targetFolderId: REFS })
  })

  test('되돌리기를 누르면 원래 폴더로 다시 옮긴다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    await dragTo(page, `drive-row-file-${SPEC}`, `drive-row-folder-${MEETING}`)
    await expect(page.getByTestId(`drive-row-file-${SPEC}`)).toHaveCount(0)

    await page.getByRole('button', { name: '되돌리기' }).click()
    await moves.waitFor(2)
    expect(moves.lastBody<MoveBody>()).toEqual({ fileIds: [SPEC], folderIds: [], targetFolderId: PLAN })
    await expect(page.getByText('되돌렸습니다')).toBeVisible()
    await expect(page.getByTestId(`drive-row-file-${SPEC}`)).toBeVisible()
  })

  test('서버가 거부하면 사유를 오류 토스트로 보이고 목록은 그대로다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page, { moveStatus: 409 })
    await dragTo(page, `drive-row-file-${SPEC}`, `drive-row-folder-${MEETING}`)
    await moves.waitFor(1)
    await expect(page.getByText('같은 이름의 항목이 이미 있습니다.')).toBeVisible()
    await expect(page.getByText(/옮겼습니다/)).toHaveCount(0)
    await expect(page.getByTestId(`drive-row-file-${SPEC}`)).toBeVisible()
  })

  test('짧은 클릭은 그대로 폴더를 연다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    await page.getByTestId(`drive-row-folder-${MEETING}`).getByRole('button', { name: '회의록' }).click()
    await expect(page).toHaveURL(new RegExp(`folderId=${MEETING}`))
    expect(moves.count()).toBe(0)
  })

  test('키보드로도 옮길 수 있다 — Space 로 집고 방향키로 폴더를 고른 뒤 Space', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    const row = page.getByTestId(`drive-row-file-${SPEC}`)
    await expect(row).toHaveAttribute('aria-roledescription', '드래그 가능한 항목')
    await row.focus()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('drive-drag-overlay')).toBeVisible()
    // 처음 ↓ 는 첫 폴더 행(회의록), 한 번 더 ↓ 는 참고 자료.
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId(`drive-row-folder-${MEETING}`)).toHaveAttribute('data-drop-state', 'over')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId(`drive-row-folder-${REFS}`)).toHaveAttribute('data-drop-state', 'over')
    await page.keyboard.press('Space')
    await moves.waitFor(1)
    expect(moves.lastBody<MoveBody>()).toEqual({ fileIds: [SPEC], folderIds: [], targetFolderId: REFS })
  })

  test('키보드로 위 경로로 꺼낼 수 있다', async ({ authenticatedPage: page }) => {
    const { moves } = await setup(page)
    await page.getByTestId(`drive-row-file-${DESIGN}`).focus()
    await page.keyboard.press('Space')
    // 처음 ↑ 는 가장 가까운 상위 경로(문서), 한 번 더 ↑ 는 루트.
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId(`drive-crumb-${DOCS}`)).toHaveAttribute('data-drop-state', 'over')
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('drive-root')).toHaveAttribute('data-drop-state', 'over')
    await page.keyboard.press('Enter')
    await moves.waitFor(1)
    expect(moves.lastBody<MoveBody>()).toEqual({ fileIds: [DESIGN], folderIds: [], targetFolderId: null })
  })

  test('보관된 채널의 공간(읽기 전용)에서는 끌어 옮기기를 켜지 않는다', async ({ authenticatedPage: page }) => {
    await setup(page, { archived: true })
    await expect(page.getByTestId('drive-readonly-banner')).toBeVisible()
    await expect(page.getByTestId(`drive-row-file-${SPEC}`)).not.toHaveAttribute('aria-roledescription')
  })

  test('휴대폰 폭에서는 끌어 옮기기를 켜지 않는다(길게 누르기 선택 유지)', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setup(page)
    await expect(page.getByTestId(`drive-row-file-${SPEC}`)).not.toHaveAttribute('aria-roledescription')
  })
})
