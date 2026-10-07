// WP-301 노트 상단 AI 요약 카드 E2E — GET/POST /wiki/pages/{id}/summary 를 모킹한다.
//
// 카드는 제목 아래·본문 위에 놓이고, 요약이 없으면(MISSING) 노트당 한 번 자동 생성한다.
// 낡음은 요약 캐시의 status 로 그린다 — 본문은 동기화 서버(Yjs)가 파생 저장하며 version 을 올리고(WP-287), 편집기는
// wiki.page.updated SSE → 페이지 재조회로 새 version 을 알게 되면 캐시를 STALE 로 맞춘다. 제목만 저장은 version 을 올리지 않는다.
import type { Page } from '@playwright/test'
import type {
  WikiPageDetail,
  WikiPageSummary,
  WikiPageSummaryState,
  WikiRole,
  WikiSpace,
  WikiSummaryStatus,
} from '../../../src/types/wiki'
import { createUser } from '../../factories/auth.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { seedCollabFor } from '../../fixtures/collab'
import { mockGatedEvents } from '../../fixtures/gatedEvents'
import { expectStays } from '../../fixtures/wait'

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

/** summary 모킹: 초기 GET 응답과 POST 응답(또는 실패)을 지정. 호출 수를 센다. */
async function mockSummary(
  page: Page,
  opts: { initial: WikiPageSummaryState; post?: WikiPageSummaryState | 'fail'; delayMs?: number; pageId?: number },
) {
  let current = opts.initial
  // setCurrent — 이후 GET 이 돌려줄 상태를 바꾼다(저장으로 본문이 길어진 상황 등).
  const calls = { get: 0, post: 0, setCurrent: (s: WikiPageSummaryState) => void (current = s) }
  await page.route(`**/api/v1/wiki/pages/${opts.pageId ?? PAGE_ID}/summary`, async (route) => {
    if (route.request().method() === 'GET') {
      calls.get++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) })
    }
    calls.post++
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
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

