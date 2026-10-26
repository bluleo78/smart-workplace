// WP-301 노트 상단 AI 요약 카드 E2E — GET/POST /wiki/pages/{id}/summary 를 모킹한다.
//
// 카드는 제목 아래·본문 위에 놓이고, 요약이 없으면(MISSING) 노트당 한 번 자동 생성한다.
// 낡음은 요약 캐시의 status 로 그린다 — 본문은 동기화 서버(Yjs)가 파생 저장하며 version 을 올리고(WP-287), 편집기는
// wiki.page.updated SSE → 페이지 재조회로 새 version 을 알게 되면 캐시를 STALE 로 맞춘다. 제목만 저장은 version 을 올리지 않는다.
// 문단형·비노출(TOO_SHORT·UNAVAILABLE)·서버 STALE·실패 뒤 다시 시도·노트 이동 격리·AI 불가는 src/components/wiki/WikiSummaryCard.test.tsx,
// 뷰어도 카드를 보는지는 src/pages/wiki/wikiPage.test.tsx 가 지킨다(WP-983).
import type { Page } from '@playwright/test'
import { REVALIDATE_REASON_DELETED } from '@smart-workplace/wiki-editor-schema/collab-protocol'
import type { WikiPageDetail, WikiPageSummary, WikiPageSummaryState, WikiRole, WikiSpace, WikiSummaryStatus } from '../../../src/types/wiki'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { changeCollabRole, collabNsOf, seedCollabFor } from '../../fixtures/collab'
import { mockGatedEvents } from '../../fixtures/gatedEvents'
import { wikiEditorOpener } from '../../fixtures/wiki-mock'

const SPACE_ID = 1
const PAGE_ID = 300
const OTHER_ID = 301
const LONG = '## 회의\n' + '결정 사항을 정리한다. '.repeat(40)

function space(role: WikiRole): WikiSpace {
  return {
    id: SPACE_ID,
    type: 'TEAM',
    name: '팀 위키',
    ownerId: 1,
    role,
    createdAt: '2026-06-01T00:00:00Z',
  }
}

const TITLES: Record<number, string> = { [PAGE_ID]: '회의록', [OTHER_ID]: '짧은 메모' }

function pageDetail(id: number, body: string, version = 1): WikiPageDetail {
  return {
    id,
    spaceId: SPACE_ID,
    parentId: null,
    title: TITLES[id],
    body,
    version,
    updatedBy: 1,
    updatedAt: '2026-06-01T00:00:00Z',
    aiLastUsedAt: null,
    aiLastAction: null,
  }
}

// 공통 모킹: 스페이스(역할 가변) + 트리(PAGE_ID·OTHER_ID) + 페이지 GET + 동기화 문서 시드.
// 본문 저장은 REST PUT 이 아니라 동기화 서버의 파생 저장이므로, 그 결과(version+1 + wiki.page.updated)는 notifyUpdated 로 흉내 낸다.
async function setupWikiMocks(page: Page, role: WikiRole = 'OWNER') {
  // GET 전용 고정 응답은 공용 mockApi 로(다른 메서드는 fallback).
  await mockApi(page, 'GET', '/api/v1/wiki/spaces', [space(role)])
  await mockApi(page, 'GET', `/api/v1/wiki/spaces/${SPACE_ID}/pages`, [
    { id: PAGE_ID, parentId: null, title: TITLES[PAGE_ID], position: 0, aiLastUsedAt: null },
    { id: OTHER_ID, parentId: null, title: TITLES[OTHER_ID], position: 1, aiLastUsedAt: null },
  ] satisfies WikiPageSummary[])
  await mockApi(page, 'GET', `/api/v1/wiki/spaces/${SPACE_ID}/members`, [])
  const bodies: Record<number, string> = { [PAGE_ID]: LONG, [OTHER_ID]: '짧다' }
  const versions: Record<number, number> = { [PAGE_ID]: 1, [OTHER_ID]: 1 }
  // 에디터 본문은 동기화 서버 문서에서 온다 — 열기 전에 시드한다(시드는 열린 문서를 닫으므로 goto 전 1회).
  for (const id of [PAGE_ID, OTHER_ID]) await seedCollabFor(page, id, bodies[id], role)
  const events = await mockGatedEvents(page)
  await page.route(
    (url) => /^\/api\/v1\/wiki\/pages\/\d+$/.test(url.pathname),
    (route) => {
      const id = Number(new URL(route.request().url()).pathname.split('/').pop())
      const method = route.request().method()
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(pageDetail(id, bodies[id], versions[id])),
        })
      }
      return route.fallback()
    },
  )
  /**
   * 서버 쪽 노트 변경 알림을 흉내 낸다 — bumpVersion 이면 동기화 서버의 본문 파생 저장(version+1), 아니면 제목만 저장(version 그대로).
   * wiki.page.updated 를 보내고 그에 따른 페이지 재조회 응답까지 기다린다. 게이트 SSE 라 테스트당 한 번만 부를 수 있다.
   */
  async function notifyUpdated(opts: { bumpVersion: boolean }) {
    if (opts.bumpVersion) versions[PAGE_ID] += 1
    const refetch = page.waitForResponse(
      (r) => new URL(r.url()).pathname === `/api/v1/wiki/pages/${PAGE_ID}` && r.request().method() === 'GET',
    )
    events.deliver(
      `event: wiki.page.updated\ndata: ${JSON.stringify({ spaceId: SPACE_ID, pageId: PAGE_ID, title: TITLES[PAGE_ID], actorId: 1 })}\n\n`,
    )
    await refetch
  }
  return { notifyUpdated }
}

