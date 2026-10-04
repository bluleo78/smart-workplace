// 위키 원격 수정 반영 E2E (WP-170) — 노트를 열어 둔 채 AI 비서·다른 탭이 같은 노트를 저장하면
// wiki.page.updated SSE → 페이지 재조회 → 열린 에디터의 본문·제목·version 이 새로고침 없이 바뀌어야 한다.
// 저장하지 않은 내 편집이 있으면 덮어쓰지 않고 '최신 내용 불러오기' 배너를 띄운다.
// 백엔드는 page.route 로 흉내 낸다: version 이 서버와 다르면 409(낙관적 동시성), 같으면 저장 + version+1.
import type { Page } from '@playwright/test'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockGatedEvents } from '../../fixtures/gatedEvents'
import { expectStays } from '../../fixtures/wait'
import { buildWikiAiSse } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 100

/** 서버 상태 흉내 — GET 은 현재 상태를, PUT 은 version 이 맞을 때만 저장한다. */
interface FakeServer {
  title: string
  body: string
  version: number
  puts: { version: number; body: string; status: number }[]
  /** 설정되면 409 응답을 이 promise 가 풀릴 때까지 보류한다(저장 진행 중 상태 재현용). */
  hold409?: Promise<void>
}

function detail(s: FakeServer) {
  return wikiPageDetail({ id: PAGE_ID, spaceId: SPACE_ID, title: s.title, body: s.body, version: s.version })
}

/** 모든 테스트의 출발 상태 — 서버에 v1 '원래 본문'. */
function initialServer(extra: Partial<FakeServer> = {}): FakeServer {
  return { title: '원래 제목', body: '원래 본문', version: 1, puts: [], ...extra }
}

