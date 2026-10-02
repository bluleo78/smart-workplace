// 위키 원격 수정 반영 E2E (WP-170) — 노트를 열어 둔 채 AI 비서·다른 탭이 같은 노트를 저장하면
// wiki.page.updated SSE → 페이지 재조회 → 열린 에디터의 본문·제목·version 이 새로고침 없이 바뀌어야 한다.
// 저장하지 않은 내 편집이 있으면 덮어쓰지 않고 '최신 내용 불러오기' 배너를 띄운다.
// 백엔드는 page.route 로 흉내 낸다: version 이 서버와 다르면 409(낙관적 동시성), 같으면 저장 + version+1.
import type { WikiPageDetail, WikiSpace } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockGatedEvents } from '../../fixtures/gatedEvents'

const SPACE_ID = 1
const PAGE_ID = 100

function personalSpace(): WikiSpace {
  return {
    id: SPACE_ID,
    type: 'PERSONAL',
    name: '내 위키',
    ownerId: 1,
    role: 'OWNER',
    createdAt: '2026-06-01T00:00:00Z',
  }
}

/** 서버 상태 흉내 — GET 은 현재 상태를, PUT 은 version 이 맞을 때만 저장한다. */
interface FakeServer {
  title: string
  body: string
  version: number
  puts: { version: number; body: string; status: number }[]
}

function detail(s: FakeServer): WikiPageDetail {
  return {
    id: PAGE_ID,
    spaceId: SPACE_ID,
    parentId: null,
    title: s.title,
    body: s.body,
    version: s.version,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

async function mockWiki(page: import('@playwright/test').Page, server: FakeServer) {
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => route.fulfill({ json: [personalSpace()] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.fulfill({ json: [{ id: PAGE_ID, parentId: null, title: server.title, position: 0, aiLastUsedAt: null }] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}/mentions`,
    (route) => route.fulfill({ json: [] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}/backlinks`,
    (route) => route.fulfill({ json: [] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/pages/${PAGE_ID}`,
    (route) => {
      if (route.request().method() === 'PUT') {
        const req = route.request().postDataJSON() as { title: string; body: string; version: number }
        if (req.version !== server.version) {
          server.puts.push({ version: req.version, body: req.body, status: 409 })
          return route.fulfill({ status: 409, json: { message: `다른 사용자가 먼저 수정했습니다: page=${PAGE_ID}` } })
        }
        server.title = req.title
        server.body = req.body
        server.version += 1
        server.puts.push({ version: req.version, body: req.body, status: 200 })
        return route.fulfill({ json: detail(server) })
      }
      return route.fulfill({ json: detail(server) })
    },
  )
}

/** 다른 곳(AI 비서 등)에서 저장된 것처럼 서버 상태를 바꾼다. */
function remoteSave(server: FakeServer, title: string, body: string) {
  server.title = title
  server.body = body
  server.version += 1
}

const updatedFrame = `event: wiki.page.updated\ndata: ${JSON.stringify({ spaceId: SPACE_ID, pageId: PAGE_ID, title: 'x', actorId: 2 })}\n\n`

test('위키 — 편집 중이 아닐 때 다른 곳의 수정이 새로고침 없이 에디터에 반영되고 다음 저장은 새 version 을 싣는다', async ({
  authenticatedPage: page,
}) => {
  const server: FakeServer = { title: '원래 제목', body: '원래 본문', version: 1, puts: [] }
  await mockWiki(page, server)
  const events = await mockGatedEvents(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror')
  const title = page.getByPlaceholder('제목 없음')
  await expect(editor).toHaveText('원래 본문')
  await expect(title).toHaveValue('원래 제목')

  // AI 비서가 같은 노트를 저장 → SSE 알림.
  remoteSave(server, 'AI가 고친 제목', 'AI가 고친 본문')
  const refetch = page.waitForResponse(
    (r) => r.url().endsWith(`/api/v1/wiki/pages/${PAGE_ID}`) && r.request().method() === 'GET',
  )
  events.deliver(updatedFrame)
  await refetch

  await expect(editor).toHaveText('AI가 고친 본문')
  await expect(title).toHaveValue('AI가 고친 제목')
  await expect(page.getByTestId('wiki-remote-stale')).toHaveCount(0)
  // 교체 자체는 사용자 편집이 아니므로 자동저장을 일으키지 않는다.
  expect(server.puts).toHaveLength(0)

  // 이어서 편집하면 원격 수정본의 version(2)으로 저장돼 충돌이 나지 않는다.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 그리고 내 수정')
  await expect.poll(() => server.puts.length).toBe(1)
  expect(server.puts[0]).toMatchObject({ version: 2, status: 200 })
  expect(server.puts[0].body).toContain('AI가 고친 본문 그리고 내 수정')
  await expect(page.getByTestId('wiki-save-state')).toHaveText('저장됨')
  // 내 저장의 self-echo(같은 version)는 원격 수정으로 오인하지 않는다.
  await expect(page.getByTestId('wiki-remote-stale')).toHaveCount(0)
})

test('위키 — 저장 전 내 편집이 있으면 원격 수정으로 덮어쓰지 않고 최신 내용 불러오기를 제안한다', async ({
  authenticatedPage: page,
}) => {
  const server: FakeServer = { title: '원래 제목', body: '원래 본문', version: 1, puts: [] }
  await mockWiki(page, server)
  const events = await mockGatedEvents(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror')
  await expect(editor).toHaveText('원래 본문')

  // 내가 입력하는 사이(디바운스 대기 중) AI 비서가 저장한다. 내 자동저장이 먼저 나가 409 가 나든,
  // SSE 가 먼저 와 대기 중으로 판정되든 결과는 같아야 한다 — 내 입력을 지우지 않고 배너를 띄운다.
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 내 입력')
  remoteSave(server, 'AI가 고친 제목', 'AI가 고친 본문')
  events.deliver(updatedFrame)

  const banner = page.getByTestId('wiki-remote-stale')
  await expect(banner).toBeVisible()
  await expect(editor).toHaveText('원래 본문 내 입력')
  // 내 편집은 옛 version(1)으로만 저장 시도된다 — 서버의 AI 수정본을 덮어쓰지 않는다.
  await expect.poll(() => server.puts.length).toBeGreaterThan(0)
  expect(server.puts.every((p) => p.status === 409)).toBe(true)
  expect(server.body).toBe('AI가 고친 본문')

  // 최신 내용 불러오기 → 원격 수정본으로 교체, 배너·충돌 해제.
  await banner.getByRole('button', { name: '최신 내용 불러오기' }).click()
  await expect(editor).toHaveText('AI가 고친 본문')
  await expect(page.getByPlaceholder('제목 없음')).toHaveValue('AI가 고친 제목')
  await expect(banner).toHaveCount(0)
  // 저장 상태 칩은 idle 이면 렌더되지 않으므로 '충돌' 칩이 없어졌는지로 확인한다.
  await expect(page.getByTestId('wiki-save-state').filter({ hasText: '충돌' })).toHaveCount(0)

  // 이후 편집은 새 version(2)으로 정상 저장된다.
  const putsBefore = server.puts.length
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' 다시 편집')
  await expect.poll(() => server.puts.length).toBe(putsBefore + 1)
  expect(server.puts.at(-1)).toMatchObject({ version: 2, status: 200 })
  expect(server.body).toContain('AI가 고친 본문 다시 편집')
})