/** 본문 편집 — 문서 끝에 글자를 쳐 넣는다(동기화 서버 문서에 들어감). 저장 결과 알림은 notifyUpdated 로 따로 보낸다. */
async function typeAtEnd(page: Page, text: string) {
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
}

/**
 * summary 모킹: 초기 GET 응답과 POST 응답(또는 실패)을 지정. 호출 수를 센다.
 * hold 를 주면 POST 응답을 그 Promise 가 풀릴 때까지 붙잡는다 — 「생성 중」 화면을 시간이 아니라 테스트가 정한 시점까지 유지해,
 * 부하로 노트가 늦게 열려도 로딩 표시가 먼저 사라지지 않게 한다.
 */
async function mockSummary(
  page: Page,
  opts: { initial: WikiPageSummaryState; post?: WikiPageSummaryState | 'fail'; hold?: Promise<void>; pageId?: number },
) {
  let current = opts.initial
  const calls = { get: 0, post: 0 }
  await page.route(`**/api/v1/wiki/pages/${opts.pageId ?? PAGE_ID}/summary`, async (route) => {
    if (route.request().method() === 'GET') {
      calls.get++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) })
    }
    calls.post++
    if (opts.hold) await opts.hold
    if (opts.post === 'fail' || !opts.post) {
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: '노트 요약 AI 요청에 실패했습니다.' }),
      })
    }
    current = opts.post
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) })
  })
  return calls
}

/** 테스트가 직접 푸는 Promise — mockSummary 의 hold 로 POST 응답 시점을 정한다. */
function gate() {
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  return { held, release }
}

/** 요약 상태 빌더 — 기본은 요약 없는 version 1 상태, over 로 필드를 덮는다. */
const state = (status: WikiSummaryStatus, over: Partial<WikiPageSummaryState> = {}): WikiPageSummaryState => ({
  summary: null,
  status,
  summaryVersion: null,
  pageVersion: 1,
  summarizedAt: null,
  ...over,
})
const ready = (v = 1, summary = '배포를 10/9 로 확정했다.') =>
  state('READY', { summary, summaryVersion: v, pageVersion: v, summarizedAt: '2026-10-08T05:20:00Z' })
const missing = () => state('MISSING')
const tooShort = () => state('TOO_SHORT')

const open = wikiEditorOpener(SPACE_ID, PAGE_ID)

test('긴 노트를 열면 자동으로 요약을 만들어 제목 아래·본문 위에 카드로 보여 준다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  const post = gate()
  const calls = await mockSummary(page, { initial: missing(), post: ready(), hold: post.held })
  await open(page)

  const card = page.getByTestId('wiki-ai-summary')
  await expect(page.getByTestId('wiki-ai-summary-loading')).toBeVisible()
  post.release()
  await expect(card).toContainText('배포를 10/9 로 확정했다.')
  await expect(card).toContainText('10/8')
  await expect(page.getByTestId('wiki-ai-summary-loading')).toHaveCount(0)
  expect(calls.post).toBe(1)

  // 시안 A — 제목 입력칸 아래, 본문(.ProseMirror) 위.
  const titleBox = await page.getByPlaceholder('제목 없음').boundingBox()
  const cardBox = await card.boundingBox()
  const bodyBox = await page.locator('.ProseMirror').boundingBox()
  expect(titleBox && cardBox && bodyBox).toBeTruthy()
  expect(cardBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height)
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(bodyBox!.y)
})