async function mockWiki(page: Page, server: FakeServer) {
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => route.fulfill({ json: [wikiSpace({ id: SPACE_ID, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) =>
      route.fulfill({ json: [wikiPageSummary({ id: PAGE_ID, title: server.title })] }),
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
    async (route) => {
      if (route.request().method() === 'PUT') {
        const req = route.request().postDataJSON() as { title: string; body: string; version: number }
        if (req.version !== server.version) {
          server.puts.push({ version: req.version, body: req.body, status: 409 })
          if (server.hold409) await server.hold409
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
function remoteSave(server: FakeServer, title = 'AI가 고친 제목', body = 'AI가 고친 본문') {
  server.title = title
  server.body = body
  server.version += 1
}

/** 에디터 본문 끝에 이어서 입력한다. */
async function typeAtEnd(page: Page, text: string) {
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
}

const updatedFrame = `event: wiki.page.updated\ndata: ${JSON.stringify({ spaceId: SPACE_ID, pageId: PAGE_ID, title: 'x', actorId: 2 })}\n\n`

test('위키 — 편집 중이 아닐 때 다른 곳의 수정이 새로고침 없이 에디터에 반영되고 다음 저장은 새 version 을 싣는다', async ({
  authenticatedPage: page,
}) => {
  const server = initialServer()
  await mockWiki(page, server)
  const events = await mockGatedEvents(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror')
  const title = page.getByPlaceholder('제목 없음')
  await expect(editor).toHaveText('원래 본문')
  await expect(title).toHaveValue('원래 제목')

  // AI 비서가 같은 노트를 저장 → SSE 알림.
  remoteSave(server)
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
  await typeAtEnd(page, ' 그리고 내 수정')
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
  const server = initialServer()
  await mockWiki(page, server)
  const events = await mockGatedEvents(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror')
  await expect(editor).toHaveText('원래 본문')

  // 내가 입력하는 사이(디바운스 대기 중) AI 비서가 저장한다. 내 자동저장이 먼저 나가 409 가 나든,
  // SSE 가 먼저 와 대기 중으로 판정되든 결과는 같아야 한다 — 내 입력을 지우지 않고 배너를 띄운다.
  await typeAtEnd(page, ' 내 입력')
  remoteSave(server)
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
  await typeAtEnd(page, ' 다시 편집')
  await expect.poll(() => server.puts.length).toBe(putsBefore + 1)
  expect(server.puts.at(-1)).toMatchObject({ version: 2, status: 200 })
  expect(server.body).toContain('AI가 고친 본문 다시 편집')
})

test('위키 — 옛 version 저장이 진행 중일 때 최신 내용을 불러오면 뒤늦은 409 로 충돌 상태에 갇히지 않는다', async ({
  authenticatedPage: page,
}) => {
  let release!: () => void
  const server = initialServer({ hold409: new Promise<void>((r) => (release = r)) })
  await mockWiki(page, server)
  const events = await mockGatedEvents(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror')
  await expect(editor).toHaveText('원래 본문')

  // 입력 직후 원격 저장 알림 → 배너. 이어서 디바운스가 끝나 옛 version(1) 저장이 나가고, 서버가 그 409 를 보류한다.
  await typeAtEnd(page, ' 내 입력')
  remoteSave(server)
  events.deliver(updatedFrame)
  const banner = page.getByTestId('wiki-remote-stale')
  await expect(banner).toBeVisible()
  await expect.poll(() => server.puts.length).toBe(1)

  // 저장이 진행 중인 채로 최신 내용을 불러온 뒤, 보류했던 409 를 돌려준다.
  await banner.getByRole('button', { name: '최신 내용 불러오기' }).click()
  await expect(editor).toHaveText('AI가 고친 본문')
  release()

  // 옛 저장의 409 는 무시된다 — 충돌 배너·칩이 뜨지 않고 다음 편집이 새 version(2)으로 저장된다.
  await typeAtEnd(page, ' 다시 편집')
  await expect.poll(() => server.puts.length).toBe(2)
  expect(server.puts[1]).toMatchObject({ version: 2, status: 200 })
  await expect(page.getByText('다른 사용자가 먼저 수정했습니다.', { exact: false })).toHaveCount(0)
  await expect(page.getByTestId('wiki-save-state')).toHaveText('저장됨')
})

test('위키 — AI 생성 중 최신 내용을 불러오면 생성을 취소해 AI 출력이 최신본에 섞이지 않는다', async ({
  authenticatedPage: page,
}) => {
  const server = initialServer()
  await mockWiki(page, server)

  // /ai 시작 → correlationId, 취소(DELETE) 캡처.
  let startedResolve!: (id: string) => void
  const started = new Promise<string>((r) => (startedResolve = r))
  const cancelled: string[] = []
  await page.route('**/api/v1/wiki/pages/*/ai', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    startedResolve('corr-1')
    return route.fulfill({ json: { correlationId: 'corr-1' } })
  })
  await page.route('**/api/v1/wiki/pages/*/ai/*', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    cancelled.push(route.request().url().split('/').pop() as string)
    return route.fulfill({ json: {} })
  })

  // 첫 /events 응답: AI 델타 일부 + 다른 곳의 저장 알림(아직 done 없음 → 생성 중).
  // 재연결 응답: 불러오기 클릭 뒤에야 나머지 델타 + done — 취소됐으면 삽입되지 않아야 한다.
  let clickedResolve!: () => void
  const clicked = new Promise<void>((r) => (clickedResolve = r))
  let eventsReq = 0
  let lateDelivered = false
  await page.route('**/api/v1/events', async (route) => {
    eventsReq += 1
    if (eventsReq <= 2) {
      // StrictMode 이중 마운트로 첫 연결이 2번 올 수 있다 — 둘 다 같은 본문(취소된 쪽은 버려짐).
      await started
      remoteSave(server)
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: buildWikiAiSse(['앞부분 '], 'corr-1', false) + updatedFrame })
    }
    await clicked
    lateDelivered = true
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: buildWikiAiSse(['뒷부분'], 'corr-1'),
    })
  })

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror')
  await expect(editor).toHaveText('원래 본문')
  await typeAtEnd(page, '/')
  await page.getByTestId('wiki-slash-option-continue').click()

  const banner = page.getByTestId('wiki-remote-stale')
  await expect(banner).toBeVisible()
  await expect(page.getByTestId('wiki-ai-busy')).toBeVisible()

  await banner.getByRole('button', { name: '최신 내용 불러오기' }).click()
  clickedResolve()
  await expect(editor).toHaveText('AI가 고친 본문')
  await expect(page.getByTestId('wiki-ai-busy')).toHaveCount(0)
  await expect.poll(() => cancelled).toEqual(['corr-1'])

  // 늦게 도착한 델타는 무시된다. 재연결 응답이 실제로 전달된 뒤 렌더 반영 여유를 두고 부재를 확인한다 —
  // "일어나지 않음" 확인이라 짧은 고정 대기가 불가피하다.
  await expect.poll(() => lateDelivered, { timeout: 10_000 }).toBe(true)
  await expectStays(page, async () => (await editor.textContent())?.trim(), 'AI가 고친 본문', { ms: 500 })
  expect(server.body).toBe('AI가 고친 본문')
})
