// 위키 원격 제목 변경 반영 E2E (WP-170 → WP-172) — 노트를 열어 둔 채 AI 비서·다른 탭이 같은 노트의 제목을 바꾸면
// wiki.page.updated SSE → 페이지 재조회 → 열린 화면의 헤더 제목이 새로고침 없이 바뀌어야 한다.
// 본문은 실시간 동기화(Yjs)라 "다른 곳의 본문 수정이 열린 노트에 반영"과 옛 버전 충돌(409)·'최신 내용 불러오기'
// 시나리오는 사라졌다 — 그 의도는 wiki-collab.spec.ts 의 동시 편집·오프라인 병합 시나리오가 대신한다.
// 제목은 여전히 짧은 REST 저장이라 이 spec 이 SSE 모킹으로 원격 제목 반영(입력 중이면 덮지 않음)을 지킨다.
import type { Page } from '@playwright/test'

import { wikiPageDetail, wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { seedCollabFor } from '../../fixtures/collab'
import { mockGatedEvents } from '../../fixtures/gatedEvents'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

const SPACE_ID = 1
const PAGE_ID = 100

/** 서버 상태 흉내 — GET 은 현재 제목을 돌려준다. 본문은 일부러 동기화 문서와 다르게 둬 REST 본문이 에디터에 새지 않음을 본다. */
interface FakeServer {
  title: string
}

async function mockWiki(page: Page, server: FakeServer) {
  // 에디터 본문은 동기화 서버 문서에서 온다 — 열기 전에 한 번 시드한다.
  await seedCollabFor(page, PAGE_ID, '원래 본문')
  await page.route(
    (url) => url.pathname === '/api/v1/wiki/spaces',
    (route) => route.fulfill({ json: [wikiSpace({ id: SPACE_ID, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })] }),
  )
  await page.route(
    (url) => url.pathname === `/api/v1/wiki/spaces/${SPACE_ID}/pages`,
    (route) => route.fulfill({ json: [wikiPageSummary({ id: PAGE_ID, title: server.title })] }),
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
    (route) =>
      route.fulfill({
        json: wikiPageDetail({ id: PAGE_ID, spaceId: SPACE_ID, title: server.title, body: 'REST 본문(에디터에 쓰이면 안 됨)' }),
      }),
  )
}

const updatedFrame = `event: wiki.page.updated\ndata: ${JSON.stringify({ spaceId: SPACE_ID, pageId: PAGE_ID, title: 'AI가 고친 제목', actorId: 2 })}\n\n`

/** 원격 제목 변경 알림을 보내고, 그에 따른 페이지 재조회 응답까지 기다린다. */
async function deliverRemoteTitle(page: Page, server: FakeServer, events: { deliver(body: string): void }) {
  server.title = 'AI가 고친 제목'
  const refetch = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/api/v1/wiki/pages/${PAGE_ID}` && r.request().method() === 'GET',
  )
  events.deliver(updatedFrame)
  await refetch
}

test('위키 — 제목 입력 중이 아닐 때 다른 곳에서 제목을 바꾸면 내 헤더 제목이 새로고침 없이 바뀐다', async ({
  authenticatedPage: page,
}) => {
  const server: FakeServer = { title: '원래 제목' }
  await mockWiki(page, server)
  const events = await mockGatedEvents(page)
  const gets = trackRequests(page, 'GET', `/api/v1/wiki/pages/${PAGE_ID}`)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const editor = page.locator('.ProseMirror')
  const title = page.getByPlaceholder('제목 없음')
  await expect(editor).toHaveText('원래 본문')
  await expect(title).toHaveValue('원래 제목')
  await expect(title).not.toBeFocused()

  // AI 비서가 같은 노트의 제목을 바꿈 → SSE 알림 → 재조회.
  await deliverRemoteTitle(page, server, events)

  await expect(title).toHaveValue('AI가 고친 제목')
  // 사이드바 트리도 같은 알림으로 다시 불러와 새 제목을 보인다.
  await expect(page.getByRole('button', { name: 'AI가 고친 제목', exact: true })).toBeVisible()
  // 재조회한 REST 본문은 에디터를 건드리지 않는다 — 본문은 동기화 문서가 정한다. 새는 일이 있다면 재조회 뒤 비동기로
  // 일어나므로 한 번만 읽지 않고 일정 시간 그대로인지 지켜본다.
  await expectStays(page, async () => (await editor.textContent()) ?? '', '원래 본문', { ms: 500 })
  // 웹은 본문을 동기화 서버로 저장하므로 조회 때마다 AI 병합 기준본을 남기지 않게 base=false 를 보낸다(WP-289·291).
  expect(gets.urls().map((u) => u.searchParams.get('base'))).toEqual(gets.urls().map(() => 'false'))
  expect(gets.count()).toBeGreaterThanOrEqual(2)
})

test('위키 — 제목 입력란에 포커스가 있는 동안엔 원격 제목이 덮지 않고, 포커스를 떠나면 반영된다', async ({
  authenticatedPage: page,
}) => {
  const server: FakeServer = { title: '원래 제목' }
  await mockWiki(page, server)
  const events = await mockGatedEvents(page)

  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${PAGE_ID}`)
  const title = page.getByPlaceholder('제목 없음')
  await expect(page.locator('.ProseMirror')).toHaveText('원래 본문')
  await expect(title).toHaveValue('원래 제목')

  // 제목을 고치려고 입력란에 들어가 있는 사이 원격 변경이 온다 — 입력 중인 화면을 바꾸지 않는다.
  await title.focus()
  await deliverRemoteTitle(page, server, events)
  await expectStays(page, () => title.inputValue(), '원래 제목')

  // 입력란을 떠나면(아무것도 고치지 않았으니) 원격 제목으로 맞춘다.
  await page.locator('.ProseMirror').click()
  await expect(title).toHaveValue('AI가 고친 제목')
})