test('목록형 요약은 목록으로 그려 항목마다 한 줄씩, 긴 항목은 기호 뒤로 들여써 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  const items = ['배포를 10/9 로 확정했다.', 'QA 는 수요일까지 마친다.', '롤백 기준은 오류율 2%.']
  await mockSummary(page, { initial: ready(1, items.map((t) => `• ${t}`).join('\n')) })
  await open(page)

  // 스크린리더에도 목록으로 읽히고, 항목은 기호(•)를 뗀 문장이다.
  const list = page.getByTestId('wiki-ai-summary-text')
  await expect(list.getByRole('listitem')).toHaveText(items)
  // 항목이 한 줄씩 아래로 쌓인다.
  const boxes = await list.getByRole('listitem').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))
  expect(boxes[1]).toBeGreaterThan(boxes[0])
  expect(boxes[2]).toBeGreaterThan(boxes[1])
  // 항목 글자는 카드 왼쪽 끝보다 안쪽(기호 뒤)에서 시작한다 — 줄바꿈된 둘째 줄도 같은 들여쓰기를 따른다.
  const [listLeft, itemLeft] = await list.evaluate((el) => [
    el.getBoundingClientRect().left,
    el.querySelector('li')!.getBoundingClientRect().left,
  ])
  expect(itemLeft).toBeGreaterThan(listLeft)
})

// 버전 비교 분기 — 생성 중 저장한 뒤 도착한 요약의 낡음, TOO_SHORT 의 재조회, 같은 버전(제목만 바뀐 알림) 무시 — 는
// src/hooks/queries/useWikiSummary.test.ts 가 본다(WP-410). 아래는 편집기 → 요약 캐시 → 카드 배선 확인.
test('저장으로 노트가 바뀌면 낡음 표시가 뜨고 다시 요약하면 새 요약으로 바뀐다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  const wiki = await setupWikiMocks(page)
  const calls = await mockSummary(page, { initial: ready(1), post: ready(2, '새 요약') })
  await open(page)

  const card = page.getByTestId('wiki-ai-summary')
  await expect(card).toContainText('배포를 10/9 로 확정했다.')
  await expect(page.getByTestId('wiki-ai-summary-stale')).toHaveCount(0)

  // 본문 편집 → 동기화 서버 파생 저장(version 2) → wiki.page.updated → 재조회 → 카드가 낡음으로 바뀐다.
  await typeAtEnd(page, ' 추가 내용')
  await wiki.notifyUpdated({ bumpVersion: true })
  await expect(page.getByTestId('wiki-ai-summary-stale')).toBeVisible()
  // READY/STALE 에서는 저장마다 요약을 다시 조회하지 않는다(TOO_SHORT 일 때만 재조회).
  expect(calls.get).toBe(1)

  await page.getByTestId('wiki-ai-summary-refresh').click()
  await expect(card).toContainText('새 요약')
  await expect(page.getByTestId('wiki-ai-summary-stale')).toHaveCount(0)
})

// WP-296 — 지워졌거나 접근을 잃은 노트에서는 요약을 다시 만들 수 없다 — 다시 시도를 거둬 헛된 행동을 권하지 않는다.
// 실패 문구는 남긴다 — 카드를 접으면 그 높이만큼 본문이 튀어 읽던 자리를 잃는다.
test('요약 실패 뒤 노트가 삭제되면 다시 시도 버튼을 거두고 카드 높이는 유지한다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  await mockSummary(page, { initial: missing(), post: 'fail' })
  await open(page)
  await expect(page.getByTestId('wiki-ai-summary-retry')).toBeVisible()

  await changeCollabRole(collabNsOf(page), PAGE_ID, 'NONE', REVALIDATE_REASON_DELETED)
  await expect(page.getByTestId('wiki-sync-status')).toHaveAttribute('data-status', 'deleted')
  await expect(page.getByTestId('wiki-ai-summary-retry')).toHaveCount(0)
  await expect(page.getByTestId('wiki-ai-summary-failed')).toBeVisible()
})

test('헤더 AI 메뉴·슬래시 메뉴에는 본문 삽입형 AI 요약이 없다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  // 요약은 상단 카드로 옮겼으므로 생성 계열은 초안·이어쓰기만 남는다.
  await setupWikiMocks(page, 'EDITOR')
  await mockSummary(page, { initial: tooShort() })
  await open(page)

  await page.getByTestId('wiki-ai-header-button').click()
  await expect(page.getByTestId('wiki-ai-header-draft')).toBeVisible()
  await expect(page.getByTestId('wiki-ai-header-continue')).toBeVisible()
  await expect(page.getByTestId('wiki-ai-header-summarize')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.locator('.ProseMirror').click()
  await page.keyboard.type('/')
  await expect(page.getByTestId('wiki-slash-option-continue')).toBeVisible()
  await expect(page.getByTestId('wiki-slash-option-summarize')).toHaveCount(0)
})
