// 드라이브 헤더 경로(§B-1, WP-979) — 데스크톱 풀페이지는 경로를 Page.Header 왼쪽 한 줄에 둔다.
// 시작점은 공간 이름(앱 이름 「드라이브」 없음), 휴지통은 「공간 › 휴지통」으로 모드를 보이고 공간을 누르면 모드를 나간다.
// 경로 항목에 끌어다 놓기·폭 접기는 브라우저가 필요해 drive-dnd-move.spec·drive.spec(E2E)이 지킨다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { DriveSpace } from '@/types/drive'

const space: DriveSpace = {
  id: 1,
  type: 'TEAM',
  name: '디자인 공간',
  ownerId: 1,
  role: 'OWNER',
  archived: false,
  createdAt: '2026-06-01T00:00:00Z',
}

/** 공간·쿼터·항목·폴더 경로(문서 › 2026)·빈 휴지통. */
const handlers = [
  http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 1024 * 1024 * 1024 })),
  http.get('/api/v1/drive/spaces', () => HttpResponse.json([space])),
  http.get('/api/v1/drive/spaces/:id', () => HttpResponse.json(space)),
  http.get('/api/v1/drive/spaces/:id/items', () => HttpResponse.json({ folders: [], files: [] })),
  http.get('/api/v1/drive/folders/10/path', () => HttpResponse.json([{ id: 5, name: '문서' }, { id: 10, name: '2026' }])),
  http.get('/api/v1/drive/folders/5/path', () => HttpResponse.json([{ id: 5, name: '문서' }])),
  http.get('/api/v1/drive/spaces/:id/trash', () => HttpResponse.json({ items: [] })),
]

test('폴더 안 — 헤더 경로가 「공간 › 문서 › 2026」이고 상위 폴더를 누르면 그 폴더로 간다', async () => {
  const { user, location } = renderPage('/drive/spaces/1?folderId=10', { handlers })
  const path = await screen.findByTestId('drive-breadcrumb', {}, { timeout: PAGE_LOAD_TIMEOUT })
  // 헤더 안 한 줄 — 따로 있던 경로 줄은 없다.
  expect(within(screen.getByTestId('page-header')).getByTestId('drive-breadcrumb')).toBe(path)
  await within(path).findByTestId('drive-crumb-10')
  expect(within(path).getByTestId('drive-root')).toHaveTextContent('디자인 공간')
  expect(within(path).getByTestId('drive-crumb-5')).toHaveTextContent('문서')
  expect(within(path).getByTestId('drive-crumb-10')).toHaveAttribute('aria-current', 'page')
  expect(path).not.toHaveTextContent('드라이브')

  await user.click(within(path).getByTestId('drive-crumb-5'))
  expect(location()).toBe('/drive/spaces/1?folderId=5')
})

test('휴지통 — 「공간 › 휴지통」으로 보이고 공간을 누르면 휴지통을 나간다', async () => {
  const { user, location } = renderPage('/drive/spaces/1?view=trash', { handlers })
  const mode = await screen.findByTestId('drive-breadcrumb-mode', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(mode).toHaveTextContent('휴지통')
  expect(mode).toHaveAttribute('aria-current', 'page')
  const path = screen.getByTestId('drive-breadcrumb')
  expect(within(path).getByTestId('drive-root')).toHaveTextContent('디자인 공간')

  await user.click(within(path).getByTestId('drive-root'))
  expect(location()).toBe('/drive/spaces/1')
  expect(screen.queryByTestId('drive-breadcrumb-mode')).toBeNull()
})
