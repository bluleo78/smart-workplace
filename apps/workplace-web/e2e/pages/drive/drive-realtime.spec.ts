// WP-36/WP-63 — 드라이브 resource.changed 실시간 반영 E2E.
// /api/v1/events 를 게이트 모킹해 프레임을 첫 렌더 *뒤에* 흘려보내고, 재조회로 화면이 바뀌는지 본다.
import type { Page } from '@playwright/test'

import { createFile, createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockGatedEvents } from '../../fixtures/gatedEvents'

const SPACE_ID = 1

// 공간 목록 — 가변 상태(클로저)로 팀스페이스 추가를 흉내낸다.
async function stubSpaces(page: Page, getSpaces: () => unknown[]) {
  await page.route(
    (url) => url.pathname === '/api/v1/drive/spaces',
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getSpaces()) })
        : route.fallback(),
  )
}

// 항목 목록 — 쓰기 요청은 fallback(404 등)으로 드러낸다.
async function stubItems(page: Page, getState: () => { folders: unknown[]; files: unknown[] }) {
  await page.route(
    (url) => url.pathname === `/api/v1/drive/spaces/${SPACE_ID}/items`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getState()) })
        : route.fallback(),
  )
}

// resource.changed 프레임 — 서버가 보내는 drive/drive-space payload(attrs 는 spaceId 만).
function frame(resource: 'drive' | 'drive-space', op: 'created' | 'updated' | 'deleted', ids: number[] = []) {
  const data = { resource, op, scopeType: 'USER', scopeId: 1, spaceId: SPACE_ID, ids, actorId: 99 }
  return `event: resource.changed\ndata: ${JSON.stringify(data)}\n\n`
}

test.describe('드라이브 실시간 반영 (WP-63)', () => {
  test('파일 생성 이벤트 — 새 파일 행이 나타난다', async ({ authenticatedPage: page }) => {
    let state = { folders: [] as unknown[], files: [createFile({ id: 20, name: 'a.txt' })] as unknown[] }
    await stubSpaces(page, () => [personalSpace(), createSpace()])
    await stubItems(page, () => state)
    const events = await mockGatedEvents(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('select-file-20')).toBeVisible()
    await expect(page.getByText('new.txt')).toHaveCount(0)

    state = { ...state, files: [...state.files, createFile({ id: 21, name: 'new.txt' })] }
    events.deliver(frame('drive', 'created', [21]))

    await expect(page.getByText('new.txt')).toBeVisible()
  })

  test('선택 보존 — 재조회 후에도 체크와 선택 개수가 유지된다', async ({ authenticatedPage: page }) => {
    let state = {
      folders: [] as unknown[],
      files: [createFile({ id: 20, name: 'a.txt' }), createFile({ id: 21, name: 'b.txt' })] as unknown[],
    }
    await stubSpaces(page, () => [personalSpace(), createSpace()])
    await stubItems(page, () => state)
    const events = await mockGatedEvents(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await page.getByTestId('select-file-20').check()
    await page.getByTestId('select-file-21').check()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 2개')

    state = { ...state, files: [...state.files, createFile({ id: 22, name: 'c.txt' })] }
    events.deliver(frame('drive', 'created', [22]))

    await expect(page.getByText('c.txt')).toBeVisible()
    await expect(page.getByTestId('select-file-20')).toBeChecked()
    await expect(page.getByTestId('select-file-21')).toBeChecked()
    await expect(page.getByTestId('select-file-22')).not.toBeChecked()
    await expect(page.getByTestId('bulk-toolbar')).toContainText('선택 2개')
  })

  test('사이드바 — drive-space 이벤트로 새 팀스페이스가 표시된다', async ({ authenticatedPage: page }) => {
    let spaces: unknown[] = [personalSpace(), createSpace()]
    await stubSpaces(page, () => spaces)
    await stubItems(page, () => ({ folders: [], files: [] }))
    const events = await mockGatedEvents(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('drive-space-list')).toContainText('팀 공간')
    await expect(page.getByText('신규 팀스페이스')).toHaveCount(0)

    spaces = [...spaces, createSpace({ id: 7, name: '신규 팀스페이스' })]
    events.deliver(frame('drive-space', 'created', [7]))

    await expect(page.getByTestId('drive-space-list')).toContainText('신규 팀스페이스')
  })

  test('휴지통 조회 실패 — 이후 drive 이벤트가 와도 목록 화면을 유지한다', async ({ authenticatedPage: page }) => {
    await stubSpaces(page, () => [personalSpace(), createSpace()])
    await stubItems(page, () => ({ folders: [], files: [createFile({ id: 20, name: 'a.txt' })] }))
    let trashOk = false
    await page.route('**/api/v1/drive/spaces/*/trash', (route) =>
      trashOk
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
        : route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    )
    const events = await mockGatedEvents(page)

    await page.goto(`/drive/spaces/${SPACE_ID}`)
    await expect(page.getByTestId('select-file-20')).toBeVisible()
    await page.getByTestId('trash-toggle').click()
    await expect(page.getByTestId('trash-view')).toHaveCount(0)

    // 휴지통이 복구된 뒤 이벤트가 와도 사용자가 다시 열기 전엔 휴지통 뷰로 바뀌지 않는다.
    trashOk = true
    events.deliver(frame('drive', 'updated'))
    await page.waitForTimeout(500)
    await expect(page.getByTestId('trash-view')).toHaveCount(0)
    await expect(page.getByTestId('select-file-20')).toBeVisible()
  })
})