async function openPage(page: Page, id = PAGE_ID) {
  await page.goto(`/wiki/spaces/${SPACE_ID}/pages/${id}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
}

test('긴 노트를 열면 자동으로 요약을 만들어 제목 아래·본문 위에 카드로 보여 준다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  const calls = await mockSummary(page, { initial: missing(), post: ready(), delayMs: 500 })
  await openPage(page)

  const card = page.getByTestId('wiki-ai-summary')
  await expect(page.getByTestId('wiki-ai-summary-loading')).toBeVisible()
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

test('목록형 요약은 목록으로 그려 항목마다 한 줄씩, 긴 항목은 기호 뒤로 들여써 보인다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  const items = ['배포를 10/9 로 확정했다.', 'QA 는 수요일까지 마친다.', '롤백 기준은 오류율 2%.']
  await mockSummary(page, { initial: ready(1, items.map((t) => `• ${t}`).join('\n')) })
  await openPage(page)

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

test('목록이 아닌 옛 문단형 요약은 원문 그대로 보인다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  await mockSummary(page, { initial: ready(1, '배포를 10/9 로 확정했다. QA 는 수요일까지 마친다.') })
  await openPage(page)

  const text = page.getByTestId('wiki-ai-summary-text')
  await expect(text).toHaveText('배포를 10/9 로 확정했다. QA 는 수요일까지 마친다.')
  await expect(text.getByRole('listitem')).toHaveCount(0)
})

// 카드 비노출 상태 — 짧은 노트(TOO_SHORT)·공용 비서 없음(UNAVAILABLE)은 같은 기대(카드 없음·생성 요청 없음)를 갖는다.
for (const { status, name } of [
  { status: 'TOO_SHORT', name: '짧은 노트는 요약 카드를 그리지 않고 생성도 요청하지 않는다' },
  {
    status: 'UNAVAILABLE',
    name: '공용 비서가 없어 요약할 수 없는 노트(UNAVAILABLE)는 카드를 그리지 않고 생성도 요청하지 않는다',
  },
] as const) {
  test(name, async ({ authenticatedPage: page }) => {
    await setupWikiMocks(page)
    const calls = await mockSummary(page, { initial: state(status) })
    await openPage(page)

    await expect.poll(() => calls.get).toBe(1)
    await expect(page.getByTestId('wiki-ai-summary')).toHaveCount(0)
    expect(calls.post).toBe(0)
  })
}

test('저장으로 노트가 바뀌면 낡음 표시가 뜨고 다시 요약하면 새 요약으로 바뀐다', async ({ authenticatedPage: page }) => {
  const wiki = await setupWikiMocks(page)
  const calls = await mockSummary(page, { initial: ready(1), post: ready(2, '새 요약') })
  await openPage(page)

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

test('요약 생성 중에 저장하면 도착한 요약을 낡음으로 표시한다', async ({ authenticatedPage: page }) => {
  // 생성 응답(pageVersion 1)이 저장(version 2) 뒤에 도착 — 응답만 믿으면 최신처럼 보이므로 노트 캐시 버전에 맞춰 STALE 로 본다.
  const wiki = await setupWikiMocks(page)
  await mockSummary(page, { initial: missing(), post: ready(1, 'A 요약'), delayMs: 3000 })
  await openPage(page)
  await expect(page.getByTestId('wiki-ai-summary-loading')).toBeVisible()

  await typeAtEnd(page, ' 생성 중 편집')
  await wiki.notifyUpdated({ bumpVersion: true })

  await expect(page.getByTestId('wiki-ai-summary')).toContainText('A 요약')
  await expect(page.getByTestId('wiki-ai-summary-stale')).toBeVisible()
})

test('서버가 STALE 로 알려 주면 편집기 버전이 같아도 낡음 표시를 보여 준다', async ({ authenticatedPage: page }) => {
  // 다른 사람이 저장해 서버만 낡음을 아는 상황 — summaryVersion 이 편집기 version(1)과 같아도 status 를 따른다.
  await setupWikiMocks(page)
  await mockSummary(page, { initial: { ...ready(1), status: 'STALE', pageVersion: 2 }, post: ready(2, '새 요약') })
  await openPage(page)

  await expect(page.getByTestId('wiki-ai-summary')).toContainText('배포를 10/9 로 확정했다.')
  await expect(page.getByTestId('wiki-ai-summary-stale')).toBeVisible()
})

test('짧던 노트가 저장으로 길어지면 상태를 다시 조회해 요약을 한 번 만든다', async ({ authenticatedPage: page }) => {
  const wiki = await setupWikiMocks(page)
  const calls = await mockSummary(page, { initial: tooShort(), post: ready(2, '길어진 노트 요약') })
  await openPage(page)
  await expect.poll(() => calls.get).toBe(1)
  await expect(page.getByTestId('wiki-ai-summary')).toHaveCount(0)

  // 저장 뒤 서버는 본문이 충분히 길어져 MISSING 으로 본다.
  calls.setCurrent({ ...missing(), pageVersion: 2 })
  await typeAtEnd(page, ' 내용을 더 쓴다')
  await wiki.notifyUpdated({ bumpVersion: true })

  await expect(page.getByTestId('wiki-ai-summary')).toContainText('길어진 노트 요약')
  await expect.poll(() => calls.get).toBe(2)
  await expectStays(page, () => calls.post, 1, { ms: 1000 })
})

test('제목만 바뀐 알림(version 그대로)은 요약을 낡음으로 만들지 않는다', async ({ authenticatedPage: page }) => {
  // 동시 편집 도입 후 version 은 본문 파생 저장 순번이라 제목 저장은 올리지 않는다 — 재조회가 와도 같은 version 이면 READY 유지.
  const wiki = await setupWikiMocks(page)
  const calls = await mockSummary(page, { initial: ready(1) })
  await openPage(page)
  await expect(page.getByTestId('wiki-ai-summary')).toContainText('배포를 10/9 로 확정했다.')

  await wiki.notifyUpdated({ bumpVersion: false })
  await expectStays(page, () => page.getByTestId('wiki-ai-summary-stale').count(), 0, { ms: 1000 })
  expect(calls.get).toBe(1)
})

test('요약 생성에 실패하면 한 번만 시도하고 다시 시도 버튼을 보여 준다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  const calls = await mockSummary(page, { initial: missing(), post: 'fail' })
  await openPage(page)

  const card = page.getByTestId('wiki-ai-summary')
  // 실패는 회색 한 줄이 아니라 오류 표시(아이콘 + 문구)로 보여 준다.
  await expect(page.getByTestId('wiki-ai-summary-failed')).toHaveText('요약하지 못했어요')
  // 자동 재시도 없음 — 2초 동안 POST 가 1건으로 유지돼야 한다.
  await expectStays(page, () => calls.post, 1, { ms: 2000 })

  await page.getByTestId('wiki-ai-summary-retry').click()
  await expect.poll(() => calls.post).toBe(2)
})

test('생성 중 다른 노트로 이동하면 이전 노트의 요약·로딩이 새 노트에 새지 않는다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page)
  const callsA = await mockSummary(page, { initial: missing(), post: ready(1, 'A 요약'), delayMs: 1500 })
  await mockSummary(page, { initial: tooShort(), pageId: OTHER_ID })
  await openPage(page)

  await expect(page.getByTestId('wiki-ai-summary-loading')).toBeVisible()
  await page.getByTestId(`wiki-tree-row-${OTHER_ID}`).click()
  await expect(page).toHaveURL(new RegExp(`/pages/${OTHER_ID}$`))
  await expect(page.getByPlaceholder('제목 없음')).toHaveValue(TITLES[OTHER_ID])

  // A 의 POST 가 끝날 때까지(1.5s) 지켜보며 OTHER 화면에 카드·A 요약이 나타나지 않는지 확인한다.
  await expectStays(page, () => page.getByTestId('wiki-ai-summary').count(), 0, { ms: 2000 })
  await expect(page.getByText('A 요약')).toHaveCount(0)
  expect(callsA.post).toBe(1)
})

test('뷰어도 요약 카드를 본다', async ({ authenticatedPage: page }) => {
  await setupWikiMocks(page, 'VIEWER')
  await mockSummary(page, { initial: ready() })
  await openPage(page)

  await expect(page.getByTestId('wiki-ai-summary')).toContainText('배포를 10/9 로 확정했다.')
})

test('AI 를 쓸 수 없는 사용자는 요약 조회 자체를 하지 않는다', async ({ authenticatedPage: page }) => {
  // aiAvailable:false 로 덮어씀 — 픽스처의 true 모킹보다 나중에 등록돼 우선 적용(LIFO).
  await mockApi(page, 'GET', '/api/v1/users/me', {
    ...createUser({ aiAvailable: false }),
    roles: [{ id: 2, name: 'USER', description: '일반 사용자', isSystem: true }],
  })
  await setupWikiMocks(page)
  const calls = await mockSummary(page, { initial: ready() })
  await openPage(page)

  await expectStays(page, () => calls.get, 0, { ms: 500 })
  await expect(page.getByTestId('wiki-ai-summary')).toHaveCount(0)
})

test('헤더 AI 메뉴·슬래시 메뉴에는 본문 삽입형 AI 요약이 없다', async ({ authenticatedPage: page }) => {
  // 요약은 상단 카드로 옮겼으므로 생성 계열은 초안·이어쓰기만 남는다.
  await setupWikiMocks(page, 'EDITOR')
  await mockSummary(page, { initial: tooShort() })
  await openPage(page)

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
