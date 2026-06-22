// #460: 홈 챗 도크 드라이브 위젯 렌더 — show_drive 지시를 받아
// 드라이브 스페이스 목록 또는 아이템(폴더/파일) 목록을 렌더하는지 검증한다.
// 전략: compose done SSE 에 widgets:[{type:'drive',...}] 를 포함시키고
//   위젯이 자체 훅으로 호출하는 /drive/spaces, /drive/spaces/:id/items 를 모킹한다.

import { expect, test } from '../fixtures/auth.fixture'

import type { DriveItemList, DriveSpace } from '../../src/types/drive'

// 팩토리 헬퍼 — 테스트용 최소 DriveSpace 생성.
function makeSpace(overrides: Partial<DriveSpace> & { id: number; name: string }): DriveSpace {
  return {
    type: 'TEAM',
    ownerId: 1,
    role: 'VIEWER',
    archived: false,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

// 팩토리 헬퍼 — 테스트용 DriveItemList 생성.
function makeItemList(overrides: Partial<DriveItemList>): DriveItemList {
  return {
    folders: [],
    files: [],
    ...overrides,
  }
}

test.describe('#460 홈 챗 도크 드라이브 위젯 렌더', () => {
  test(
    'drive 위젯이 스페이스 목록을 렌더한다(spaceId 미지정)',
    { tag: '@smoke' },
    async ({ authenticatedPage: pg }) => {
      // 1) compose → drive 위젯(spaceId 없음) 지시.
      await pg.route(
        (url) => url.pathname === '/api/v1/ai/chat',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"sessionId":"s-drive-1","widgets":[{"type":"drive","params":{}}]}\n\n',
          }),
      )
      // 2) 드라이브 스페이스 목록 API 모킹.
      await pg.route(
        (url) => url.pathname === '/api/v1/drive/spaces',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
              makeSpace({ id: 1, name: '개인 드라이브', type: 'PERSONAL' }),
              makeSpace({ id: 2, name: '팀 드라이브', type: 'TEAM' }),
            ]),
          }),
      )

      await pg.goto('/')
      await pg.getByTestId('chat-launcher').click()
      await pg.getByTestId('chat-input').fill('드라이브 보여줘')
      await pg.getByRole('button', { name: '보내기' }).click()

      // 위젯 컨테이너 + 스페이스 목록 확인.
      await expect(pg.getByTestId('chat-widgets')).toBeVisible()
      const items = pg.getByTestId('drive-items')
      await expect(items).toBeVisible()
      await expect(items).toContainText('개인 드라이브')
      await expect(items).toContainText('팀 드라이브')
    },
  )

  test(
    'drive 위젯이 아이템 목록을 렌더한다(spaceId 지정)',
    { tag: '@smoke' },
    async ({ authenticatedPage: pg }) => {
      // 1) compose → drive 위젯(spaceId=3) 지시.
      await pg.route(
        (url) => url.pathname === '/api/v1/ai/chat',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'text/event-stream',
            body: 'event: done\ndata: {"sessionId":"s-drive-2","widgets":[{"type":"drive","params":{"spaceId":3}}]}\n\n',
          }),
      )
      // 2) 드라이브 스페이스 목록(spaceId 있어도 호출될 수 있으므로 스텁).
      await pg.route(
        (url) => url.pathname === '/api/v1/drive/spaces',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
          }),
      )
      // 3) 스페이스 3 아이템 목록 모킹.
      await pg.route(
        (url) => url.pathname === '/api/v1/drive/spaces/3/items',
        (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              makeItemList({
                folders: [
                  { id: 10, parentId: null, name: '기획 문서', createdAt: '2024-01-01T00:00:00Z' },
                ],
                files: [
                  {
                    id: 20,
                    folderId: null,
                    fileId: 100,
                    name: '회의록.pdf',
                    mimeType: 'application/pdf',
                    sizeBytes: 1024,
                    category: 'DOCUMENT',
                    createdAt: '2024-01-01T00:00:00Z',
                    versionCount: 1,
                  },
                ],
              }),
            ),
          }),
      )

      await pg.goto('/')
      await pg.getByTestId('chat-launcher').click()
      await pg.getByTestId('chat-input').fill('팀 드라이브 파일 보여줘')
      await pg.getByRole('button', { name: '보내기' }).click()

      // 위젯 컨테이너 + 폴더/파일 목록 확인.
      await expect(pg.getByTestId('chat-widgets')).toBeVisible()
      const items = pg.getByTestId('drive-items')
      await expect(items).toBeVisible()
      // 폴더 먼저
      await expect(items).toContainText('기획 문서')
      // 그 다음 파일
      await expect(items).toContainText('회의록.pdf')
    },
  )

  test('drive 위젯이 스페이스 0건이면 빈 상태를 표시한다', async ({ authenticatedPage: pg }) => {
    await pg.route(
      (url) => url.pathname === '/api/v1/ai/chat',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          body: 'event: done\ndata: {"sessionId":"s-drive-3","widgets":[{"type":"drive","params":{}}]}\n\n',
        }),
    )
    await pg.route(
      (url) => url.pathname === '/api/v1/drive/spaces',
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        }),
    )

    await pg.goto('/')
    await pg.getByTestId('chat-launcher').click()
    await pg.getByTestId('chat-input').fill('드라이브 보여줘')
    await pg.getByRole('button', { name: '보내기' }).click()

    await expect(pg.getByTestId('chat-widgets')).toBeVisible()
    await expect(pg.getByTestId('drive-empty')).toBeVisible()
    await expect(pg.getByTestId('drive-empty')).toContainText('드라이브가 없어요')
  })
})
